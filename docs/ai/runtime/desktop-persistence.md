# Desktop Persistence: SQLite-Only Desktop

Purpose: define the SQLite-only persistence architecture for the Trackers Lens desktop app, owned by TL Core.
Read when: changing desktop storage, SQLite, persistence bridge or repository APIs.
Do not read when: changing browser-only compatibility code.
Last updated: 2026-08-25.

## Decision

SQLite is the only persistent store for the Electron desktop application. TL Core is its sole owner. IndexedDB is not a source of truth, is not a rollback mechanism and must not be introduced into new desktop code.

The database belongs to TL Core. Electron Main supplies only the app-data path and the validated IPC adapter. Renderer code, JavaScript workers and Python workers never receive a database handle or arbitrary SQL capability.

```txt
Renderer repositories
        │ validated persistence requests
        ▼
TL Core persistence service ──► SQLite file in Electron userData
                                       │
                                       └─ schema, migrations, audit
```

Python remains computation-only. A Python node can return a proposed record or transformed payload; a TL Storage node/Core policy validates and persists it.

## Store Contract

Records remain JSON-like objects keyed by `id`. The names below are SQLite logical collections in `tl_records`; they preserve current payload envelopes while callers are moved behind Core repository APIs.

| Data class | SQLite logical collections | Desktop treatment |
| --- | --- | --- |
| Workspace and assets | `tl_pages`, `tl_widgets`, `tl_connections`, `tl_settings` | Local library, Box Editor, connection and channel paths use Core SQLite. |
| Runtime graph | `tl_flows`, `tl_runtime_nodes`, `tl_runtime_dependencies`, `tl_channels` | First implementation group; Graph Store/snapshot already use the Core boundary in desktop SQLite mode. |
| Runtime observations | `tl_events`, `tl_flow_logs`, `tl_box_performance`, `tl_time_travel_snapshots` | All use the Core SQLite boundary. |
| AI state | `tl_ai_providers`, `tl_ai_agents`, `tl_ai_runtime`, `tl_ai_jobs`, `tl_ai_logs`, `tl_ai_memory`, `tl_ai_prompts`, `tl_ai_prompt_flows`, `tl_ai_metrics` | Move after runtime observations, with a separate desktop-secret policy. |
| Knowledge | `tl_knowledge_documents`, `tl_knowledge_chunks`, `tl_knowledge_embeddings`, `tl_knowledge_entities`, `tl_knowledge_relations`, `tl_knowledge_dictionary`, `tl_knowledge_events`, `tl_structured_knowledge`, `tl_knowledge_queries`, `tl_knowledge_sources`, `tl_knowledge_metrics` | Core SQLite repository group. |
| Operational state | `tl_offline_queue`, `tl_offline_cache`, `tl_packages`, `tl_package_lock`, dynamic StorageRuntime collections | StorageRuntime writes `tl_history` or normalized `tl_storage_*` collections through Core SQLite; other operational owners remain to be isolated from browser compatibility code. |

`localStorage` is not part of the first database cutover. UI preferences such as Flow Chat open state remain renderer-local until they are separately catalogued and moved through an explicit settings migration.

## SQLite Model v1

The first SQLite schema is deliberately document-oriented to preserve the existing record shapes and avoid a global relational rewrite:

```txt
tl_meta(key, value_json, updated_at)
tl_records(store_name, id, workspace_id, record_json, created_at, updated_at)
tl_migration_runs(id, source, status, manifest_json, started_at, completed_at, error_json)
tl_migration_items(run_id, store_name, record_id, payload_hash, status, error_json)
tl_backups(id, path, manifest_json, created_at)
```

Required indexes: `(store_name, id)` unique, `(store_name, workspace_id)`, `updated_at`, and migration-item lookup by `(run_id, store_name, record_id)`. `record_json` stores the unmodified logical record; canonical columns only support safe scope/query operations. Domain-specific relational tables are a later optimization and require their own migration/compatibility design.

`tl_meta` contains at minimum `schemaVersion`, `storageContractVersion`, `profileId`, and the active persistence mode. SQLite is opened with migrations and integrity checks managed by TL Core; it is not exposed through preload.

## Persistence Mode

Desktop mode is `desktop-sqlite`. It is Core-owned and never supplied by a renderer URL, worker or Python option. New desktop persistence APIs must fail clearly when unavailable; they must not fall back to IndexedDB.

## Transition Policy

This repository is development-only and its existing IndexedDB data is disposable. Do not create a recovery bundle, backup manifest, shadow comparison or rollback path for it. Existing IndexedDB stores may be ignored or removed once their calling module has been moved to the SQLite repository.

The transition is code-based, not data-migration-based: replace direct IndexedDB calls collection group by collection group with narrow Core repository operations. Every desktop write has one authority—SQLite—never dual-write. The application must not report completion until all active desktop callers have left IndexedDB.

## Current Implementation

Implemented foundation:

- `core/desktop/desktop-persistence.cjs` owns SQLite schema/integrity and allow-listed record operations through Node's built-in `node:sqlite`.
- Electron Main supplies only the private app-data path. Preload exposes named commands and never a database path, handle or raw SQL.
- `database.html` is the read-only SQLite Explorer in Electron. It requests the allow-listed collection catalog and records through TL Core, so developers can inspect logical collections and JSON payloads without opening the database file or executing SQL from the renderer. It requires that bridge: it has no operational IndexedDB or demo-data fallback; the former IndexedDB open/read implementation and sample records have been removed. Its actions are limited to selection, copy and local JSON export—never editing, deleting, duplicating or importing records.
- `database.html` loads only its UI framework, configuration, sidebar and Explorer script. It does not load graph, cache, package, editor or other persistence runtime modules.
- `TrackerLensRuntimeGraphStore`, `RuntimeSnapshotStore`, `TrackerLensEventLogStore`, `TrackerLensConnectionsStore`, `TrackerLensChannelRegistry`, `TrackerLensLocalLibrary`, `TrackerLensBoxEditorDialog`, `TrackerLensBoxPerformanceMonitor`, `TrackerLensTimeTravelStore`, `TrackerLensKnowledgeRuntime`, `StorageRuntime` and the legacy-compatible `DatabaseIndexedDB` Workspace adapter use the Core SQLite boundary for desktop persistence.
- Browser-oriented IndexedDB implementations still exist in modules not yet moved. They are temporary migration debt, not a valid desktop fallback.
- Runtime manifest permissions normalize the old `indexeddb.read` / `indexeddb.write` tokens to `sqlite.read` / `sqlite.write`, including persisted legacy manifests. New palette nodes must declare the SQLite tokens directly.

## Acceptance Tests

- Core rejects unknown persistence commands, paths, store names and raw-SQL requests.
- SQLite integrity and allow-listed record reads/writes/deletions are covered by automated tests.
- A desktop Flow Map smoke test must prove that no first-group read or mutation opens IndexedDB.
- Each remaining collection group must move all readers and writers together before IndexedDB usage is deleted.

## Explicit Non-goals

- No replication, sync service, cloud backup or multi-device conflict resolution.
- No use of SQLite by Python or arbitrary package code.
- No new IndexedDB desktop persistence paths.
