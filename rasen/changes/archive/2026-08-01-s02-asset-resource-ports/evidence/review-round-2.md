# C4 review-cycle round 2 independent re-review

- Change: `s02-asset-resource-ports`
- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c4`
- Baseline commit/tree: `507cecf456ed68007c60829be5c3c41bebf64a5d` / `2dd46187ff2d31b026010cb3d6573dcf099441d3`
- Review date: 2026-08-01
- Mode: independent, report-only; reviewer did not author or edit product code, tasks, run-state, protected fixtures/oracles, or commits
- Verdict: **BLOCKED — 0 Blocker, 1 Major, 0 Minor, 0 Trivial**

## Finding

### Major — the Next gate still counts orphan Worker/WASM files as a complete reachable graph

Round 1 fixed the original URL-scanning blind spots for the editor client-reference manifest,
route HTML/CSS, and recursively referenced `static/chunks` JS/MJS. Root escapes in those files are
now attributable, and missing files discovered by that recursion fail closed. However, the four
required layer counts are not derived from that reachable graph:

- `nextInventory()` enumerates every file under `.next/static`, then selects every non-ORT WASM,
  every ORT WASM, and every JS/MJS containing the Worker heuristics before traversing the editor
  graph (`script/check-emitted-runtime-assets.mjs:187-211`).
- Those globally selected Worker files are then inserted as independent roots into
  `nextClientGraph()` (`script/check-emitted-runtime-assets.mjs:235-243`). The traversal therefore
  cannot prove that an editor entry reaches the Worker; seeding the Worker manufactures that
  reachability.
- `missingLayerViolations()` consumes the global `entries` groups, not the visited client graph
  (`script/check-emitted-runtime-assets.mjs:308-315`). An orphan Worker/editor-WASM/ORT artifact
  therefore satisfies the required layer merely by existing anywhere in `.next/static`.
- The alleged legal positive fixture demonstrates the false green. `good-entry.js` references only
  `lazy-good.mjs` (`script/check-emitted-runtime-assets.mjs:373-379`); the Worker and both WASM
  files are written separately and have no edge from that entry (`script/check-emitted-runtime-assets.mjs:383-394`).
  Nevertheless `--positive-control` exits 0. The `truncated-graph` control bypasses
  `nextInventory()` and calls `missingLayerViolations()` on a hand-built array
  (`script/check-emitted-runtime-assets.mjs:336-340`), so it cannot falsify this defect.

This leaves the original Major only partially closed: a build may retain stale/orphan Worker and
WASM files while the editor entry loses the corresponding URL, yet tasks 8.4/11.4 and design D6
are certified. The retained real-output inventory proves file presence and hashes, but it does not
record graph edges and therefore cannot repair this gap after the output directory is removed.

Required repair: seed only the editor route's client entry/HTML/CSS roots; traverse the real browser
references (including the relevant `static/chunks`/`static/media` JS, MJS, Worker and WASM forms);
derive all four layer classifications from the visited set; and add real-parser controls for
entry → Worker → ORT, entry → editor-WASM, a deleted reachable file, an orphaned layer, root escapes
at every layer, and an unrelated server bundle that must remain excluded. The positive fixture must
connect all required layers rather than pre-seeding them.

## Round-1 finding closure audit

| Round-1 finding | Round-2 disposition | Independent evidence |
| --- | --- | --- |
| Major: thumbnail-less forced-none load/exit reaches compositor | **Resolved** | `updateThumbnailFromTimeline()` returns before scene access when inactive or degraded (`project-manager.ts:654-655`), and both `loadProject()` and `prepareExit()` use that shared path. The regression drives both public methods with no thumbnail and records zero scene/renderer/render/dirty/flush calls. The Vite forced-none harness creates and saves metadata with no thumbnail, settles normal preview/effect schedules, calls `prepareExit()`, and requires `thumbnailAbsentAfterExit`, null compositor, and zero GPU work/errors. The normal path still supplies `editor.renderer.assetResolver` to `buildScene()` (`project-manager.ts:662-669`) and its focused control renders/saves once. |
| Major: Next emitted-output blind spots | **Partially resolved; Major remains** | Manifest/HTML/CSS/root/lazy URL scanning is now real and attributable, and missing reachable files fail closed. Reachable-layer completeness remains false-green for the orphan case described above. |
| Major: manifest exactness/anti-vacuity | **Resolved** | The checker owns a producer-independent copied allowlist, recursively enumerates source and output, compares both directions, rejects copied/emitted duplicates, and recomputes both counts and byte totals (`check-asset-manifest.mjs:12-28,55-121,124-240`). The actual validator path passes the legal fixture and rejects 17 corrupt fixtures, including one same-category deletion, copied/emitted duplicates, four stale aggregates, and independent allowlist/output mismatch. Fresh evidence records 298 copied files / 4,481,200 bytes and 7 emitted files / 29,875,620 bytes. |
| Trivial: stale sticker-cache ownership rationale | **Resolved** | `session-state-ownership.json` now says Host-resolved URL plus dimensions, matching `stickerSourceCacheKey`; the gate classifies 53 imperative modules, including the two resolver WeakMaps and local playback subscription. |

## Standards axis

No additional correctness, security, concurrency, Windows-path, CLI-shape, frontend-design, or
performance finding was found in the round-1 repair delta. The forced-none guard is before all
raster acquisition; the manifest set comparison normalizes Windows separators; recursive emitted
paths use `resolve()` plus platform `sep`; focused type and ownership gates remain clean. The one
Major above is a gate-correctness/anti-vacuity defect, not a style concern.

Standards count: **0 Blocker / 0 Major / 0 Minor / 0 Trivial**.

## Spec axis

One Major remains against design D6 and tasks 8.4/11.4: required emitted layers are present on disk
but are not proven reachable from the editor route. All other reviewed C4 requirements and the other
three round-1 repairs are supported by implementation plus attributable evidence.

Spec count: **0 Blocker / 1 Major / 0 Minor / 0 Trivial**.

## Focused verification evidence

Commands run against the current combined worktree:

```text
node script/check-emitted-runtime-assets.mjs --positive-control
node script/check-emitted-runtime-assets.mjs --negative-control
node script/check-asset-manifest.mjs --negative-control
bun test apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts apps/web/src/editor/host/__tests__ apps/web/src/fonts/__tests__ apps/web/src/services/renderer/__tests__ apps/web/src/services/transcription/__tests__ apps/web/src/stickers/__tests__/host-assets.test.ts apps/web/src/preview/components/__tests__/timecode-playback-subscription.test.ts
node script/check-session-state-boundary.mjs
node script/check-type-baseline.mjs
bunx tsc --noEmit -p apps/vite-example/tsconfig.json
node script/generate-source-inventory.mjs
git diff --check
git diff --exit-code 507cecf4 -- <protected port/parity/type/session/Rust/SBOM/UPSTREAM paths>
```

Results:

- emitted controls: positive exit 0; negative 8/8 exit 0. The positive's disconnected layer files
  are the direct falsification described in the Major finding.
- manifest controls: legal positive plus 17/17 corrupt controls behave as required.
- focused suite: 28 pass / 0 fail / 136 expectations across 9 files.
- session ownership: 9/9 factories, 9/9 keys, 53 classified modules.
- type ceiling: exactly 3 inherited diagnostics and no out-of-baseline diagnostic; Vite typecheck
  exits 0.
- provenance: all 42 baseline-relative tracked source/config/checker paths have at least one
  `PATCHES.md` row; all 24 untracked implementation paths were absent at the pin. Canonical inventory
  remains 1,069 files / 7.15 MB, rollup
  `8ce81cbd563de44ca6d99857fa9959feaeae4eb0992656deb1c4a10b7ba168bf`, JSON SHA-256
  `ff6a633ebf8ad29d23cd2d8b536c97e56e820e91842d66adc67492a5a20c24f3`, Markdown SHA-256
  `f37abaf8849ce61eabf272a4309abaf3c75418a16029fea10c832c955d6d2150`.
- protected paths are byte-identical to baseline; `git diff --check` exits 0.

Heavy Vite/Next builds and browser runs were not repeated. Their retained marker/hash/PID/network
evidence is sufficient for the three repairs that are actually closed, but it cannot establish the
missing reachability edge because the retained emitted inventory contains files, not edges.

## Verdict

**ROUND 2: BLOCKED — 0/1/0/0.** Round 1 closed the forced-none, manifest, and ownership findings.
The Next emitted-graph repair needs one more non-author fix/re-review cycle before C4 can be called
clean.
