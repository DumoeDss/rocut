# C5 Core Persistence Consumer Rewire Evidence

Date: 2026-08-02  
Role: APPLY leaf — core project/media/scenes consumers  
Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`  
Commit: none; the shared C5 worktree remains uncommitted

## Implemented scope

- Tasks 8.1–8.6 and 8.10–8.12 are complete and checked.
- `EditorCore` owns exactly one `SessionPersistenceCoordinator`, constructed from `session.host.store` before managers and destroyed with the core.
- Project list/load/save/delete/rename/duplicate, media attachment load/save/remove, scene project reads, media commands, and media capacity inspection now use the owning editor session. No core/media production path imports `storageService`, a browser adapter, IndexedDB, OPFS, or a storage path.
- Project duplication copies opaque attachment bytes and metadata, including provider-private siblings. Failed partial duplication removes already-created duplicate projects.
- Project removal relies on the store's project cascade and does not touch another project's same-key attachment or durable library namespaces.
- Media attachment metadata and bytes round-trip through a mechanism-neutral codec. A still-reading attachment write is enqueued before an immediate undo/remove, preserving invocation order.
- Capacity handling distinguishes an unavailable store, an available store with unknown capacity, and a real zero-byte remaining capacity.
- `project-manager-thumbnail-degraded.test.ts` now injects an in-memory store/coordinator. The C4 forced-none harness seeds through its session-owned coordinator. The former C5 singleton RED control now exercises a real Host/session recreation and filters intentionally deleted tracked files during source inventory.
- Public `createEditorSession` and `EditorSession` call shapes were not edited by this leaf. Their modifications visible in the shared worktree belong to the Host-composition leaf.

## Durable failure semantics

- Every core persistence failure reaches the session diagnostics channel with fixed text and logical context only: `{ operation, code }`. Raw exceptions, project IDs, attachment metadata, bytes, and provider-private payloads are not logged.
- Project create/load/save/list/delete/rename/duplicate and scene/media load/clear reject after reporting and showing a recoverable UI message; callers cannot infer durable success.
- MediaManager's explicit add result remains `null` on durable failure and does not publish an asset or ratchet FPS. Command-based optimistic add/remove rolls live state back on failed durability and displays a recovery message.
- Automatic save failures remain dirty and do not spin in a tight retry loop or create an unhandled rejection. Explicit `flush()` still rejects so exit/flush callers cannot mistake failure for success.
- Project load does not clear the prior project/scene state before its durable project/media reads succeed. Scene load failure likewise leaves the prior live scene state intact.

## Focused verification

Combined command:

```text
bun test apps/web/src/media/__tests__/persistence.test.ts apps/web/src/media/__tests__/processing-capacity.test.ts apps/web/src/core/managers/__tests__/media-persistence-rewire.test.ts apps/web/src/core/managers/__tests__/project-persistence-rewire.test.ts apps/web/src/core/managers/__tests__/save-manager-persistence-failure.test.ts apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts apps/web/src/editor/ports/__tests__/conformance.test.ts
```

Result: 39 passed, 0 failed, 188 assertions across nine files. The project diagnostics assertion was added after that combined run and then run directly below.

Direct isolated controls:

- Media manager/commands: 2 passed, 0 failed, 14 assertions.
- Project manager/diagnostics: 3 passed, 0 failed, 15 assertions. This includes durable-create non-publication and proof that a raw private sentinel is absent from the emitted diagnostics record.
- C5 storage RED-to-green controls: 9 passed, 0 failed, 26 assertions.

Static/type gates:

- Targeted ESLint: exit 0; only the repository's informational missing-pages warning was printed.
- `node script/check-type-baseline.mjs`: PASS; exactly the three inherited diagnostics, no new diagnostic identity.
- `bun run typecheck` in `apps/vite-example`: PASS.
- `git -c core.whitespace=cr-at-eol diff --check`: PASS. The tracked `save-manager.ts` blob itself uses CRLF, so the explicit Windows-aware whitespace rule avoids misclassifying its added CR bytes as trailing spaces while keeping the review diff minimal.
- `node script/check-session-state-boundary.mjs`: PASS, 10/10 factories, 10/10 registry keys, 52 classified imperative modules.
- `node script/check-host-composition.mjs`: PASS.
- `rasen validate s02-storage-port --project rocut --strict --json`: valid, no issues.
- Targeted `rg` for `storageService|StorageService|getStorageService`: zero hits in the rewritten core/media/command/C4 paths.

## Known shared-tree red

`node script/check-storage-boundary.mjs` exits 1 only because its positive Host rule still requires at least one `BrowserHostAdapter` import. Section 9 intentionally deleted that provisional adapter and composes `BrowserProjectStore` directly, while `check-host-composition.mjs` already proves both final Host stores. The boundary finalizer must update the stale positive rule; reintroducing the retired adapter would violate tasks 9.6–9.9.
