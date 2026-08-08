# C7 implementation RED record

Date: 2026-08-05 (Asia/Shanghai)

## Missing product contract

The accepted C6 base had no `apps/web/src/editor/session/headless.ts`, no `createHeadlessEditorSession`, no dedicated Vite facade, and no Next data-only route. The only creation path was `createEditorSession()`, which immediately continued from migration into session-store binding and `session-core-owner`/`EditorCore`. That graph was therefore an invalid headless substitute even if `mount()` was omitted.

The initial focused contract cases were authored against the intended isolated import and covered absence, detached edit/save/reopen, cross-project rejection, serial admission/retry, terminal disposal, second-owner isolation, and zero runtime-resource acquisition. Before the export existed, the intended import/contract was the named RED; no full-session shim or React stub was accepted as GREEN.

## Missing shared migration ownership

At the base, `MigrationFailedError`, the per-store `WeakMap`, and migration orchestration were private to `create-session.ts`. There was no possible full/headless in-flight join because the headless factory did not exist and duplicating the map would create two gates. The new isolated matrix was written for full/full, full/headless, headless/full, headless/headless, distinct stores, and fail-then-retry before the logic was extracted.

## Unsafe absence measurement

The existing Next aggregate inventory could report no React while combining route/NFT/manifest/source-map material that did not prove one exact root's outgoing emitted closure. It was retained only as a diagnostic RED. C7 required an exact application root, dependency-edge reachability, emitted-chunk intersection, retained raw IDs, and required behavior roots before forbidden-module absence could be considered.

Checker controls were introduced for empty inventory, wrong/duplicated entry, missing critical root, stale base/marker, changed artifact digest, aggregate-only attribution, copied Host evidence, React path variants, raw alias, and Sonner. The valid Vite and Next React-injected builds in `negative-controls.md` prove the ordinary checker—not a build crash—names the actual `react-family` violation.

## Structured-report RED

Command:

`bun test script/__tests__/c7-headless-graph.test.mjs -t "publishes stable structured"`

Observed RED: exit `1`, `0 pass / 1 fail / 15 skipped / 1 expectation`. The existing thrown `Error` had no non-null `report`, so CI could not obtain stable rule IDs, offending module IDs, graph digest, or exit semantics. After the focused RED, the checker gained `HeadlessGraphCheckError` and stable JSON while retaining its human-readable diagnostic; final GREEN is recorded in `negative-controls.md`.

## Build/runtime RED diagnostics

`failed-build-attempts-20260805.md` retains every setup/collector/build failure and explicitly distinguishes it from an oracle failure. `evidence/raw/vite-headless-runtime-20260805.json` is the truthful first clean-graph runtime rejection: semantics passed but the dedicated HTML caused one favicon `404`, so it was not promoted. The subsequent data favicon and fresh attempt 2 eliminated that error.
