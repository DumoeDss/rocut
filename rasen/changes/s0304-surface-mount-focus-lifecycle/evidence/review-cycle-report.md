# Review Cycle: s0304-surface-mount-focus-lifecycle

Rounds: **2/3**

Tier: **A (dispatched Codex-native implementation roles; fresh Claude Code non-author Round 2 reviewer)**

Status: **PASS — review loop complete; proceed to local-only ship**

## Role isolation

| Work | Actor | Role | Authorship |
| --- | --- | --- | --- |
| Original implementation and S1/S2/S3/S4/P2/P3 fixes | `/root/r1_implementer_2` | implementer | author |
| P1 design-level fix | `/root/r1_design_fixer` | fixer | author |
| Original review and Round 1 delta re-review | `/root/r1_verify_review` | reviewer | non-author verifier |
| Round 2 final-source closure | `/root/r1_implementer_2` | implementer | author |
| Round 2 delta re-review | fresh Claude Code Opus reviewer | reviewer | non-author verifier |

Author != verifier is preserved. The Round 2 reviewer authored none of the implementation and modified only the two canonical review reports.

The requested `rasen-review` skill was unavailable in this runtime (`Unknown skill: rasen-review`), so the reviewer applied the repository's canonical review-loop method directly and independently rather than relying on implementer self-report.

## Fingerprints and evidence identity

| Identity | Value | Round 2 status |
| --- | --- | --- |
| HEAD | `c5a139662c8411b99570e15b22c7c30662e7864e` | independently read |
| HEAD tree | `5dfed27331bfa52e8e5d07a0010e7d05e7130c68` | independently read |
| Round 1 reviewer fingerprint | `238546b0963aa5c4aa611cebf41c381edef0af6c3c1124269f50fb6b8f19ed24` | prior 43-path state |
| Round 2 final product/checker fingerprint | `2984b222baf7de5670c88209ff63296729af0d372c1c7fda4348a983dc16cf95` | **independently reproduced from 44 serialized records** |
| Serialized receipt size | 44 paths / 5,154 UTF-8 bytes | matched implementation algorithm/list |
| Implementation report | `4d7931eda8d55cdfd76317bd331429fb89c1e0fb4872eb9e6500af644ca92d46` | independently hashed; manifest match |
| Artifact manifest | `5fcc164278edd57388c9b70cb8eff6e52d8ba94611d07f30e20f25da19299b51` | independently hashed |
| Manifest members | 26/26 | independently matched |
| PNG evidence | 14/14 | independently decoded and visually sampled/inspected |
| Final parity report | `637c2866c39d354ef00e3524a09f3c3ac45b0fc76f6d00f732747f877396be50` | independently hashed; authoritative 28/19/9 |

### Fingerprint recomputation method

The reviewer independently applied the serialized algorithm recorded in the implementation report:

1. use the final 44 porcelain-status/path/file-hash records after `.rasen/` exclusion;
2. retain each exact two-character status and bytewise UTF-8 path order;
3. serialize `status<TAB>path<TAB>sha256(file)<LF>`;
4. SHA-256 the resulting bytes.

As a direct check independent of the implementer's claimed digest, the reviewer temporarily materialized those 44 serialized records in an allowed report, hashed the file, and obtained exactly `2984b222baf7de5670c88209ff63296729af0d372c1c7fda4348a983dc16cf95`, then replaced the temporary materialization with the canonical review content. Finding-relevant current files were separately hashed and matched their listed receipt entries.

## Round summary

| Round | Open entering round (B/Ma/Mi/T) | Resolution | Confirmed by | Open leaving round |
| --- | ---: | --- | --- | ---: |
| Initial review | 3/2/2/0 | seven findings entered bounded review loop | `/root/r1_verify_review` | 3/2/2/0 |
| Round 1 delta | 3/2/2/0 | S1 and S3 resolved; P1/P2/S2/P3/S4 rejected | `/root/r1_verify_review` | 2/2/1/0 |
| Round 2 delta | 2/2/1/0 | **P1, P2, S2, P3, S4 all resolved** | fresh Claude Code Opus non-author reviewer | **0/0/0/0** |

Cumulative resolution: **7/7 findings**. Round 2 is below the three-round cap; no escalation is needed.

## Per-finding history

| Finding | Severity | Round 1 status | Round 2 independent confirmation | Final disposition |
| --- | --- | --- | --- | --- |
| S1 — Next target/server mismatch | Blocker | resolved | unchanged; Next still owns/targets isolated `:3017`, no reuse | **RESOLVED R1** |
| S2 — C4 lost full-load synchronization | Major | open | helper requires active plus `!getIsLoading()`; intermediate active/loading state is tested false; current C4 1/1 result postdates final source/build | **RESOLVED R2** |
| S3 — live suspend/resume failure coverage | Minor | resolved | unchanged; final lifecycle suite retains live/stale failure protections | **RESOLVED R1** |
| S4 — stale boundary inventory | Minor | open | `BOUNDARIES.md` now exactly 2,931 total / 630 Web, matching graph evidence | **RESOLVED R2** |
| P1 — action fan-out across sessions | Blocker | open for stale evidence | final test code presses Space in focused secondary real Surface and requires one secondary-only delta; Vite/Next final runs and later parity runs are attributable | **RESOLVED R2** |
| P2 — malformed operation reaches apply | Blocker | open | invariant-backed create validation and exact patch validation; malformed-present matrix covers all 12 kinds; former four empty payloads cannot pass | **RESOLVED R2** |
| P3 — visible remount during pending suspend | Major | open | pending suspend tracked across generation replacement; real session serializes resume; exact race test requires one resume and mounted final state | **RESOLVED R2** |

## Evidence chronology and browser attribution

| Evidence | Final result start/write | Relevant final content | Attribution conclusion |
| --- | --- | --- | --- |
| C4 Next | run starts `2026-08-11T09:46:58.040Z`; 1/1 | helper/probe hashes `d3cc01d3…` / `e1335430…`, after final marked build | **current for S2** |
| Vite Surface | test starts `2026-08-11T09:49:14.373Z`; 2/2 | final `surface.pw.ts` hash `a8f4bd2e…` written before test | **current for P1** |
| Next Surface | test starts `2026-08-11T09:49:48.335Z`; 2/2 | same final browser assertion and final action-source receipt | **current for P1** |
| Vite parity | test starts `2026-08-11T09:50:20.872Z`; 1/1 | after final P1 assertion/source | **current closure regression check** |
| Next parity | test starts `2026-08-11T09:51:24.552Z`; 1/1 | after final P1 assertion/source; isolated `:3017` server | **current closure regression check** |

Both final Surface ledgers are manifest-bound and contain 9 asserted steps, 49 calls, zero Surface/console errors, and final real action state `primary=false`, `secondary=true`. The two-session step's executable test compares the action-call delta and requires only the secondary surface.

The C4 executable test requires Worker round-trip and release, no page errors/rejections, then forced-none graphics state with no GPU work. Both post-load screenshots matched the manifest and visually show the loaded editor/expected unavailable state.

## Mandatory parity-count discrepancy disposition

`spec-falsification-sweep.md:55` says **25 differences / 16 T3 / 9 Host-incidental**, while the final implementation report and generated `parity-comparison.md` say **28 / 19 / 9**.

Final disposition: **accepted-known, non-blocking stale-evidence prose; authoritative final count is 28 / 19 / 9.**

Independent basis:

- the generated final report contains exactly 19 fail-safe semantic rows and 9 incidental rows;
- the three rows absent from the stale sweep sentence are `createdIds` ordinal-order rows inside T3's idempotency result envelope;
- the final implementation report enumerates their concurrent-import ordering cause;
- final snapshot/report hashes and both 1/1 parity results are the later evidence;
- the stale sweep is itself manifest-frozen (`70062a6e…`) and was explicitly forbidden from modification in this review.

This discrepancy is not silently dropped. It must be carried into local ship/archive notes. It does not reopen a product finding because the final 28 rows are enumerated and bounded, while final track membership, clip order, interaction assertions, and reload/reopen equivalence remain asserted. The parity report's documented one-frame classifier blind spot remains a known harness limitation and is not claimed fixed.

## Round 2 independent gates

| Gate | Result |
| --- | --- |
| Relevant source/test inspection | PASS — exact prior failure paths traced in final source and tests |
| Current-file to final-receipt binding | PASS — finding-relevant file hashes match 44-path receipt |
| Worktree fingerprint recomputation | PASS — `2984b222…` |
| Artifact manifest | PASS — 26/26 |
| PNG decode/visual integrity | PASS — 14/14 |
| Surface Vite stored final run | PASS — 2/2, current chronology |
| Surface Next stored final run | PASS — 2/2, owned isolated `:3017`, current chronology |
| C4 stored final run | PASS — 1/1, current chronology |
| Full parity stored final runs | PASS — 1/1 per Host |
| Boundary documentation parity | PASS — 2,931 / 630 / 15 / 2,282 / 4 |
| `git diff --check HEAD` | PASS |
| Fresh focused Bun execution by this reviewer | **Not executed** — the tool requested explicit permission for each `bun test` invocation and permission was not granted. The reviewer does not claim a fresh test run; the hash-bound final ledger records 37/0/172 across 8 files. |

The fresh-run limitation is explicit. Closure rests on independent code-path proof plus hash-bound, current, executable browser/runtime artifacts—not on implementer claims alone.

## Exact final counts

| Axis | Blocker | Major | Minor | Trivial | Total | Worst |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Standards open | 0 | 0 | 0 | 0 | 0 | None |
| Spec open | 0 | 0 | 0 | 0 | 0 | None |
| **Overall open** | **0** | **0** | **0** | **0** | **0** | **None** |

Round 2 resolved: **5/5** entering findings.

Whole loop resolved: **7/7** findings.

## Ship decision

**PASS. R1 may proceed to local-only ship.**

Ship/archive must preserve the explicit parity-count reconciliation: final authoritative evidence is **28 / 19 / 9**, while `spec-falsification-sweep.md:55` is stale at **25 / 16 / 9**. No remote push, PR, or publication is authorized by this report.

## Durable findings for later child planning

1. Bind browser chronology to final source/test hashes; a correct ledger produced before final code is not closure evidence.
2. Treat 28 / 19 / 9 as the authoritative parity count and preserve the stale-sweep reconciliation through archive.
3. Lifecycle remount reconciliation must include in-flight session transitions, not only the currently published session state.

## Canonical reports

- `evidence/review-report.md`
- `evidence/review-cycle-report.md`
