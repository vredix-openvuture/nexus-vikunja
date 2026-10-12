'use strict';

/* ============================================================================
 *  NEXUS VIKUNJA · a Vikunja project as a Nexus Suite kanban source
 *
 *      ```nexus-kanban
 *      source: vikunja
 *      project: 24
 *      ```
 *
 *  The suite draws the board; this answers its seam (see the suite's
 *  lib/kanbanedit.js): the columns are the project's kanban buckets, the cards
 *  its tasks. Every action is a request to Vikunja at once — there is no local
 *  state to reconcile. The board shows the change before the server answers,
 *  takes it back if the request fails, and is redrawn from a fresh read after.
 *
 *  A source object lives for one draw. Anything that runs later (a menu, a
 *  dialog, a request coming back) looks its task up by ID on the board as it is
 *  THEN — the board it was drawn from may have been replaced by a refresh.
 * ========================================================================== */

const { Menu, Notice, setIcon } = require('obsidian');
const { dayOf, dueOf } = require('./client.js');
const { openTaskNote } = require('./tasknotes.js');

/* Where a task is on a board right now: { board, col, index, task } or null. */
function locate(board, taskId) {
  const buckets = (board && board.buckets) || [];
  for (let col = 0; col < buckets.length; col++) {
    const index = buckets[col].tasks.findIndex(t => t.id === taskId);
    if (index >= 0) return { board, col, index, task: buckets[col].tasks[index] };
  }
  return null;
}

/* A position between the neighbours at `at` — Vikunja orders a bucket by
   these numbers, so only the moved task has to change. Null: leave it. */
function positionAt(list, at) {
  const p = (t) => (t && typeof t.position === 'number' ? t.position : null);
  const before = list[at - 1], after = list[at + 1];
  if (p(before) != null && p(after) != null) return (p(before) + p(after)) / 2;
  if (p(before) != null) return p(before) + 1024;
  if (p(after) != null) return p(after) / 2;
  return null;
}

function vikunjaSource(plugin, board) {
  const { app, config, helpers, repaint, ctx } = board;
  const projectId = parseInt(config.project, 10) || 0;
  const store = plugin.store;
  const data = projectId ? store.get(projectId) : null;
  const notes = plugin.taskNotes();
  const boardFile = ctx && ctx.sourcePath ? app.vault.getAbstractFileByPath(ctx.sourcePath) : null;
  const projectTitle = boardFile ? boardFile.basename : 'Project ' + projectId;
  const current = () => store.get(projectId);

  // Drawn from the last answer at once; asked again behind it when that is old.
  // When it settles the store redraws every board of the project.
  if (projectId && plugin.ready() && !store.isFresh(projectId) && !store.isLoading(projectId)) {
    store.refresh(projectId).catch(() => {});
  }

  const buckets = () => (data && data.buckets) || [];

  /* One request to Vikunja for one task, after the board already shows it.
     Success: a fresh read (after this write). Failure: the board is put back,
     the reason shown, and read again. */
  function write(what, taskId, undo, request) {
    return store.serial(taskId, request).then(
      () => store.refresh(projectId, true).catch(() => {}),
      (e) => {
        undo();
        repaint();
        new Notice('Nexus Vikunja: ' + what + ' failed — ' + (e && e.message ? e.message : e));
        store.refresh(projectId, true).catch(() => {});
      });
  }

  function moveTask(taskId, toCol, at) {
    const here = locate(current(), taskId);
    if (!here) return;
    const target = here.board.buckets[toCol];
    if (!target) return;
    const viewId = here.board.viewId;
    const undo = store.patch(projectId, (b) => {
      const from = b.buckets[here.col].tasks;
      const [task] = from.splice(here.index, 1);
      const to = b.buckets[toCol].tasks;
      to.splice(at == null ? to.length : Math.max(0, Math.min(to.length, at)), 0, task);
    });
    repaint();
    const after = locate(current(), taskId);
    const position = after ? positionAt(after.board.buckets[after.col].tasks, after.index) : null;
    const crossed = here.col !== toCol;
    write('moving the task', taskId, undo, async () => {
      const client = plugin.client();
      if (crossed) await client.moveToBucket(projectId, viewId, target.id, taskId);
      if (position != null) await client.setPosition(taskId, viewId, position);
    });
  }

  function setDone(taskId, done) {
    const undo = store.patch(projectId, (b) => { const here = locate(b, taskId); if (here) here.task.done = done; });
    repaint();
    write('ticking the task', taskId, undo, () => plugin.client().updateTask(taskId, { done }));
  }

  function cardMenu(evt, taskId) {
    const here = locate(current(), taskId);
    if (!here) return;
    const task = here.task;
    const menu = new Menu();
    menu.addItem(i => i.setTitle('Open note').setIcon('file-text')
      .onClick(() => plugin.openNote(task, projectId, projectTitle)));
    menu.addItem(i => i.setTitle('Open in Vikunja').setIcon('external-link')
      .onClick(() => window.open(plugin.taskUrl(taskId))));
    menu.addSeparator();
    menu.addItem(i => i.setTitle(task.done ? 'Mark as open' : 'Mark as done').setIcon(task.done ? 'circle' : 'check')
      .onClick(() => setDone(taskId, !task.done)));
    menu.addItem(i => i.setTitle('Rename…').setIcon('pencil').onClick(async () => {
      const title = await plugin.ask('Task title', task.title);
      if (title == null || !title.trim() || title.trim() === task.title) return;
      write('renaming the task', taskId, () => {}, () => plugin.client().updateTask(taskId, { title: title.trim() }));
    }));
    menu.addItem(i => i.setTitle('Due date…').setIcon('calendar-days').onClick(async () => {
      const day = await plugin.ask('Due date (YYYY-MM-DD, empty = none)', dayOf(task.due_date));
      if (day == null) return;
      const value = day.trim();
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) { new Notice('Nexus Vikunja: a due date is written YYYY-MM-DD.'); return; }
      write('setting the due date', taskId, () => {}, () => plugin.client().updateTask(taskId, { due_date: dueOf(value) }));
    }));
    menu.addSeparator();
    here.board.buckets.forEach((b, i) => {
      if (i === here.col) return;
      menu.addItem(x => x.setTitle('Move to “' + b.title + '”').setIcon('arrow-right')
        .onClick(() => moveTask(taskId, i, null)));
    });
    menu.showAtMouseEvent(evt);
  }

  const source = {
    id: 'vikunja',

    columns() {
      return buckets().map(b => {
        const open = b.tasks.filter(t => !t.done).length;
        const limit = parseInt(b.limit, 10) || 0;
        return {
          title: b.title,
          limit,
          kind: b.id && b.id === (data && data.doneBucketId) ? 'done' : helpers.bucketKind(b.title),
          items: b.tasks,
          count: { text: limit ? open + '/' + limit : String(b.tasks.length), over: !!limit && open > limit },
        };
      });
    },

    total() {
      const all = buckets().reduce((n, b) => n + b.tasks.length, 0);
      const open = buckets().reduce((n, b) => n + b.tasks.filter(t => !t.done).length, 0);
      return open + ' / ' + all;
    },

    get emptyText() {
      if (!projectId) return 'This board needs a line “project: <id>” — the Vikunja project it shows.';
      if (!plugin.ready()) return 'Nexus Vikunja has no address or token on this device — Settings → Nexus Vikunja.';
      if (data && data.error) return 'Vikunja: ' + data.error;
      return 'Loading from Vikunja…';
    },

    head(el) {
      if (data && data.error && buckets().length) {
        const chip = el.createDiv({ cls: 'nx-vk-state is-error', text: 'offline copy' });
        chip.setAttribute('aria-label', 'Vikunja: ' + data.error);
      } else if (store.isLoading(projectId)) {
        el.createDiv({ cls: 'nx-vk-state', text: 'syncing…' });
      }
    },

    tools(el) {
      const tool = (icon, label, fn) => {
        const b = el.createDiv('nx-kb-tool');
        setIcon(b, icon);
        b.setAttribute('aria-label', label);
        b.onclick = fn;
      };
      tool('refresh-cw', 'Refresh from Vikunja', () => store.refresh(projectId, true).catch(() => {}));
      tool('external-link', 'Open the project in Vikunja', () => window.open(plugin.projectUrl(projectId)));
    },

    view(task) {
      const chips = [];
      const due = dayOf(task.due_date);
      if (due) {
        const today = window.moment ? window.moment().format('YYYY-MM-DD') : new Date().toISOString().slice(0, 10);
        const label = window.moment ? window.moment(due, 'YYYY-MM-DD').format('D MMM') : due;
        chips.push({ cls: 'due', text: due === today ? 'today' : label,
          mod: (!task.done && due < today ? 'is-late' : '') + (due === today ? ' is-today' : '') });
      }
      (task.labels || []).forEach(l => { if (l && l.title) chips.push({ cls: 'tag', text: '#' + l.title }); });
      const note = notes.get(task.id);
      return {
        lead: true, kind: null, done: !!task.done,
        icon: note ? 'file-text' : '', iconLabel: note ? note.path : '',
        title: task.title, desc: null, chips,
      };
    },

    fill(frame, task) {
      const taskId = task.id;
      const box = frame.lead.createEl('input', { cls: 'nx-kb-check', attr: { type: 'checkbox' } });
      box.checked = !!task.done;
      box.onclick = (e) => e.stopPropagation();
      box.onchange = () => setDone(taskId, box.checked);
      // A click opens the task's note, like any card on a Nexus board;
      // Ctrl/⌘ goes to the task in Vikunja instead.
      frame.el.onclick = (e) => {
        if (frame.el.hasClass('is-dragging')) return;
        if (e.ctrlKey || e.metaKey) { window.open(plugin.taskUrl(taskId)); return; }
        plugin.openNote(task, projectId, projectTitle);
      };
      frame.dots.onclick = (e) => { e.stopPropagation(); cardMenu(e, taskId); };
      frame.el.oncontextmenu = (e) => { e.preventDefault(); cardMenu(e, taskId); };
    },

    // The drag hands over the indexes of THIS draw; they are turned into the
    // task's id at once and everything after works from that.
    move(fromCol, index, toCol, at) {
      const from = buckets()[fromCol];
      const task = from && from.tasks[index];
      if (task) moveTask(task.id, toCol, at);
    },

    add(col, title) {
      const bucket = buckets()[col];
      if (!bucket) return;
      const viewId = data.viewId;
      store.serial('new-' + projectId, async () => {
        const client = plugin.client();
        const made = await client.createTask(projectId, { title, bucket_id: bucket.id });
        // Some servers file a new task in the default bucket whatever was asked.
        if (made && made.id && made.bucket_id !== bucket.id) await client.moveToBucket(projectId, viewId, bucket.id, made.id);
      }).then(
        () => store.refresh(projectId, true).catch(() => {}),
        (e) => new Notice('Nexus Vikunja: adding the task failed — ' + (e && e.message ? e.message : e)));
    },
  };
  // A board that has not loaded yet has no columns to add to.
  if (!buckets().length) delete source.add;
  return source;
}

module.exports = { vikunjaSource, locate, positionAt };
