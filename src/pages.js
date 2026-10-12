'use strict';

/* ============================================================================
 *  NEXUS VIKUNJA · one page per project
 *  "Sync projects" makes sure every Vikunja project has a page in the boards
 *  folder holding its board. A page is found by `vikunja-project: <id>`, so a
 *  renamed or moved page is still that project's page and is never made twice.
 *
 *  Nothing is deleted. A project gone from Vikunja (deleted, archived, access
 *  lost) gets `vikunja-gone: true` on its page; one that comes back loses it.
 *  The page — and whatever was written on it — is the user's to remove.
 * ========================================================================== */

const { ensureFolder, freePath, safeName, PROJECT_KEY } = require('./tasknotes.js');

const GONE_KEY = 'vikunja-gone';

function pageText(project) {
  return [
    '---',
    PROJECT_KEY + ': ' + project.id,
    '---',
    '',
    '```nexus-kanban',
    'source: vikunja',
    'project: ' + project.id,
    '```',
    '',
  ].join('\n');
}

/* Pages by project id, anywhere in the vault — a page moved out of the boards
   folder is still that project's page. Frontmatter only; the metadata cache
   already has it. */
function pageIndex(app) {
  const out = new Map();
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = (app.metadataCache.getFileCache(file) || {}).frontmatter;
    const id = fm ? parseInt(fm[PROJECT_KEY], 10) : NaN;
    // A task note carries the project id too; only a page has no task id.
    if (id > 0 && !(fm && fm['vikunja-task']) && !out.has(id)) out.set(id, file);
  }
  return out;
}

/* Returns what happened, for the notice: { made, gone, back }. */
async function syncPages(plugin) {
  const app = plugin.app;
  const folder = plugin.boardsFolder();
  const projects = (await plugin.client().projects()).filter(p => !p.is_archived);
  await ensureFolder(app, folder);
  const pages = pageIndex(app);
  const result = { made: 0, gone: 0, back: 0 };

  for (const project of projects) {
    const page = pages.get(project.id);
    if (!page) {
      await app.vault.create(freePath(app, folder, safeName(project.title, 'Project ' + project.id)), pageText(project));
      result.made++;
      continue;
    }
    const fm = (app.metadataCache.getFileCache(page) || {}).frontmatter || {};
    if (fm[GONE_KEY]) {
      await app.fileManager.processFrontMatter(page, f => { delete f[GONE_KEY]; });
      result.back++;
    }
  }
  const live = new Set(projects.map(p => p.id));
  for (const [id, page] of pages) {
    if (live.has(id)) continue;
    const fm = (app.metadataCache.getFileCache(page) || {}).frontmatter || {};
    if (fm[GONE_KEY]) continue;
    await app.fileManager.processFrontMatter(page, f => { f[GONE_KEY] = true; });
    result.gone++;
  }
  return result;
}

module.exports = { syncPages, pageIndex, pageText, GONE_KEY };
