# C7 implementer evidence manifest

Date: 2026-08-05 (Asia/Shanghai)

## Identity and write set

- Worktree/branch: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c7` / `feat/s02-headless-editing`.
- Accepted base HEAD/tree: `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf` / `885d307814260b77397c2c2677b9361fdfc5f5e2`.
- Delivery state: uncommitted implementation, review-ready; no child commit/tree exists yet because Luna-xhigh ship is a later leaf.
- Authored write set: `25` files (`5` tracked modifications + `20` untracked additions), canonical path/content SHA-256 `a6d795f56d68627415200324b0b8c16284aabc6f6de063139c1bc04eb81b806a`.
- Tracked diff stat: `132 insertions / 184 deletions` across five files. Generated build evidence is separately classified and excluded from the authored digest.

Authored paths:

```text
apps/vite-example/build/headless-module-graph.ts
apps/vite-example/headless.html
apps/vite-example/package.json
apps/vite-example/src/headless-entry.ts
apps/vite-example/tsconfig.json
apps/vite-example/vite.headless.config.ts
apps/web/build/headless-webpack-graph-plugin.ts
apps/web/next.config.ts
apps/web/src/app/c7-headless/route.ts
apps/web/src/editor/session/__tests__/headless-browser-boundary.test.ts
apps/web/src/editor/session/__tests__/headless-migration.test.ts
apps/web/src/editor/session/__tests__/headless-semantic-fixture.test.ts
apps/web/src/editor/session/__tests__/headless-session.test.ts
apps/web/src/editor/session/create-session.ts
apps/web/src/editor/session/headless-proof-control-react.ts
apps/web/src/editor/session/headless-proof-control.ts
apps/web/src/editor/session/headless-semantic-fixture.ts
apps/web/src/editor/session/headless.ts
apps/web/src/editor/session/migration-gate.ts
script/__tests__/c7-headless-graph.test.mjs
script/__tests__/c7-headless-semantic-result.test.mjs
script/check-headless-graph.mjs
script/check-headless-semantic-result.mjs
script/fixtures/session-state-ownership.json
script/run-c7-headless-host.mjs
```

## Accepted C7 artifacts

| Host/control | Output | Build / graph identity | Verdict |
| --- | --- | --- | --- |
| Vite React control | `apps/vite-example/dist-c7-headless-react-control-20260805-2` | graph `b8dd90d6...`, build `vite:c7-vite-react-control-20260805-2:3de445cddc6421d6` | build 0, checker 1 for React |
| Vite clean | `apps/vite-example/dist-c7-headless-clean-20260805-2` | graph `78b16bbe...`, build `vite:c7-vite-headless-clean-20260805-2:47bef2a6df57e1c4` | graph/runtime PASS |
| Next React control | `apps/web/.next-c7-headless-react-control-20260805-7` | graph `02a5d5ff...`, build `next-webpack:22647de5e357d25d` | build 0, checker 1 for React |
| Next clean | `apps/web/.next-c7-headless-clean-20260805-1` | graph `2f5e3d8b...`, build `next-webpack:0e4af95144cec01c` | graph/runtime PASS |
| Vite ordinary | `apps/vite-example/dist-c7-ordinary-regression-20260805-1` | file set `50d2ed2e...` | build/assets/browser PASS |
| Next ordinary | `apps/web/.next-c7-ordinary-regression-20260805-3` | build ID `MfsSIdOz18ObX6sALb1af`, file set `74b5aaa4...` | default Turbopack/browser PASS |

Raw accepted runtime records:

- `evidence/raw/vite-headless-runtime-clean2-20260805.json`
- `evidence/raw/next-headless-runtime-20260805.json`

The first Vite runtime failure and all failed build attempts remain separately attributable; none is promoted.

## Command/result rollup

| Gate | Exact result |
| --- | --- |
| C7 focused | `40 pass / 0 fail / 64 expectations` |
| direct shared migration | `6 pass / 0 fail / 16 expectations` |
| C5 storage/persistence | `67 pass / 0 fail / 443 expectations` |
| C6 18-file matrix | `50 pass / 0 fail / 162 expectations` |
| C4 Host matrix | `49 pass / 0 fail / 293 expectations` |
| Vite typecheck | exit `0` |
| pinned type baseline | exit `0`, exact three inherited diagnostics |
| full `bun test` | `430 pass / 8 inherited fail / 2 inherited errors / 1,358 expectations / 438 tests / 81 files` |
| ordinary Vite | `2,893` modules / `307` files / `35,041,293` bytes; browser oracle PASS |
| ordinary Next | Next 16.1.3 Turbopack / `19/19` / `2,614` files / `247,650,021` bytes; browser oracle PASS |
| WASM | self-built/path/license/wiring/API `38/58/609` and negatives PASS |
| protected identity | every recorded tree/blob/SHA exact; tracked diff exit `0` |
| child strict validation | `1/1` valid, zero issues |
| main-spec strict validation | `14/14` valid, zero issues |

## Evidence map and known pending leaves

- Baseline: `baseline-20260805.md`
- RED/GREEN: `red-implementation.md`, `green-implementation.md`
- Controls/failures: `negative-controls.md`, `failed-build-attempts-20260805.md`
- Clean Hosts: `headless-hosts.md` plus `evidence/raw/*.json`
- Ordinary Hosts: `ordinary-host-regression.md`
- Final regression/scope: `final-regression.md`
- Capability sweep: `capability-sweep.md`

Pending by design: independent Sol review/re-review, protected heavyweight editing-parity browser replay if the reviewer requires it, the absent historical C6 untracked provenance-anchor replay, shared SBOM/source-inventory generation, Luna-xhigh local ship, LEAD integration/spec sync, and separate Luna-xhigh archive. No pass is claimed for these leaves.

## Round-1 remediation supplement (superseding final implementation counts)

The preceding manifest remains the truthful pre-review implementation record. After the accepted
round-1 Sol fixes, the authored set is `30` files: `7` tracked modifications plus `23` untracked
additions. Sorted `path + NUL + raw bytes + NUL` SHA-256 is
`072b5fdf40f3d983c7407aae9d90e0bcd7a588803d07d21ff7785438cee65470`.

```text
BOUNDARIES.md
PATCHES.md
apps/vite-example/build/headless-module-graph.ts
apps/vite-example/headless.html
apps/vite-example/package.json
apps/vite-example/src/headless-entry.ts
apps/vite-example/tsconfig.json
apps/vite-example/vite.headless.config.ts
apps/web/build/__tests__/headless-webpack-graph-plugin.test.ts
apps/web/build/headless-webpack-graph-plugin.ts
apps/web/next.config.ts
apps/web/src/app/c7-headless/route.ts
apps/web/src/editor/session/__tests__/headless-browser-boundary.test.ts
apps/web/src/editor/session/__tests__/headless-migration.test.ts
apps/web/src/editor/session/__tests__/headless-runtime-probe.test.ts
apps/web/src/editor/session/__tests__/headless-semantic-fixture.test.ts
apps/web/src/editor/session/__tests__/headless-session.test.ts
apps/web/src/editor/session/create-session.ts
apps/web/src/editor/session/headless-proof-control-react.ts
apps/web/src/editor/session/headless-proof-control.ts
apps/web/src/editor/session/headless-runtime-probe.ts
apps/web/src/editor/session/headless-semantic-fixture.ts
apps/web/src/editor/session/headless.ts
apps/web/src/editor/session/migration-gate.ts
script/__tests__/c7-headless-graph.test.mjs
script/__tests__/c7-headless-semantic-result.test.mjs
script/check-headless-graph.mjs
script/check-headless-semantic-result.mjs
script/fixtures/session-state-ownership.json
script/run-c7-headless-host.mjs
```

Final post-format artifacts supersede the first accepted C7 proof artifacts above:

| Host/control | Final output | Final identity | Verdict |
| --- | --- | --- | --- |
| Vite React control | `dist-c7-r1-headless-react-control-20260805-3` | raw graph `6c6bff36...` | checker `1`, five React identities |
| Vite clean | `dist-c7-r1-headless-clean-20260805-3` | raw graph `eeda71ec...` | graph/runtime PASS |
| Next React control | `.next-c7-r1-headless-react-control-20260805-2` | raw graph `c2332f85...` | checker `1`, injected React only |
| Next clean | `.next-c7-r1-headless-clean-20260805-2` | raw graph `b32ac37f...` | graph/runtime PASS |

Final command rollup: focused C7 `52/0/81`; full Bun `442 pass / 8 inherited fail / 2 inherited
loader errors / 1,375 expectations / 450 tests / 83 files`; Rust `12/12`; WASM exact `38/58/609`;
Vite typecheck and pinned type baseline PASS; static boundaries PASS; protected identities exact;
Rasen child `1/1` and main specs `14/14` strict-valid. Fresh protected Vite and Next editing parity
both pass. Exact-base/current WebGPU isolation reproduces the same inherited migration-observation
race; current WebGL passes.

SBOM is no longer pending: official regeneration reports `1,359` npm packages and `80` wasm
crates, all D-1..D-5 dispositions valid, and tracked SBOM diff zero. `SOURCE_INVENTORY.md` remains
deferred to the post-commit Luna-xhigh ship check because its official generator sees Git-tracked
paths and would omit the currently untracked additions.

See `review-round1-fixes.md`, `review-cycle-report.md`, and `scenario-realization-map.md`. A fresh
non-author Sol re-review remains mandatory; this supplement does not close the prior findings.

## Round-2 remediation supplement (review candidate, not self-acceptance)

The R1/R3 fixer adds two proof-only paths to the round-1 authored set. The final authored set is
`32` files: `7` tracked modifications plus `25` untracked additions. Generated `dist-c7-*` and
`.next-c7-*` outputs are excluded. Ordinal-sorted `path + NUL + raw bytes + NUL` SHA-256 is
`e35913a746813342a7380a2fcfc00ea1df8aa4ec92234526f07fe058152ca657`.

```text
BOUNDARIES.md
PATCHES.md
apps/vite-example/build/headless-module-graph.ts
apps/vite-example/headless.html
apps/vite-example/package.json
apps/vite-example/src/headless-entry.ts
apps/vite-example/tsconfig.json
apps/vite-example/vite.headless.config.ts
apps/web/build/__tests__/headless-webpack-graph-plugin.test.ts
apps/web/build/headless-webpack-graph-plugin.ts
apps/web/next.config.ts
apps/web/src/app/c7-headless/route.ts
apps/web/src/editor/session/__tests__/headless-browser-boundary.test.ts
apps/web/src/editor/session/__tests__/headless-migration.test.ts
apps/web/src/editor/session/__tests__/headless-runtime-probe.test.ts
apps/web/src/editor/session/__tests__/headless-semantic-fixture.test.ts
apps/web/src/editor/session/__tests__/headless-session.test.ts
apps/web/src/editor/session/create-session.ts
apps/web/src/editor/session/headless-proof-control-react-browser.ts
apps/web/src/editor/session/headless-proof-control-react.ts
apps/web/src/editor/session/headless-proof-control.ts
apps/web/src/editor/session/headless-runtime-probe.ts
apps/web/src/editor/session/headless-semantic-fixture.ts
apps/web/src/editor/session/headless.ts
apps/web/src/editor/session/migration-gate.ts
script/__tests__/c7-headless-graph.test.mjs
script/__tests__/c7-headless-semantic-result.test.mjs
script/check-headless-graph.mjs
script/check-headless-semantic-result.mjs
script/fixtures/c7-headless-runtime-sensitivity-control.ts
script/fixtures/session-state-ownership.json
script/run-c7-headless-host.mjs
```

Final round-2 candidate artifacts supersede every earlier headless acceptance role while retaining
the earlier raw evidence:

| Host/control | Final output | Raw graph SHA-256 | Runtime-report SHA-256 | Result |
| --- | --- | --- | --- | --- |
| Vite React sensitivity | `dist-c7-r2-headless-react-control-20260805-10` | `1a7cf5bcd6a426179078db94273df827c31d019e1767bfc6a5eb516fb449c65a` | `d66942ea5910dfd6f11dc46dc6f244e60333b22f7f56d13afe2b143e4720d9b4` | expected React-only rejection plus browser sensitivity PASS |
| Vite clean | `dist-c7-r2-headless-clean-20260805-3` | `6eaf3a78e5ef8a01b0b2fd3d46f6892637e9ee058bfe65ff3c266d19f1e6338c` | `b5081b0a9d6445e25330732284959a1a8973a6fcb7a6d6f08e4b19cb4d232732` | graph/runtime clean PASS |
| Next React sensitivity | `.next-c7-r2-headless-react-control-20260805-5` | `69187000e14d9500d78b85bd85c003df72ebf9e9bf5beedb60a81c76609c6845` | `00ed06adf5c086ec8300d51d56e5fc54f03260edb943bed0851dd876b5a74ce1` | expected injected-React-only rejection plus server sensitivity PASS |
| Next clean | `.next-c7-r2-headless-clean-20260805-3` | `078b16dd9d9358f27c7f2651bda83e9cb6e11c77a719d094d86a95df7ecac45a` | `9b0bbdff678dfc6c2dd56b5012700ddd0fc0e0b12a330d54eaf4cd67a0540002` | graph/runtime clean PASS |

The cross-Host evaluator binds clean graphs `6eaf3a78...` and `078b16dd...` to the same actual edit,
reopen, opaque payload and attachment result. Final gates are focused `90/0/123`; full Bun
`480 pass / 8 inherited fail / 2 inherited loader errors / 1,417 expectations / 488 tests / 83
files`; Rust `12/12`; WASM exact `38/58/609`; static/type/format/protected/strict gates PASS.

Initial/round-1 generated output reclamation is fully identified in `review-round2-fixes.md`.
Tasks 12.6-12.8 remain unchecked: these artifacts are offered to a third fresh non-author Sol-xhigh
reviewer and are not an implementer-issued clean verdict.
