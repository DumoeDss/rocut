# C7 verification report — Sol round 1

Date: 2026-08-05 (Asia/Shanghai)

Change: s02-headless-editing

Accepted base HEAD/tree: a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf / 885d307814260b77397c2c2677b9361fdfc5f5e2

Implementation state: uncommitted 25-file authored write set, manifest digest a6d795f56d68627415200324b0b8c16284aabc6f6de063139c1bc04eb81b806a. Generated review build output is excluded from that digest.

HISTORICAL ROUND-1 VERDICT: BLOCKED — Blocker:2 Major:3 Minor:0 Trivial:0

## Scorecard

| Dimension | Result | Evidence |
| --- | --- | --- |
| Planning artifacts | PASS | proposal, design, 14-requirement/62-scenario delta, and tasks are structurally complete |
| Headless data lifecycle | PASS | focused session, migration, browser-boundary, semantic fixture tests: 40/40 |
| Exact emitted proof | FAIL | Next zero-root-chunk and Vite missing-HTML counterexamples |
| Runtime truth | FAIL | fallback/React values are constants; C6 runtime inventory is incomplete |
| Ordinary Host protection | PARTIAL | fresh Vite build and Vite parity pass; Next parity not independently replayed |
| C3 capacity protection | FAIL | WebGL passes; WebGPU fails twice at the same migration-state assertion |
| Rust/WASM/API/license | PASS | 12 Rust tests and 38/58/609 API/source/path/license gates pass |
| Full regression | PASS WITH INHERITED RED | exact 430 pass / 8 inherited fail / 2 inherited errors / 1,358 expectations |
| Main-spec strict validation | PASS | 14/14 |
| Child strict validation | PASS | 1/1 |
| Provenance/delivery | FAIL | patch log, SBOM, committed source inventory, clean re-review, ship/integration/archive remain open |
| Security | PASS | no confidence-8/10 exploitable finding |

## Blocking findings

1. [Blocker] Next exact-root emitted membership is false-positive capable. See review-report.md R1.
2. [Blocker] Vite graph accepts the executed artifact with headless.html omitted. See review-report.md R2.
3. [Major] Runtime no-fallback/no-React/no-resource fields are not fully observed. See review-report.md R3.
4. [Major] WebGPU protected regression fails twice and Next parity remains unexecuted. See review-report.md R4.
5. [Major] PATCHES/SBOM/committed source inventory and architecture provenance are incomplete. See review-report.md R5.

Recommended order: fix proof producers/checker and runtime probes with focused RED/GREEN controls; isolate the WebGPU failure against the accepted base; rerun affected Hosts and all protected leaves; then close provenance against the committed child tree; finally obtain a fresh non-author clean re-review.

## Fourteen inherited main-spec falsification sweep

| Main spec | Concrete C7 invalidation edge | Independent falsification gate | Status |
| --- | --- | --- | --- |
| browser-persistence-boundary | a headless route could accidentally select browser storage or alter ordinary Host persistence | storage/Host composition gates pass; Vite parity passes; accepted ordinary Host browser evidence remains attributable | PASS/PARTIAL |
| developer-reproducibility | new build modes and uncommitted files can make clean-checkout and inventory instructions stale | fresh Vite build/typecheck pass; committed source inventory is not yet possible | BLOCKED |
| editing-parity-fixture | migration extraction can move editing semantics or migration observations | protected Vite parity passes; exact parity fixture remains protected; Next replay missing | BLOCKED |
| editor-session-runtime | shared migration extraction or headless disposal can disturb full-session handles/state | focused migration/session tests and Rust handle tests pass; WebGPU protected job fails twice | BLOCKED |
| host-port-contract | proof code could widen public contracts or acquire resources directly | port and session-resource boundary scripts pass | PASS |
| host-service-boundary | proof Host could resurrect hidden storage context/fallback | storage and Host composition scripts pass | PASS |
| inherited-defect-repair | C7 could hide or add reds while changing fixture scope | full Bun identities exactly match 8 inherited failures + 2 loader errors; type baseline remains exact | PASS |
| next-free-distributable-boundary | new headless code could pull Next/product-shell code into Vite | fresh 2,893-module graph passes all ten exclusions | PASS |
| runtime-asset-delivery | ordinary builds could lose Worker/WASM/ORT layers | cross-Host emitted runtime gate passes | PASS |
| self-built-wasm-artifact | proof builds could substitute or mutate WASM | source/path/license/wiring and protected artifact identities pass | PASS |
| session-resource-disposal | headless or migration extraction could bypass the resource seam | static resource/state/port gates and focused disposal tests pass; complete runtime observation remains blocked | PASS/PARTIAL |
| session-state-isolation | headless/shared migration state could leak across owners or handles | focused owner tests, Rust 12/12, and WebGL pass; WebGPU suite does not complete | BLOCKED |
| upstream-provenance | new upstream behavior can escape patch/SBOM/source inventory | reference/license gate passes; patch log and derived inventories are incomplete | BLOCKED |
| wasm-api-surface | proof configuration could change resolved/generated API | exact 38 JS / 58 binary / 609 imports and structural compile pass | PASS |

## Delta realization sweep — 14 requirements / 62 scenarios

Status totals: 49 VERIFIED, 10 BLOCKED, 3 PENDING.

| # | Scenario | Realization evidence | Status |
| ---: | --- | --- | --- |
| 1.1 | Headless factory creates a project-scoped owner | headless-session focused tests and API inspection | VERIFIED |
| 1.2 | Isolated export does not traverse the React-bearing barrel | emitted module graphs and direct import inspection | VERIFIED |
| 1.3 | Frozen public surfaces remain unchanged | protected identities and diff audit | VERIFIED |
| 1.4 | S03 behavior is not introduced early | public-surface and scope audit | VERIFIED |
| 2.1 | Existing project loads as detached data | headless-session focused test | VERIFIED |
| 2.2 | Known-field edit is durably saved | headless-session and semantic fixture | VERIFIED |
| 2.3 | A second owner reopens the edit | focused test plus both accepted Host runtime JSON | VERIFIED |
| 2.4 | Missing project remains explicit | focused test | VERIFIED |
| 2.5 | Cross-project save is rejected | focused test | VERIFIED |
| 3.1 | Full and headless creation join one in-flight migration | isolated shared migration suite | VERIFIED |
| 3.2 | Two headless owners join one in-flight migration | isolated shared migration suite | VERIFIED |
| 3.3 | Different stores migrate independently | isolated shared migration suite | VERIFIED |
| 3.4 | Failed migration blocks creation and can retry | isolated shared migration suite | VERIFIED |
| 3.5 | Existing full-session migration events do not drift | isolated shared migration suite and source comparison | VERIFIED |
| 4.1 | Store identity is non-browser and explicit | runtime JSON, fixture and static storage gate | VERIFIED |
| 4.2 | Throwing browser globals remain untouched | isolated browser-boundary process test | VERIFIED |
| 4.3 | No production Host fallback can pass | evaluator checks a literal hostFallback:false rather than an observation | BLOCKED |
| 5.1 | Unknown nested project data is preserved | semantic fixture digest equality | VERIFIED |
| 5.2 | Attachment body remains byte-identical | semantic fixture SHA-256 equality | VERIFIED |
| 5.3 | Attachment metadata remains equivalent | semantic fixture digest equality | VERIFIED |
| 5.4 | Headless disposal does not delete durable data | semantic fixture and second-owner reopen | VERIFIED |
| 6.1 | Dispose waits for an admitted save | focused serialization test | VERIFIED |
| 6.2 | Concurrent dispose joins one terminal run | focused dispose test | VERIFIED |
| 6.3 | Post-dispose operations reject | focused test and runtime JSON | VERIFIED |
| 6.4 | One headless owner does not corrupt another | focused owner isolation test | VERIFIED |
| 6.5 | No C6 live resource class is acquired | runtime result observes only 3 classes and hard-codes React; static gates are insufficient for the runtime claim | BLOCKED |
| 7.1 | Fresh Vite runtime proves the round trip | accepted clean Vite raw runtime JSON | VERIFIED |
| 7.2 | Vite graph is tied to the executed artifact | checker accepts JS+map copied without headless.html | BLOCKED |
| 7.3 | Ordinary Vite Host remains independent | fresh ordinary Vite build, distributable gate and protected parity | VERIFIED |
| 7.4 | Vite output cannot be reused across controls | stale/copy/control tests and distinct graph identities | VERIFIED |
| 8.1 | Fresh Next runtime proves the round trip | accepted clean Next raw runtime JSON | VERIFIED |
| 8.2 | Next closure starts at the exact application root | producer accepts root with no actual chunk and borrows entrypoint files | BLOCKED |
| 8.3 | Aggregated zero-React inventory is insufficient | focused aggregate-only negative test | VERIFIED |
| 8.4 | Ordinary default Next build remains independent | accepted ordinary Turbopack build and runtime inventory | VERIFIED |
| 8.5 | Next and Vite evidence cannot substitute for each other | host/producer/copy negative tests and distinct runtime ownership | VERIFIED |
| 9.1 | Critical closure roots are present | accepted clean graph envelopes and checker | VERIFIED |
| 9.2 | Empty or truncated graph fails closed | module truncation is rejected, but executable HTML truncation passes | BLOCKED |
| 9.3 | Unrelated entry fails closed | wrong-entry negative test | VERIFIED |
| 9.4 | Artifact mutation invalidates attribution | recorded JS mutation fails, but headless.html mutation/absence is outside inventory | BLOCKED |
| 10.1 | Clean Vite closure contains no React family | accepted clean Vite graph | VERIFIED |
| 10.2 | Clean Next closure contains no React family | accepted clean Next graph | VERIFIED |
| 10.3 | Source grep cannot satisfy the boundary | emitted-graph checker and aggregate-only control | VERIFIED |
| 10.4 | Normalization cannot hide a forbidden dependency | POSIX/Windows/package-manager/virtual/raw-alias negative matrix | VERIFIED |
| 11.1 | Vite React injection is detected | Vite control build and checker rejection | VERIFIED |
| 11.2 | Next React injection is detected | Next control build and checker rejection | VERIFIED |
| 11.3 | Broken control is not sensitivity evidence | control artifacts have successful builds and real React modules | VERIFIED |
| 11.4 | Accepted clean output is rebuilt after controls | distinct later clean markers/digests for both Hosts | VERIFIED |
| 12.1 | Runtime result proves an actual edit and reopen | both accepted raw runtime JSON and evaluator | VERIFIED |
| 12.2 | React mount absence is observed, not inferred | reactMountAttempts is a literal zero | BLOCKED |
| 12.3 | Unique process and build ownership is recorded | raw runtime ownership/build/graph records | VERIFIED |
| 12.4 | Owned cleanup runs on failure | implementer cleanup records plus reviewer ports 4173/41831-41836 all free | VERIFIED |
| 13.1 | Full session behavior survives migration extraction | Vite parity passes, but Next parity is missing and WebGPU migration observation fails twice | BLOCKED |
| 13.2 | Production browser storage remains durable | storage gates, Vite parity, ordinary Host evidence | VERIFIED |
| 13.3 | Runtime and resource invariants remain green | WebGL passes; WebGPU protected job fails twice | BLOCKED |
| 13.4 | Protected identities remain equal | implementer protected-identity record and reviewer diff audit | VERIFIED |
| 13.5 | Regression identity does not grow | full Bun suite exactly matches inherited-red manifest | VERIFIED |
| 14.1 | Complete capability corpus is swept both ways | this 62-row realization table plus the 14-main-spec falsification table | VERIFIED |
| 14.2 | Planning does not masquerade as execution | reports distinguish pass, blocked and pending leaves | VERIFIED |
| 14.3 | Independent review closes material findings | round-1 review has five open material findings | BLOCKED |
| 14.4 | Luna ship is a separate leaf | forbidden until clean re-review | PENDING |
| 14.5 | Integration evidence is fresh | no integration authorized or performed | PENDING |
| 14.6 | Archive follows accepted spec sync | no archive authorized or performed | PENDING |

Because ten realization scenarios are blocked and three workflow scenarios are pending, task 11.10 and task 12.8 remain unchecked.

## Executed commands

Commands below were independently executed in the C7 worktree unless marked planning:

- git rev-parse HEAD and git rev-parse 'HEAD^{tree}'
- six-file C7 focused bun test command from green-implementation.md
- bun test
- node script/check-session-state-boundary.mjs
- node script/check-session-resource-boundary.mjs
- node script/check-port-boundary.mjs
- node script/check-storage-boundary.mjs
- node script/check-host-composition.mjs
- node script/check-runtime-asset-boundary.mjs
- node script/check-reference-boundary.mjs
- node script/check-next-imports.mjs
- bun run check:wasm
- cargo test --manifest-path rust/wasm/Cargo.toml with CARGO_TARGET_DIR=C:/Users/Sayo/cargo-target
- bun run typecheck in apps/vite-example
- node script/check-type-baseline.mjs
- fresh ordinary Vite production build to dist-c7-sol-review-c3-20260805 with root base and exact accepted commit marker
- node script/check-distributable-boundary.mjs against that fresh module graph
- node script/check-emitted-runtime-assets.mjs against the fresh Vite and accepted ordinary Next outputs
- Playwright C3 WebGL job on owned port 41831
- Playwright C3 WebGPU jobs on owned ports 41832 and 41833
- protected Vite parity Playwright scenario on owned port 4173
- Next zero-root-chunk inline producer counterexample
- Vite missing-headless.html envelope counterexample
- rasen validate s02-headless-editing --strict --no-interactive --project rocut --json
- rasen validate --specs --strict --no-interactive --project rocut --json
- git diff --check

No product/test/tooling repair, commit, push, PR, integration, spec sync, ship, or archive was performed.

## Test and gate results

- Focused C7: 40 pass / 0 fail / 64 expectations.
- Full Bun: 430 pass / 8 inherited fail / 2 inherited errors / 1,358 expectations / 438 tests / 81 files.
- Rust: 12 pass / 0 fail.
- C3 WebGL: 1 pass.
- C3 WebGPU: 0 pass / 2 repeated failed runs at the same assertion.
- Protected Vite parity: 1 pass.
- Vite typecheck: pass.
- Strict validation: child 1/1; main specs 14/14.
- Overall verification result: fail.

TEST EVIDENCE
- scope: focused C7, full repository, production Vite, protected parity/C3, Rust/WASM, static boundaries, strict planning validation
- rationale: this is the smallest combined scope that exercises every risk introduced by the headless API and both proof producers while protecting C3-C6 and ordinary Hosts
- command: see “Executed commands” above
- result: fail
- tree: 885d307814260b77397c2c2677b9361fdfc5f5e2

## Task truth

- 12.1 complete: the reviewer received and inspected all required inputs.
- 12.2 complete: the Next collector was adversarially audited and falsified.
- 12.3 complete: API/barrel/S03/migration/race/fallback/opaque/attachment concerns were audited.
- 12.4 complete: every round-1 finding is severity-tagged, evidenced, and routed; material findings remain open, so no advancement is claimed.
- 12.5-12.7 next: Sol fixes, fresh non-author re-review, affected gate replay.
- 12.8 false: implementation verification is blocked.
- 13.x false: ship/integration/archive are not legal yet.

## Round-2 verification supplement

Latest verdict: **BLOCKED — Blocker: 1, Major: 1, Minor: 0, Trivial: 0**.

The complete current scorecard, independent gate identities, task truth, and exact remediation
criteria are in `verification-round2.md` and `review-round2.md`. Scenario totals are
`54 PASS / 3 FAIL / 5 UNVERIFIED`. Tasks 12.6-12.8 remain false.

## Round-3 final verification supplement

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

This is the single canonical verdict for the accumulated report. It adopts the third fresh
non-author CLEAN disposition in `review-report.md` and `review-cycle-report.md`, and it is
cross-checked against the `59` pre-delivery PASS / `0` FAIL / `0` UNVERIFIED evidence in
`scenario-realization-map.md` and the round-3 scenario-corpus result below. The earlier blocked
rounds and their findings remain historical evidence rather than competing current verdicts.

| Verification surface | Independent round-3 result |
| --- | --- |
| Accepted identity | PASS — HEAD `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf`, tree `885d307814260b77397c2c2677b9361fdfc5f5e2` |
| Authored delta | PASS — 32 files, SHA-256 `e35913a746813342a7380a2fcfc00ea1df8aa4ec92234526f07fe058152ca657` |
| R1 exact Next root | PASS — resolved resource only; complete alias-only/no-resource envelope rejected; plugin `5/5` |
| R3 field-complete runtime proof | PASS — all clean fields zero, every installed sensitivity hook nonzero, availability-aware absence and ordered provenance enforced |
| Focused C7 matrix | PASS — `90/0/123` |
| Final clean Hosts | PASS — Vite `15` modules / graph `6eaf3a78...`; Next `16` modules / graph `078b16dd...`; cross-Host evaluator PASS |
| Final sensitivity Hosts | PASS — Vite rejected only 19 React-family identities; Next rejected only one injected React identity; both runtime sensitivity validators PASS |
| Full Bun | ACCEPTED — `480 pass / 8 inherited fail / 2 inherited loader errors / 1,417 expectations`; exact inherited identities unchanged |
| Static/type/format | PASS — eight boundaries, Vite typecheck, exact-three root baseline, source Prettier, zero-error ESLint, MJS syntax, and `git diff --check` |
| Rust/WASM | PASS — Rust `12/12` plus doc tests; WASM exact `38/58/609` and all source/path/license/privacy gates |
| Protected identities | PASS — all cold-baseline tree/blob/SHA identities exact; protected diff exit `0`; no lockfile drift |
| Protected parity/C3 | PASS/accepted inherited — Vite and Next parity `1/1`; exact-base/current WebGPU same line-88 oracle race; current WebGL PASS |
| Strict planning validation | PASS — child `1/1`, main specs `14/14`, zero issues |
| Scenario corpus | PASS — `14/14` requirements, `62/62` rows; `59` pre-delivery PASS and `3` delivery PENDING |

The LEAD causality adjudication is accepted: requiring ship/integration/archive evidence before
task 12.8 would create a dependency cycle, while retaining R14.S4-R14.S6 as explicit pending rows
preserves every later evidence obligation. No non-delivery scenario is failed or unverified.

At the time of this verification, task truth was `126 checked / 11 unchecked`: the since-recorded
historical deviation at 1.10 and delivery tasks 13.1-13.10 were then unchecked; 12.6-12.8 were
checked. No delivery action occurred during verification. After the final CLEAN review, a separate
Luna-xhigh ship leaf was assigned and rejected by the external quota gate before repository action,
so 13.1 is now complete as assignment only. Current checkbox truth is `127 checked / 8 unchecked /
135 total`: 13.2-13.9 remain pending, while 1.10 and 13.10 are numbered non-checkbox records.

TEST EVIDENCE
- scope: the complete post-round-2 C7 candidate and every review-sensitive regression surface
- rationale: verifies exact-root fail-closed behavior, field-complete runtime sensitivity, clean
  cross-Host semantics, ordinary Host protection, and planning/delivery causality
- command: see the round-3 supplement in `review-report.md`
- result: pass, with exact accepted inherited full-suite/C3 identities only
- tree: `885d307814260b77397c2c2677b9361fdfc5f5e2`
