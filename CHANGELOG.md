# Changelog

## 0.1.1 — unreleased

### Changed

- The hints that send you to the settings name the place they are: the suite's Add-ons page, or
  the plugin's own tab when there is no suite to host it.
- Without Nexus Suite (or after turning it off) the settings get a tab of their own again.
- The token setting says whether this device's secret storage is encrypted.
- Removing the add-on from the suite forgets the token and the offline boards on that device.

## 0.1.0 — 2026-10-12

### Added

- First version: a `vikunja` kanban source for Nexus Suite, a page per project, a note per task,
  write-through moves, ticks and new cards, an offline copy per device, a refresh timer.
- Installed and updated from Nexus Suite's Add-ons page; its settings are a page there.
- The API token is kept in Obsidian's secret storage on each device.
