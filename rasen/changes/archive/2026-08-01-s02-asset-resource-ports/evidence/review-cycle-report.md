## Review Cycle: s02-asset-resource-ports

Rounds: **3/3**   Tier: **A (Codex native, role-isolated)**   Status: **CLEAN**

- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c4`
- Branch: `feat/s02-asset-resource-ports`
- Review range: baseline `507cecf456ed68007c60829be5c3c41bebf64a5d` through the final dirty working tree
- Final severity: **0 Blocker / 0 Major / 0 Minor / 0 Trivial**
- Open findings: **none**
- This report records the bounded three-round review cycle and the material strategy attempt after
  the round cap. The strategy confirmation is not a fourth review round.

### Round ledger

| Round | Findings (B/Ma/Mi/T) | Triage | Fixed by | Confirmed by (non-author) | Resolved |
| --- | --- | --- | --- | --- | --- |
| 1 | `0/3/0/1` | Major 1 product/runtime guard: non-trivial product fix. Major 2 emitted graph and Major 3 manifest exactness: non-trivial diagnostic fixes. Trivial 1 ownership wording: fixture/provenance correction. | `/root/c4_fix_forced_none`, `/root/c4_fix_emitted_gate`, `/root/c4_fix_manifest_gate`; `/root/c4_finish` integrated the fixes, ownership fixture, fresh builds and provenance. | `/root/c4_review_r2`, independently reviewing the combined delta. The fixer/finalizer PASS was not accepted as self-certification. | `3/4` fully closed: forced-none thumbnail path, exact manifest and ownership rationale. The emitted-graph finding was partially closed and carried forward as one narrower Major. |
| 2 | `0/1/0/0` | Reachability anti-vacuity: non-trivial checker/graph repair; remove global orphan roots and derive layers from the editor-route visited graph. | `/root/c4_fix_emitted_r2`; `/root/c4_finish` performed fresh-build integration and provenance finalization. | `/root/c4_review_r3`, independently re-reading the repair and normal gate. | The exact orphan-root finding was closed. Re-review exposed a successor Major in the same completeness area: relative references, required topology and editor-WASM identity still false-greened. |
| 3 | `0/1/0/0` | Persistent design-level diagnostic defect. The three-round cap was reached, so no fourth ordinary review/fix round was started; the finding entered the strategy ladder. | Ordinary round ended BLOCKED; the post-cap material repair was authored by `/root/c4_strategy_graph_fix` and integrated/finalized by `/root/c4_finish`. | `/root/c4_strategy_verify` independently confirmed the strategy result after the cap. Neither strategy author/finalizer certified its own work. | `1/1` closed by strategy attempt 1; independent result **CONFIRMED CLEAN — 0/0/0/0**. |

### Findings, triage and disposition

#### Round 1

Source: `evidence/verify-report.md` — SHA-256
`4d477a16e8be9a14ded4c4c424764489483192be6b57d30fdc84696a383fa9d5`.

1. **Major — forced-none thumbnail-less load and `prepareExit()` reached the compositor.**
   Routed to the non-trivial product fixer. `updateThumbnailFromTimeline()` now exits before scene,
   renderer or canvas work when inactive/degraded. The focused public load/exit regression and fresh
   forced-none Chrome proof record no thumbnail, null compositor, GPU work 0 and zero product errors.
   Non-author round-2 disposition: **resolved**.
2. **Major — the Next emitted gate omitted editor HTML/CSS, root manifest references and unselected
   lazy chunks.** Routed to the diagnostic fixer. Round 1 added real-parser discovery and attributable
   root/lazy controls. Non-author round-2 disposition: **partially resolved**; root/lazy blind spots
   closed, but global Worker/WASM selection could still manufacture complete layers.
3. **Major — the asset manifest was category-only, not exact or anti-vacuous.** Routed to the
   manifest fixer. The gate now owns a producer-independent allowlist, recursively enumerates both
   sides, rejects duplicates/stale aggregates, and passes the legal fixture plus 17 corrupt controls.
   Non-author round-2 disposition: **resolved**.
4. **Trivial — ownership fixture described the obsolete sticker cache key.** Routed as a fixture-only
   correction and integrated with the final ownership inventory. Non-author round-2 disposition:
   **resolved**.

Round-1 fix evidence:

- `evidence/fix-forced-none-round1.md` — `6a623ee3e109cc787995987826b0462b99dccf1e40a962941bfb44a47117586b`
- `evidence/fix-emitted-gate-round1.md` — `5baf67ede6c69e639abf2e81c4948e7a10cb697dc6a3279368d655e66e87b029`
- `evidence/fix-manifest-gate-round1.md` — `833af146a51966e61739a2ca006817d32d8e0bf34f48fca845a36ab0c19341a6`
- `handoff/fixer-round-1.md` — `8f320afc41b31847f9c3abbedd59784c10f1bc2531ecfb67a7c333953920d9af`

#### Round 2

Source: `evidence/review-round-2.md` — SHA-256
`5719337eeb41d459e803a6cb3d09ab492390d37b64a5c70947d4b08211799069`.

1. **Major — orphan Worker/editor-WASM/ORT files outside the editor route could satisfy required
   layers.** Routed as a non-trivial checker repair. Seeds were restricted to editor client manifest
   and route HTML/CSS browser references; server mappings/bundles were excluded; all classifications
   came only from recursively visited files and every edge retained attribution. Round 3 confirmed
   the directory-wide orphan mechanism and deleted absolute target cases were closed, while finding
   a successor false-green for source-relative traversal, topology and generic WASM identity.

Round-2 fix evidence:

- `evidence/fix-emitted-gate-round2.md` — `81befdb53a4c519c382b20127a3f407ab9df7a395139a194197b778433c85142`
- `handoff/fixer-round-2.md` — `ab20ee161156508a2ed07fc2cf291979eb414e80ee85159391edb731964f7d86`

#### Round 3 and cap

Source: `evidence/review-round-3.md` — SHA-256
`da53235acd046fd74742f8bf2985d533cb063ad20c0921ef8dd8741cbae2dfe6`.

1. **Major — the visited Next graph still ignored referrer-relative JS/CSS dependencies, normal
   acceptance checked labels rather than the three required paths, and arbitrary non-ORT WASM could
   stand in for the editor artifact.** The round ended BLOCKED at the configured 3/3 cap. The LEAD
   correctly entered the material-change strategy ladder instead of starting an unbounded fourth
   review round or reporting a silent pass.

### Strategy attempt 1 after the cap

Attempt 1 changed the model rather than extending the failed string/layer heuristic:

- one browser graph parses HTML attributes, CSS URLs, JS/MJS/TS runtime/module references and Next
  static references;
- `./` and `../` resolve against both referrer URL and emitted filesystem directory, retaining
  query/hash evidence while lookup uses the path component;
- public-base, Next-output, `.next/static` and `chunks|css|media` containment all fail closed;
- all four layers come only from visited nodes;
- normal acceptance and fixtures share `nextInventory()` -> `nextClientGraph()` ->
  `acceptanceViolations()`;
- normal acceptance requires concrete `entry -> Worker`, `entry -> editor-WASM`, and
  `Worker -> ORT` paths;
- generic `.wasm` is a resource; editor WASM requires a narrow OpenCut identity or the protected
  artifact digest.

The strategy fixer first reproduced four red controls on the old acceptance path, then made the
connected positive and negative matrix green. Integration found its claimed 23 negatives actually
contained only 22, added the missing relative-lazy-to-server/static escape through the same normal
parser, and established a genuine 23/23 result on fresh exclusive output.

Artifacts:

- `evidence/strategy-attempt-1-graph-fix.md` — `f07f9f428bea6c5f4a8e56e55eeb451e80933fd213debe92b43ba4e10ea1c5e6`
- `handoff/strategy-attempt-1.md` — `9bac78a58e096869c34f6c754207379c2cdf8081a97dcd47a5eeb7dd64a84594`
- `evidence/strategy-attempt-1-verification.md` — `85b11a527a7be5aa50575f15e0c19666df54dba06e5fe1467c80581c054f4196`

Independent `/root/c4_strategy_verify` result: **CONFIRMED CLEAN — 0 Blocker / 0 Major / 0 Minor /
0 Trivial**. The retained graph was independently enumerated as 24 visited nodes, 16 typed edges,
seven real relative CSS-to-media edges and Next layers `7/5/1/1`; all three topology paths exist,
no `server/chunks/**` node is visited, and the emitted editor WASM SHA-256 exactly matches protected
`rust/wasm/pkg/opencut_wasm_bg.wasm`. There are no accepted-known Minor/Trivial findings.

### Author != verifier

- Initial verifier/reviewer: `/root/c4_verify`; it did not implement C4 or the round-1 fixes.
- Round-1 authors: `/root/c4_fix_forced_none`, `/root/c4_fix_emitted_gate`,
  `/root/c4_fix_manifest_gate`, with `/root/c4_finish` integrating. Confirmation:
  `/root/c4_review_r2`.
- Round-2 authors: `/root/c4_fix_emitted_r2`, with `/root/c4_finish` integrating. Confirmation:
  `/root/c4_review_r3`.
- Strategy authors: `/root/c4_strategy_graph_fix` and integration finalizer `/root/c4_finish`.
  Confirmation: `/root/c4_strategy_verify`.
- Fixer/finalizer PASS statements were treated as handoff evidence only. Resolution was recorded only
  after a distinct non-author reviewer confirmed the exact delta.

### Final test evidence

#### Scope and rationale

The final strategy delta is confined to the emitted diagnostic checker and its provenance. Its
highest-risk behaviors are parser reachability, URL containment, layer identity, topology and
anti-vacuity, so the final independent scope directly executes the connected real-parser positive,
all 23 corrupt shapes, static syntax/format, source boundaries, the exact type ceiling, protected
diffs and the retained fresh production graph. The earlier round-1 product change additionally has
its focused public load/exit test and fresh production-browser forced-none proof. Fresh product
build/browser/parity evidence was not repeated after the strategy-only checker change: the strategy
itself consumed fresh Vite/Next production outputs, while product and protected parity sources are
unchanged from their independently marked/hash-bound runs.

Final independent commands, all run from the C4 worktree:

```text
node script/check-emitted-runtime-assets.mjs --positive-control
node script/check-emitted-runtime-assets.mjs --negative-control
node --check script/check-emitted-runtime-assets.mjs
bunx @biomejs/biome check script/check-emitted-runtime-assets.mjs
bun test apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts
node script/check-session-state-boundary.mjs
node script/check-type-baseline.mjs
node script/check-runtime-asset-boundary.mjs
node script/check-runtime-asset-boundary.mjs --negative-control
node script/check-asset-manifest.mjs --negative-control
bunx tsc --noEmit -p apps/vite-example/tsconfig.json
git diff --check
git diff --exit-code 507cecf456ed68007c60829be5c3c41bebf64a5d -- apps/web/src/editor/ports apps/web/src/editor/session/create-session.ts apps/web/src/editor/session/session-types.ts apps/web/src/editor/session/index.ts apps/vite-example/tests/parity script/diff-parity-snapshots.mjs script/fixtures/type-baseline.json rust/wasm SBOM.md UPSTREAM.md
```

Results:

- Connected emitted positive PASS with all three paths; negative sweep **23/23 PASS**.
- Node syntax and canonical Biome PASS.
- Forced-none thumbnail regression 1/1 PASS.
- Session ownership PASS: 9/9 factories, 9/9 keys, 53 imperative modules.
- Type ceiling PASS: TypeScript 5.9.3, exactly three inherited diagnostics and none outside the
  pinned set; Vite TypeScript PASS.
- Source boundary PASS over 699 production modules, both Host roots, eight layers and five rules;
  source negatives 6/6 PASS.
- Manifest legal/corrupt matrix PASS: legal fixture plus 17/17 negatives.
- Protected path diff and whitespace gate PASS.
- The round-1 combined affected command in `handoff/fixer-round-1.md` passed 46/46 tests and 259
  expectations across ten files. The last broad full-suite evidence in `evidence/verify-report.md`
  remained classified as inherited-only reds: 249 pass, 8 inherited failures, 2 inherited loader
  errors and 688 expectations, with no new failure identity; later fixes were covered by the
  targeted gates above.

#### Fresh build and emitted graph evidence

Strategy attempt 1 used outputs confirmed absent before each build:

```text
cd apps/vite-example
OPENCUT_PUBLIC_BASE=/c4-strategy1-vite/ C4_VITE_OUT_DIR=dist-c4-strategy1 VITE_C4_BUILD_MARKER=c4-strategy1-vite-20260801-507cecf4 bun run build

cd apps/web
OPENCUT_PUBLIC_BASE=/c4-strategy1-next OPENCUT_NEXT_DIST_DIR=.next-c4-strategy1 C4_BUILD_MARKER=c4-strategy1-next-20260801-507cecf4 NEXT_TELEMETRY_DISABLED=1 <nine documented local placeholder environment names> bun run build

cd <worktree>
node script/check-emitted-runtime-assets.mjs --vite-output apps/vite-example/dist-c4-strategy1 --vite-base /c4-strategy1-vite/ --next-output apps/web/.next-c4-strategy1 --next-base /c4-strategy1-next/ --inventory-output E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rasen/changes/s02-asset-resource-ports/evidence/strategy-attempt-1-graph-inventory.json
```

- Vite: exit 0, 2,873 modules, layers `1/1/1/1`, manifest 298 copied / 4,481,200 bytes and
  7 emitted / 29,875,703 bytes.
- Next: exit 0, Next 16.1.3, 18/18 pages, layers `7/5/1/1` over 24 nodes and 16 typed edges.
- Normal emitted checker ran twice; retained inventory was byte-identical, SHA-256
  `4abb4eb681c4c53a8f570c3906d22ab8ff3298397d7916d56ab6df0c400da4ea`.
- Exact output directories were removed after evidence capture; they are reproducible and were not
  replaced by the pre-existing default `.next` output.

#### Fresh browser and parity evidence references

- `evidence/vite-final.md` (`926e3456ee485a41487654727de8142507f0493a4369ab7b3942521fc1c1c3c3`):
  fresh `/c4-vite/` production build, manifest/Worker/two-session/forced-none and real editor asset
  acquisition; owned PID/port cleanup recorded.
- `evidence/next-final.md` (`b5c0ba2fd7a35e2e72455b90784cda0e26f17602607eae1a4d3bbeb8ab8848f7`):
  fresh non-root Next standalone; 44 final product requests, zero outside `/c4-next/`, normal editor,
  Worker and forced-none probes all clean; owned PID/port cleanup recorded.
- `handoff/fixer-round-1.md`: fresh `/c4-review1/` forced-none Chrome proof after the thumbnail fix;
  33 network events, zero product failures/base escapes, null compositor, GPU 0 and no thumbnail.
- `evidence/parity-verification.md` (`1eee98032de5d605e300caf4b9ee479e91c26d44bd68d3dbb67df187b2549ce3`):
  unchanged protected scenario PASS on fresh Vite and fresh Next, all 10 interactions on both Hosts.
- `evidence/parity-verification-diff.md`
  (`247bd7b7122d31caee0a885dd74e404a56b36f3c3b41c00a51d82f97a40ecf10`):
  195 leaf values, 9 differences, **0 semantic / 9 incidental**.
- Protected parity tree `e1fbb55b985f4fb490c6b233d18c50c58ea14c28`, parity oracle blob
  `fa387ebea1e7f0cc1110eebcb922d393a1337842`, and type fixture blob
  `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8` remain baseline-identical.

### Content-state fingerprint

Git `HEAD` is still the C3 integration baseline because this cycle is pre-ship and uncommitted:

```text
HEAD = 507cecf456ed68007c60829be5c3c41bebf64a5d
HEAD^{tree} = 2dd46187ff2d31b026010cb3d6573dcf099441d3
```

The reviewed dirty tree contains 45 tracked changes and 24 untracked implementation files. Its
reproducible two-part fingerprint is:

1. Tracked patch Git-blob OID:

   ```text
   cmd /d /c "git diff --binary --full-index --no-ext-diff 507cecf456ed68007c60829be5c3c41bebf64a5d -- . 2>NUL | git hash-object --stdin"
   bbc1ea724571ea17c638ab3e59d9bb4b78f03340
   ```

2. Untracked manifest SHA-256: sort `git ls-files --others --exclude-standard`; for every path emit
   lowercase `<file-sha256>  <slash-normalized-path>\n`; SHA-256 that UTF-8 manifest:

   ```text
   45a13dafa5418e9e178a224a0017659e091571b053ccd5c7e9aafc108aeaa521
   ```

SHA-256 over these exact two UTF-8 lines with a final newline:

```text
tracked-diff-git-blob-sha1 bbc1ea724571ea17c638ab3e59d9bb4b78f03340
untracked-manifest-sha256 45a13dafa5418e9e178a224a0017659e091571b053ccd5c7e9aafc108aeaa521
```

is the final dirty-state fingerprint:

```text
71c369205746ad8869029c4dcde97dd2087e07277e2a454bab0ccbc029905bde
```

Canonical provenance is independently stable: 1,069 files / 7,500,075 bytes, rollup
`8ce81cbd563de44ca6d99857fa9959feaeae4eb0992656deb1c4a10b7ba168bf`; `SOURCE_INVENTORY.json`
SHA-256 `ff6a633ebf8ad29d23cd2d8b536c97e56e820e91842d66adc67492a5a20c24f3`;
`SOURCE_INVENTORY.md` SHA-256
`f37abaf8849ce61eabf272a4309abaf3c75418a16029fea10c832c955d6d2150`. All 42 baseline-relative
inherited changes under `.gitignore`, `apps`, `rust` and `script` have a `PATCHES.md` path entry.

### Open

None. No Blocker, Major, Minor or Trivial finding remains accepted or unresolved.

### Report

- `evidence/review-cycle-report.md`
