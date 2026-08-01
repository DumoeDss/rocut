# C4 regression evidence

All commands ran in `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c4` unless noted. No Rust/generated WASM, public C1 port/session shape, type fixture, or parity fixture/oracle was edited.

## Frozen boundaries

- `node script/check-port-boundary.mjs`: exit 0; 30 contract modules; all five rules pass.
- `node script/check-reference-boundary.mjs`: exit 0; 891/1263 files; all rules pass.
- `node script/check-storage-boundary.mjs`: exit 0; 734 sources; browser storage remains inside storage services and the one documented provisional Vite Host adapter path.
- `node script/check-distributable-boundary.mjs apps/vite-example/dist-c4-final/module-graph.json`: exit 0; fresh 2871-module graph; all ten exclusion rules pass (572 editor, 13 Vite Host, 2282 dependency, 4 other).
- `node script/check-session-state-boundary.mjs`: first exit 1 correctly caught one unused `useEditorInstance()` and two new resolver-keyed WeakMaps missing from the ownership inventory. The unused hook was removed and both WeakMaps were classified as immutable-Host-resolver indexes whose deterministic image/canvas/service disposal remains C6. Final exit 0: 9/9 factories, 9/9 keys, 52 imperative modules, no default/handle-0/unimplemented production path.
- `node script/check-next-imports.mjs`: exit 0; 739 source files; all 25 `next/*` importers are the allowlisted shell and none is in the editor graph.
- Negative controls: session-state, editor-singleton, and port-boundary controls all exit 0 and every deliberate defect is caught. `node script/check-editor-singleton.mjs` remains clean over 695 runtime and 39 command modules.

These results preserve the frozen C1 port/public-session behavior and do not invert C5 persistence.

## C0b WASM

- `bun run check:wasm`: exit 0. Source/resolution correspondence passes at the root and web Host; path scan has no machine path and its POSIX controls fail as intended; API surface is exactly 38 JS exports, 58 binary exports, 609 imports, with providers and structural compile passing.
- `node script/check-wasm-api-surface.mjs --negative-control`: exit 0; all 14 missing/extra/changed/provider/type/file/gate/CI controls fail for the named reason.
- `node script/run-wasm-api-contract.mjs`: exit 0.
- `node script/test-wasm-runtime-api.mjs`: exit 0; WebGL, capacity 1, handle 1, zero-yield + yielded cancellation pass; concurrent initialization failure coalesces.
- Wrapper SHA-256 in `rust/wasm/pkg`, root `node_modules`, and web `node_modules`: `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1` (939 bytes).
- Binary SHA-256 in all three locations: `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1` (3286340 bytes).

No Rust or generated-WASM rebuild/edit was performed.

## C3 protected behavior

- `OPENCUT_SESSION_STATE_TEST_ISOLATED=1 bun test apps/web/src/editor/session/__tests__/session-state-isolation.test.ts`: exit 0, 6 pass, 163 expectations. This includes distinct compositor handles, one serialized compositor across preview/snapshot/thumbnail/export, complete export capture exclusivity, rollback/capacity, stale first-render rejection, and symmetric state isolation.
- Isolated runtime-ownership/lifecycle/async-store files: exit 0, 56 pass, 218 expectations. Host generation churn/teardown, exact wrapper frees, lifecycle/resource reconciliation, and async request generations pass.
- Port conformance + production Host composition: part of a 24-pass/138-expectation batch; no failures.
- Fresh root-base Vite build: exit 0, 2871 modules, output `dist-c3-regression`, marker `507cecf456ed68007c60829be5c3c41bebf64a5d`.
- `C3_BROWSER_BACKEND=webgl C3_PREVIEW_PORT=43383 ... npx playwright test --config=playwright.c3.config.ts`: exit 0, 1/1; WebGL capacity-1 first preview and second-preview rejection behavior pass.
- `C3_BROWSER_BACKEND=webgpu C3_PREVIEW_PORT=43384 C3_WEBGPU_EXECUTABLE=C:/Program Files/Google/Chrome/Application/chrome.exe ...`: exit 0, 1/1; installed Chrome, capacity 2, distinct handles/frames/projects and isolation behavior pass.

## Focus, type ceiling, and full suite

- Focused C4 files: 30 pass, 0 fail, 135 expectations across eight files.
- `bun run typecheck` in `apps/vite-example`: exit 0.
- `node script/check-type-baseline.mjs`: final exit 0; TypeScript 5.9.3; exactly 3 diagnostics; no diagnostic outside the pinned set. An earlier diagnostic run caught five C4 test/Host typing identities; they were repaired without changing the pinned fixture.
- `bun test`: expected exit 1; 248 pass, 8 fail, 2 module errors, 680 expectations; 256 tests/45 files. Compared with the 222-pass baseline, 26 net C4 tests were added. The red identities remain exactly the six `resolveTrackPlacement`/`ZERO_MEDIA_TIME` failures and the masks/WASM `__wbindgen_start` plus timeline update-pipeline/`DEFAULTS` module errors. There is no new full-suite red identity.

## Protected parity hard stop

`PARITY_HOST=vite C4_VITE_OUT_DIR=dist-c3-regression PARITY_BASE_URL=http://127.0.0.1:4173 bun run test:parity` was run twice without modifying the fixture/oracle. Both attempts exit 1 with the same sole failed interaction:

- `play`: after Home, Space, and 1.5 seconds, the displayed timecode remained `00:00:00:00`.
- The ledger records `00:00:00:00 -> 00:00:00:00 (playing) -> 00:00:02:01 (paused)`; all other interactions completed and the partial persisted snapshot/reopen check passed.
- This is a repeated semantic parity red, not an incidental snapshot delta. No third retry, Next parity run, snapshot comparison, fixture change, or oracle rebaseline was attempted.

Task 12.4 remains unchecked and is the C4 hard blocker.
