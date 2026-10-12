'use strict';

/* ============================================================================
 *  NEXUS VIKUNJA · a note per task
 *  A card is clicked → its note opens; there is one only once it is wanted.
 *  The note is found by `vikunja-task: <id>` in its frontmatter, not by its
 *  name, so renaming the task in Vikunja or the note in Obsidian never loses
 *  the link. What is written in the note stays in the vault — Vikunja keeps
 *  its own description.
 * ========================================================================== */

const { Notice, TFile, normalizePath } = require('obsidian');
const { plainText } = require('./client.js');

const TASK_KEY = 'vikunja-task';
const PROJECT_KEY = 'vikunja-project';

function safeName(text, fallback) {
  const name = String(text || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return name || fallback;
}

/* "Folder/Name.md", or "Folder/Name 2.md" when that is taken. */
function freePath(app, folder, name) {
  const at = (n) => normalizePath((folder ? folder + '/' : '') + n + '.md');
  if (!app.vault.getAbstractFileByPath(at(name))) return at(name);
  for (let i = 2; i < 1000; i++) if (!app.vault.getAbstractFileByPath(at(name + ' ' + i))) return at(name + ' ' + i);
  return at(name + ' ' + Date.now());
}

async function ensureFolder(app, folder) {
  if (!folder) return;
  let at = '';
  for (const part of folder.split('/').filter(Boolean)) {
    at = at ? at + '/' + part : part;
    if (!app.vault.getAbstractFileByPath(at)) {
      try { await app.vault.createFolder(at); }
      catch (e) { if (!app.vault.getAbstractFileByPath(at)) throw e; }   // made meanwhile is fine
    }
  }
}

/* Every note that names a task, by task id. Rebuilt per board draw: a sweep of
   frontmatter the metadata cache already holds, no file is read. */
function noteIndex(app) {
  const out = new Map();
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = (app.metadataCache.getFileCache(file) || {}).frontmatter;
    const id = fm ? parseInt(fm[TASK_KEY], 10) : NaN;
    if (id > 0 && !out.has(id)) out.set(id, file);
  }
  return out;
}

/* The note of a task, made when there is none yet: titled like the task,
   carrying the ids and the Vikunja address, and starting with the task's own
   description so it is not an empty page. */
async function openTaskNote(plugin, task, projectId, projectTitle) {
  const app = plugin.app;
  let file = plugin.taskNotes().get(task.id) || null;
  if (!file) {
    const folder = plugin.taskNotesFolder(projectTitle);
    await ensureFolder(app, folder);
    const body = [
      '---',
      TASK_KEY + ': ' + task.id,
      PROJECT_KEY + ': ' + projectId,
      'vikunja-url: ' + plugin.taskUrl(task.id),
      '---',
      '',
    ];
    const description = plainText(task.description);
    if (description) body.push(description, '');
    file = await app.vault.create(freePath(app, folder, safeName(task.title, 'Task ' + task.id)), body.join('\n'));
    // Known at once: the metadata cache reads the new file a moment later.
    plugin.rememberTaskNote(task.id, file);
  }
  if (!(file instanceof TFile)) { new Notice('Nexus Vikunja: the note of this task could not be opened.'); return; }
  await app.workspace.getLeaf('tab').openFile(file);
}

module.exports = { noteIndex, openTaskNote, ensureFolder, freePath, safeName, TASK_KEY, PROJECT_KEY };
