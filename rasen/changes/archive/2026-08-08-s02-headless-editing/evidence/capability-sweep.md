# C7 capability sweep

Date: 2026-08-05 (Asia/Shanghai)

## Fourteen inherited capabilities — falsification direction

| Main capability | Concrete C7 falsification edge | Executed regression / status |
| --- | --- | --- |
| browser-persistence-boundary | proof Host or headless seam leaks an in-memory fallback into production, or migration extraction loses opaque/durable data | storage boundary and negative controls; C5 `67/67`; both ordinary Chrome oracles report `BrowserProjectStore`; PASS |
| developer-reproducibility | conditional Next instrumentation hijacks default compiler, env setup is implicit, or Vite output is stale | fresh ordinary Vite; default Next explicitly Turbopack `19/19`; nine schema names documented with no values; build-before-type; PASS |
| editing-parity-fixture | shared migration extraction changes full editor lifecycle or persisted semantics | protected parity tree exact; shared migration and full lifecycle matrices; full Bun identity unchanged; heavyweight two-Host parity browser oracle not replayed, so that supplemental leaf remains pending |
| editor-session-runtime | headless factory duplicates migration/session ownership or changes full create/dispose ordering | direct four-pair migration matrix `6/6`; C6 lifecycle matrix `50/50`; session-state and singleton gates; PASS |
| host-port-contract | headless public surface imports `TProject` schema or accepts a partial/fallback Host | project type derived from coordinator; port boundary `50` modules and negatives; complete Host tests; PASS |
| host-service-boundary | new adapter bypasses Host assets/runtime/store roles | Host composition, runtime asset source, emitted inventory, C4 Host matrix `49/49`; PASS |
| inherited-defect-repair | new diagnostic/failure is hidden inside accepted baseline noise | type baseline exactly three; full Bun exactly inherited `8 fail / 2 errors`, plus 40 new passes; PASS |
| next-free-distributable-boundary | C7 Vite path accidentally imports Next/site code | fresh ordinary Vite graph `2,893` modules; all ten distributable exclusions PASS; dedicated Vite headless closure `12` modules; PASS |
| runtime-asset-delivery | build config drops Worker/WASM/ORT/assets or serves them under the wrong base | asset manifest `298` copied + `7` emitted; cross-Host emitted gate; real browser execution under mounted bases; PASS |
| self-built-wasm-artifact | proof-only Webpack uses a stub/alternate binary or generated artifact drifts | mirrored bytes match protected SHA-256; `check:wasm` and path/license/wiring checks PASS; PASS |
| session-resource-disposal | headless owner creates a resource, or migration edit changes full-session drain/leak polarity | headless resource counts all zero; resource boundary `720/266`; C6 unit and both ordinary 18-cycle oracles; PASS |
| session-state-isolation | moved migration `WeakMap` becomes unclassified/default state or one headless owner poisons another | ownership fixture moved to exact module; state gate `10/10`, `52` modules; distinct/same-store headless tests; PASS |
| upstream-provenance | new generated/reference/license drift or protected path mutation | reference/license gate; protected hashes exact; strict validation; old untracked C6 Vite provenance anchor unavailable and explicitly not claimed |
| wasm-api-surface | proof compiler or headless code changes generated exports/imports/providers | exact `38/58/609` API gate and all negatives PASS; protected Rust/generated identities exact; PASS |

## C7 delta — realization direction

The delta mechanically contains `14` requirements and `62` scenarios. Each row below accounts for the scenarios under that requirement; it does not convert later workflow stages into implementation passes.

| Requirement / scenario count | Executed realization evidence | Status |
| --- | --- | --- |
| Provider-private data lifecycle / 4 | `headless-session.test.ts`, exact surface keys, no mount/transaction/revision/draft methods, complete Host resolution | PASS |
| Save, disposal, reopen / 5 | semantic fixture plus independent Vite/Next runtime JSON; real edit/save/new owner/reopen/absence/mismatch | PASS |
| One shared migration gate / 5 | direct `6/6` full/headless pairing, distinct-store, failure/retry matrix; full factory re-export compatibility | PASS |
| Non-browser store only / 3 | throwing browser sentinels, in-memory Host/store identity, graph forbids browser store, zero fallback | PASS |
| Opaque data and attachments / 4 | stable provider/attachment metadata/body digests in unit plus both Host runtime records | PASS |
| Serialized terminal resource-free ownership / 5 | save retry/ordering, concurrent stable disposal, post-dispose no-I/O, second-owner isolation, zero C6 acquisitions | PASS |
| Dedicated Vite artifact / 4 | control then clean2 build, exact 12-module closure, real Chrome result, PID/port/profile cleanup | PASS |
| Dedicated Next per-entry artifact / 5 | explicit proof-only Webpack exact entry, 13-module closure, HTTP 200 JSON execution, independent build/process, ordinary Turbopack unchanged | PASS |
| Real implementation in emitted closure / 4 | ten required roots plus exact application root, non-empty/chunk/file/digest anti-vacuity and copied-Host rejection | PASS |
| Mechanical React absence / 4 | clean closures zero forbidden only after integrity passes; normalization/raw IDs; full-editor/browser composition forbidden; stable JSON rules | PASS |
| Same-path React sensitivity / 4 | valid Vite and Next React-injected builds exit 0; ordinary checker exits 1 for `forbidden.react-family`; controls never promoted | PASS |
| Truthful independent runtime / 4 | owned-process harnesses, zero unhandled observations, cross-Host evaluator rejects copied graph/result and incomplete cleanup | PASS |
| C3-C6 and ordinary Hosts / 5 | C4/C5/C6 matrices, fresh ordinary builds, emitted/assets/static/type/full suite, both production Chrome oracles | PASS, with heavyweight editing-parity/C3 standalone browser replay retained for independent verification |
| Distinct verification/delivery stages / 6 | capability sweep and planning/execution separation are satisfied; no product commit/integration/archive occurred | 2 implementation scenarios PASS; independent Sol review, Luna ship, LEAD integration, and separate Luna archive remain intentionally PENDING |

## Verdict

All 56 product/runtime/control/regression scenarios outside the six-stage workflow requirement have an executed evidence route. Within the final six, the corpus sweep and planning/execution separation are realized; the four review/delivery/integration/archive scenarios remain open in their mandated order. No later-stage checkbox or pass claim is pre-populated.

## Round-1 remediation supplement

`scenario-realization-map.md` now enumerates every scenario individually (`62` rows / `62` unique
IDs). The final post-format Vite and Next clean closures contain `14` and `15` modules respectively,
and their pre-load runtime probes replace the earlier literal zero/fallback claims. Both protected
editing-parity Host jobs have been replayed and pass. C3 WebGL passes; accepted-base and current
WebGPU jobs reproduce the same inherited migration-observation race, so the C7 delta introduces no
new backend/resource failure identity. Full Bun is now the prior `430/8/2` identity plus `12` new
passes: `442/8/2`, with no new red identity.

Round-1 non-author review has occurred and all accepted product/tool fixes are implemented, but the
independent-review scenario remains `PENDING` until a fresh non-author Sol re-review accepts the
post-fix delta. Luna ship, LEAD integration, and separate Luna archive remain pending in order.
