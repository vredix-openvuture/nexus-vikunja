<div align="center">

**Nexus Vikunja** is a companion plugin for Nexus Suite that shows your Vikunja projects as its kanban boards.

</div>

Every Vikunja project gets a page in your vault with its kanban board on it. The cards come straight
from the Vikunja API, and whatever you do on the board (move, tick, add) is sent to Vikunja at once.
Obsidian keeps no task state of its own: Vikunja stays the one place the tasks live.

<br>
<br>

## Install

In Obsidian: **Settings → Nexus Suite → Add-ons → Nexus Vikunja**, switch on.

The suite downloads the newest release of this repo into `.obsidian/plugins/nexus-vikunja/` and
turns it on. Its settings then appear as the page **Vikunja** under Add-ons in the suite's
settings: the Vikunja address, an API token, the boards folder. **Sync now** makes the project
pages. The update button on the Add-ons page fetches newer releases.

Without the suite's Add-ons page (an older suite), put `main.js`, `manifest.json` and
`styles.css` from the latest release into that folder by hand; the settings then get a tab of
their own.

Requirements: Nexus Suite with its Kanban module turned on (it draws the boards, this plugin fills
them), and a Vikunja server new enough to have project views (0.24 or later). Tested against the
API of Vikunja v2.7.0.

To remove it, use the bin next to it on the Add-ons page: it turns the plugin off and deletes its
folder. The project pages and task notes stay in the vault
as ordinary notes; a board whose plugin is gone says so instead of showing cards.

<br>
<br>

## Features

### Boards that are Vikunja

| On the board | In Vikunja |
|---|---|
| A column | A bucket of the project's kanban view, in Vikunja's order, with its limit |
| A card | A task: title, due date, labels |
| Drag a card | The task moves to that bucket, at that place |
| Tick a card | The task is marked done (and filed in the done bucket, if the kanban view has one set) |
| Type into "New card" | A new task in that bucket |

- **Every board of a project redraws** when a read finishes, and a read started after a move or
  tick always comes after it, so the board ends on what Vikunja has.
- **A failed request is taken back** on the board, with a notice saying why.
- **Shown at once, fetched behind it.** A board draws the last answer straight away and asks
  Vikunja again when that answer is older than 30 seconds. A refresh button sits in the board's head.
- **Offline copy.** The last answer per project is kept in this device's local storage, not in the
  vault. Without a connection the board shows it, marked "offline copy".
- **Refresh timer.** Open boards are read again every 5 minutes by default; 0 turns it off.

### A page per project

- **Sync projects** makes a page in the boards folder (default `Vikunja/`) for every project that
  is not archived. A page is found again by `vikunja-project: <id>` in its frontmatter, so renaming
  or moving it is fine.
- **Nothing is deleted.** A project that disappears from Vikunja gets `vikunja-gone: true` on its
  page; the flag goes again when the project comes back.
- **On start**, if turned on, the projects are synced once quietly. Off by default: on a second
  device the vault sync may not have pulled the pages yet, and the device would make them again.

- **Any note can show a board.** The block (`source: vikunja`, `project: <id>`, optionally
  `title:`) works anywhere, and so does embedding a project page.

### A note per task

- **Click a card** and the task's note opens in a new tab. It is made on the first click, in
  `<boards folder>/Tasks/<project>/`, with the task's description as its first lines.
- **Found by id.** The note carries `vikunja-task: <id>`, so renaming the task or the note never
  loses it. What you write there stays in the vault; Vikunja's description is not overwritten.
- **Ctrl/Cmd-click** opens the task in Vikunja instead. The card's menu adds mark done/open,
  rename, due date and move to a column.

### The token stays on the device

- **Obsidian's secret storage.** The API token is kept there, encrypted with the system's key
  store where the device has one (the setting says whether it is). Never in `data.json` or the
  repo, so a synced vault does not carry it. Each device is given its own once; the bin next to
  the field forgets it, and removing the add-on forgets it too.
- **Older Obsidian** (before secret storage existed): the device's local storage instead, still
  outside the vault. A token saved there by 0.1.0 moves into the secret storage on its own.

<br>

## Roadmap

- **Screenshots.** None yet.
- **Labels** are shown, not edited. **Assignees** are neither shown nor changed.
- **Subprojects** get flat pages; mirroring the project tree as folders is not built.

<br>

## Links

[Changelog](CHANGELOG.md) · [Architecture](docs/architecture.md) · [Nexus Suite](https://github.com/vredix-openvuture/nexus-suite)

MIT licensed.
