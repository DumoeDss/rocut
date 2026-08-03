# C5 failing-control evidence

Date: 2026-08-01

Product worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`

These are intentionally failing controls captured before the C5 contract, browser store, coordinator, consumer wiring, and final boundary rules exist. A test is not counted as evidence merely because it was written: every unmet behavior below was executed and produced the attributed failure.

## Behavior controls

Test file: `apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts`

The file self-isolates when included by the broad suite. For exact RED selectors, run in PowerShell from the product worktree:

```powershell
$env:OPENCUT_C5_STORAGE_RED_ISOLATED='1'
bun test apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts -t '<selector>'
```

The bulk capture command used the same environment variable without `-t`. It exited 1 with `0 pass / 9 fail / 13 expect() calls`; all failures below were present in that one run.

| Exact selector | Exit | Expected/current attributed failure |
| --- | ---: | --- |
| `opaque nested fields survive a known timeline edit and full Host/session recreation` | 1 | actual `StorageService` load/save reconstruction retains the known bookmark edit but drops `providerPrivateProject`, `providerPrivateMetadata`, and `providerPrivateScene` after two real Host/session owners and a new service wrapper |
| `the public store can carry attachment metadata and bytes` | 1 | `ProjectStore.saveAttachment is missing` |
| `the public store can carry saved-sound and custom-preset libraries` | 1 | `ProjectStore.saveLibraryRecord is missing` |
| `both production Hosts reject inherited InMemoryProjectStore` | 1 | Next's `host.store` is an `InMemoryProjectStore`; the assertion stops before Vite, while the source/composition inventory confirms both Hosts spread the same reference store |
| `the browser implementation runs the shared conformance matrix` | 1 | the fixture imports `runPortConformance`, but production `services/storage/browser-project-store.ts` does not exist |
| `a staged-validation failure leaves every legacy source readable` | 1 | actual `V1toV2Migration.run()` deletes both `video-editor-timelines-project-v1-123-scene-main` and `video-editor-timelines-project-v1-123` before any caller-side staged validation |
| `equal attachment keys remain isolated between projects` | 1 | `ProjectStore.saveAttachment is missing`, so the current port cannot express the isolation case |
| `equal library keys remain isolated between namespaces` | 1 | `ProjectStore.saveLibraryRecord is missing`, so the current port cannot express the namespace case |
| `all current direct persistence importers are rejected` | 1 | returns the complete 12-path current violation inventory rather than `[]` |

The 12-path inventory printed by the last selector is deliberately broader than the nine production singleton-import paths in preflight because it also includes the C4 harness, the sole provisional-adapter Host user, and the C3-deferred custom-preset local-storage path:

1. `apps/vite-example/src/c4-forced-none-harness.tsx`
2. `apps/vite-example/src/project-picker.tsx`
3. `apps/web/src/commands/media/add-media-asset.ts`
4. `apps/web/src/commands/media/remove-media-asset.ts`
5. `apps/web/src/components/storage-provider.tsx`
6. `apps/web/src/core/managers/media-manager.ts`
7. `apps/web/src/core/managers/project-manager.ts`
8. `apps/web/src/core/managers/scenes-manager.ts`
9. `apps/web/src/media/processing.ts`
10. `apps/web/src/services/storage/browser-host-adapter.ts`
11. `apps/web/src/sounds/sounds-store.ts`
12. `apps/web/src/timeline/components/graph-editor/custom-presets-store.ts`

The browser conformance fixture is `script/fixtures/c5-browser-store-conformance/browser-store-conformance.ts`. It imports the existing shared conformance runner and supplies the missing production `BrowserProjectStore` as `createInMemoryPorts({ store })`; it is a fixture, not a mock browser implementation.

## Boundary negative controls

Fixture root: `script/fixtures/c5-storage-boundary/`

Test file: `script/__tests__/c5-storage-boundary-red.test.mjs`

Exact command for an individual selector:

```powershell
bun test script/__tests__/c5-storage-boundary-red.test.mjs -t '<selector>'
```

Bulk command: `bun test script/__tests__/c5-storage-boundary-red.test.mjs`

Bulk result: exit 1, `3 pass / 3 fail / 9 expect() calls`.

| Exact selector | Control status | Gate result and diagnostic |
| --- | --- | --- |
| `rejects a private storage port or context` | RED | current gate exits 0 and accepts `StoragePort` plus `StorageContext`; missing rule |
| `rejects a direct process-global singleton import` | RED | current gate exits 0 and accepts a production `storageService` import; missing rule |
| `rejects direct IndexedDB outside the named boundary` | proven negative | underlying gate exits non-zero and prints `[indexeddb] ...consumer.ts`; existing mechanism rule is non-vacuous |
| `rejects direct OPFS outside the named boundary` | proven negative | underlying gate exits non-zero and prints `[opfs] ...consumer.ts`; existing mechanism rule is non-vacuous |
| `rejects a storage mechanism type in the public port` | proven negative | underlying gate exits non-zero and prints `[idb-factory] ...project-store.ts`; existing type-name rule catches this explicit leak |
| `rejects a production in-memory storage fallback` | RED | current gate exits 0 and accepts `createInMemoryPorts()` in the production Host fixture; missing rule |

`script/check-storage-boundary.mjs --fixture <fixture-root>` is test plumbing only: it runs the unchanged current rules over a fixture-shaped `apps/` tree. It does not implement the missing C5 rules, and normal production scans exclude only the exact `script/fixtures/c5-` control prefix. The post-control positive command `node script/check-storage-boundary.mjs` still exits 0 and still scans 736 production source files.

## What must turn these controls green

- Preserve an opaque snapshot above the Host-neutral store, overlay the known edit by identity, save, destroy the complete Host/session, and recover every private sentinel.
- Deepen the existing `ProjectStore` directly for attachments and library records; do not introduce a second port/context or inspect the opaque project payload for media.
- Supply a real browser store to the unchanged shared conformance path and final-override the reference store in both production Hosts.
- Stage, read back, and validate migration output before deleting either legacy timeline database.
- Remove every inventoried direct/private production path rather than adding exemptions.
- Extend the canonical boundary gate so the three currently accepted fixtures exit non-zero with targeted diagnostics, while retaining the already-proven IndexedDB/OPFS/mechanism-type controls.
