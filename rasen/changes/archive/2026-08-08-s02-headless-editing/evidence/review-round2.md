# C7 fresh non-author Sol review — round 2

Date: 2026-08-05 (Asia/Shanghai)

Accepted base HEAD/tree: `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf` /
`885d307814260b77397c2c2677b9361fdfc5f5e2`

Reviewed worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c7`

Reviewed authored identity: `30` files (`7` tracked modifications / `23` untracked additions),
sorted `path + NUL + raw bytes + NUL` SHA-256
`072b5fdf40f3d983c7407aae9d90e0bcd7a588803d07d21ff7785438cee65470`.
The reviewer independently recomputed this digest. Generated `dist-c7-*` and `.next-c7-*` trees
are excluded.

## Verdict

**BLOCKED — Blocker: 1, Major: 1, Minor: 0, Trivial: 0.**

The round-1 repairs close R2, R4, and R5 for the current pre-commit review scope. R1 is still
false-positive capable through an alias-only Next root, and R3 still lacks sensitivity controls for
each zero resource/React observation. Tasks 12.6-12.8 remain false. Ship, integration, spec sync,
and archive remain forbidden.

## Prior finding adjudication

| Finding | Round-2 disposition | Evidence |
| --- | --- | --- |
| R1 Next exact-root membership | **OPEN — Blocker** | A real producer-to-checker alias-only-root counterexample passes. |
| R2 Vite executable facade | **CLOSED** | Final HTML is inventoried/digested and its exact module script resolves to an entry chunk; missing, altered, wrong-script, wrong-entry, empty/truncated, stale, copied-Host, and React controls reject. |
| R3 observed runtime zeros | **OPEN — Major** | Probe installation/provenance is real, but the test triggers only one global and four Host-mediated paths; it does not prove sensitivity for every claimed zero. |
| R4 protected C3/parity | **CLOSED — inherited oracle** | Exact base/current WebGPU reproduce the same line-88 observation race; current WebGL passes; fresh post-fix Vite and Next parity evidence passes. |
| R5 provenance | **CLOSED for pre-commit scope** | P-273, BOUNDARIES section 6, deterministic SBOM, reference/license checks, and protected identity checks pass. Official source inventory remains a bounded post-commit Luna ship leaf. |

## R1 — Blocker: alias-only request identity can impersonate the exact Next root

`apps/web/build/headless-webpack-graph-plugin.ts:90-107` combines `resource`, `rawRequest`,
`userRequest`, `request`, and `identifier()` into one undifferentiated identity set. Lines 188-192
select the root when *any* such identity equals the expected entry. Lines 259-266 then fall back to
the first raw identity when `module.resource` is absent, and lines 285-289 hard-code
`entry.observed` to the expected value rather than recording the matched resolved resource.

The reviewer constructed a producer input whose root module had:

- no `resource` at all;
- only `rawRequest = apps/web/src/app/c7-headless/route.ts`;
- real membership in `server/app/c7-headless/route.js` and the named Webpack entrypoint;
- outgoing edges to all eleven required closure roots;
- a real emitted file with matching digest.

The producer published `entry.expected == entry.observed`, `matchCount: 1`, `emitted: true`, and a
12-module envelope. The strict checker then returned `ok: true`:

```text
rootHasResource=false
graphSha256=3547dd2d2898a7e0a996f2ef4a5d40618639e63d41f3be0c912ca6c15a9b6e7b
moduleSetSha256=f3a4b296532983b45289a536630733c104792b37b913c72cdf3b5c38ca5cbd6c
fileSetSha256=e6418a98ece731deca0bcaa336daa3d1191305371842075c71e69e9c427a5237
checker=PASS (12 modules, zero issues)
```

The retained reviewer-only temporary envelope is under
`C:/Users/Sayo/AppData/Local/Temp/c7-r2-alias-full-Sfm794/out/c7-headless-graph.json`.
It is supporting scratch evidence, not a repository artifact or delivery dependency.

Impact: the central Next proof can certify an unresolved/alias-only module as the exact application
root. Current clean output looks internally consistent, but the producer/checker contract cannot
distinguish that output from this fabricated root. This fails R8.S2 and R9.S3.

Required fix:

1. Select the exact root only from canonical resolved `module.resource` (or an equivalently strict,
   loader-extracted resolved-resource field), normalized to the repository-relative exact path.
2. Keep request/identifier strings only as retained provenance and forbidden-dependency aliases;
   they must not establish root identity.
3. Record the actual matched resolved identity in `entry.observed`; do not copy the expected value.
4. Add a full producer-to-checker control with no exact resource and an exact `rawRequest`; it must
   fail even when chunk membership, entrypoint intersection, file bytes, and all required roots are
   otherwise complete.
5. Rebuild the Next React control and a later clean Next artifact, execute the clean artifact, and
   rerun cross-Host evaluation.

## R3 — Major: zero-resource claims are not sensitivity-proven field by field

`apps/web/src/editor/session/headless-runtime-probe.ts` installs hooks for timers, RAF, Worker,
audio, object URLs, WebGPU, WebAssembly, Host resources, and React DOM markers. Installation alone
does not prove that every hook is effective in the environment that supplies the accepted zero.

The only direct probe sensitivity test,
`apps/web/src/editor/session/__tests__/headless-runtime-probe.test.ts:5-68`, triggers global
`setTimeout`, Host-mediated Worker/audio/object-URL calls, and a Host graphics query. It does not
independently trigger and observe:

- global `setInterval` or `requestAnimationFrame`;
- global `Worker`, `AudioContext`/`webkitAudioContext`, or `URL.createObjectURL`;
- `navigator.gpu.requestAdapter`;
- `WebAssembly.instantiate` or `instantiateStreaming`;
- a React DOM mount/mutation/root-marker path.

The semantic evaluator controls at
`script/__tests__/c7-headless-semantic-result.test.mjs:200-265` reject missing fields/strategies and
bad ordering, but do not prove a nonzero observation for each field. Therefore the final Vite/Next
zeros are well attributed but not fully sensitivity-proven. This leaves R6.S5 and R12.S2
unverified.

Required fix:

1. Add targeted sensitivity tests that successfully exercise every claimed global/Host/GPU/WASM
   count in an environment where the hook exists, and assert the corresponding nonzero field.
2. Add a browser/DOM React control that causes a real mount marker or mutation and proves the React
   detector increments/rejects it; retain the server-no-DOM provenance separately.
3. Add evaluator controls for nonzero/fabricated values and incomplete provenance for every field,
   not only a missing RAF field and missing React strategy.
4. Rebuild and execute final Vite/Next clean artifacts only after those controls, then rerun the
   semantic evaluator and the affected static/resource gates.

## Full 30-file inspection

Every authored file in the accepted digest was inspected. Disposition by path:

| Area | Files | Result |
| --- | --- | --- |
| Architecture/provenance | `BOUNDARIES.md`; `PATCHES.md` | R5 closed for pre-commit scope. |
| Vite proof | `apps/vite-example/build/headless-module-graph.ts`; `headless.html`; `package.json`; `src/headless-entry.ts`; `tsconfig.json`; `vite.headless.config.ts` | R2 closed; final executable graph and React controls pass. |
| Next proof | `apps/web/build/__tests__/headless-webpack-graph-plugin.test.ts`; `apps/web/build/headless-webpack-graph-plugin.ts`; `apps/web/next.config.ts`; `apps/web/src/app/c7-headless/route.ts` | R1 open; ordinary Next remains conditional/Turbopack-safe. |
| Session tests | `headless-browser-boundary.test.ts`; `headless-migration.test.ts`; `headless-runtime-probe.test.ts`; `headless-semantic-fixture.test.ts`; `headless-session.test.ts` under `apps/web/src/editor/session/__tests__/` | Functional/migration/opaque/disposal tests pass; probe sensitivity incomplete. |
| Session implementation | `create-session.ts`; `headless-proof-control-react.ts`; `headless-proof-control.ts`; `headless-runtime-probe.ts`; `headless-semantic-fixture.ts`; `headless.ts`; `migration-gate.ts` under `apps/web/src/editor/session/` | No public-barrel, S03, durable-deletion, opaque-data, or migration-duplication regression found; R3 evidence gap remains. |
| Repository proof/evaluator | `script/__tests__/c7-headless-graph.test.mjs`; `script/__tests__/c7-headless-semantic-result.test.mjs`; `script/check-headless-graph.mjs`; `script/check-headless-semantic-result.mjs`; `script/fixtures/session-state-ownership.json`; `script/run-c7-headless-host.mjs` | Graph/runtime checks otherwise pass; checker cannot recover a producer's true resolved root and runtime controls are not field-complete. |

## Fourteen-capability falsification sweep

| Main spec | Round-2 result |
| --- | --- |
| browser-persistence-boundary | PASS |
| developer-reproducibility | PASS WITH DELIVERY CAVEAT: official source inventory waits for the child commit |
| editing-parity-fixture | PASS |
| editor-session-runtime | BLOCKED: runtime zero sensitivity incomplete |
| host-port-contract | PASS |
| host-service-boundary | PASS |
| inherited-defect-repair | PASS WITH INHERITED RED identity unchanged |
| next-free-distributable-boundary | BLOCKED: exact Next root proof is false-positive capable |
| runtime-asset-delivery | PASS |
| self-built-wasm-artifact | PASS |
| session-resource-disposal | BLOCKED: runtime no-acquisition observation lacks full sensitivity controls |
| session-state-isolation | PASS |
| upstream-provenance | PASS WITH DELIVERY CAVEAT: source inventory is post-commit |
| wasm-api-surface | PASS |

## Complete 62-scenario result

Totals: **54 PASS / 3 FAIL / 5 UNVERIFIED**.

- FAIL: R8.S2 (exact Next root), R9.S3 (unrelated/alias-only entry fails closed), R14.S3
  (independent review closes all material findings).
- UNVERIFIED: R6.S5 (no C6 live resource acquired), R12.S2 (React mount absence observed), and
  delivery scenarios R14.S4-R14.S6.
- PASS: every other scenario in R1.S1-R14.S6, including R13.S3 under the explicitly isolated
  inherited WebGPU oracle. The row-by-row latest status is in `scenario-realization-map.md`.

## Independent gates

- Focused C7: `52 pass / 0 fail / 81 expectations` across eight files.
- Final clean strict checkers: Vite `14` modules / `5` files, graph
  `977998d4cf9aadc7ba76e47af9a1235216de3aa24988eae0714a0645b0578d87`; Next `15` modules /
  `2` files, graph `05e3c327cb422378bddbf95db0ee922e5e086ff64bff18241a353fa1f759a2de`.
- Final cross-Host semantic evaluator: PASS, project `c7-headless-project`, edit
  `C7 headless edit`, raw graphs `eeda71ec...` / `b32ac37f...`.
- React controls: final Vite control rejects five real React-family identities; final Next control
  rejects the injected vendored React identity. An initial reviewer replay used stale marker names;
  the corrected-marker replays produced the stated intended failures.
- Full Bun: `442 pass / 8 inherited fail / 2 inherited loader errors / 1,375 expectations / 450
  tests / 83 files` in `47.82s`; the six placement/ZERO_MEDIA_TIME failures and two loader errors
  match the inherited manifest exactly.
- Vite typecheck: exit `0`. Pinned type baseline: exit `0`, three current diagnostics, none outside
  the pinned set.
- Static boundaries: session state `10/10`, resource `721/266`, port `52`, storage `737`, Host
  composition `2/734`, runtime assets `736`, reference `5,701/10,263`, Next imports `807/25`; all
  pass. `git diff --check` and `bun.lock` diff pass.
- WASM: source/path/license/wiring and exact `38/58/609` pass. Rust: `12/12` plus doc tests.
- Protected paths and SBOM tracked diff: zero. Authored 30-file digest independently matches.
- Rasen strict validation: child `1/1`, main specs `14/14`, zero issues.
- R4: corrected exact-base and current WebGPU runs both fail at
  `tests/c3/session-capacity.pw.ts:88` after the same `122` migration-state samples; current WebGL
  passes `1/1` in `5.9s`. Fresh post-fix Vite and Next parity artifacts each pass `10/10`
  interactions with zero assertion failures; the Next-only blocked analytics request is expected.
- All reviewer/C7-owned ports are released. Port `4174` remains owned by pre-existing PID `44516`
  in the accepted-base worktree and was preserved.

Reviewer setup errors were corrected and are not product verdicts: one base C3 invocation initially
used the marker as `C3_BUILD_COMMIT`, and one gate batch initially used package-script names from the
wrong working directory. Corrected exact commands produced the results above.

## Task truth and legal next action

- 12.6 remains unchecked: a fresh non-author re-review occurred, but its required repeat-until-clean
  predicate is not met.
- 12.7 remains unchecked: R1/R3 require another fix and affected-gate replay.
- 12.8 remains unchecked: two material findings and five unverified scenarios remain.
- 13.1-13.10 remain forbidden.

The next legal action is a Sol fix round limited to R1 and R3, followed by a different fresh
non-author Sol re-review. Do not assign Luna ship until that review is CLEAN.

TEST EVIDENCE
- scope: complete 30-file authored set, all 14 main specs, all 62 delta scenarios, both final clean/control Hosts, exact-base/current C3, full Bun/type/static/WASM/Rust/strict/provenance gates
- rationale: closes or falsifies every prior round-1 finding and every non-delivery acceptance edge without mutating product state
- result: fail — 1 Blocker / 1 Major
- tree: `885d307814260b77397c2c2677b9361fdfc5f5e2`

