# Custom Node Packages

Purpose: define the planned package, trust and marketplace model for developer-built Flow Map nodes.
Read when: implementing Custom Node upload/install/runtime, marketplace verification, package security or developer SDK.
Do not read when: working on built-in nodes unrelated to external packages.
Last updated: 2026-08-31.

## Direction

Trackers Lens supports developer-built custom nodes through an importable `.tl-node.zip` bundle, never loose ad-hoc scripts. A custom node may contain runtime code, UI schema, JSON schemas, images, files, examples and documentation.

JavaScript custom runtime cannot be made 100% safe. TL must reduce risk with manifests, permissions, sandboxing, signing and marketplace verification, but must not claim perfect control over arbitrary external code.

## Artifact and Persistence Rule

The `.tl-node.zip` file is the portable package artifact. Electron Main/TL Core
alone may read it, validate it and copy the exact archive into the Core-owned
app-data package directory. The renderer, workers and package runtime never
receive an archive path or filesystem handle.

SQLite remains the authority for the installed-package catalog (`tl_packages`):
package id/version, archive SHA-256, manifest summary, trust level, declared
permissions, source/provenance and install state. Flow Maps persist only a
package reference/version plus node configuration; they do not embed package
files. This gives imports, upgrades, removal, audit and later dependency locks
one Core-owned lifecycle without replacing the portable-file format.

Manifest-only import stores and catalogs the archive but never loads, imports
or executes `runtime.js`. Runtime execution is blocked until the later
sandboxed-runtime phase.

## Package Shape

Required `.tl-node.zip` root shape:

```text
my-custom-node/
  node.json
  runtime.js
  ui.json
  assets/
    icon.svg
    preview.png
  schemas/
    input.schema.json
    output.schema.json
  examples/
    sample-flow.json
  README.md
```

`node.json` is the main contract:

```json
{
  "id": "custom.story-analyzer",
  "name": "Story Analyzer",
  "version": "1.0.0",
  "publisher": "example-dev",
  "category": "ai-agents",
  "subtype": "story-analyzer",
  "icon": "auto_stories",
  "inputs": ["task", "text"],
  "outputs": ["analysis", "diagnostic"],
  "permissions": {
    "network": false,
    "filesystem": false,
    "aiProvider": true,
    "memory": true,
    "runtimeGraph": "read"
  },
  "runtime": {
    "entry": "runtime.js",
    "mode": "sandboxed"
  },
  "ui": {
    "schema": "ui.json"
  }
}
```

Runtime should expose a controlled function shape:

```js
export async function run({ input, config, tools, emit, log }) {
  const result = await tools.ai.complete({ prompt: config.promptTemplate, input });
  await emit("analysis", { text: result.text });
}
```

## Trust Levels

Custom nodes should carry a visible trust level:

- `verified`: from the official TL Marketplace, signed and verified.
- `community`: published but not officially verified, with visible warnings.
- `local-dev`: loaded from local zip/folder for development, high warning.
- `blocked`: rejected by policy or verification.

Example:

```json
{
  "trustLevel": "verified",
  "signature": "package-signature",
  "publisher": "trackerslens",
  "verifiedAt": "2026-07-30T00:00:00.000Z"
}
```

## Marketplace Model

Official TL Marketplace is the safe default:

- package signature verification
- manifest validation
- declared permissions review
- static analysis for risky APIs
- AI-assisted code review
- runtime smoke tests
- dependency scan where applicable
- verified badge in UI

External zip/folder installs are allowed only with explicit user consent and strong warnings. If a user installs unverified code from outside the official marketplace, TL should make the risk clear and mark the node as unverified/local-dev.

## Verification Checks

Marketplace verification should inspect:

- `eval`, `new Function`, dynamic import of remote code
- `fetch`, `WebSocket`, external network calls
- browser storage and direct SQLite access outside TL Core
- file access requests
- hidden credential collection
- undeclared permission use
- minified/obfuscated code
- unexpected cross-workspace/global access
- runtime graph mutations outside approved tools

AI verification should produce:

- risk summary
- permission mismatch report
- blocked patterns
- suggested fixes for the developer
- human-readable install warning text

## Runtime Safety

Custom runtime must be permission-gated:

- AI provider calls only through TL tools.
- Memory access only through declared scoped APIs.
- Runtime graph reads/mutations only through approved tool layer.
- Network access disabled by default and explicit when allowed.
- Files/assets limited to the package unless a permission is granted.
- Mutations still go through safe executor/preflight where possible.

Sandboxing is defense-in-depth, not a full guarantee.

## Implementation Phases

1. Manifest-only package import: validate and Core-copy a `.tl-node.zip`, catalog manifest/assets/UI schema and register a disabled palette entry without executing external code.
2. Package asset support: icons, previews, JSON schemas, examples and sample flow import.
3. Permission dialog: show requested permissions, trust level and verification status before install.
4. Sandboxed runtime: execute `runtime.js` with restricted `{ input, config, tools, emit, log }` API.
5. Local Dev Mode: folder/zip upload for developers, always marked `local-dev` or `community`.
6. Official Marketplace: signed package registry with AI/static verification and `verified` trust level.
7. Versioning/migrations: update installed custom nodes without breaking existing Flow Map configs.
