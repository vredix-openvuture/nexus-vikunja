'use strict';

/* ============================================================================
 *  NEXUS VIKUNJA
 *  A companion to Nexus Suite: Vikunja projects as its kanban boards. The
 *  suite draws the board; this plugin registers the `vikunja` source that
 *  fills it (src/source.js), keeps a page per project (src/pages.js) and a
 *  note per task once one is wanted (src/tasknotes.js).
 * ========================================================================== */

const { Plugin, Modal, Notice, Setting, normalizePath } = require('obsidian');
const { VikunjaClient } = require('./client.js');
const { BoardStore } = require('./store.js');
const { vikunjaSource } = require('./source.js');
const { syncPages, pageIndex } = require('./pages.js');
const { safeName, noteIndex, openTaskNote } = require('./tasknotes.js');
const { VikunjaSettingTab, drawSettings, DEFAULT_SETTINGS, TOKEN_KEY } = require('./settings.js');

class NexusVikunja extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.store = new BoardStore(this.app, () => this.client(), () => this.webBase());
    // Every board of the source is redrawn when a fetch settles, not only the
    // one that asked — see store.js.
    this.store.onSettled = () => { const k = this.suiteKanban(); if (k) k.repaintSource('vikunja'); };
    // The task-note index is a vault sweep; it is kept until the vault changes.
    const forget = () => { this._taskNotes = null; };
    this.registerEvent(this.app.metadataCache.on('changed', forget));
    ['create', 'delete', 'rename'].forEach(ev => this.registerEvent(this.app.vault.on(ev, forget)));
    try { this.migrateToken(); }
    catch (e) { console.warn('[nexus-vikunja] moving the token into the secret storage failed; it stays where it was:', e && e.message); }

    this.addCommand({ id: 'sync-projects', name: 'Sync projects (a page per Vikunja project)', callback: () => this.syncProjects(true) });
    this.addCommand({ id: 'refresh-boards', name: 'Refresh open Vikunja boards', callback: () => this.refreshBoards() });

    // The suite may load after this plugin, or be reloaded: it says so with
    // 'nexus-suite:ready', and then the source and the page are registered
    // (again). layout-change catches a suite that was turned off meanwhile.
    this.registerEvent(this.app.workspace.on('nexus-suite:ready', () => this.attach()));
    this.app.workspace.onLayoutReady(() => {
      this._layoutReady = true;
      this.attach();
      if (!this._unregister) new Notice('Nexus Vikunja needs Nexus Suite with its Kanban module turned on.');
      if (this.settings.syncOnStart && this.ready()) this.syncProjects(false);
      this.startTimer();
      this.registerEvent(this.app.workspace.on('layout-change', () => this.attach()));
    });
    this.attach();
  }

  attach() { this.registerSource(); this.registerSettings(); }

  onunload() {
    if (this._unregister) this._unregister();
    this._unregister = null;
    if (this._offSettings) this._offSettings();
    this._offSettings = null;
  }

  /* The settings as a page of Nexus Suite's own settings, under Add-ons — or,
     with no suite to host it (off, missing, too old), a tab of its own. Called
     whenever the suite may have come or gone. */
  registerSettings() {
    const suite = this.app.plugins && this.app.plugins.getPlugin ? this.app.plugins.getPlugin('nexus-suite') : null;
    if (!suite || typeof suite.registerSettingsPage !== 'function') {
      this._offSettings = null;
      this._settingsHost = null;
      if (this._layoutReady && !this._ownTab) { this._ownTab = new VikunjaSettingTab(this.app, this); this.addSettingTab(this._ownTab); }
      return;
    }
    if (this._ownTab) {
      try { this.app.setting.removeSettingTab(this._ownTab); } catch (e) { /* an Obsidian without it keeps both */ }
      this._ownTab = null;
    }
    if (this._offSettings && this._settingsHost === suite && suite.settingsPages && suite.settingsPages.has('nexus-vikunja')) return;
    this._settingsHost = suite;
    this._offSettings = suite.registerSettingsPage({
      id: 'nexus-vikunja', name: 'Vikunja', icon: 'square-kanban',
      sub: 'Vikunja projects as kanban boards: address, token, folders',
      display: (el) => drawSettings(this, el),
    });
  }
  /* Where the settings are right now, for the hints that send you there. */
  settingsPath() { return this._offSettings ? 'Settings → Nexus Suite → Add-ons → Vikunja' : 'Settings → Nexus Vikunja'; }

  /* Asked by the suite before it removes this add-on: what lives only on this
     device — the token, the offline copies of boards — goes with it. */
  forgetDeviceData() {
    this.setToken('');
    try {
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.indexOf('nexus-vikunja-board-') >= 0) keys.push(k);
      }
      keys.forEach(k => window.localStorage.removeItem(k));
    } catch (e) { console.warn('[nexus-vikunja] clearing the offline boards failed:', e && e.message); }
  }

  redrawSettings() {
    if (this._settingsHost && this._settingsHost.redrawSettings) this._settingsHost.redrawSettings();
    if (this._ownTab && this._ownTab.containerEl.isShown && this._ownTab.containerEl.isShown()) this._ownTab.display();
  }

  suiteKanban() {
    const suite = this.app.plugins && this.app.plugins.getPlugin ? this.app.plugins.getPlugin('nexus-suite') : null;
    return suite && suite.kanban && suite.kanban.registerSource ? suite.kanban : null;
  }

  /* Also called later on: a suite that was reloaded (or turned on after this
     plugin) has an empty source list, and its boards would say "not loaded". */
  registerSource() {
    const kanban = this.suiteKanban();
    if (!kanban) return;
    if (this._unregister && kanban === this._kanban && (!kanban.hasSource || kanban.hasSource('vikunja'))) return;
    this._kanban = kanban;
    this._unregister = kanban.registerSource('vikunja', (board) => vikunjaSource(this, board));
  }

  /* ---- connection ------------------------------------------------------- */
  /* The token lives in Obsidian's secret storage when this Obsidian has one
     (1.11 and later) and in the device's local storage otherwise. Either way
     only on this device: neither is part of the vault. */
  secureStorage() {
    const s = this.app.secretStorage;
    return s && typeof s.getSecret === 'function' ? s : null;
  }
  /* Said as it is: Obsidian encrypts its secret storage with the system's key
     store where the device has one, and keeps it in plain text where it has
     none (a Linux desktop without a keyring) — and warns about that itself. */
  tokenStorageNote() {
    const secure = this.secureStorage();
    if (!secure) return 'This Obsidian has no secret storage: kept in this device’s local storage, never in the vault.';
    let encrypted = true;
    try { encrypted = typeof secure.isEncryptionAvailable !== 'function' || secure.isEncryptionAvailable(); } catch (e) { encrypted = false; }
    return encrypted
      ? 'Kept in Obsidian’s secret storage on this device, encrypted with the system’s key store. Never in the vault.'
      : 'Kept in Obsidian’s secret storage on this device, never in the vault — but NOT encrypted here: this system offers no key store to Obsidian.';
  }

  token() {
    const secure = this.secureStorage();
    try {
      if (secure) return secure.getSecret(TOKEN_KEY) || '';
      return (this.app.loadLocalStorage ? this.app.loadLocalStorage(TOKEN_KEY) : window.localStorage.getItem(TOKEN_KEY)) || '';
    } catch (e) { console.warn('[nexus-vikunja] reading the token failed:', e); return ''; }
  }
  setToken(value) {
    const secure = this.secureStorage();
    if (secure) {
      if (value) secure.setSecret(TOKEN_KEY, value);
      else secure.deleteSecret(TOKEN_KEY);
      return;
    }
    if (this.app.saveLocalStorage) this.app.saveLocalStorage(TOKEN_KEY, value || null);
    else if (value) window.localStorage.setItem(TOKEN_KEY, value);
    else window.localStorage.removeItem(TOKEN_KEY);
  }
  /* A token saved by 0.1.0 in local storage moves into the secret storage. */
  migrateToken() {
    const secure = this.secureStorage();
    if (!secure) return;
    let old = null;
    try { old = this.app.loadLocalStorage ? this.app.loadLocalStorage(TOKEN_KEY) : window.localStorage.getItem(TOKEN_KEY); } catch (e) { old = null; }
    if (!old) return;
    if (!secure.getSecret(TOKEN_KEY)) secure.setSecret(TOKEN_KEY, old);
    if (this.app.saveLocalStorage) this.app.saveLocalStorage(TOKEN_KEY, null); else window.localStorage.removeItem(TOKEN_KEY);
  }
  ready() { return !!(this.settings.url && this.token()); }
  client() { return new VikunjaClient({ url: this.settings.url, token: this.token() }); }
  webBase() { return String(this.settings.url || '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, ''); }
  taskUrl(id) { return this.webBase() + '/tasks/' + id; }
  projectUrl(id) { return this.webBase() + '/projects/' + id; }

  /* ---- folders ---------------------------------------------------------- */
  boardsFolder() { return normalizePath(this.settings.boardsFolder || 'Vikunja'); }
  taskNotesFolder(projectTitle) {
    const root = this.settings.notesFolder ? normalizePath(this.settings.notesFolder) : this.boardsFolder() + '/Tasks';
    return root + '/' + safeName(projectTitle, 'Project');
  }

  /* ---- task notes ------------------------------------------------------- */
  taskNotes() {
    if (!this._taskNotes) this._taskNotes = noteIndex(this.app);
    return this._taskNotes;
  }
  rememberTaskNote(id, file) { this.taskNotes().set(id, file); }

  /* One note per task even when a card is tapped twice quickly: the second
     tap waits for the first instead of making another. */
  openNote(task, projectId, boardTitle) {
    this._opening = this._opening || new Map();
    if (this._opening.has(task.id)) return this._opening.get(task.id);
    // The project's folder is named after the project's PAGE, not after the
    // note the board happens to sit in — a board embedded in a meeting note
    // must not file its tasks under "Meeting".
    const page = pageIndex(this.app).get(projectId);
    const run = openTaskNote(this, task, projectId, page ? page.basename : boardTitle)
      .catch(e => new Notice('Nexus Vikunja: the note could not be made — ' + (e && e.message ? e.message : e)))
      .then(() => { this._opening.delete(task.id); });
    this._opening.set(task.id, run);
    return run;
  }

  /* ---- work ------------------------------------------------------------- */
  async syncProjects(loud) {
    if (!this.ready()) { if (loud) new Notice('Nexus Vikunja: set the address and the token first — ' + this.settingsPath() + '.'); return; }
    try {
      const r = await syncPages(this);
      const bits = [];
      if (r.made) bits.push(r.made + ' new page' + (r.made === 1 ? '' : 's'));
      if (r.back) bits.push(r.back + ' back');
      if (r.gone) bits.push(r.gone + ' marked gone');
      if (loud || bits.length) new Notice('Nexus Vikunja: projects synced' + (bits.length ? ' — ' + bits.join(', ') : ', nothing new') + '.');
    } catch (e) {
      new Notice('Nexus Vikunja: syncing the projects failed — ' + (e && e.message ? e.message : e));
    }
  }

  /* Every open board asks again: the store forgets how fresh it was and the
     suite redraws them, which makes each one fetch. */
  refreshBoards() {
    this.registerSource();   // a suite turned on or reloaded since
    this.store.boards.forEach(b => { b.at = 0; });
    const kanban = this.suiteKanban();
    if (kanban) kanban.repaintSource('vikunja');
  }

  startTimer() {
    if (this._timer) window.clearInterval(this._timer);
    this._timer = null;
    const minutes = parseInt(this.settings.refreshMinutes, 10) || 0;
    if (!minutes) return;
    this._timer = window.setInterval(() => { if (this.ready()) this.refreshBoards(); }, minutes * 60 * 1000);
    this.registerInterval(this._timer);
  }

  async saveSettings() { await this.saveData(this.settings); }

  /* One line of text, or null when cancelled. */
  ask(title, value) {
    return new Promise(resolve => {
      const modal = new Modal(this.app);
      let result = null;
      modal.titleEl.setText(title);
      let input;
      new Setting(modal.contentEl).addText(t => {
        input = t;
        t.setValue(value || '');
        t.inputEl.style.width = '100%';
        t.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); result = t.getValue(); modal.close(); } });
      }).addButton(b => b.setButtonText('OK').setCta().onClick(() => { result = input.getValue(); modal.close(); }));
      modal.onClose = () => resolve(result);
      modal.open();
      window.setTimeout(() => input && input.inputEl.focus(), 0);
    });
  }
}

module.exports = NexusVikunja;
