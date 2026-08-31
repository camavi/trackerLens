# Desktop Core Boundary

Purpose: describe the Electron renderer-to-TL Core boundary.
Read when: changing Electron IPC, preload APIs, desktop lifecycle or the desktop Runtime Manager.
Do not read when: working only on browser UI or existing renderer runtime behavior.
Last updated: 2026-08-31.

## Current Phase 2 Boundary

Implementation: `core/desktop/tl-core.cjs`.

Electron Main calls the Core through one IPC route: `trackers-core:request`.
The preload exposes only these renderer APIs:

- `window.trackers.desktop.getStatus()`
- `window.trackers.desktop.openExternal(url)`
- `window.trackers.runtime.getStatus()`
- `window.trackers.desktop.persistence.getStatus()`
- `window.trackers.desktop.persistence.planImport(bundle)`
- `window.trackers.desktop.customNodePackages.inspect()`
- `window.trackers.desktop.customNodePackages.install()`
- `window.trackers.desktop.customNodePackages.list()`

For compatibility with existing desktop pages, the same diagnostic calls are also exposed as `window.trackersDesktop.getPersistenceStatus()` and `window.trackersDesktop.planPersistenceImport(bundle)`. They map to the same validated Core route; neither alias exposes a database handle or broader IPC.

The Core allow-lists those commands and validates external URLs/import-plan store names. Custom Node package import opens a native Main-process file picker for `.tl-node.zip`, then the Core-owned manager validates the archive, catalogs its manifest and copies its opaque artifact into app data. The bridge returns only sanitized manifest/catalog metadata—never an archive path, filesystem handle, raw SQL, child-process or runtime-execution API. Imported package JavaScript is explicitly blocked during this manifest-only phase.

`desktop.persistence.*` is diagnostic-only during the foundation phase. Main provides TL Core with the private user-data SQLite path, but neither status nor preload reveal it. `planImport` hashes/validates an allow-listed first-cohort export bundle and does not write user data; fixture import exists only in Core tests.

`npm run test:desktop` is a hidden-window smoke test that verifies both bridge forms in a sandboxed/context-isolated Electron renderer.

## Current Ownership

- Electron Main: windows, lifecycle, CSP, navigation policy and OS adapter calls.
- TL Core: allow-listed desktop command contract and runtime ownership metadata.
- Renderer JS Worker: existing JS runtime execution.
- Renderer persistence: restricted TL Core SQLite bridge only.

`runtime.getStatus()` is intentionally descriptive only during Phase 2. Runtime migration, app-data migration and Python are later phases.
