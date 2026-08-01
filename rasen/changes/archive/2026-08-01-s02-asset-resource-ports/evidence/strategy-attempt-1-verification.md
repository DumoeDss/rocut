# C4 strategy attempt 1 independent confirmation

- Date: 2026-08-01
- Change: `s02-asset-resource-ports`
- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c4`
- Baseline commit/tree: `507cecf456ed68007c60829be5c3c41bebf64a5d` / `2dd46187ff2d31b026010cb3d6573dcf099441d3`
- Mode: independent, report-only; no product, provenance, task, run-state, protected fixture/oracle, build output, or commit was changed
- Scope: post-cap strategy-attempt confirmation, not review round 4; no fresh production build was repeated
- Verdict: **CONFIRMED CLEAN — 0 Blocker / 0 Major / 0 Minor / 0 Trivial**

## Finding disposition

Review round 3's remaining Major is closed. The final checker SHA-256 is
`aba7a8c2071f80ebf96d05384782dc98dcd831a216aff45d7b2568bbb9094a5c`, exactly matching the
strategy handoff. Independent static tracing and direct synthetic execution establish that the
shipping normal gate and fixtures use the same browser-graph parser and acceptance function:

```text
runCheck()/runNextParserFixture()
  -> nextInventory()
  -> nextClientGraph()
  -> resolveNextBrowserReference()
  -> acceptanceViolations()
```

`runCheck()` does not have a weaker aggregate-only path. Its Next report is accepted only after
graph discovery, four visited-layer checks, and all three topology requirements.

## Browser reference and containment audit

- `browserReferences()` recognizes referrer-relative JavaScript lazy/module/runtime references and
  CSS `url(...)` references. The connected fixture contains both
  `./lazy-relative.mjs?runtime=1#chunk` and `../media/font.woff2?font=1#face`.
- `cleanReference()` removes query/fragment only for filesystem lookup. URL resolution uses the
  original normalized reference and retained edges preserve `pathname + search + hash`; query and
  fragment therefore do not corrupt lookup and are not silently lost from evidence.
- Relative filesystem lookup is rooted at `dirname(from)`, while browser URL lookup is rooted at
  the referrer's public URL. Resolved paths are checked, in order, against the configured public
  base, the Next output root, `.next/static`, and the permitted `static/{chunks,css,media}`
  categories.
- Direct fixture reproduction failed closed with attributable evidence for all requested shapes:
  lazy deletion (`missing-reachable-next-file`), a root escape inside the reached lazy chunk
  (`root-emitted-entry-url`), lazy traversal into `server/chunks`
  (`relative-next-static-escape`), CSS media deletion (`missing-reachable-next-file`), and CSS
  traversal outside the public base, output, or static tree (`relative-public-base-escape`,
  `relative-next-output-escape`, `relative-next-static-escape`).

The positive fixture passed with seven visited edges and concrete paths for all three topology
requirements. Its deliberately present `ssrModuleMapping` and `server/chunks/unrelated.js` were not
seeded or visited. `nextInventory()` additionally emits `server-bundle-in-browser-graph` if a
server chunk ever becomes reachable, so server exclusion is fail-closed rather than an inventory
filter that can hide a visited node.

## Layer identity and topology audit

- Next layer entries are created only by iterating `clientGraph.files`; unvisited directory content
  cannot contribute an `entry`, `transcription-worker`, `editor-wasm`, or `ort-sidecar` label.
- The normal Next acceptance checks these three graph paths, allowing intermediate client chunks:
  `entry -> transcription-worker`, `entry -> editor-wasm`, and
  `transcription-worker -> ort-sidecar`.
- A generic non-ORT `.wasm` is classified as `resource`. Editor WASM requires a narrow OpenCut
  filename or SHA-256 identity with protected `rust/wasm/pkg/opencut_wasm_bg.wasm`.
- The `direct-entry-ort` fixture failed `missing-runtime-topology` for Worker-to-ORT even though ORT
  was reachable directly from an entry. The `unrelated-editor-wasm` fixture failed both the
  `editor-wasm` layer and entry-to-editor-WASM topology. Therefore disconnected labels and an
  arbitrary `unrelated.wasm` cannot satisfy normal acceptance.

The connected positive and the full negative sweep both call the same parser/acceptance path.
Independent rerun result: positive PASS; **23/23 named negatives PASS**. The 23 include Vite/Next
root escapes, empty/truncated graphs, orphan/deleted nodes, relative lazy and CSS media cases, all
three relative containment boundaries, direct-entry ORT, arbitrary WASM, and server-only output.

## Retained fresh graph verification

The retained inventory SHA-256 is
`4abb4eb681c4c53a8f570c3906d22ab8ff3298397d7916d56ab6df0c400da4ea`, matching the handoff.
Independent enumeration found:

- Vite required layers: `1/1/1/1`.
- Next: 24 visited nodes, 16 typed edges, and 14 required-layer entries with counts `7/5/1/1`.
- Edge kinds: seven `css-url`, six `next-static-root`, and three `quoted-url`.
- All seven relative edges are real CSS-to-media references resolved below
  `/c4-strategy1-next/_next/static/media/`.
- Entry to Worker:
  `static/chunks/46076a746839fe9d.js -> static/media/worker.8051bf58.ts`.
- Entry to editor WASM:
  `static/chunks/8e4be1ab06a32972.js -> static/chunks/27a88e35df72eaf6.wasm`.
- Worker to ORT:
  `static/chunks/fefc45234332e672.js -> static/media/ort-wasm-simd-threaded.jsep.232c7845.wasm`.
- Every edge endpoint exists in the retained visited-node set; no `server/chunks/**` node is present.
- The generic emitted editor-WASM chunk is 3,286,340 bytes with SHA-256
  `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`, exactly equal to the
  protected editor-WASM source. ORT SHA-256 is
  `c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39`.

The exclusive strategy output directories were absent after verification, as the handoff records;
this confirmation intentionally reused the retained fresh-build inventory and did not substitute a
stale default output or repeat a heavy build.

## Round-1 repair and regression spot checks

All independent commands below exited 0:

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
git diff --exit-code 507cecf4 -- <protected paths>
```

Results and provenance checks:

- Forced-none thumbnail load/exit regression: 1/1 PASS; the prior compositor-entry Major stays
  closed.
- Session ownership: 9/9 factories, 9/9 registry keys, 53 classified imperative modules PASS.
- Source boundary: 699 production modules, both Host roots, eight layers and five rules PASS; source
  negatives 6/6 PASS.
- Manifest corrupt/fallback matrix: legal fixture plus 17/17 negatives PASS.
- Exact type ceiling: TypeScript 5.9.3 reports only the three allowed inherited diagnostics; Vite
  typecheck PASS.
- Protected port tree, public session construction/types/index, parity tree/oracle, type fixture,
  all Rust/WASM, `SBOM.md`, and `UPSTREAM.md` are byte-identical to `507cecf4`.
- All 42 baseline-relative inherited changes under `.gitignore`, `apps`, `rust`, and `script` have a
  `PATCHES.md` path entry. P-211 accurately describes the final 23-negative graph gate.
- Canonical source inventory remains 1,069 files / 7,500,075 bytes, rollup
  `8ce81cbd563de44ca6d99857fa9959feaeae4eb0992656deb1c4a10b7ba168bf`; JSON SHA-256
  `ff6a633ebf8ad29d23cd2d8b536c97e56e820e91842d66adc67492a5a20c24f3`; Markdown SHA-256
  `f37abaf8849ce61eabf272a4309abaf3c75418a16029fea10c832c955d6d2150`.
- No temporary `rocut-*-emitted-*` fixture directory remained. Verification created no new product
  or build artifact.

## Verdict

**CONFIRMED CLEAN — 0/0/0/0.** Strategy attempt 1 materially changes the failed approach and fully
closes review round 3's Major. C4 has no remaining blocker from this post-cap confirmation.
