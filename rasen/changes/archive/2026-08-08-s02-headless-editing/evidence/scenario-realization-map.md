# C7 headless-editing scenario realization map

Date: 2026-08-05 (Asia/Shanghai)

Accepted child base: `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf` / tree
`885d307814260b77397c2c2677b9361fdfc5f5e2`. This map covers all `14` delta requirements and all
`62` scenarios. After fresh non-author round-3 review, every pre-delivery row is independently
accepted. The three workflow rows that necessarily follow task 12.8 remain explicitly `PENDING`
under the LEAD causality adjudication. Latest total: `59 PASS / 0 FAIL / 0 UNVERIFIED`
pre-delivery plus `3 PENDING` delivery scenarios.

Common focused command: the final eight-file C7 suite is `90 pass / 0 fail / 123 expectations`.
Common final Host evidence is
`raw/vite-r2-headless-clean-boundary-final-20260805.json`,
`raw/next-r2-headless-clean-boundary-final-20260805.json`, and the final Vite/Next graph outputs
recorded in `review-round2-fixes.md`.

| ID | Delta scenario | Status | Executed evidence or pending delivery artifact |
| --- | --- | --- | --- |
| R1.S1 | Headless factory creates a project-scoped owner | EXECUTED | `headless-session.test.ts`; both final raw Host reports record Host-issued distinct owner IDs and the exact project ID. |
| R1.S2 | Isolated export does not traverse the React-bearing barrel | EXECUTED | `headless-browser-boundary.test.ts`; final Vite/Next exact emitted graphs; clean checker verdicts. |
| R1.S3 | Frozen public surfaces remain unchanged | EXECUTED | `baseline-20260805.md`; final protected identity audit in `review-round1-fixes.md`; protected `git diff --quiet` exit 0. |
| R1.S4 | S03 behavior is not introduced early | EXECUTED | `headless-session.test.ts` import/surface assertions and final scope audit in `final-regression.md`. |
| R2.S1 | Existing project loads as detached data | EXECUTED | `headless-session.test.ts`; `headless-semantic-fixture.test.ts`; both final runtime reports. |
| R2.S2 | Known-field edit is durably saved | EXECUTED | Semantic fixture digests/timestamps plus final runtime reports. |
| R2.S3 | A second owner reopens the edit | EXECUTED | Semantic fixture and cross-Host evaluator; distinct owner IDs and equal saved/reopened digests. |
| R2.S4 | Missing project remains explicit | EXECUTED | `headless-session.test.ts` missing-project/null/no-navigation case. |
| R2.S5 | Cross-project save is rejected | EXECUTED | `headless-session.test.ts` cross-project rejection and untouched-store assertions. |
| R3.S1 | Full and headless creation join one in-flight migration | EXECUTED | `headless-migration.test.ts` isolated shared matrix and `green-implementation.md`. |
| R3.S2 | Two headless owners join one in-flight migration | EXECUTED | Same shared migration matrix. |
| R3.S3 | Different stores migrate independently | EXECUTED | Same matrix, distinct-store event trace. |
| R3.S4 | Failed migration blocks creation and can retry | EXECUTED | Same matrix, preserved error identity and retry case. |
| R3.S5 | Existing full-session migration events do not drift | EXECUTED | Characterization/green records plus full regression and ordinary parity runs. |
| R4.S1 | Store identity is non-browser and explicit | EXECUTED | Pre-load runtime probe in both final reports records `InMemoryProjectStore`, same instance, and `fallbackUsed=false`. |
| R4.S2 | Throwing browser globals remain untouched | EXECUTED | `headless-browser-boundary.test.ts`. |
| R4.S3 | No production Host fallback can pass | EXECUTED | Evaluator wrong-store/fallback-store negatives plus final actual Host/store probe. |
| R5.S1 | Unknown nested project data is preserved | EXECUTED | Semantic fixture opaque digests in focused test and both final reports. |
| R5.S2 | Attachment body remains byte-identical | EXECUTED | Semantic fixture attachment body digests in focused test and both final reports. |
| R5.S3 | Attachment metadata remains equivalent | EXECUTED | Semantic fixture metadata digests/key/schema in both final reports. |
| R5.S4 | Headless disposal does not delete durable data | EXECUTED | Semantic fixture durable presence assertions and both final reports. |
| R6.S1 | Dispose waits for an admitted save | EXECUTED | `headless-session.test.ts` serialized admission/save/dispose coverage. |
| R6.S2 | Concurrent dispose joins one terminal run | EXECUTED | `headless-session.test.ts` stable terminal promise/destruction coverage. |
| R6.S3 | Post-dispose operations reject | EXECUTED | Unit test plus final semantic report `postDisposeWriteRejected/storeUntouched=true`. |
| R6.S4 | One headless owner does not corrupt another | EXECUTED | Unit test and two-owner semantic fixture. |
| R6.S5 | No C6 live resource class is acquired | EXECUTED | Final Vite/Next clean probes require every field to be zero; field-complete controls genuinely exercise each installed global, Host, WebGPU, WASM, React, and derived compositor/GPU path; evaluator negatives reject every fabricated clean field and installed-but-zero hook. |
| R7.S1 | Fresh Vite runtime proves the round trip | EXECUTED | Final Vite clean output and `raw/vite-headless-runtime-r1-final-20260805.json`. |
| R7.S2 | Vite graph is tied to the executed artifact | EXECUTED | Final Vite raw graph `eeda71ec...`, executable HTML validation, file/module digests, and runtime graph binding. |
| R7.S3 | Ordinary Vite Host remains independent | EXECUTED | `ordinary-host-regression.md`; protected Vite editing-parity pass recorded in `review-round1-fixes.md`. |
| R7.S4 | Vite output cannot be reused across controls | EXECUTED | `c7-headless-graph.test.mjs`; `negative-controls.md`; final control and clean use distinct output/marker identities. |
| R8.S1 | Fresh Next runtime proves the round trip | EXECUTED | Final Next clean output and `raw/next-headless-runtime-r1-final-20260805.json`. |
| R8.S2 | Next closure starts at the exact application root | EXECUTED | Root selection derives only from normalized `module.resource`; the full alias-only producer-to-checker envelope with no resolved resource is rejected, and final control/clean graphs use actual resolved roots. |
| R8.S3 | Aggregated zero-React inventory is insufficient | EXECUTED | Aggregate-only checker negative and exact-root zero-membership RED/GREEN coverage. |
| R8.S4 | Ordinary default Next build remains independent | EXECUTED | `ordinary-host-regression.md`; fresh root-base Next 16.1.3 Turbopack parity pass in `review-round1-fixes.md`. |
| R8.S5 | Next and Vite evidence cannot substitute for each other | EXECUTED | Copied-Host graph/result negatives in graph and semantic evaluator suites. |
| R9.S1 | Critical closure roots are present | EXECUTED | Final Vite/Next strict graph checks include the required runtime-probe root and all critical roots. |
| R9.S2 | Empty or truncated graph fails closed | EXECUTED | `c7-headless-graph.test.mjs` and Next truncated-byte plugin case. |
| R9.S3 | Unrelated entry fails closed | EXECUTED | Wrong-entry, zero-root, wrong-entrypoint-owner, and complete alias-only/no-resource producer controls all reject before acceptance. |
| R9.S4 | Artifact mutation invalidates attribution | EXECUTED | Altered digest/HTML/base/marker/module-set controls. |
| R10.S1 | Clean Vite closure contains no React family | EXECUTED | Final Vite checker pass: `15` modules, zero forbidden identities. |
| R10.S2 | Clean Next closure contains no React family | EXECUTED | Final Next checker pass: `16` modules, zero forbidden identities. |
| R10.S3 | Source grep cannot satisfy the boundary | EXECUTED | Aggregate/import-list-only negative controls. |
| R10.S4 | Normalization cannot hide a forbidden dependency | EXECUTED | Windows, package-manager, query, alias, virtual, JSX and server-runtime graph negatives. |
| R11.S1 | Vite React injection is detected | EXECUTED | Final Vite sensitivity graph `1a7cf5bc...`; checker exits 1 for exactly 19 React-family identities. |
| R11.S2 | Next React injection is detected | EXECUTED | Final Next sensitivity graph `69187000...`; checker exits 1 solely for the injected React identity. |
| R11.S3 | Broken control is not sensitivity evidence | EXECUTED | `failed-build-attempts-20260805.md`; graph controls require successful collection and named-rule failure. |
| R11.S4 | Accepted clean output is rebuilt after controls | EXECUTED | Post-format final sequence uses Vite clean `...-3` and Next clean `...-2`, distinct from final controls. |
| R12.S1 | Runtime result proves an actual edit and reopen | EXECUTED | Final two raw reports plus cross-Host evaluator; no-edit/no-second-owner/missing-digest negatives. |
| R12.S2 | React mount absence is observed, not inferred | EXECUTED | Vite sensitivity creates a real React root with `createRoot`/`flushSync`, observes MutationObserver activity and root-marker growth, while Next records exact server-no-DOM absence; fabricated React sensitivity is rejected. |
| R12.S3 | Unique process and build ownership is recorded | EXECUTED | Final reports record marker/build/output/PID/port/base/graph and redacted logs. |
| R12.S4 | Owned cleanup runs on failure | EXECUTED | Preserved failed Vite runtime report and helper `finally` cleanup records; all C7-owned ports released. |
| R13.S1 | Full session behavior survives migration extraction | EXECUTED | Full-session/migration/C6 matrices and protected Vite/Next parity evidence. |
| R13.S2 | Production browser storage remains durable | EXECUTED | `ordinary-host-regression.md` and C5/C6 persistence matrices. |
| R13.S3 | Runtime and resource invariants remain green | EXECUTED WITH INHERITED ORACLE | C4/C6 gates and WebGL pass; exact accepted-base/current WebGPU runs fail at the same pre-existing migration-observation race, isolated in `review-round1-fixes.md`. |
| R13.S4 | Protected identities remain equal | EXECUTED | Final protected path/tree/blob/generated SHA audit, all exact. |
| R13.S5 | Regression identity does not grow | EXECUTED | Full Bun `480 pass / 8 inherited fail / 2 inherited loader errors / 1,417 expectations`; type baseline has no new diagnostic. |
| R14.S1 | Complete capability corpus is swept both ways | EXECUTED | Inherited falsification sweep in `capability-sweep.md`; this complete `14/62` realization map; strict validation `14/14 + 1/1`. |
| R14.S2 | Planning does not masquerade as execution | EXECUTED | `tasks.md` remains staged; ship/integration/archive and fresh re-review remain unchecked. |
| R14.S3 | Independent review closes material findings | EXECUTED | Third fresh non-author Sol-xhigh review accepts both round-2 fixes, reconfirms R2/R4/R5, finds zero Blocker/Major/Minor/Trivial issues, and records the complete gate replay in `review-report.md` and `verification-report.md`. |
| R14.S4 | Luna ship is a separate leaf | PENDING | Tasks 13.1-13.4 follow task 12.8; no ship leaf has run. |
| R14.S5 | Integration evidence is fresh | PENDING | Tasks 13.5-13.7 follow the child commit; no integrated identity exists. |
| R14.S6 | Archive follows accepted spec sync | PENDING | Tasks 13.8-13.10 follow integrated acceptance/spec sync; no archive identity exists. |

Mechanical coverage: `14/14` requirements and `62/62` scenarios are represented above. Round-3
acceptance is `59 PASS / 0 FAIL / 0 UNVERIFIED` pre-delivery plus `3 PENDING` delivery scenarios.

## Round-2 fixer candidate supplement

The table above remains the authoritative fresh-review verdict. The implementer has executed the
following candidate closures and offers them to a third non-author reviewer; none is self-promoted
to independent PASS.

| Scenario | Fixer candidate status | New exact evidence |
| --- | --- | --- |
| R8.S2 | FIXER-EXECUTED, review pending | `headless-webpack-graph-plugin.test.ts` now sends a complete alias-only producer envelope through the ordinary checker with no `module.resource`; it is rejected. Final Next control/clean graphs `69187000...` / `078b16dd...` use resolved resource roots. |
| R9.S3 | FIXER-EXECUTED, review pending | The same full-envelope control proves an exact request alias cannot masquerade as the unrelated/unresolved entry; plugin matrix `5/5`. |
| R6.S5 | FIXER-EXECUTED, review pending | Final Vite/Next sensitivity controls genuinely exercise every installed timer, RAF, Worker, audio, object URL, Host, WebGPU and WASM hook; the evaluator rejects any installed-but-zero field. Final clean reports independently require every field to be zero. |
| R12.S2 | FIXER-EXECUTED, review pending | Vite control creates a real React root with `createRoot`/`flushSync`, records MutationObserver activity and root-marker growth; Next records exact server-no-DOM hook absence. Fabricated React sensitivity is rejected. |

The final candidate reports are
`raw/vite-r2-react-sensitivity-boundary-final2-20260805.json`,
`raw/vite-r2-headless-clean-boundary-final-20260805.json`,
`raw/next-r2-react-sensitivity-boundary-final-20260805.json`, and
`raw/next-r2-headless-clean-boundary-final-20260805.json`. Cross-Host evaluation binds clean graphs
`6eaf3a78...` / `078b16dd...`; focused tests are `90/0/123`, and full regression is
`480 pass / 8 inherited fail / 2 inherited loader errors / 1,417 expectations`.

The third fresh reviewer accepted all four candidates without new findings. This supplement is
therefore historical fixer evidence; the authoritative table above records the final pre-delivery
state, while R14.S4-R14.S6 remain delivery-owned.
