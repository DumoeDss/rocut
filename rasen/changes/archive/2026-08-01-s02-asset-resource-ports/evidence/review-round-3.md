# C4 review-cycle round 3 independent re-review

- Change: `s02-asset-resource-ports`
- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c4`
- Baseline commit/tree: `507cecf456ed68007c60829be5c3c41bebf64a5d` / `2dd46187ff2d31b026010cb3d6573dcf099441d3`
- Review date: 2026-08-01
- Mode: independent, report-only; reviewer did not author or edit product code, tasks, run-state, protected fixtures/oracles, or commits
- Verdict: **BLOCKED — 0 Blocker, 1 Major, 0 Minor, 0 Trivial**

## Finding

### Major — the Next browser graph still false-greens relative dependencies and the wrong required-layer topology

Round 2 correctly removed the directory-wide Worker/WASM preselection. `nextInventory()` now seeds
only the editor client manifest and editor-route HTML/CSS roots, excludes `ssrModuleMapping` and
server bundles, and derives its inventory from files reached by `nextClientGraph()`. The retained
fresh production inventory is also internally consistent: SHA-256
`133dfdb55dbbf8f06ccddba811cbf40b21d1d843b63ad30feb6a198bf10e603e`, 14 classified Next
files, entry/Worker/editor-WASM/ORT `9/3/1/1`, nine edges, with actual entry-to-Worker,
entry-to-editor-WASM and Worker-to-ORT edges.

The checker itself is nevertheless still anti-vacuous only for the fixture's absolute URL shape:

- `nextStaticReference()` accepts a reference only when it contains `/_next/` or begins with
  `static/`, and rejects every path containing `..` (`script/check-emitted-runtime-assets.mjs:110-122`).
  `nextStaticReferences()` adds only quoted `static/{chunks,css,media}` references
  (`:125-132`). It never resolves `./lazy.mjs`, `../media/font.woff2`, or another relative browser
  URL against the referring JS/CSS file.
- `quotedPaths()` and `scanEscapingUrls()` likewise inspect only root-leading strings and root-leading
  CSS `url(...)` values (`:360-390`). A reached stylesheet containing a relative traversal that
  resolves outside the configured Host base is invisible.
- The normal gate validates only whether the visited inventory contains each label
  (`missingLayerViolations`, `:396-403`, called by `runCheck` at `:719-732`). It does not require the
  topology entry-to-Worker, entry-to-editor-WASM and Worker-to-ORT. Those edge assertions exist only
  inside the synthetic positive fixture (`:533-551`).
- `inferredLayer()` classifies every non-ORT `.wasm` file as `editor-wasm` (`:173-186`). Therefore
  an unrelated reachable WASM can satisfy the editor-WASM layer even if the OpenCut editor WASM is
  absent.

An ephemeral control loaded the exact current parser functions in memory and passed a real Next
output-shaped directory through `nextInventory()`, `scanEscapingUrls()` and
`missingLayerViolations()`. The editor manifest supplied only the editor entry and CSS roots; the
entry used `import("./lazy.mjs")`, the lazy chunk contained `/flags/root-from-relative-lazy.svg`,
the CSS used `url(../media/font.woff2)` and a relative traversal resolving to `/flags/...`, and all
four required labels were otherwise present. The result was a false green:

```text
missing=0
parser=0
escaping=0
lazyScanned=false
fontVisited=false
relativeCssEscapeReported=false
```

A second exact-parser control made the entry point directly reference ORT, made the Worker contain
no ORT edge, and supplied `unrelated.wasm` instead of an editor WASM. It again produced zero parser,
missing-layer, or escaping violations; the inventory reported all four layers while
`workerToOrt=false` and classified `static/chunks/unrelated.wasm` as `editor-wasm`.

This means a plausible emitted regression can lose a relative lazy subtree, hide a first-party root
escape inside it, lose the nested Worker-to-ORT relationship, or lose the actual editor WASM while
tasks 8.2/8.4/11.4 and design D6 still pass. The correct retained real inventory shows that the
review-2 build happened to be good; it does not make the gate capable of rejecting these bad graphs.

Required repair:

1. Extract browser references with source-file-relative URL semantics for HTML, CSS, JS/MJS/TS,
   including `./` and `../`; resolve them against the referring emitted file, then enforce both
   `.next/static/{chunks,css,media}` containment and configured public-base containment.
2. Make the normal gate require the structural edges entry-to-Worker, entry-to-editor-WASM and
   Worker-to-ORT, not only four labels somewhere in the visited set.
3. Identify the actual editor WASM and transcription/ORT artifacts by stable build metadata,
   expected identity/hash, or sufficiently narrow semantic classification; arbitrary WASM must not
   satisfy `editor-wasm`.
4. Add real-parser controls for a relative lazy import and deletion, CSS-to-media traversal, a
   relative CSS base escape, direct-entry ORT with no Worker-to-ORT edge, and unrelated WASM in place
   of the editor WASM. Each negative must exercise the same normal parser/gate path.

## Round-1 and round-2 closure regression audit

| Prior finding | Round-3 disposition | Independent evidence |
| --- | --- | --- |
| Major: thumbnail-less forced-none load/exit reaches compositor | **Resolved** | `updateThumbnailFromTimeline()` returns before scene or renderer acquisition when inactive/degraded; the isolated public load plus `prepareExit()` regression passes and records zero scene/renderer/render/dirty/flush calls. |
| Major: manifest exactness/anti-vacuity | **Resolved** | The real checker independently enumerates allowlist/output paths, rejects duplicates and stale counts/bytes, and its legal plus 17 corrupt controls all behave as expected. |
| Trivial: stale sticker-cache ownership rationale | **Resolved** | The fixture now names Host-resolved URL plus dimensions and the ownership gate passes 9/9 factories, 9/9 keys and 53 imperative modules. |
| Major: Next emitted graph used global orphan Worker/WASM roots | **Partially resolved; Major remains** | Directory-wide seeding is gone, editor-route roots and server exclusion are real, and orphan/deleted absolute-shape controls pass. Relative reference coverage, exact artifact identity and required edge topology remain false-green as described above. |

## Standards axis

One Major correctness/completeness finding remains in the diagnostic gate. Path containment uses
resolved Windows paths correctly after a dependency is recognized, but the reference extractor
does not model ordinary relative browser URL semantics and the normal gate does not enforce its
claimed topology. No additional security, concurrency, frontend-design, performance, or provenance
finding was found in the round-2 delta.

Standards count: **0 Blocker / 1 Major / 0 Minor / 0 Trivial**.

## Spec axis

One Major remains against runtime-asset-delivery's “complete emitted resource graph” scenario,
design D6, and tasks 8.2/8.4/11.4. The retained real build contains the required edges, but the
shipping checker can still certify a graph that omits relative lazy/CSS/media reachability, the
nested Worker-to-ORT edge, or the actual editor WASM.

Spec count: **0 Blocker / 1 Major / 0 Minor / 0 Trivial**.

## Coverage trace

```text
editor client manifest + editor HTML/CSS roots
  -> absolute /<base>/_next/static/...        TESTED: positive + orphan/deleted/root controls
  -> quoted static/{chunks,css,media}/...     TESTED: positive + real inventory
  -> ./lazy.mjs                               GAP: silently unvisited
  -> CSS ../media/font.woff2                  GAP: silently unvisited
  -> relative CSS traversal outside base     GAP: silently unreported

visited files
  -> four labels present                     TESTED: missing/orphan controls
  -> entry -> Worker -> ORT topology          GAP in normal gate; fixture-only assertion
  -> entry -> actual OpenCut editor WASM      GAP: any non-ORT WASM satisfies label
```

## Focused verification evidence

Commands run against the final dirty worktree:

```text
node script/check-emitted-runtime-assets.mjs --positive-control
node script/check-emitted-runtime-assets.mjs --negative-control
node script/check-asset-manifest.mjs --negative-control
node script/check-runtime-asset-boundary.mjs
node script/check-runtime-asset-boundary.mjs --negative-control
node --check script/check-emitted-runtime-assets.mjs
bunx biome check script/check-emitted-runtime-assets.mjs
bun test apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts
node script/check-session-state-boundary.mjs
node script/check-type-baseline.mjs
bunx tsc --noEmit -p apps/vite-example/tsconfig.json
git diff --check
git diff --exit-code 507cecf4 -- <protected port/parity/type/session/Rust/SBOM/UPSTREAM paths>
```

Results:

- Existing emitted controls pass: connected positive and 14/14 negatives. The new in-memory
  real-parser controls above expose shapes those fixtures do not cover.
- Manifest legal/negative matrix passes 18/18; forced-none thumbnail regression passes; source
  positive and 6/6 source negatives pass; session ownership passes.
- Exact type ceiling reports only the three inherited TypeScript 5.9.3 diagnostics; Vite typecheck,
  Node syntax, Biome, diff whitespace and protected-path checks exit 0.
- `PATCHES.md` contains all 42 baseline-relative inherited `.gitignore`/`apps`/`rust`/`script`
  paths. P-211's retained real counts are accurate, but its broad completeness claim remains
  unsupported until this Major closes.
- Canonical inventory identities match the final handoff: 1,069 files / 7,500,075 bytes, rollup
  `8ce81cbd563de44ca6d99857fa9959feaeae4eb0992656deb1c4a10b7ba168bf`, JSON SHA-256
  `ff6a633ebf8ad29d23cd2d8b536c97e56e820e91842d66adc67492a5a20c24f3`, Markdown SHA-256
  `f37abaf8849ce61eabf272a4309abaf3c75418a16029fea10c832c955d6d2150`, drift 158 modified /
  44 added.
- Final classification remains 45 tracked changes and 24 untracked implementation files. No
  `dist-c4-*`, `.next-c4-*`, `.next-pre-c4-*`, synthetic parser directory, or live process whose
  command line references the C4 worktree remains.
- Heavy fresh builds/browser/parity were not repeated. Their exact marker/hash/PID evidence was
  retained and the real round-2 inventory was independently checked for 14 files, nine edges and
  the three required edge types.

## Verdict

**ROUND 3: BLOCKED — 0/1/0/0.** The real review-2 build graph is good, but the sole round-2 Major
is not fully closed because the checker still accepts relative-reference and wrong-topology false
greens. C4 cannot be called CLEAN until a non-author fix and re-review close this gate defect.
