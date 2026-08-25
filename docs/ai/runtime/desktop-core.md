# Desktop Core Boundary

Purpose: describe the Electron renderer-to-TL Core boundary.
Read when: changing Electron IPC, preload APIs, desktop lifecycle or the desktop Runtime Manager.
Do not read when: working only on browser UI or existing renderer runtime behavior.
Last updated: 2026-08-25.

## Current Phase 2 Boundary

Implementation: `core/desktop/tl-core.cjs`.

Electron Main calls the Core through one IPC route: `trackers-core:request`.
The preload exposes only these renderer APIs:

- `window.trackers.desktop.getStatus()`
- `window.trackers.desktop.openExternal(url)`
- `window.trackers.runtime.getStatus()`
- `window.trackers.desktop.persistence.getStatus()`
- `window.trackers.desktop.persistence.planImport(bundle)`

For compatibility with existing desktop pages, the same diagnostic calls are also exposed as `window.trackersDesktop.getPersistenceStatus()` and `window.trackersDesktop.planPersistenceImport(bundle)`. They map to the same validated Core route; neither alias exposes a database handle or broader IPC.

The Core allow-lists those commands and validates external URLs/import-plan store names. It exposes no filesystem, database, raw SQL, child-process, arbitrary IPC or runtime-execution API.

`desktop.persistence.*` is diagnostic-only during the foundation phase. Main provides TL Core with the private user-data SQLite path, but neither status nor preload reveal it. `planImport` hashes/validates an allow-listed first-cohort export bundle and does not write user data; fixture import exists only in Core tests.

`npm run test:electron-bridge` is a hidden-window smoke test that verifies both bridge forms in a sandboxed/context-isolated Electron renderer.

## Current Ownership

- Electron Main: windows, lifecycle, CSP, navigation policy and OS adapter calls.
- TL Core: allow-listed desktop command contract and runtime ownership metadata.
- Renderer JS Worker: existing JS runtime execution.
- Renderer IndexedDB: existing local persistence.

`runtime.getStatus()` is intentionally descriptive only during Phase 2. Runtime migration, app-data migration and Python are later phases.
