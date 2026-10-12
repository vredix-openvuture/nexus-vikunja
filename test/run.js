'use strict';
/* node test/run.js — the plugin's logic against a fake Vikunja and an
   in-memory vault. The board itself is drawn by Nexus Suite and tested there;
   what is tested here is everything this plugin decides and sends. */

const Module = require('module');
const path = require('path');
const stubPath = path.join(__dirname, 'obsidian-stub.js');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === 'obsidian' ? stubPath : resolve.call(this, request, ...rest);
};

const stub = require('./obsidian-stub.js');
const { fakeApp } = require('./fakevault.js');
const { fakeVikunja } = require('./fakeserver.js');
const { VikunjaClient, dayOf, dueOf, plainText } = require('../src/client.js');
const { BoardStore } = require('../src/store.js');
const { vikunjaSource } = require('../src/source.js');
const { syncPages } = require('../src/pages.js');
const NexusVikunja = require('../src/main.js');
const { DEFAULT_SETTINGS } = require('../src/settings.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log('FAIL  ' + name + (detail !== undefined ? '  →  ' + JSON.stringify(detail) : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

function setup(opts) {
  const server = fakeVikunja(opts);
  global.__server = server.handler;
  const app = fakeApp();
  const plugin = new NexusVikunja();
  plugin.app = app;
  plugin.settings = Object.assign({}, DEFAULT_SETTINGS, { url: 'https://vk.example/' });
  plugin.setToken('good');
  plugin.store = new BoardStore(app, () => plugin.client(), () => plugin.webBase());
  plugin.settled = 0;
  plugin.store.onSettled = () => { plugin.settled++; };
  global.window = { open: (u) => server.calls.push('OPEN ' + u), moment: null };
  return { server, app, plugin };
}
const settle = () => new Promise(r => setTimeout(r, 0));
async function drain(n) { for (let i = 0; i < (n || 10); i++) await settle(); }

(async () => {
  // ── client ────────────────────────────────────────────────────────────────
  {
    const { server, plugin } = setup({ pageSize: 2 });
    const projects = await plugin.client().projects();
    eq('client · every page of projects, without the Favorites pseudo project', projects.map(p => p.id), [24, 8, 3]);
    ok('client · lists are always asked for paged (the WAF quirk)', server.calls.every(c => !/^GET \/projects$/.test(c)));
    eq('client · the kanban view is found', (await plugin.client().kanbanView(24)).id, 91);
  }
  {
    const many = [];
    for (let i = 0; i < 5; i++) many.push({ id: 300 + i, title: 'T' + i, bucket_id: 1, position: i, done: false });
    const { plugin } = setup({ pageSize: 2, tasks: many });
    const buckets = await plugin.client().buckets(24, 91);
    eq('client · a bucket with more than one page is fetched whole', buckets[0].tasks.map(t => t.id), [300, 301, 302, 303, 304]);
  }
  {
    const { server, plugin } = setup();
    await plugin.client().updateTask(102, { done: true });
    const t = server.tasks.find(x => x.id === 102);
    eq('client · an update keeps the fields it did not send', [t.title, t.due_date, t.done], ['Ship it', '2026-10-20T10:00:00Z', true]);
    await plugin.client().updateTask(101, { title: 'Write the docs' });
    const t1 = server.tasks.find(x => x.id === 101);
    eq('client · and never posts back the view-less bucket and position', [t1.bucket_id, t1.position], [1, 100]);
    plugin.setToken('expired');
    let err = null;
    try { await plugin.client().projects(); } catch (e) { err = e; }
    ok('client · a refused token says so', err && /token was refused/.test(err.message), err && err.message);
  }
  eq('client · the empty date is no day', dayOf('0001-01-01T00:00:00Z'), '');
  eq('client · a due date round-trips through local midnight', dayOf(dueOf('2026-10-20')), '2026-10-20');
  eq('client · no due date is written as the empty date', dueOf(''), '0001-01-01T00:00:00Z');
  eq('client · descriptions lose their HTML', plainText('<p>First <b>line</b></p><p>Second &amp; more</p>'), 'First line\nSecond & more');
  eq('client · the address may be pasted with /api/v1', new VikunjaClient({ url: 'https://x.org/api/v1/', token: 't' }).base, 'https://x.org');

  // ── store ─────────────────────────────────────────────────────────────────
  {
    const { app, plugin } = setup();
    const board = await plugin.store.refresh(24);
    eq('store · buckets in order with their tasks', board.buckets.map(b => [b.title, b.tasks.length]), [['Todo', 1], ['Doing', 1], ['Done', 1]]);
    const kept = [...app.local.keys()].find(k => /^nexus-vikunja-board-.+-24$/.test(k));
    ok('store · an offline copy is kept on this device', !!kept);
    ok('store · without the task descriptions', !/First <b>line/.test(app.local.get(kept)));
    plugin.settings.url = 'https://other.example';
    ok('store · another server does not see that copy', !new BoardStore(app, () => plugin.client(), () => plugin.webBase()).get(24));
    plugin.settings.url = 'https://vk.example/';
    plugin.setToken('expired');
    plugin.store.boards.get(24).at = 0;
    let threw = false;
    try { await plugin.store.refresh(24); } catch (e) { threw = true; }
    const after = plugin.store.get(24);
    ok('store · a failed refresh keeps the last buckets', threw && after.buckets.length === 3 && /refused/.test(after.error));
    ok('store · and is not asked again on every repaint', plugin.store.isFresh(24));
    const restarted = new BoardStore(app, () => plugin.client(), () => plugin.webBase());
    ok('store · a new session starts from the offline copy, marked stale', restarted.get(24).buckets.length === 3 && !restarted.isFresh(24));
  }

  // ── the board source ──────────────────────────────────────────────────────
  function sourceFor(plugin, repaints) {
    return vikunjaSource(plugin, {
      app: plugin.app, config: { project: '24' }, ctx: { sourcePath: 'Vikunja/Nexus Suite.md' },
      helpers: { bucketKind: (t) => (/done/i.test(t) ? 'done' : /doing/i.test(t) ? 'doing' : 'open') },
      repaint: () => repaints.push(1),
    });
  }
  {
    const { server, plugin } = setup();
    const repaints = [];
    let src = sourceFor(plugin, repaints);
    eq('source · before the first answer it says it is loading', src.emptyText, 'Loading from Vikunja…');
    ok('source · and cannot add to columns it does not have', !src.add);
    await drain();
    ok('source · the answer redraws every board of the source', plugin.settled >= 1);
    src = sourceFor(plugin, repaints);
    const cols = src.columns();
    eq('source · columns are the buckets', cols.map(c => c.title), ['Todo', 'Doing', 'Done']);
    eq('source · the done bucket is a done column', cols[2].kind, 'done');
    eq('source · a limit shows as open/limit', cols[1].count, { text: '1/2', over: false });
    eq('source · total is open / all', src.total(), '2 / 3');
    const v = src.view(cols[0].items[0]);
    eq('source · a card shows its title and labels', [v.title, v.chips.map(c => c.text)], ['Write docs', ['#docs']]);
    eq('source · and its due date', src.view(cols[1].items[0]).chips[0].cls, 'due');

    server.calls.length = 0;
    src.move(0, 0, 1, 1);
    eq('source · a move shows at once', plugin.store.get(24).buckets[1].tasks.map(t => t.id), [102, 101]);
    await drain(20);
    ok('source · and is sent to the bucket in Vikunja', server.calls.some(c => c === 'POST /projects/24/views/91/buckets/2/tasks'), server.calls);
    ok('source · with its place in the bucket', server.calls.some(c => c === 'POST /tasks/101/position'), server.calls);
    eq('source · then the board is read again', plugin.store.get(24).buckets[1].tasks.map(t => t.id).sort(), [101, 102]);

    src = sourceFor(plugin, repaints);
    server.calls.length = 0;
    src.add(0, 'Brand new');
    await drain(20);
    ok('source · a new card is a new task in Vikunja', server.tasks.some(t => t.title === 'Brand new' && t.bucket_id === 1));
  }
  {
    const { server, plugin } = setup();
    await plugin.store.refresh(24);
    const repaints = [];
    const src = sourceFor(plugin, repaints);
    src.add(1, 'Into doing');
    await drain(20);
    const made = server.tasks.find(t => t.title === 'Into doing');
    eq('source · a card added to a column lands in that bucket', made && made.bucket_id, 2);
  }
  {
    // A write made while the first read is still out must not be undone by it.
    const { server, plugin } = setup();
    await plugin.store.refresh(24);
    plugin.store.boards.get(24).at = 0;
    const repaints = [];
    const src = sourceFor(plugin, repaints);       // starts a read
    ok('race · a read is in flight', plugin.store.isLoading(24));
    src.move(0, 0, 1, null);                         // Write docs → Doing, meanwhile
    await drain(30);
    eq('race · the board ends on the server state after the write', plugin.store.get(24).buckets[1].tasks.map(t => t.id).sort(), [101, 102]);
    eq('race · which is what Vikunja has', server.tasks.find(t => t.id === 101).bucket_id, 2);
  }
  {
    // Two quick writes to one task run one after the other.
    const { server, plugin } = setup();
    await plugin.store.refresh(24);
    const src = sourceFor(plugin, []);
    const c = plugin.client();
    const a = plugin.store.serial(102, () => c.updateTask(102, { title: 'First' }));
    const b = plugin.store.serial(102, () => c.updateTask(102, { due_date: '0001-01-01T00:00:00Z' }));
    await Promise.all([a, b]);
    eq('serial · the second write keeps the first', server.tasks.find(t => t.id === 102).title, 'First');
  }
  {
    // A write that fails puts the board back; it does not stay as an "offline copy".
    const { plugin } = setup();
    await plugin.store.refresh(24);
    const src = sourceFor(plugin, []);
    plugin.setToken('expired');
    src.move(0, 0, 2, null);
    eq('undo · the move shows at once', plugin.store.get(24).buckets[2].tasks.length, 2);
    await drain(30);
    eq('undo · and is taken back when Vikunja refuses it', plugin.store.get(24).buckets.map(b => b.tasks.length), [1, 1, 1]);
    ok('undo · with a notice', stub.notices.some(n => /moving the task failed/.test(n)));
  }
  {
    // The card menu acts on the task by id, whatever the board looks like now.
    const { server, plugin } = setup();
    await plugin.store.refresh(24);
    const src = sourceFor(plugin, []);
    plugin.store.boards.get(24).at = 0;
    await plugin.store.refresh(24);                 // the board object is replaced
    src.move(1, 0, 0, null);                         // indexes of the OLD draw
    await drain(30);
    eq('stale · the old draw still moves the right task', server.tasks.find(t => t.id === 102).bucket_id, 1);
  }
  {
    const { plugin } = setup();
    plugin.setToken('');
    const src = sourceFor(plugin, []);
    ok('source · without a token it says where to set one', /no address or token/.test(src.emptyText), src.emptyText);
    const none = vikunjaSource(plugin, { app: plugin.app, config: {}, ctx: null, helpers: {}, repaint() {} });
    ok('source · a block without project: says what is missing', /project: <id>/.test(none.emptyText));
  }

  // ── task notes ────────────────────────────────────────────────────────────
  {
    const { app, plugin } = setup();
    const { openTaskNote } = require('../src/tasknotes.js');
    const task = { id: 101, title: 'Write: docs?', description: '<p>First line</p>' };
    await openTaskNote(plugin, task, 24, 'Nexus Suite');
    const made = [...app.files.keys()].find(p => p.startsWith('Vikunja/Tasks/Nexus Suite/'));
    ok('notes · a task without a note gets one in its project folder', !!made, [...app.files.keys()]);
    const text = made ? app.files.get(made).text : '';
    ok('notes · it names the task and the project', /vikunja-task: 101/.test(text) && /vikunja-project: 24/.test(text));
    ok('notes · and starts with the task description', /First line/.test(text));
    eq('notes · it opens', app.opened, [made]);
    await openTaskNote(plugin, Object.assign({}, task, { title: 'Renamed in Vikunja' }), 24, 'Nexus Suite');
    eq('notes · the second click opens the same note, even after a rename', app.opened, [made, made]);
    const other = { id: 555, title: 'Tapped twice' };
    await Promise.all([plugin.openNote(other, 24, 'Nexus Suite'), plugin.openNote(other, 24, 'Nexus Suite')]);
    eq('notes · a double tap makes one note', [...app.files.keys()].filter(p => /Tapped twice/.test(p)).length, 1);
  }

  // ── project pages ─────────────────────────────────────────────────────────
  {
    const { server, app, plugin } = setup();
    const first = await syncPages(plugin);
    eq('pages · one page per project that is not archived', first, { made: 2, gone: 0, back: 0 });
    ok('pages · holding its board', /source: vikunja\nproject: 24/.test(app.files.get('Vikunja/Nexus Suite.md').text));
    const again = await syncPages(plugin);
    eq('pages · a second sync makes nothing twice', again.made, 0);
    server.projects = server.projects.filter(p => p.id !== 8);
    const gone = await syncPages(plugin);
    eq('pages · a project that is gone is marked, not deleted', gone.gone, 1);
    ok('pages · the page is still there', /vikunja-gone: true/.test(app.files.get('Vikunja/Velumeron.md').text));
    server.projects.push({ id: 8, title: 'Velumeron' });
    eq('pages · and unmarked when it comes back', (await syncPages(plugin)).back, 1);
    const entry = app.files.get('Vikunja/Nexus Suite.md');
    app.files.delete('Vikunja/Nexus Suite.md');
    entry.file.path = 'Elsewhere/Nexus Suite.md';
    app.files.set(entry.file.path, entry);
    eq('pages · a page moved out of the folder is still found', (await syncPages(plugin)).made, 0);
  }

  // ── the token on the device ───────────────────────────────────────────────
  {
    const { app, plugin } = setup();
    const secrets = new Map();
    app.secretStorage = {
      getSecret: (id) => (secrets.has(id) ? secrets.get(id) : null),
      setSecret: (id, v) => { if (!/^[a-z0-9-]+$/.test(id)) throw new Error('bad id'); secrets.set(id, v); },
      deleteSecret: (id) => secrets.delete(id),
    };
    // setup() stored 'good' in local storage, as 0.1.0 did.
    plugin.migrateToken();
    eq('token · an old token moves into the secret storage', secrets.get('nexus-vikunja-token'), 'good');
    ok('token · and leaves the local storage', !app.local.has('nexus-vikunja-token'));
    plugin.setToken('tk_unique_42');
    ok('token · a new one goes to the secret storage only', secrets.get('nexus-vikunja-token') === 'tk_unique_42' && !app.local.has('nexus-vikunja-token'));
    eq('token · and is read from there', plugin.token(), 'tk_unique_42');
    plugin.setToken('');
    ok('token · forgetting it deletes the secret', !secrets.has('nexus-vikunja-token'));
    ok('token · never in the settings that sync', !JSON.stringify(plugin.settings).includes('tk_unique_42'));
  }

  // ── the settings page inside Nexus Suite ──────────────────────────────────
  {
    const { app, plugin } = setup();
    const pages = new Map();
    const suite = { settingsPages: pages, redraws: 0, redrawSettings() { this.redraws++; },
      registerSettingsPage(p) { pages.set(p.id, p); return () => pages.delete(p.id); } };
    app.plugins = { getPlugin: (id) => (id === 'nexus-suite' ? suite : null) };
    plugin.registerSettings();
    ok('settings · the page is registered with the suite', pages.has('nexus-vikunja') && typeof pages.get('nexus-vikunja').display === 'function');
    plugin.registerSettings();
    eq('settings · and only once', pages.size, 1);
    plugin.redrawSettings();
    eq('settings · a redraw goes through the suite', suite.redraws, 1);
    eq('settings · hints point to the suite page', plugin.settingsPath(), 'Settings → Nexus Suite → Add-ons → Vikunja');
    // The suite goes away: the settings get a tab of their own, and back.
    const added = [], removed = [];
    plugin.addSettingTab = (t) => added.push(t);
    app.setting = { removeSettingTab: (t) => removed.push(t) };
    plugin._layoutReady = true;
    app.plugins = { getPlugin: () => null };
    plugin.registerSettings();
    eq('settings · without the suite they get a tab of their own', added.length, 1);
    eq('settings · and the hints say where', plugin.settingsPath(), 'Settings → Nexus Vikunja');
    app.plugins = { getPlugin: (id) => (id === 'nexus-suite' ? suite : null) };
    pages.clear();
    plugin.registerSettings();
    ok('settings · the suite back: the page returns and the own tab goes', pages.has('nexus-vikunja') && removed.length === 1);
    plugin.onunload();
    ok('settings · unloading takes the page out', !pages.has('nexus-vikunja'));
  }

  // ── removing the add-on forgets what is on the device ─────────────────────
  {
    const { app, plugin } = setup();
    const ls = new Map([['x-nexus-vikunja-board-abc-24', '{}'], ['other', '1']]);
    global.window.localStorage = { get length() { return ls.size; }, key: (i) => [...ls.keys()][i], removeItem: (k) => ls.delete(k) };
    plugin.forgetDeviceData();
    ok('forget · the token is gone', !plugin.token());
    ok('forget · the offline boards are gone, nothing else', !ls.has('x-nexus-vikunja-board-abc-24') && ls.has('other'));
    app.secretStorage = { getSecret: () => null, setSecret() {}, deleteSecret() {}, isEncryptionAvailable: () => false };
    ok('forget · an unencrypted store is called that', /NOT encrypted/.test(plugin.tokenStorageNote()));
  }

  console.log(fail === 0 ? 'ALL GREEN — ' + pass + ' checks' : fail + ' FAILED of ' + (pass + fail));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('THREW: ' + (e && e.stack || e)); process.exit(1); });
