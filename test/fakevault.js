'use strict';
/* A vault in memory: files, frontmatter parsed from a leading --- block. */
const { TFile } = require('./obsidian-stub.js');

function frontmatterOf(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return undefined;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) { const v = line.slice(i + 1).trim(); fm[line.slice(0, i).trim()] = v === 'true' ? true : v; }
  }
  return fm;
}

function fakeApp() {
  const files = new Map();
  const folders = new Set();
  const opened = [];
  const app = {
    files, folders, opened,
    vault: {
      getMarkdownFiles: () => [...files.values()].map(f => f.file),
      getAbstractFileByPath: (p) => (files.get(p) || {}).file || (folders.has(p) ? { path: p } : null),
      createFolder: async (p) => { folders.add(p); },
      create: async (p, text) => {
        if (files.has(p)) throw new Error('exists: ' + p);
        const file = new TFile(p);
        files.set(p, { file, text });
        return file;
      },
    },
    metadataCache: { getFileCache: (f) => ({ frontmatter: frontmatterOf((files.get(f.path) || {}).text || '') }) },
    fileManager: {
      processFrontMatter: async (f, fn) => {
        const entry = files.get(f.path);
        const fm = frontmatterOf(entry.text) || {};
        fn(fm);
        const body = entry.text.replace(/^---\n[\s\S]*?\n---\n?/, '');
        entry.text = '---\n' + Object.entries(fm).map(([k, v]) => k + ': ' + v).join('\n') + '\n---\n' + body;
      },
    },
    workspace: { getLeaf: () => ({ openFile: async (f) => { opened.push(f.path); } }) },
    local: new Map(),
    loadLocalStorage(k) { return this.local.has(k) ? this.local.get(k) : null; },
    saveLocalStorage(k, v) { if (v == null) this.local.delete(k); else this.local.set(k, v); },
  };
  return app;
}

module.exports = { fakeApp, frontmatterOf };
