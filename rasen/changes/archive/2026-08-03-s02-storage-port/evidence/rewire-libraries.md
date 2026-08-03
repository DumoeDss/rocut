# C5 libraries and storage UI rewiring evidence

Status: sections 8.7, 8.8, 8.9 and the sound/preset/storage-provider portion of 8.13 are implemented in the shared C5 worktree. Task 8.13 remains unchecked until its core-manager/command half is repaired and verified. No commit was created.

## Implemented boundary

- Saved sounds use coordinator library record `{ namespace: "saved-sounds", key: "user-sounds" }`; mutations stay ordered inside the session StoreApi and publish live state only after the durable promise succeeds.
- Custom graph presets use `{ namespace: "graph-editor-presets", key: "user-presets" }`. The former module-global cache/listener set and direct `localStorage` reads/writes are gone. The StoreApi is the tenth member of the existing session registry, so two sessions share committed durable data but not listeners, loading/error state, or in-memory preset arrays.
- `StorageProvider` selects the owning `EditorCore.persistence`/project manager, exposes that exact coordinator and Host store plus inspection/capacity and project/all clear actions, and constructs no store, coordinator, storage context, or browser adapter.
- All three UI families publish generic retryable errors and payload-free session diagnostics. Promise rejection remains observable; event handlers catch only after the store has published the visible error, preventing unhandled rejections without converting failure to success.
- `SessionPersistenceCoordinator.clearLibraryNamespace` orders a namespace clear against prior and later mutations in that namespace, clears retained library snapshots only after the Host store succeeds, emits `clear:<namespace>`, and leaves other namespaces progressing independently.

## Focused proof

| Command | Result |
| --- | --- |
| `OPENCUT_SESSION_ASYNC_STORE_TEST_ISOLATED=1 bun test apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts` | PASS: 7 tests, 51 expectations |
| `bun test apps/web/src/editor/session/__tests__/session-state-isolation.test.ts` | PASS: isolated wrapper; inner session ownership suite green |
| `OPENCUT_C5_COORDINATOR_ISOLATED=1 bun test apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts` | PASS: 4 tests, 32 expectations |
| `node script/check-type-baseline.mjs` | PASS: exactly three current diagnostics, all inherited/pinned; no new identity |
| `node script/check-session-state-boundary.mjs` | PASS: 10/10 factories, 10/10 registry keys, 52 classified imperative modules |
| `git diff --check` | PASS |
| `rasen validate s02-storage-port --strict --project rocut --json` | PASS: one change, zero issues |

The focused library cases prove:

1. saved loads remain latest-wins while durable save/remove operations remain ordered;
2. two custom-preset and sounds StoreApi instances are distinct while a second coordinator over the same store can explicitly load the first session's committed records;
3. clearing `saved-sounds` removes that namespace, retains `graph-editor-presets`, and emits a clear event;
4. a paused saved-sound record write is completed before its namespace clear, while a preset write in another namespace progresses without waiting;
5. sound and preset save failures reject, leave prior live state unchanged, expose retry text, and report only library/operation/whitelisted code—not the secret error payload.

## Boundary scan status

An `rg` sweep over the changed sounds, custom-preset, storage-provider, session-store and coordinator modules finds no `storageService`, `BrowserHostAdapter`, `localStorage`, IndexedDB, or OPFS call. The canonical storage boundary was also run; its mechanism/direct-call checks pass, but its obsolete positive assertion still expects one Vite `BrowserHostAdapter` importer and therefore reports red after the section-9 leaf intentionally removed the adapter. That gate change belongs to the boundary/finalizer task, not this leaf.

## Required finalizer follow-up

The in-memory consumer regression proves namespace clear and preset isolation. The real-browser legacy compatibility row still needs one explicit regression in `apps/web/src/services/storage/browser-project-store-conformance.ts` (invoked by the existing C5 browser harness): seed the old raw `user-sounds` row, load it through the compatibility path, call `clearLibraryNamespace({ namespace: "saved-sounds" })`, then require a fresh load to return `null` while a graph-preset record remains. Browser mechanics/conformance were outside this leaf's write set, so this proof is intentionally left for the finalizer and must be green before 8.14/final verification.

Task 8.13 also remains open because the concurrent core consumer delta still contains failure paths that log raw errors and/or resolve after failure instead of propagating it. The combined finalizer must inspect at least `core/managers/project-manager.ts` (save-current, list, delete and rename catches), `core/managers/media-manager.ts` (save/load catches), `core/managers/scenes-manager.ts` (load catch), and media command catches. Those files were outside this leaf's write set. Only after those paths emit payload-free session diagnostics, retain visible recoverable UI, and avoid silent success should 8.13 be checked.
