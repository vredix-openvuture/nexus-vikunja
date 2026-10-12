'use strict';

/* ============================================================================
 *  NEXUS VIKUNJA · what the boards show
 *  The server is the only truth. This holds the LAST ANSWER per project so a
 *  board can draw at once and refresh behind it, and so a device without a
 *  connection still shows something (read-only) instead of an empty strip.
 *
 *  Kept in this device's localStorage, never in the vault: it is a copy of
 *  someone else's data, and a vault file would be synced and conflict for
 *  nothing. The key carries the server address, so pointing the plugin at
 *  another server never shows the old one's boards.
 *
 *  Every fetch that settles calls `onSettled` — the plugin redraws ALL boards
 *  of the source then, not only the one that started the fetch (a code block
 *  re-rendered meanwhile is a new element the first one knew nothing of).
 * ========================================================================== */

const FRESH_MS = 30 * 1000;   // a board opened again within this is not refetched

function hash(text) {
  let h = 0;
  for (const ch of String(text || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36);
}

/* What is kept on disk: the board without task descriptions (HTML that can be
   long, and the board never shows it). */
function slim(board) {
  return Object.assign({}, board, {
    buckets: (board.buckets || []).map(b => Object.assign({}, b, {
      tasks: (b.tasks || []).map(t => { const c = Object.assign({}, t); delete c.description; return c; }),
    })),
  });
}

class BoardStore {
  constructor(app, getClient, getServer) {
    this.app = app;
    this.getClient = getClient;
    this.getServer = getServer || (() => '');
    this.boards = new Map();     // projectId → { at, viewId, doneBucketId, buckets, error }
    this.loading = new Map();    // projectId → Promise of the fetch in flight
    this.queued = new Map();     // projectId → Promise of a fetch queued behind it
    this.writes = new Map();     // taskId → Promise of the last write to that task
    this.onSettled = null;
  }

  key(projectId) { return 'nexus-vikunja-board-' + hash(this.getServer()) + '-' + projectId; }

  get(projectId) {
    if (this.boards.has(projectId)) return this.boards.get(projectId);
    let saved = null;
    try { saved = JSON.parse(this.load(this.key(projectId)) || 'null'); } catch (e) { saved = null; }
    if (saved && saved.buckets) {
      // From an earlier session: shown at once, but always refetched.
      saved.at = 0;
      this.boards.set(projectId, saved);
    }
    return saved;
  }

  /* Asked recently — successfully or not. A board that failed is not asked
     again on every repaint; the refresh button or the timer asks again. */
  isFresh(projectId) {
    const b = this.boards.get(projectId);
    return !!b && Date.now() - b.at < FRESH_MS;
  }
  isLoading(projectId) { return this.loading.has(projectId); }

  /* Read the project's kanban view. `after` is for a fetch that must see a
     write that just landed: a fetch already in flight may have read the server
     before it, so one more is queued behind it instead of reusing it. */
  refresh(projectId, after) {
    const running = this.loading.get(projectId);
    if (running && !after) return running;
    if (running) {
      if (!this.queued.has(projectId)) {
        const next = running.catch(() => {}).then(() => { this.queued.delete(projectId); return this.fetch(projectId); });
        this.queued.set(projectId, next);
      }
      return this.queued.get(projectId);
    }
    return this.fetch(projectId);
  }

  fetch(projectId) {
    const run = (async () => {
      const previous = this.get(projectId);
      try {
        const client = this.getClient();
        const view = await client.kanbanView(projectId);
        if (!view) throw new Error('the project has no kanban view in Vikunja');
        const buckets = await client.buckets(projectId, view.id);
        const board = { at: Date.now(), viewId: view.id, doneBucketId: view.done_bucket_id || 0, buckets, error: '' };
        this.boards.set(projectId, board);
        this.save(this.key(projectId), JSON.stringify(slim(board)));
        return board;
      } catch (e) {
        const board = Object.assign({ buckets: [], viewId: 0 }, previous || {}, { at: Date.now(), error: e && e.message ? e.message : String(e) });
        this.boards.set(projectId, board);
        throw e;
      } finally {
        this.loading.delete(projectId);
        // Not when another fetch is queued behind this one: this answer may
        // predate a write, and drawing it would flash the old state.
        if (this.onSettled && !this.queued.has(projectId)) { try { this.onSettled(projectId); } catch (e) { console.error('[nexus-vikunja] redraw after a fetch', e); } }
      }
    })();
    this.loading.set(projectId, run);
    return run;
  }

  /* Change the board on screen before the server has answered, so a dragged
     card does not snap back while the request is out. Returns the undo: the
     board as it was, put back when the request fails — or an offline board
     would keep showing a move that never reached Vikunja. */
  patch(projectId, fn) {
    const board = this.boards.get(projectId);
    if (!board) return () => {};
    const before = JSON.parse(JSON.stringify(board));
    fn(board);
    return () => { if (this.boards.get(projectId) === board) this.boards.set(projectId, before); };
  }

  /* Writes to one task run one after another. updateTask reads the task and
     posts it back whole, so two overlapping writes would each post the version
     they read and the second would undo the first. */
  serial(taskId, fn) {
    const before = this.writes.get(taskId) || Promise.resolve();
    const run = before.catch(() => {}).then(fn);
    this.writes.set(taskId, run);
    run.then(() => { if (this.writes.get(taskId) === run) this.writes.delete(taskId); }, () => { if (this.writes.get(taskId) === run) this.writes.delete(taskId); });
    return run;
  }

  load(key) {
    try { return this.app.loadLocalStorage ? this.app.loadLocalStorage(key) : window.localStorage.getItem(key); }
    catch (e) { return null; }
  }
  save(key, value) {
    try {
      if (this.app.saveLocalStorage) this.app.saveLocalStorage(key, value);
      else window.localStorage.setItem(key, value);
    } catch (e) { console.warn('[nexus-vikunja] could not keep the offline copy of a board:', e); }
  }
}

module.exports = { BoardStore, FRESH_MS };
