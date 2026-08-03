## Why

After C4, both application Hosts still inherit the in-memory reference `ProjectStore`, while editor production code reaches the process-global browser storage service through nine direct import paths. That split defeats Host composition, loses provider-private project fields during save/reopen, and prevents a second non-browser store from proving that persistence is genuinely portable.

## What Changes

- **BREAKING**: deepen the existing public `ProjectStore` role—without adding a parallel or private port—so it can carry opaque project records, mechanism-neutral project attachments, durable user-library records, and storage capability/error results needed by the existing editor workflows. Host implementations must provide the complete role.
- Replace the provisional `BrowserHostAdapter` with a production browser `ProjectStore` whose IndexedDB/OPFS mechanics and schema migrations remain behind the named storage boundary; wire that store explicitly in both Vite and Next Host roots with no in-memory production fallback.
- Centrally authorize the browser store's physical topology at the granularity each mutation can destroy: an exact `(database, store)` pair for libraries, a whole database plus exact OPFS root for media cleanup, and a whole database for migration cleanup. Ordinary media access, new cleanup plans, and historical retries fail closed against current and retained protected ownership before mutation; this private attempt-4 policy does not widen the public port or persisted journal format.
- Rewire the storage provider, project/media/scenes managers, media commands and processing, saved-sounds store, and the C3-deferred custom graph-preset persistence through the session Host store. Remove editor-runtime imports of the process-global storage singleton.
- Preserve provider-private and otherwise unknown opaque data byte-for-byte in meaning across ordinary edit/save/reopen flows, including nested metadata and project attachment metadata.
- Run the persistent browser store and a second non-browser store through the same conformance suite, including opt-in disposable migration fixtures, multi-session/project isolation, cancellation, quota/unavailable/corrupt failures, and destructive-operation semantics.
- Tighten automated boundary checks and negative controls so direct browser persistence, adapter resurrection, hidden fallbacks, private backchannels, or Host-neutral contract leaks fail deterministically.
- Preserve the protected parity oracle, type fixture, Rust/generated WASM surfaces, and the C4 build/parity/regression ceilings; leave resource disposal and headless execution to C6 and C7.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `browser-persistence-boundary`: replace the explicitly provisional adapter with the production browser store, strengthen opaque round-trip and migration safety, and make the boundary gate enforce the final ownership model.
- `host-port-contract`: make the complete Host port surface required, formally deepen the existing `ProjectStore` role rather than inventing another port, and require identical persistent/non-browser storage conformance and failure semantics.

## Impact

- Affects the public Host storage contract and its conformance kit, browser and in-memory store implementations, session creation/composition, both application Host roots, storage migration ownership, project/media/sound/preset persistence consumers, browser-storage boundary tooling, tests, and decision records.
- The expected implementation write set includes `apps/web/src/editor/ports/**`, `apps/web/src/services/storage/**` (including the private topology module and cascade/migration topology probes), the nine inventoried storage importers, the custom graph-preset store handed off by C3, session factory/Host resolution, `apps/vite-example` and `apps/next-example` composition roots, focused tests, and boundary/documentation updates.
- C1's recorded risk has materialized: its minimal `ProjectStore` cannot invert media binaries, durable libraries, and capacity/support calls without either a private backchannel or a formal in-place contract amendment. Implementation must stop before product wiring if review rejects this amendment; silently widening the interface or adding an ungoverned port is forbidden.
- Excludes C6's five-resource/session disposal and shared-GPU last-owner work, C7's emitted headless Host, E1 feature work, protected parity/type fixtures, Rust crates, and generated WASM artifacts.
