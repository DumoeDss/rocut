# C4 independent verification report

- Change: `s02-asset-resource-ports`
- Reviewed baseline: `507cecf456ed68007c60829be5c3c41bebf64a5d` (`2dd46187ff2d31b026010cb3d6573dcf099441d3`)
- Reviewed worktree: `E:\\AI\\ChatAI\\Agents\\VibeCodingProjects\\elftia\\_others\\rocut-wt-c4`
- Review date: 2026-08-01
- Verdict: **BLOCKED — 0 Blocker, 3 Major, 0 Minor, 1 Trivial**

## Findings

### Major — forced-none still enters the compositor through project thumbnails

`EditorProvider` correctly sets degraded state before loading the project (`apps/web/src/components/providers/editor-provider.tsx:45-47`), but `ProjectManager.loadProject` calls `updateThumbnailFromTimeline()` whenever persisted metadata lacks a thumbnail (`apps/web/src/core/managers/project-manager.ts:171-179`). `prepareExit()` calls the same path unconditionally (`apps/web/src/core/managers/project-manager.ts:538-548`). That method has no degraded guard: it builds a scene, constructs a canvas renderer, and calls `renderToCanvas` (`apps/web/src/core/managers/project-manager.ts:654-689`). `CanvasRenderer.renderToCanvas` reaches `ensureInitialized` (`apps/web/src/services/renderer/canvas-renderer.ts:77-87,124-135`), which calls `createCompositor` (`apps/web/src/services/renderer/compositor/wasm-compositor.ts:89-105`).

The production-like forced-none fixture cannot detect this ordinary path because it pre-seeds a thumbnail (`apps/vite-example/src/c4-forced-none-harness.tsx:92-100`). A real saved project without `metadata.thumbnail` can therefore allocate/fail the compositor during load, and every forced-none project can retry raster work on exit. This contradicts the two forced-none scenarios and design D7's requirement to suppress raster work before compositor acquisition.

Required repair: short-circuit thumbnail generation before scene construction/rendering whenever `renderer.isDegraded`, and add a forced-none regression that loads a project without a thumbnail, calls the exit path, settles asynchronous work, and asserts a null compositor handle, zero GPU acquisition, and zero page/unhandled errors.

### Major — the Next emitted-output gate can certify root-escaping HTML, CSS, or chunks

`nextInventory()` reads only the editor client-reference manifest and extracts only URLs that already match the configured prefixed `.../_next/static/chunks/*.js` expression (`script/check-emitted-runtime-assets.mjs:106-136`). It then scans only those selected JS entries and detected Worker files (`script/check-emitted-runtime-assets.mjs:137-175`). In contrast, the Vite branch scans all emitted HTML/CSS/JS/MJS (`script/check-emitted-runtime-assets.mjs:67-103`).

Consequences:

- A root `/_next/...` reference in the same manifest is excluded by the prefix-only extraction before `scanEscapingUrls` can see it.
- Next emitted HTML and CSS are never scanned.
- A root first-party URL in an unselected or lazy Next chunk is never scanned.

The negative controls do not exercise `nextInventory` or `scanEscapingUrls`; they construct a violation object directly and exit non-zero (`script/check-emitted-runtime-assets.mjs:236-289`). They therefore cannot falsify this parser/graph blind spot. Browser evidence proves the routes exercised by the recorded run, but cannot replace the explicit all-output gate for unexercised lazy paths. Tasks 8.2 and 11.4, and design D6's HTML/CSS/JS/chunk requirement, are not established.

Required repair: enumerate the actual Next editor output graph without first filtering URLs by the expected base, scan every reachable HTML/CSS/JS/MJS entry and lazy chunk, and make mixed good-plus-root-escaped synthetic output pass through the real inventory/scanner code in a negative control.

### Major — manifest completeness is category-only, not exact or anti-vacuous

`validateManifest()` checks that `files` is non-empty, required categories occur, fields exist, and emitted classifications occur (`script/check-asset-manifest.mjs:43-105`). It never validates `fileCount === files.length`, recorded totals, duplicate logical paths, or equality with the copied output/allowlist. The runtime fetch loop only fetches entries still present in the manifest (`script/check-asset-manifest.mjs:302-313`). Thus deleting one of many flag/font entries while leaving its category represented, duplicating an entry, or leaving stale counts/totals can pass despite the manifest generator recording those totals (`apps/vite-example/build/editor-assets.ts:125-143`).

The current `truncated-category` fixture removes an entire category, while `missing-file` calls response validation directly (`script/check-asset-manifest.mjs:171-189`); neither proves that a single same-category manifest deletion or duplicate fails. This does not establish the runtime-asset-delivery scenario requiring every copied runtime asset exactly once and deletion/truncation to fail, nor task 7.5.

Required repair: validate copied and emitted `fileCount`/`totalBytes`, reject duplicate paths, compare copied manifest paths to an independently enumerated allowlist/output set, and run one-entry deletion plus duplicate-entry fixtures through the real checker.

### Trivial — ownership fixture describes the obsolete sticker cache key

`script/fixtures/session-state-ownership.json:330-335` says `stickerSourceCache` is keyed by immutable sticker id. The implementation now keys by resolved URL plus dimensions (`apps/web/src/services/renderer/nodes/sticker-node.ts:38-42`, `apps/web/src/services/renderer/nodes/sticker-cache-key.ts:1-10`). The classification remains correct, but the provenance explanation should match the implementation.

## Artifact and task completeness

All proposal, design, both delta specs, all 86 task rows, implementer handoff, and every evidence file were read. The full baseline-relative tracked diff and all 23 untracked implementation paths were reviewed, not only the handoff file list.

All 86 task rows are marked complete and each maps to at least one implementation or evidence artifact. Eighty-three have conclusive evidence at their stated scope. Three checked rows are not established by the implementation that is cited for them: 7.5 (exact manifest completeness), 8.2 (all Next HTML/CSS/JS/chunks), and 11.4 (the same incomplete Next emitted scan). Section 9 has a real production-like forced-none proof, but its pre-seeded thumbnail leaves an uncovered product path that violates the broader forced-none requirements.

| Task section | Checked | Verification result |
| --- | ---: | --- |
| 1. Baseline and failing controls | 7/7 | Supported |
| 2. Browser asset/runtime implementations | 7/7 | Supported |
| 3. Production Host composition/base | 8/8 | Supported |
| 4. Fonts and CSS URLs | 6/6 | Supported |
| 5. Flags, stickers, effects, Host chrome | 8/8 | Supported |
| 6. Session-owned transcription Worker | 8/8 | Supported |
| 7. Manifest/content verification | 8/8 | Partial: finding 3 |
| 8. Source/emitted URL gates | 7/7 | Partial: finding 2 |
| 9. Forced-none survival | 7/7 | Evidence exists, but finding 1 exposes an uncovered raster path |
| 10. Fresh Vite proof | 6/6 | Supported by fresh marker/PID/hash/network evidence |
| 11. Fresh Next proof | 6/6 | Browser proof supported; emitted-scan claim partial: finding 2 |
| 12. Regression/provenance/handoff | 8/8 | Supported |

The two specs contain 7 requirements and 25 scenarios. Twenty-two scenarios are convincingly satisfied. The two forced-none survival scenarios are not satisfied for thumbnail-less/exit paths, and the exact inventory/emitted-graph completeness scenario is not satisfied. Four requirements are fully satisfied; the graphics, manifest, and initialization/diagnostic requirements are partial because of the findings above.

## Correctness, boundaries, and evidence review

- Next and Vite explicitly override the three reference C4 roles after the in-memory spread. Browser adapter path validation, abort/status/content/JSON errors, Worker message/error/transfer adaptation, idempotent termination, and two-instance isolation have focused tests.
- Font atlas/chunk, quoted CSS, flags, stickers, branding, effect preview, generated graphics, transcription Worker ownership, two-base isolation, and URL/dimension cache keys are implemented at session/Host boundaries. No mutable global base or direct production editor Worker construction was found.
- Existing fresh Vite `/c4-vite/` and Next `/c4-next` evidence includes full markers, exclusive ports/PIDs, origin-root decoys, copied/emitted hashes, MIME/content checks, normal/Worker/forced-none browser runs, and cleanup records. Heavy browser/build/parity evidence was reused because it is tied to exact markers, hashes, and PIDs.
- The recorded parity investigation and independent verification adequately establish the local dual-subscription timecode repair: all ten protected interactions matched semantically; the nine remaining differences were incidental. Protected parity/oracle files were not changed.
- `PATCHES.md` contains all 41 changed inherited paths below `apps/`, `rust/`, and `script/`. `SOURCE_INVENTORY.json` and `.md` hashes match the implementer handoff (`ff6a633e...` and `f37abaf8...`).
- Protected paths are byte-identical to baseline: `apps/web/src/editor/ports/**`, `apps/vite-example/tests/parity/**`, the parity oracle, type fixture, protected session construction/types/index, `rust/wasm/**`, `SBOM.md`, and `UPSTREAM.md`.
- No unexplained new full-suite failure identity was observed. The final full run has one additional passing playback regression compared with the pre-fix evidence.

## Independent test evidence

TEST EVIDENCE

- Scope: final dirty C4 worktree, fast static/focused verification plus full Bun regression; heavy fresh Vite/Next production and protected parity evidence reused after marker/hash/PID validation.
- Rationale: verify the final playback delta, source/port gates, negative controls, type ceiling, provenance, and protected paths without replacing already-attributable production-browser evidence.
- Commands:
  - `bun test apps/web/src/editor/host/__tests__ apps/web/src/fonts/__tests__ apps/web/src/services/renderer/__tests__ apps/web/src/services/transcription/__tests__ apps/web/src/stickers/__tests__/host-assets.test.ts apps/web/src/preview/components/__tests__/timecode-playback-subscription.test.ts`
  - `bun test`
  - `node script/check-runtime-asset-boundary.mjs`
  - `node script/check-runtime-asset-boundary.mjs --negative-control`
  - `node script/check-emitted-runtime-assets.mjs --negative-control`
  - `node script/check-asset-manifest.mjs --negative-control`
  - `node script/check-port-boundary.mjs`
  - `node script/check-type-baseline.mjs`
  - `bunx tsc --noEmit -p apps/vite-example/tsconfig.json`
  - `git diff --check`
  - `git diff --exit-code 507cecf456ed68007c60829be5c3c41bebf64a5d -- <protected paths>`
- Result: focused C4 suite 27 pass / 0 fail; full suite 249 pass / 8 inherited fail / 2 inherited loader errors / 688 expectations; source, source-negative, emitted-negative, manifest-negative, and port gates pass; type baseline reports only the 3 expected diagnostics and Vite typecheck passes; diff whitespace and protected-path checks pass.
- Tree: baseline/HEAD `507cecf456ed68007c60829be5c3c41bebf64a5d`, tree `2dd46187ff2d31b026010cb3d6573dcf099441d3`, with the reviewed uncommitted C4 implementation enumerated by `git status --short` in the worktree.

VERIFY VERDICT: BLOCKED
