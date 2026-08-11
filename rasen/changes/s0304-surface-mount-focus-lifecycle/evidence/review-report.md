# R1 Round 2 independent delta re-review

Date: 2026-08-11

Mode: report-only, fresh non-author reviewer, one-shot

Change: `s0304-surface-mount-focus-lifecycle`

Verdict: **PASS — all 5 Round 1 findings are resolved (2 Blocker, 2 Major, 1 Minor); 0 findings remain open. R1 may proceed to local-only ship.**

## Reviewer isolation

The Round 2 implementation was authored by `/root/r1_implementer_2` (with the earlier P1 design fix authored by `/root/r1_design_fixer`). This review was performed by a fresh Claude Code Opus reviewer who authored none of the implementation. No product code, test, evidence input, run-state, git index, commit, or branch was modified. Only this report and `review-cycle-report.md` were updated.

The requested `rasen-review` skill was not registered in this runtime (`Unknown skill: rasen-review`), so the review used the repository's canonical review-loop method directly: read prior reports and run-state; inspect each source/test/evidence chain independently; adversarially test the prior failure mechanism; verify attribution, chronology, hashes, and worktree identity; then update the two canonical reports.

## Exact identity and evidence integrity

- Branch: `recovery/s0304-ui-commit-routing-final`
- HEAD: `c5a139662c8411b99570e15b22c7c30662e7864e`
- HEAD tree: `5dfed27331bfa52e8e5d07a0010e7d05e7130c68`
- Final product/checker fingerprint: **`2984b222baf7de5670c88209ff63296729af0d372c1c7fda4348a983dc16cf95`**.
- Independent fingerprint recomputation: the reviewer copied the implementation report's 44 already-path-sorted `status<TAB>path<TAB>sha256(file)<LF>` records byte-for-byte into a temporary form of this allowed report and independently SHA-256 hashed it. The result was exactly `2984b222…`; the record count is 44 and the implementation report records 5,154 UTF-8 bytes. The reviewer then replaced the temporary serialization with this report.
- Independent current hashes of all finding-relevant product/test files matched the corresponding entries in that 44-path receipt, including `registry.ts` (`a9a8c602…`), `surface.pw.ts` (`a8f4bd2e…`), `surface-transaction-binding.ts` (`ee39fd44…`), `surface-lifecycle.ts` (`62b89f4e…`), `c4-project-load.ts` (`d3cc01d3…`), `c4-next-runtime-probe.tsx` (`e1335430…`), the three focused test files, and `BOUNDARIES.md` (`7965ce86…`).
- Artifact manifest SHA-256: **`5fcc164278edd57388c9b70cb8eff6e52d8ba94611d07f30e20f25da19299b51`**.
- Manifest verification: **26/26 entries matched**. The reviewer independently hashed every manifest member (browser results, ledgers, measurements, disposal reports, 14 PNGs, implementation report, parity report, and falsification sweep); no mismatch was found.
- PNG integrity: **14/14 decoded successfully** through the image reader. Visual inspection covered both C4 post-load captures, both focus matrices, and the remaining Vite/Next lifecycle/disposal captures; no contradictory or corrupt frame was found. The two C4 full-page captures are larger than the ordinary 1600×1000 Surface captures as expected.
- `git diff --check HEAD`: **PASS** (no output).

## Round 2 disposition

| Finding | Prior severity | Round 2 disposition | Independent proof |
| --- | --- | --- | --- |
| P1 | Blocker | **RESOLVED** | Final-hash-bound Vite and Next runs each prove effectful secondary-only dispatch after the final browser assertion and action-scope source |
| P2 | Blocker | **RESOLVED** | Every operation kind now receives authoritative structural validation; malformed-present tests cover all 12 kinds and the former four empty entity payloads cannot pass |
| S2 | Major | **RESOLVED** | C4 gates on active project **and** `!getIsLoading()`; delayed-state test proves the intermediate active/loading state stays blocked; final-source C4 run is current |
| P3 | Major | **RESOLVED** | A session being suspended is tracked across generation replacement, causing visible remount to queue exactly one resume behind the suspend |
| S4 | Minor | **RESOLVED** | `BOUNDARIES.md` now records 2,931 total / 630 Web, matching the final emitted graph and checker evidence |

## Per-finding proof

### P1 — RESOLVED — attributable effectful dual-Host evidence

The final action registry remains correctly scope-selective: `registry.ts:29-49` separates an unscoped legacy bucket from weakly keyed scoped buckets; `registry.ts:107-135` selects only the explicit/inherited scope, snapshots handlers, and restores inherited scope in `finally`. `registry.test.ts:10-109` independently covers selected-owner dispatch, legacy isolation, scope-local unbind, and nested inheritance.

The decisive Round 2 browser assertion is executable rather than narrative. `surface.pw.ts:493-550` mounts two real sessions, focuses the secondary root, snapshots both real playback states and the action-call count, presses Space, waits for exactly one additional toggle, and requires the delta's surface list to equal only `["secondary"]`, with primary still false and secondary true.

Attribution is now adequate:

- relevant P1 product source was stable before the final evidence;
- the final `surface.pw.ts` write/hash (`a8f4bd2e…`) precedes the stored Vite test start `2026-08-11T09:49:14.373Z` and Next test start `2026-08-11T09:49:48.335Z`;
- Vite Surface result `fdf11493…`: 2 expected, 0 unexpected, 0 flaky;
- Next Surface result `ec7f4cfb…`: 2 expected, 0 unexpected, 0 flaky, isolated owned server at `127.0.0.1:3017`, `reuseExistingServer: false`, placeholder-only environment;
- both final ledgers have 9 asserted steps, 49 calls, zero Surface/console errors, final `primaryPlaying=false`, `secondaryPlaying=true`, and exactly one secondary playback toggle in the two-session delta;
- both final full-parity runs occurred later (Vite starts `09:50:20.872Z`, Next starts `09:51:24.552Z`) and each reports 1 expected / 0 unexpected.

This closes the Round 1 attribution defect; it does not rely on the implementer's assertion alone.

### P2 — RESOLVED — malformed present payloads are rejected before apply

`surface-transaction-binding.ts:8-13,48-129,131-182` now delegates entity validation to the transaction engine's authoritative invariants and validates patches by an exact own-key allowlist plus invariant-backed synthetic base objects. Create-track and create-asset additionally require a primitive string discriminator before calling invariants, avoiding coercion-based acceptance. IDs are non-empty; expected revision is a non-negative integer; idempotency key is non-empty.

The prior diagnostic's four inputs (`track: {}`, `clip: {}`, `asset: {}`, `marker: {}`) now fail respectively at `isValidTrack`, `isValidClip`, `isValidAsset`, and `isValidMarker`, so none can reach `apply`.

`surface-transaction-binding.test.ts:26-121,188-279` supplies malformed-present payload/patch cases for **all 12 operation kinds**, requires zero applies and one `SurfaceCommitAdapterError` per case, then supplies authoritative minimal valid forms for all kinds and requires exactly one apply. Adversarial inspection also confirmed unsupported patch keys, accessor/non-enumerable/symbol keys, non-primitive discriminators, invalid finite/integer/range values, and empty project patches are rejected.

### S2 — RESOLVED — C4 waits for full load and evidence is current

`c4-project-load.ts:1-10` defines completion as both a non-null active project and `!editor.project.getIsLoading()`. `c4-next-runtime-probe.tsx:22-29,140-144` subscribes through `useEditor(isC4ProjectLoadComplete)`, does not start its effect while false, and exposes `starting` until true.

`surface-composition.test.ts:97-126` models the exact Round 1 counterexample: loading starts true; publishing an active object alone remains false; only changing loading to false makes the gate true. This proves the helper blocks the interval after active publication but before `ProjectManager.loadProject`'s final loading publication.

The current C4 result hash is `a78c0194…`, and the run starts `2026-08-11T09:46:58.040Z`, after the final helper/probe writes and marked production build. It reports 1 expected / 0 unexpected. Its executable assertions require Worker pong/transfer, created=1/released=1, no page errors/rejections, forced-none rasterizer/backend/limit/reason/source, mounted session, both unavailable presentations, null render tree/handle, and zero GPU work. Both post-load PNGs match the manifest and visually show a loaded editor with the expected renderer-unavailable state.

### P3 — RESOLVED — in-flight suspend is reconciled on visible remount

`surface-lifecycle.ts:39-40,60-100,154-171` tracks sessions with an in-flight suspend in a `WeakSet`. It inserts before awaiting `session.suspend()` and removes in `finally`. A replacement mount therefore seeds as hidden if either the session is already suspended **or** the prior suspend is still pending. The component's initial visible publication changes desired visibility and queues one resume.

The real session contract independently supports this ordering: `create-session.ts:186-193` serializes transitions; `suspend()` synchronously sets `suspendRequested` before enqueueing; `resume()` accepts either suspended state or a pending suspend and queues behind it, then resumes only after the suspend has published `state="suspended"` (`create-session.ts:256-300`).

`surface-lifecycle.test.ts:288-329` reproduces the exact former race: hidden, suspend pending, cleanup, visible remount, then settle suspend and resume. It requires one suspend, one resume, final mounted state, one first-generation unmount, no disposal, and no errors. Static adversarial tracing confirms the old generation's reconciliation cannot publish errors into the replacement, while the session-owned queued resume remains valid.

### S4 — RESOLVED — boundary inventory matches the graph

`BOUNDARIES.md:45-48` now says **2,931 modules**, including **630 from `apps/web/src`**, 15 example Host, 2,282 dependencies, and 4 other/Vite modules. This exactly matches the final Vite emitted-graph result recorded by the boundary gate, with all ten exclusions passing. The document hash `7965ce86…` matches the final 44-path receipt.

## Mandatory 25/16/9 versus 28/19/9 discrepancy

**Disposition: accepted-known, non-blocking evidence-documentation discrepancy; authoritative final count is 28 / 19 / 9.**

`spec-falsification-sweep.md:55` still says 25 differences / 16 T3 / 9 Host-incidental. That sentence describes an earlier parity output and was not regenerated after the final-source parity rerun. It is demonstrably stale because:

1. `parity-comparison.md:14` is the generated final report and says **28 differences: 19 semantic, 9 incidental**.
2. Its semantic table contains 19 rows: 16 key/fingerprint rows plus three `createdIds` ordinal-order rows; its incidental table contains 9 rows.
3. `implementation-report.md:119` explicitly accounts for the three added rows as created-ID ordinal ordering caused by concurrent imports and records final snapshot/report hashes.
4. The final parity report hash `637c2866…`, final snapshot hashes, and both final 1/1 browser results are later/current artifacts; the stale sweep is itself hash-frozen as `70062a6e…` and could not be edited in this review.
5. The difference is classification/report chronology, not a product-state regression: final track membership, clip order, edit assertions, and reload/reopen equivalence remain asserted; the generated report itself warns that its 19 rows are fail-safe “semantic” rows and does not automatically confer a pass.

The discrepancy must remain visible to later planning and archive readers. It does **not** reopen a Round 1 product finding because the final authoritative artifacts are internally consistent at 28 / 19 / 9 and the extra three rows are explicitly enumerated and bounded to T3's opaque idempotency result envelope.

## Independent gates and audited final results

| Gate | Result |
| --- | --- |
| Finding-relevant source/test hash binding | **PASS** — all independently hashed files match the 44-path receipt |
| 44-path serialized fingerprint | **PASS** — independently reproduced `2984b222…` |
| Artifact manifest | **PASS** — 26/26 hashes matched; manifest `5fcc1642…` |
| PNG integrity/visual audit | **PASS** — 14/14 decoded; no contradiction found |
| P1 dual-Host executable assertion | **PASS (audited final runs)** — Vite 2/2, Next 2/2; secondary-only effect; 49 calls/Host; zero ledger/console errors |
| Full parity | **PASS scenarios (audited final runs)** — Vite 1/1, Next 1/1; authoritative report 28/19/9 with known classification limits |
| C4 full-load runtime | **PASS (audited final run)** — 1/1; Worker release and forced-none assertions; current chronology |
| P2 adversarial source/test trace | **PASS** — former 4/4 malformed inputs rejected; all-kind malformed/valid matrices present |
| P3 adversarial transition trace | **PASS** — pending suspend is observed and exactly one serialized resume is queued |
| Boundary documentation parity | **PASS** — 2,931 / 630 / 15 / 2,282 / 4 |
| `git diff --check HEAD` | **PASS** |
| Fresh Bun focused suite in this reviewer invocation | **NOT EXECUTED** — the harness requested explicit permission for every `bun test` form and permission was not granted; no passing claim is fabricated. Final test artifacts/source were independently inspected, and the hash-bound implementation ledger records 37/0/172 across 8 files. |

The inability to launch a fresh Bun process is recorded as a verification limitation, not silently converted into success. It does not defeat closure here because each prior failure mechanism is directly decidable from final source and protected tests, the relevant files match the independently reproduced final receipt, and the effectful browser/runtime requirements are backed by current hash-matched artifacts whose result bodies were independently audited.

## Final counts and ship decision

| Axis | Blocker | Major | Minor | Trivial | Total | Worst |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Standards open | 0 | 0 | 0 | 0 | 0 | None |
| Spec open | 0 | 0 | 0 | 0 | 0 | None |
| **Overall open** | **0** | **0** | **0** | **0** | **0** | **None** |

Round 2 resolved **5/5** still-open Round 1 findings. Cumulatively, the bounded review loop resolved **7/7** findings (S1 and S3 in Round 1; P1, P2, S2, P3, and S4 in Round 2).

**Final verdict: PASS. R1 may proceed to local-only ship.** The accepted-known falsification-sweep count discrepancy must remain called out during local ship/archive, and no claim is made that the final parity classifier's documented one-frame blind spot has been repaired.

## Durable findings for later child planning

1. Evidence chronology must bind browser results to final source/test hashes; manifest integrity alone is insufficient.
2. Keep the authoritative parity count at **28 / 19 / 9**; `spec-falsification-sweep.md:55` is a frozen stale 25 / 16 / 9 statement, not the final result.
3. A visible remount must account for both settled suspension and `suspendRequested`/in-flight suspension; session-owned transition serialization is the correctness seam.
