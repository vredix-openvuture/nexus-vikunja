# Architecture

Nexus Suite draws every kanban board. Since its `feature/kanban-sources` change a board whose
`source:` the suite does not know asks a registry (`NexusKanban.registerSource`) for a factory.
This plugin registers `vikunja` there and answers the same seam a block board does (see the
suite's `src/lib/kanbanedit.js`).

| File | Job |
|---|---|
| `src/main.js` | Plugin: settings, token, commands, timer, registering the source (again after a suite reload). |
| `src/client.js` | Vikunja REST: paged lists, kanban view, buckets with all their tasks, task update (merged, because POST replaces), bucket move, position. Date and HTML helpers. |
| `src/store.js` | Last answer per project, in memory and in local storage (key per server, descriptions stripped); one fetch shared by all boards, a second one queued behind it after a write; every settled fetch redraws all boards; writes per task serialised; optimistic patches with undo. |
| `src/source.js` | The board seam: columns, cards, menu, move/tick/add as API calls followed by a re-read. Anything that runs after the draw finds its task by id on the current board. |
| `src/pages.js` | Sync projects: a page per project, found by frontmatter; gone projects flagged, never deleted. |
| `src/tasknotes.js` | The note of a task, found by `vikunja-task:` frontmatter, made on first click. |
| `src/settings.js` | `drawSettings`, drawn into the suite's page (`registerSettingsPage`) or, without one, a tab of its own. The token goes to `app.secretStorage` (local storage on an Obsidian without it). |
| `release.sh` | Tests, build, version bump, tag, GitHub release with main.js, manifest.json, styles.css: what the suite's Add-ons page downloads. |

## Tests

    npm test

- `test/run.js`: node, against `test/fakeserver.js` (a Vikunja that pages, has the WAF quirk and
  replaces tasks on POST, and reads tasks outside a view without bucket and position, as the spec
  says) and an in-memory vault. 57 checks, including the races: a write during a read, two writes
  to one task, a refused write, a stale draw, a double tap.
- `test/browser.sh`: the REAL suite kanban plus this source in headless Chromium: loading, columns,
  tick, click to note, typed card. 11 checks. Needs the nexus-suite checkout beside this one.

Not covered: a live Vikunja server and a run inside Obsidian.
