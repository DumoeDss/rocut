## Context

C1 published one Host contract and a deliberately small `ProjectStore` (`list`, `load`, `save`, `remove`, optional `migrate`) whose `ProjectRecord.data` is opaque. C4 now supplies every Host role, but both production composition roots still inherit `InMemoryProjectStore` from `createInMemoryPorts`. Browser persistence remains a process-global `storageService`, and production editor modules import it directly.

The frozen C5 product base is commit `0ef35459f685d5d41a25d0ef959aff691b7519cd`, tree `286272307b05d23826ffa7223a76695365194dba`, on `feat/s02-storage-port`. The product worktree was clean when planning began.

The current production importer inventory is:

| Consumer | Current responsibility |
| --- | --- |
| `commands/media/add-media-asset.ts` | media metadata/binary write |
| `commands/media/remove-media-asset.ts` | media removal |
| `components/storage-provider.tsx` | storage support, quota, project/media cleanup |
| `core/managers/media-manager.ts` | media load/list and object reconstruction |
| `core/managers/project-manager.ts` | project list/load/save/delete |
| `core/managers/scenes-manager.ts` | project persistence after scene mutation |
| `media/processing.ts` | persisted-media lookup during processing |
| `sounds/sounds-store.ts` | saved-sound library CRUD |
| `services/storage/browser-host-adapter.ts` | provisional `ProjectStore` wrapper |

`apps/vite-example/src/project-picker.tsx` is the sole `BrowserHostAdapter` consumer. C3 also handed the local-storage-backed custom graph-preset library to C5. Direct mechanism use currently belongs in `services/storage/indexeddb-adapter.ts`, `services/storage/opfs-adapter.ts`, `services/storage/service.ts`, and storage migrations; three explicit browser QA/probe fixtures (`tests/parity/snapshot.ts`, `tests/probe/seed.ts`, and `tests/probe/legacy-migration.pw.ts`) require narrowly named verification exemptions. Other shell-only local-storage preferences are outside this change.

The C1 open risk has materialized. A project-only CRUD surface cannot express large project attachments, a durable user library, or storage capacity/support without one of four outcomes: preserve the singleton, invent an ungoverned private port, make the Host inspect OpenCut data, or formally deepen the existing public role. Only the last outcome preserves the direction's dependency rule.

Protected base identities are:

- `apps/web/src/editor/ports` tree: `3f7d89b52a3d8f1474519695b7ae7e0a5f68c471`
- parity fixture tree: `e1fbb55b985f4fb490c6b233d18c50c58ea14c28`
- type fixture blob/SHA-256: `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8` / `0f7cc855fc8f5c7edd68b2c371bae993fe8e713d2ffd4ef21956de72bd387622`
- parity diff oracle: `fa387ebea1e7f0cc1110eebcb922d393a1337842`
- public session blobs (`create-session`, `session-types`, index): `ee63d7843fa73df6959aa92030bf4871236b6038`, `c67d9822a2a6c994be14f367e6980fbbaa6e454b`, `59dd907482a109f8627b217764925bd284f3f223`
- Rust trees (`rust/wasm`, `rust/crates/gpu`, `rust/crates/compositor`): `d782b046c0f39e85b8a5ed518b42389214c211e5`, `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2`, `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34`
- generated package SHA-256 (`opencut_wasm.js`, `opencut_wasm_bg.wasm`): `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1`, `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`

The inherited full-suite baseline is `250 pass / 8 fail / 2 loader or module errors / 688 expectations`. Its only accepted reds are six `resolveTrackPlacement` failures caused by `ZERO_MEDIA_TIME` initialization, the masks snapshot failure caused by missing `wasm.__wbindgen_start`, and the timeline update-pipeline failure caused by `DEFAULTS` initialization. C5 may fix an inherited red only if necessary and attributed; it may not add one.

## Goals / Non-Goals

**Goals:**

- Make the Host-supplied `ProjectStore` the only production path from editor logic to durable project, attachment, and user-library storage.
- Preserve arbitrary provider-private fields through decode, ordinary edits, save, full reload, and reopen.
- Place IndexedDB, OPFS, browser capability detection, and schema migration entirely behind the named browser storage implementation.
- Prove portability by running the same conformance cases against the browser implementation and the in-memory non-browser implementation.
- Preserve intentional durable sharing while isolating project IDs, attachment keys, library namespaces, sessions, and disposable test databases.
- Make missing Host roles, hidden in-memory fallbacks, direct service imports, private storage channels, and mechanism leaks mechanically fail.

**Non-Goals:**

- C6 disposal for AudioContext, Worker, WebSocket, object URL, compositor, or shared-GPU last-owner behavior.
- C7's emitted headless Host or removal of React from the emitted runtime graph.
- E1 feature behavior, renderer performance measurements, or unrelated UI/shell preference migration.
- Changes to protected parity fixtures, the type fixture, public session shape, Rust crates, or generated WASM artifacts.
- A data-destructive migration test against a real user profile.

## Decisions

### 1. Deepen the existing `ProjectStore`; do not add another port

`EditorHost.store` remains the sole persistence role. Its existing record/list/load/save/remove/migrate operations remain, and the role gains mechanism-neutral operations for:

- project-scoped attachments, identified by `{ projectId, key }`, carrying opaque metadata and an `ArrayBuffer` body;
- durable library records, identified by `{ namespace, key }`, carrying a schema version and opaque data;
- availability/capacity inspection expressed in generic terms rather than IndexedDB/OPFS support names; and
- clear/cascade behavior needed by the existing storage UI.

All returned mutable values and binary buffers are defensive copies. `remove({id})` removes the project summary, project payload, and that project's attachments as one logical operation; it does not erase user-library records. The exact TypeScript additions are public in `editor/ports/project-store.ts`, exported through the existing port entry point, covered by the decision record, and consumed without a second context or factory parameter.

This is an intentional amendment to C1, not an accidental widening. Before consumer wiring, review must accept that the C1 risk materialized and that the amended contract remains Host-neutral. If it does not, implementation stops. A private `MediaStore`, `StorageContext`, direct singleton escape hatch, or `EditorHost & { hiddenStorage: ... }` is not an alternative.

Alternatives rejected:

- A new top-level storage/media port duplicates ownership and violates the one-surface/no-private-port decision.
- Packing all media bytes into `ProjectRecord.data` forces whole-project binary rewrites and prevents a Host from retaining OPFS without inspecting editor data.
- Keeping `BrowserHostAdapter` over the singleton leaves all non-project importers uninverted and cannot pass a second implementation's conformance.

### 2. Put an editor-side persistence coordinator above the Host-neutral store

A session-scoped editor persistence coordinator translates OpenCut projects, media, saved sounds, and custom graph presets into the generic store operations. It may import editor schema types; the store contract and browser implementation may not. Managers, commands, processing helpers, and providers receive this coordinator or `host.store` from session composition rather than importing a module singleton.

The dependency direction is:

```text
Vite Host / Next Host
        |
        v
BrowserProjectStore ----> IndexedDB / OPFS / migration mechanics
        ^
        | existing EditorHost.store contract
session persistence coordinator
        ^
        |
project/media/scenes managers, media commands, sounds, presets, storage UI
```

The coordinator is an editor-internal module, not a port. It contains provider codecs and command sequencing but no browser persistence calls. Constructor/factory injection is preferred; a React provider may expose the already-created session service to UI descendants, but it may not construct or conceal another store.

### 3. Preserve unknown project data with a retained opaque snapshot and identity-aware overlay

On load, the coordinator retains a defensive clone of the complete opaque provider payload and decodes the known OpenCut projection. On save it overlays current known values onto that retained payload while preserving unknown sibling fields:

- object keys unknown to the current codec survive;
- scene, track, clip, and media array members are matched by stable identity before known fields are overlaid;
- unknown fields nested on retained members survive;
- a deliberately deleted known member and its private fields are removed;
- newly created members receive only current known data; and
- unknown top-level provider records and library payload fields survive unchanged.

The browser store never performs this merge; it stores `data` and attachment metadata opaquely. Tests seed sentinels at the project, scene, track, clip, media, attachment, and library levels, mutate a known field, save, recreate the complete Host/session, and compare all unknown sentinels after reopen. A simple load-then-save test without an edit is insufficient.

Alternatives rejected: reconstructing `SerializedProject` from known types is the current data-loss bug; JSON stringify/parse cloning rejects values supported by structured clone; shallow object spread loses nested private fields.

### 4. Make the browser store a deep mechanism-owning module

`BrowserProjectStore` is the production adapter. It composes the existing IndexedDB and OPFS helpers internally, owns database names/paths and feature detection, maps platform failures to contract errors, and exposes no raw database or filesystem adapter. Project payloads/summaries/library metadata live in IndexedDB; large attachment bodies may remain in OPFS, with metadata in IndexedDB. The in-memory implementation uses maps and copied buffers but implements the same public behavior.

Both Vite and Next create or reuse an explicitly configured browser store at their Host composition root and final-override `createInMemoryPorts().store`. Session creation receives that object through the existing `host.store`. A production graph check rejects `InMemoryProjectStore`, a missing final override, `BrowserHostAdapter`, or a fallback expression in either Host.

Alternatives rejected: one browser store per manager makes migration and transaction ownership incoherent; one process-global exported service hides dependency acquisition; database names in the contract couple every Host to browser storage.

### 5. Keep migration store-owned, opt-in in tests, and non-destructive until validation

The existing session migration trigger remains `ProjectStore.migrate`, with its once-per-store promise and retry-after-failure semantics. The browser store also keys internal work by durable database identity so two wrapper objects cannot race the same database. Migration follows four phases:

1. discover and read legacy records using their real database/store names;
2. stage transformed current records while preserving source data;
3. validate keys, schema version, record/attachment counts, and opaque sentinels by reading the staged result back; and
4. commit the current representation, then and only then delete obsolete sources.

Failure or cancellation before commit leaves the prior durable representation readable and reports a typed failure. Cleanup failure after commit is diagnostic and retryable; it does not pretend the migration failed or erase the committed data. Conformance never probes a developer's real profile: destructive cases run only when `exerciseMigration: true` is supplied with a unique disposable namespace, and teardown deletes only that resolved namespace after verifying it is under the test prefix.

### 6. Define explicit error, cancellation, and mutation semantics

The public contract exposes a mechanism-neutral store error with stable codes such as `aborted`, `quota-exceeded`, `unavailable`, `corrupt`, and `conflict`; platform error names remain browser-adapter details. A missing project/attachment/library record returns `null`, not an error. Capability inspection distinguishes unsupported/unavailable from zero remaining space.

Reads and replaceable large writes accept an optional `AbortSignal`. A pre-aborted call performs no work. Attachment writes stage bytes before switching metadata to the new body; cancellation or failure before the commit point leaves the prior attachment readable and cleans the staging artifact best-effort. Once a destructive command reaches its commit point it completes rather than reporting cancellation after mutation. Project, media, sound, and preset durable mutations remain serialized per durable key; UI latest-wins cancellation is not allowed to reorder them.

Browser errors are surfaced to the session diagnostics path with operation/scope metadata but no payload contents. Editor callers may present a recoverable message, but may not swallow a failed save or update in-memory state as if durability succeeded.

### 7. Separate durable sharing from live session state

Two sessions may intentionally share one browser store and see committed durable data, but they do not share manager caches, retained opaque snapshots, pending commands, object URLs, or listeners. Attachment operations are scoped by project ID; user-library records are scoped by namespace and key; test/browser database names are configured at the Host root.

Conformance covers two projects with the same attachment key, two library namespaces with the same key, two sessions over one store, and two independent store namespaces. Deleting one project must not affect another project or user-library data. This is persistence isolation only; resource lifetime is deferred to C6.

### 8. Strengthen boundary and composition gates with negative controls

`script/check-storage-boundary.mjs` becomes the canonical gate. It inventories production imports and mechanism calls, permits browser storage mechanisms only under `apps/web/src/services/storage/**`, and names the three exact QA/probe exceptions. It rejects:

- any production import of `storageService` or `BrowserHostAdapter` outside the boundary;
- direct IndexedDB, OPFS, or persistence local-storage use in the distributable editor graph, except the documented user-preference allowlist;
- an added private storage context/port or a Host storage property other than `store`;
- browser mechanism names, OpenCut schema imports, command classes, or editor stores in public port signatures; and
- in-memory/default storage in a production Host graph.

Fixtures deliberately introduce one violation of each class and assert a non-zero exit. The custom graph-preset and saved-sound modules leave the preference allowlist because they become library-record consumers. Shell preferences stay explicitly classified rather than opportunistically migrated.

### 9. Authorize physical topology before logical or physical mutation

The browser implementation owns one centralized private topology policy between authenticated logical plans and the IndexedDB/OPFS mechanisms. Authorization follows mutation granularity: library ownership is an exact `(database, store)` pair; media cleanup owns a whole database and one exact OPFS root; migration cleanup owns a whole database. An authentic descriptor or journal tuple is necessary but not sufficient when its destructive resource aliases another domain. Each successful authorization returns a frozen normalized permit, and cleanup executes only the permit's targets rather than re-deriving names after the check. This policy does not enter `ProjectStore` and requires neither a new public port nor a persisted-journal revision.

For a projects database `PDB` and public store `PS`, the exact pairs `(PDB, PS)`, `(PDB, PS + "-cascade-maintenance")`, `(PDB, PS + "-media-ownership")`, `(PDB, PS + "-library-clear-bindings")`, and `(PDB, PS + "-migration-maintenance")` are reserved. Media database deletion cannot target `PDB`, any current or strictly retained library database, either canonical migration-stage database, a migration-owned legacy timeline database, or a different current/retained media owner's exact database; its OPFS root likewise cannot equal another current/retained media owner's exact root. Migration database deletion cannot target live projects or current/retained library or media databases, and a canonical stage database may delete only its matching stage claim after the complete plan is authorized.

`libraryDatabase === projectsDatabase` remains valid when `libraryStore` is distinct from all five reserved public/control stores. Library operations are exact-store scoped, so rejecting this safe shared-database/distinct-store configuration merely because the database names match would be an over-broad regression. Conversely, a library database may not alias either canonical stage database because later migration cleanup owns the whole stage database.

Before ordinary attachment list/load/save/remove or media-owner refresh performs registration, certificate or descriptor writes, IndexedDB access, or OPFS access, it derives the exact media claim and authorizes it against all current and strictly retained media and library claims. A current unsafe project remove or projects/all clear authorizes its complete cross-domain plan before media-owner registration, project deletion, tombstone or journal commit, store clear, database deletion, directory deletion, or other physical I/O. Because refusal precedes logical commit, reopening under a collision-free configuration may safely reuse the same project ID.

Every historical cascade retry strictly decodes and authenticates its journal, then authorizes the complete target set before the first target operation. If any target conflicts, all target state and the exact journal are retained without partial I/O or journal rewrite, and same-ID save may remain blocked; attempt 4 does not claim automatic convergence or remapping for intrinsically unsafe historical authority. A safe retry by the same logical owner over the same exact physical tuple remains permitted and idempotent.

Migration first derives the complete candidate media and cleanup plan without opening its candidate IndexedDB databases or OPFS roots, loads all current and strictly retained media/library claims, and authorizes the full batch before any IndexedDB/OPFS discovery or upgrade, media-owner registration, stage write, recovery/cleanup intent, delete, or journal shrink. Historical migration recovery and cleanup use the same batch preflight, so a safe early target cannot partially advance past a later conflict. Topology conflicts cross the public boundary only as mechanism-neutral `unavailable` errors with logical operation/scope; maintenance diagnostics use fixed topology phases, `retryable: false`, and contain no physical names, internal policy reason, payload, provider-private value, or raw platform cause.

## Risks / Trade-offs

- **[C1 contract freeze is being amended]** → Treat the materialized risk as a named decision; land contract, conformance, and decision-record changes before consumer wiring. Stop if independent review rejects the in-place deepening.
- **[Unknown nested fields can still be lost by a naive codec]** → Require identity-aware overlay tests with a real known edit and full Host/session recreation; make any lost sentinel a ship blocker.
- **[IndexedDB metadata and OPFS bytes are not one native transaction]** → Use staged bodies and an explicit metadata commit point; preserve the previous attachment until the new record validates; make orphan cleanup idempotent.
- **[Browser conformance can accidentally test only mocks]** → Export one case matrix and run it unchanged against in-memory in the unit runner and real browser storage in an isolated browser fixture.
- **[A shared durable store can be mistaken for shared session state]** → Test shared committed visibility separately from cache/listener/object-URL independence; defer resource disposal assertions to C6.
- **[Migration tests can damage a real profile]** → Require explicit opt-in, disposable prefix validation, randomized namespaces, and resolved-target checks before teardown.
- **[The widened write set overlaps later changes]** → C6 and C7 remain serial after C5. C6 must rebase before touching session factory/ports/storage consumers; C7 must consume the final required Host surface. E1 must avoid project/media manager edits until C5 lands.
- **[Large binary copies increase memory pressure]** → Keep the first public representation mechanism-neutral and correctness-first, record measured copy cost, and do not invent an unreviewed streaming port in C5. A later measured amendment may add a portable stream abstraction.
- **[An exactly authenticated target can still alias a protected physical domain]** → Centralize mutation-granularity policy for reserved pairs, whole databases, exact OPFS roots, current/retained owners, and full historical batches; require frozen permits before ordinary media access, logical commit, discovery, or cleanup I/O.

## Migration Plan

1. Reconfirm the exact base, clean worktree, protected hashes, importer inventory, type-error ceiling, storage-boundary baseline, and inherited reds. Capture failing controls for opaque nested data loss, missing browser conformance, production in-memory fallback, and direct-import detection.
2. Amend the public `ProjectStore`, in-memory implementation, conformance matrix, decision record, and port-boundary negative fixtures. Obtain the contract-review gate before wiring consumers.
3. Implement `BrowserProjectStore` around the existing real projects database and OPFS layout. Add isolated browser conformance and non-destructive legacy migration fixtures.
4. Add the session persistence coordinator and opaque overlay codec; rewire project/media/scenes flows, commands, processing, saved sounds, custom presets, and storage UI one call family at a time.
5. Wire stable browser-store instances into both Host roots, make all Host roles required, remove optional resolution/fallback paths, retire `BrowserHostAdapter`, and eliminate the singleton's editor import surface.
6. Run focused conformance/round-trip/isolation/failure tests, boundary and negative controls, fresh Vite and Next builds, the protected parity oracle, type ceiling, source-graph/provenance checks, and the full regression suite.
7. Independently review the complete delta. Ship only if provider-private sentinels, both store implementations, both Hosts, migration safety, protected identities, and inherited-red accounting all pass.

Rollback is code-first and data-preserving: revert Host composition to the prior adapter only if no destructive cleanup has occurred, retain legacy durable sources until the new store validates them, and never roll back by deleting a user database. A partially staged attachment or migration namespace is safe to clean by its validated internal prefix; an ambiguous target is left for diagnostic cleanup.

## Open Questions

No product-shape question is intentionally deferred. The single preimplementation gate is whether review accepts the explicit in-place `ProjectStore` amendment. Rejection means stop and return to direction/C1; it does not authorize a private port or singleton escape hatch.

## Expected Write Set and Serial Overlap

Expected product paths include:

- `apps/web/src/editor/ports/project-store.ts`, `index.ts`, `in-memory/**`, `conformance/**`, tests, and the storage decision record;
- `apps/web/src/services/storage/**` plus storage migration tests;
- the nine inventoried importers and `timeline/components/graph-editor/custom-presets-store.ts`;
- the session persistence coordinator/codecs and the existing session factory/Host resolution files needed to make roles required;
- `apps/vite-example/src/project-picker.tsx`, both Vite/Next Host roots, storage/browser conformance fixtures, boundary scripts, and relevant architecture docs.

The attempt-4 minimum write set is:

- new `apps/web/src/services/storage/browser-project-store-topology.ts` for canonical control/stage names, protected-domain classification, and frozen topology permits;
- `apps/web/src/services/storage/browser-project-store.ts` for the static initialization gate and topology dependency wiring;
- `apps/web/src/services/storage/browser-project-store-media-ownership.ts` and `browser-project-store-library-clear-bindings.ts` for strict current/retained physical claims and pre-access/pre-registration authorization;
- `apps/web/src/services/storage/browser-project-store-cascade-manager.ts` and `browser-project-store-cascade.ts` for current precommit, historical full-batch preflight, permit execution, diagnostics, and delegated canonical names;
- `apps/web/src/services/storage/browser-project-store-migration.ts` for pre-discovery full-plan authorization, authorized stage cleanup, and historical full-journal preflight;
- `apps/web/src/services/storage/browser-project-store-cascade-round2-probes.ts` and `browser-project-store-migration-round2-probes.ts` for the attempt-4 alias, ordering, historical, and idempotence probes;
- `apps/vite-example/src/c5-storage-harness.ts` and `apps/vite-example/tests/c5-storage/browser-store.pw.ts` for explicit Chromium result aggregation and assertions; and
- `apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts` for focused exact-pair, whole-database, exact-root, protected-domain, and same-owner normalization rules.

Explicitly protected/non-write paths are parity fixtures/oracle, the type fixture, public session API files unless a separately attributed blocker proves unavoidable, Rust crates, generated WASM, and C6/C7/E1-owned implementation. C6 overlaps `editor/ports`, session factory, media/sounds consumers, and perhaps storage teardown; it must start from the landed C5 tree. C7 overlaps Host roots and factory shape; it follows C6. E1 must treat project/media manager conflicts as serial.
