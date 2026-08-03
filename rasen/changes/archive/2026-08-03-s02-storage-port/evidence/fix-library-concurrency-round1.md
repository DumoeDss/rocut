# C5 review round 1 — library concurrency fix

Date: 2026-08-02  
Scope: review finding B2 and test gap 2 only  
Status: implemented and focused gates green; uncommitted

## Finding closed

Two complete `EditorSession` instances can share one Host and its one stable injected
`ProjectStore`. Before this fix, saved sounds and graph-editor custom presets each serialized
only through an instance-local StoreApi/coordinator tail. Both sessions could therefore load
the same predecessor, independently append, and then save two whole-record replacements. Both
promises resolved while the later replacement silently discarded the earlier update.

## Deterministic RED

The regression suite creates two complete sessions from the same `createInMemoryHost({ store })`
and pauses the first `save-library-record` after its read. The second session then starts the
same logical mutation. Before the shared arbitration implementation:

- command: `$env:OPENCUT_SESSION_ASYNC_STORE_TEST_ISOLATED='1'; bun test apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts`
- result: **10 passed, 2 failed, 65 assertions**
- saved sounds reloaded only `[202]`, losing `201`
- custom presets reloaded only the second value (`0.55,0.66,0.77,0.88`), losing the first

The RED therefore exercised the compound read-modify-write race, not merely two direct writes.

## Implementation and boundary decision

`SessionPersistenceCoordinator.mutateLibraryRecord` now performs a fresh durable load, decode,
consumer mutation, encode/opaque overlay, and durable save inside one shared logical-record
critical section. Saved sounds and custom presets use this operation for append/remove rather
than composing a load and whole-record save outside the critical section.

Cross-session arbitration is mechanism-neutral:

- A `WeakMap<ProjectStore, DurableLibraryArbitration>` is keyed by the exact, explicitly injected
  stable store object supplied by the Host. It does not name IndexedDB, OPFS, a browser adapter,
  or another provider mechanism.
- Each value contains only in-flight `Promise<void>` tails keyed by logical library record or
  namespace-clear key. It never owns a saved sound, preset, project, or live session StoreApi.
- Same-record mutations serialize. Namespace clear waits for records in that namespace, and
  later records wait for that clear. Different namespaces remain independent.
- Settled logical keys are removed, and the weak registry entry is removed when its pending map
  becomes empty. Rejected predecessors are observed and do not poison later work.
- Each session still owns a distinct sounds StoreApi and custom-presets StoreApi. Sharing is only
  committed durability; another session observes the committed union after an explicit reload.

This is the review's allowed “coordinator registry shared by durable store identity” option. It
does not add a second `StoragePort`, `StorageContext`, singleton payload owner, public/protected
session member, or provider-specific escape hatch.

The session-state ownership inventory classifies `libraryArbitrationByStore` as
`shared-durable-store-operation-arbitration`, with the weak identity, payload-free contents, and
bounded cleanup stated explicitly. Before that real classification was added, the boundary gate
failed on the new mutable process-level symbol; after classification it passes.

## GREEN coverage

The focused session suite now proves:

1. concurrent saved-sound additions from two complete sessions reload as `[201, 202]` in both;
2. concurrent custom-preset additions reload as the committed two-value union in both;
3. a first failed shared mutation does not poison a second already-queued mutation, for both
   libraries, and both sessions reload only the successful committed value;
4. a paused saved-sound mutation does not block the graph-editor preset namespace;
5. committed durability is shared while the two live StoreApi objects remain isolated.

Observed commands/results:

| Gate | Result |
| --- | --- |
| isolated session async-store suite | **12 passed, 0 failed, 69 assertions** |
| normal session async-store wrapper | **1 passed, 0 failed** |
| opaque round-trip wrapper | **1 passed, 0 failed** |
| `node script/check-type-baseline.mjs` | **PASS**, exactly 3 current diagnostics, none outside the pinned set |
| `node script/check-session-state-boundary.mjs` | **PASS**, 10/10 factories, 10/10 registry keys, 52 classified imperative modules |
| `node script/check-storage-boundary.mjs` | **PASS**, 716 source modules, zero forbidden singleton/adapter/mechanism/fallback findings |
| `node script/check-host-composition.mjs` | **PASS**, 2 Host roots / 713 production modules |
| `node script/check-port-boundary.mjs` | **PASS**, 30 contract modules |
| focused ESLint | **PASS**; only the repository's informational missing-pages message |
| focused Prettier check | **PASS** |
| focused `git diff --check -- <five files>` | **PASS** |
| `rasen validate s02-storage-port --project rocut --strict --json` | **valid: true**, 1/1 |

The shared worktree's whole-tree `git diff --check` currently reports trailing whitespace only in
`apps/web/src/core/managers/save-manager.ts`, owned by the concurrent core fixer. This B2 fixer did
not edit that file; the five-file focused diff check is clean.

## Exact fixer write set

- `apps/web/src/editor/persistence/session-persistence-coordinator.ts`
- `apps/web/src/sounds/sounds-store.ts`
- `apps/web/src/timeline/components/graph-editor/custom-presets-store.ts`
- `apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts`
- `script/fixtures/session-state-ownership.json`

No BrowserProjectStore cascade/migration/corruption/cancellation code, core manager, Host,
protected/public session surface, task list, or review report was changed by this fixer.
