'use strict';

/* ============================================================================
 *  NEXUS VIKUNJA · settings
 *  The address and the folders live in data.json and travel with the vault.
 *  The token does NOT: it goes into Obsidian's secret storage on this device
 *  (the system keyring on a desktop, the encrypted store on Android), so a
 *  synced vault never carries a key to somebody's task list — each device is
 *  given its own once.
 *
 *  The page is drawn by drawSettings: into a page of Nexus Suite's own settings
 *  when the suite offers one (registerSettingsPage), into a tab of its own when
 *  it does not.
 * ========================================================================== */

const { PluginSettingTab, Setting, Notice, normalizePath } = require('obsidian');
const { ensureFolder } = require('./tasknotes.js');

const DEFAULT_SETTINGS = {
  url: '',
  boardsFolder: 'Vikunja',
  notesFolder: '',          // '' = "<boards folder>/Tasks"
  /* Off by default: on start the vault sync may not have pulled the pages
     another device made yet, and this device would make them a second time. */
  syncOnStart: false,
  refreshMinutes: 5,        // open boards are read again this often; 0 = only by hand
};

const TOKEN_KEY = 'nexus-vikunja-token';

function drawSettings(plugin, containerEl) {
  const app = plugin.app;
  const s = plugin.settings;
  const redraw = () => plugin.redrawSettings();

  if (!plugin.suiteKanban()) {
    containerEl.createEl('p', { cls: 'mod-warning',
      text: 'Nexus Suite with its Kanban module is not active — the boards are drawn by it. Turn it on first.' });
  }

  new Setting(containerEl).setName('Vikunja address')
    .setDesc('The address you open Vikunja at, e.g. https://vikunja.example.org')
    .addText(t => t.setPlaceholder('https://…').setValue(s.url)
      .onChange(async v => { s.url = v.trim(); await plugin.saveSettings(); }));

  new Setting(containerEl).setName('API token')
    .setDesc('Vikunja → Settings → API tokens, with read and write on projects and tasks. '
      + (plugin.secureStorage()
        ? 'Kept in this device’s encrypted secret storage, never in the vault.'
        : 'This Obsidian has no secret storage: kept in this device’s local storage, never in the vault.'))
    .addText(t => {
      t.inputEl.type = 'password';
      t.setPlaceholder(plugin.token() ? '•••••• (set — type to replace)' : 'tk_…');
      // Saved when the field is left, not per keystroke: a half-typed token
      // must not be stored.
      t.inputEl.addEventListener('change', () => { const v = t.getValue().trim(); if (v) { plugin.setToken(v); t.setValue(''); redraw(); } });
    })
    .addExtraButton(b => b.setIcon('trash-2').setTooltip('Forget the token on this device')
      .setDisabled(!plugin.token())
      .onClick(() => { plugin.setToken(''); redraw(); }));

  new Setting(containerEl).setName('Check the connection')
    .addButton(b => b.setButtonText('Check').onClick(async () => {
      try {
        const projects = await plugin.client().projects();
        new Notice('Nexus Vikunja: connected — ' + projects.length + ' projects.');
      } catch (e) { new Notice('Nexus Vikunja: ' + (e && e.message ? e.message : e)); }
    }));

  new Setting(containerEl).setName('Boards folder')
    .setDesc('One page per Vikunja project is kept here.')
    .addText(t => t.setPlaceholder('Vikunja').setValue(s.boardsFolder)
      .onChange(async v => { s.boardsFolder = normalizePath(v.trim() || 'Vikunja'); await plugin.saveSettings(); }))
    .addButton(b => b.setButtonText('Create folder').onClick(async () => {
      try { await ensureFolder(app, plugin.boardsFolder()); new Notice('Nexus Vikunja: "' + plugin.boardsFolder() + '" is there.'); }
      catch (e) { new Notice('Nexus Vikunja: the folder could not be made — ' + (e && e.message ? e.message : e)); }
    }));

  new Setting(containerEl).setName('Task notes folder')
    .setDesc('Where the note of a task is made when you click it, in a subfolder per project. Empty: "<boards folder>/Tasks".')
    .addText(t => t.setPlaceholder(plugin.boardsFolder() + '/Tasks').setValue(s.notesFolder)
      .onChange(async v => { s.notesFolder = v.trim() ? normalizePath(v.trim()) : ''; await plugin.saveSettings(); }));

  new Setting(containerEl).setName('Sync projects')
    .setDesc('Make a page for every project that has none, and mark pages of projects that are gone.')
    .addButton(b => b.setButtonText('Sync now').setCta().onClick(() => plugin.syncProjects(true)));

  new Setting(containerEl).setName('Sync projects on start')
    .setDesc('Only on a single device, or once the vault sync has run: two devices making the same page at once give two pages.')
    .addToggle(t => t.setValue(s.syncOnStart).onChange(async v => { s.syncOnStart = v; await plugin.saveSettings(); }));

  new Setting(containerEl).setName('Refresh open boards every')
    .setDesc('Minutes. 0 refreshes only when a board is opened or by its refresh button.')
    .addText(t => {
      t.inputEl.type = 'number';
      t.setValue(String(s.refreshMinutes)).onChange(async v => {
        s.refreshMinutes = Math.max(0, parseInt(v, 10) || 0);
        await plugin.saveSettings();
        plugin.startTimer();
      });
    });
}

/* The fallback when Nexus Suite cannot host the page. */
class VikunjaSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() { this.containerEl.empty(); drawSettings(this.plugin, this.containerEl); }
}

module.exports = { VikunjaSettingTab, drawSettings, DEFAULT_SETTINGS, TOKEN_KEY };
