# Luna-max Phase 6 implementer evaluation

Date: 2026-08-04 +08:00  
Evaluator: fresh non-author Sol reviewer (`/root/c5_phase6_sol_eval`)  
Implementer: Luna-max (`/root/c5_phase6_luna_max`)  
Status: **DONE — CLEAN (0 Blocker / 0 Major / 0 Minor / 0 Trivial)**  
Provisional Phase 6 signal: **mixed, with the post-fix tree CLEAN**

This is a Phase 6 implementer signal only. It is not the final decision on whether
Luna can replace Sol; that decision remains reserved for the post-C6 synthesis over
C5 Phase 6, C5 Phase 7, and C6.

## Reviewed fingerprint and scope

The review used the dirty product worktree
`E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5` and the
planning/evidence root
`E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`.

| File | SHA-256 |
|---|---|
| `AGENTS.md` | `4A944957914A49879B0053CBCE43697115B265AF3AA80C6C41C6988027638918` |
| `handoff/final-parity-sidecar-design.md` | `FD0C62FFA4BA8F8C9C6137E9C654C2E6C4778A876581C893FDFCE74363C64836` |
| `evidence/final-parity-sidecar-topology-chromium.md` | `07F7302BDC8AF79B815B3439F62760DBBB807F23D0D8F1103CD6F2510BFF0A9A` |
| `.rasen/changes/s02-storage-port/ephemera/auto-run.json` | `B23D0EF9020369D24D586F047A020F79884820501769323EA0FF688E4F0C8E07` |
| `apps/web/src/services/storage/browser-project-store-cascade-round2-probes.ts` | `885BFFA9787C00581D1AF676138462CA7CCDF0A1B90FDF4B010DAD741B2D0776` |
| `apps/web/src/services/storage/browser-storage-mechanisms.ts` | `37C56911F36D84E08D02D5B2E2B2637A97A46DA73793E0FE4DCBF3581F391164` |
| `apps/web/src/services/storage/browser-project-store.ts` | `BB408081975013AC9E1A28CC5870BBBF49C21D6DF6475304F6158DBADAB16703` |
| `apps/web/src/services/storage/browser-project-store-cascade-manager.ts` | `8CAEED69F21A5FE51547FAAAA600C81B0CE05B25E91A4DDB98239D37FD50030E` |
| `apps/vite-example/src/c5-storage-harness.ts` | `14DD6DDDE3A1F6684D36493A942D490158F248E0442D8BBBF092D912A289AA46` |
| `apps/vite-example/tests/c5-storage/browser-store.pw.ts` | `7E4B353DD96CC9DC0E92059511AB8DABFC6B416E0FDAD0FDE1D8A43A1EEDA0E2` |
| `apps/web/src/services/storage/__tests__/browser-project-store-cascade-topology.test.ts` | `DFF5CE20AEBBAC48150893CD80B45BC79F8F3377721BAAFE7B650713A3ABC6F7` |

The frozen post-fix probe is 103,432 bytes and has Git blob
`3309c752768d8c347e8a2c2455b78de339a708a6`. The pre-remediation fingerprint
reviewed in the first pass was SHA-256
`206463DE7FBD672EF16F01D8298CF6C5CDB3B6D67F408F0FE287515847ED56F7`
(Git blob `0cb4d00eab28dee152de65eaaef6489fb04d5000`, 92,221 bytes). It is untracked in the
long-lived dirty C5 worktree, so Git cannot independently reconstruct a Phase 5
versus Phase 6 hunk. Phase attribution instead comes from the recorded runstate,
the author evidence, and inspection of the current file. Those sources agree that
the Phase 6 author touched only this existing probe module. I found no Phase 6
product persistence, Host, public port, Phase 7, or parity-oracle change. The many
other dirty worktree files predate this leaf and are not attributed to Luna Phase 6.

## First return versus final author return

### First return

- Correctly ran the unedited selector first: 1/1, store 19/0/0,
  `cascadeRound2` 33/33, and empty inventories. Correctly classified that as an
  **evidence-gap RED**, not a product defect: real Chromium did not yet enumerate
  the reserved `authority` pair and did not observe physical attachment-sidecar
  IDB/OPFS access.
- Added the missing `authority` reserved-pair case and a three-channel sensitivity
  control. The first strengthened assertion required zero opens of the aliased
  projects database and failed with the legitimate observation `2/0/0`. Narrowing
  only that overbroad open-count clause was correct: shared project/cascade reads
  may open the database, while sidecar transaction count, OPFS access, DB
  version/store shape, and target-directory absence remain the meaningful gate.
- The first return was **not complete**. Luna claimed verification/evidence
  complete without running the required ESLint gate. LEAD then ran it and found
  exactly two new `@typescript-eslint/no-unsafe-type-assertion` errors at the
  prototype and `Reflect.apply` result casts.

### Final author return before independent review

- Luna fixed both lint sites within its own run: the storage prototype is now
  guarded as `unknown`, and the reflected transaction result is checked with
  `instanceof IDBTransaction`.
- Luna amended the author evidence and reran final lint/type/format/focused/full
  gates. My independent reruns confirm those ordinary paths are green.
- That author return was nevertheless **not contract-complete** because the
  required fail-safe descriptor restoration still had the exception path found by
  the first independent review.

### Post-review Luna remediation

- Luna changed only the same probe module. It moved the cleanup guard ahead of the
  first prototype mutation, records only successful installations, skips the
  action after an incomplete installation, restores each installed descriptor
  independently, retries one-shot restoration failures, and compares the complete
  effective descriptor including method identity.
- It preserves primary and cleanup failures in primary-first order, using the
  original error when only one exists and `AggregateError` when more than one
  exists.
- It added real-Chromium one-shot fault controls for install positions 1/2/3 and
  restore positions 1/2/3. The entire six-case matrix runs once for load and once
  for save; after every case the probe proves descriptor identity restoration and
  successfully reruns sensitivity plus the normal forbidden action.
- This re-review independently reproduced the 12 fault traces and closes the
  original Major.

## Phase 6 requirement assessment

| Requirement | First return | Post-fix current tree | Independent assessment |
|---|---:|---:|---|
| All reserved project-store pairs, including `authority`, reject atomically; safe same-project DB library store works | Complete | Complete | All six canonical pairs are seeded and retained; Chromium and full matrix pass. |
| Aliased media DB performs no attachment public/authority transaction, schema/store creation, or OPFS-root access before permit for load and save | Complete | Complete | `sensitivity=1/1/1` versus action `observed=2/0/0`; DB version/store names unchanged and target directory absent. |
| Physical observation non-vacuous; allowed opens cannot hide sidecar I/O; descriptor restoration fail-safe | Partial | **Complete** | Cleanup is guarded before the first mutation; partial installs never run the action; all installed descriptors receive independent restore attempts plus one-shot retry and exact identity verification. Real Chromium covers all 12 load/save fault cases. |
| Focused/full Chromium finish with empty disposable inventories and no port/process leakage | Complete | Complete | Independently reproduced. |
| No product/Host/Phase 7/parity scope change | Complete | Complete | No Phase 6 evidence of such a change; protected hashes match. |

## RED/GREEN and negative-control quality

The RED/GREEN reasoning is strong apart from descriptor failure handling.

- The pre-edit green selector was honestly treated as a RED evidence gap.
- The `authority` sentinel is not a name-only assertion: every canonical store is
  physically seeded, the attempted library claim must fail as `unavailable`, and
  every sentinel must survive.
- The safe shared-database control exercises both `projects` and `all` clear
  scopes while preserving or removing the distinct library store as specified.
- The sensitivity control uses the exact same observer and deliberately triggers
  one target DB open, one absent-authority transaction attempt, and one OPFS-root
  call. Both load/save actions then report `2/0/0`. This prevents a dead observer
  from making the zero sidecar/OPFS assertions vacuously green.
- The action also snapshots DB version and sorted `objectStoreNames` before and
  after, checks both media public and authority stores were initially absent, and
  proves the target OPFS directory absent. Legitimate project/cascade opens cannot
  conceal an upgrade, sidecar transaction, or OPFS-root access.
- Queue exposure is bounded by the serial harness: initialization and project seed
  complete before the observation window, and each observation restores before
  the next ordinary action on the successful path. A concurrent unrelated OPFS
  root call would cause a false failure, not a false green.
- `cleanupProof` now includes two instrumentation trace strings as well as fixture
  identities. This is not a false cleanup result: `withTopologyFixture` must await
  its cleanup `finally` before returning, and the outer real-browser inventory is
  empty before and after. The mixed-content array is best understood as a proof/
  diagnostic log; I do not classify it as a severity finding.

## Findings and fix closure

### Closed Major — descriptor installation/restoration was not fail-safe

Location on the pre-remediation fingerprint:
`apps/web/src/services/storage/browser-project-store-cascade-round2-probes.ts:509`
through `:571` (`observeForbiddenMediaAccess`).

Reproduction by control flow:

1. The probe replaces `IDBFactory.prototype.open` at line 509,
   `IDBDatabase.prototype.transaction` at line 522, and the storage prototype's
   `getDirectory` at line 548.
2. The only `try/finally` begins at line 558, after all three installations.
   Therefore, if installation 2 or 3 throws, the earlier successful replacements
   bypass the restoration block and remain globally installed.
3. Restoration itself is three sequential `Object.defineProperty` calls at lines
   561-570. If restoration 1 or 2 throws, later descriptors are not even attempted.
4. `isolateTopologyProbe` catches the resulting probe error and continues, so a
   leaked wrapper can taint later topology probes, counters, and browser-global
   behavior rather than reliably stopping on a clean environment.

Original impact: this was an evidence/probe correctness defect, not a demonstrated
product persistence defect. It missed the accepted Phase 6 requirement that
descriptor restoration be fail-safe and made exception-path isolation unsafe.

Minimal acceptance gate:

1. Put installation under an outer cleanup guard that is active before the first
   prototype mutation; track exactly which descriptors were successfully changed,
   and never execute the observed action after an incomplete installation.
2. Restore every successfully changed descriptor with independent best-effort
   attempts. A restore exception must not prevent attempts for the other two;
   after the first sweep, retry one-shot failed restorations (or otherwise prove
   all three originals are restored), then rethrow/preserve the primary and
   cleanup failures without silently swallowing either.
3. Add real-Chromium fault controls that make `Object.defineProperty` throw once
   at each partial-install position and once at each restoration position. After
   every case, compare the effective descriptors/method identities for
   `IDBFactory.prototype.open`, `IDBDatabase.prototype.transaction`, and the
   storage prototype's `getDirectory` to the originals, prove no wrapper remains,
   and run a subsequent sensitivity/action observation successfully.
4. Rerun ESLint, Prettier, exact-three type baseline, the focused selector, and
   the full C5 config with clean inventories and process/port hygiene.

**Closure:** all four acceptance items are implemented and independently verified
on probe SHA-256
`885BFFA9787C00581D1AF676138462CA7CCDF0A1B90FDF4B010DAD741B2D0776`.
The original Major is closed. The final severity verdict is **CLEAN — 0 Blocker /
0 Major / 0 Minor / 0 Trivial**. No fix was applied by this reviewer.

## Independent remediation re-review

The frozen one-file remediation closes each element of the original acceptance
gate:

| Accepted condition | Current evidence |
|---|---|
| Cleanup guard exists before the first mutation | The guarded `try` begins at current line 615; the first descriptor mutation is inside its loop at lines 618-624. |
| No action after an incomplete install | A descriptor is appended only after a successful define at line 625. Any thrown install transfers directly to the catch at lines 631-632; `args.run()` is reachable only after the full loop and length check at lines 627-630. |
| Independent best-effort restore of every successful install | `restoreInstalledDescriptors` iterates the successful-install list, catches each restore separately, and continues through all entries at lines 649-670. |
| One-shot retry or equivalent | The snapshot of first-sweep failures is retried once independently at lines 671-688. Final descriptor validation still records a cleanup error if either sweep leaves any mismatch. |
| Exact descriptor and method identity | `samePropertyDescriptor` compares configurable/enumerable/writable plus exact `value`, `get`, and `set` identities at lines 732-744. Both cleanup and the real-browser control use this comparison. |
| Primary and cleanup errors preserved | The primary value is captured before cleanup; `throwObserverErrors` emits the sole original value unchanged or constructs `AggregateError` with primary first and every cleanup failure following at lines 747-756. In-scope browser and descriptor failures are `Error`/`DOMException` values, so the `null` sentinel does not overlap an expected failure value. |
| Install/restore positions 1/2/3 for load and save | `runDescriptorFaultControls` declares all six plans at lines 825-832 and is called inside the two-operation load/save loop. The fault is one-shot, descriptor state is compared after each case, and a fresh sensitivity plus normal action must pass at lines 834-940. |

The independent focused run emitted exactly these 12 traces: install/1, install/2,
install/3, restore/1, restore/2, and restore/3 for load, followed by the same six
for save. Every trace was
`fired=true:restored=true:subsequent=true`. Each operation then emitted
`sensitivity=1/1/1:observed=2/0/0`. Thus the controls demonstrate not only that a
fault was injected, but that the exact global descriptors were restored and that
the next observer remained sensitive while the forbidden action stayed clean.

The evaluation artifact was scanned as UTF-8 for common mojibake/replacement
sequences; none was present, so no encoding rewrite was necessary.

## Independently reproduced commands

| Command/gate | Result |
|---|---|
| `bun x eslint apps/web/src/services/storage/browser-project-store-cascade-round2-probes.ts` | exit 0; only existing missing-pages notice |
| `bun x prettier --check apps/web/src/services/storage/browser-project-store-cascade-round2-probes.ts` | exit 0; all matched files formatted |
| `git diff --check` | exit 0; CRLF conversion notices only |
| `git diff --no-index --check -- /dev/null <probe>` | expected diff exit 1; no whitespace-error output (probe is untracked) |
| `node script/check-type-baseline.mjs` | PASS; exact 3 diagnostics, none outside pinned set |
| `bun test .../browser-project-store-cascade-topology.test.ts` | 7 pass / 0 fail / 48 assertions |
| Exact focused shared Chromium selector after proving 4175 clear | 1 pass in 21.3s; Chromium 151; all 12 fault traces true; store 19/0/0; migrationRound2 30/30; cascadeRound2 33/33; lifecycle 16/0; load/save `1/1/1 -> 2/0/0`; inventories `[]/[] -> []/[]` |
| `bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts` after proving 4175 clear | 5 pass / 0 fail in 1.2m; all 12 fault traces true; inventories empty |
| Post-run ports/processes | 4175, 4177, 43551, 43552 clear; no `node.exe`/`bun.exe` command line containing `rocut-wt-c5` |
| Protected parity sources | status/diff clean; tree `e1fbb55b985f4fb490c6b233d18c50c58ea14c28`; oracle `fa387ebea1e7f0cc1110eebcb922d393a1337842` |

The focused and full runs independently exercise the ordinary instrumentation
path and every partial-install/one-shot-restore fault position for both load and
save.

## Gate pass rate

For a transparent implementer metric, I count 18 named Phase 6 command/evidence
gates: the eight focused unit groups in the accepted handoff, three boundary/
static scripts, exact-three type, ESLint, Prettier, diff-check, focused Chromium,
full Chromium, and protected-hash plus hygiene proof.

- **First return: 17/18 = 94.4%.** The omitted ESLint gate is counted as failed,
  not skipped; when LEAD ran it, it found exactly two new errors.
- **Pre-review final author return: 18/18 = 100% mechanical command gates**, but
  only 4/5 contract requirements because fail-safe restoration was still partial.
- **Post-fix Luna return: 18/18 = 100% mechanical command gates and 5/5 contract
  requirements.** The new fault matrix is inside the focused/full Chromium gate,
  so it cannot be omitted while those commands pass.
- **Post-fix independent core rerun: 8/8 = 100%** for ESLint, Prettier/diff whitespace,
  exact-three type, cascade topology, focused Chromium, full Chromium, protected
  hashes, and post-run hygiene.

On the five Phase 6 contract requirements, the frozen post-fix tree is now 5/5
complete. The initial omitted ESLint and first independent Major remain counted in
the implementer-quality chronology rather than being erased by the clean final
tree.

## Correction rounds and footprint

1. **Luna round 1:** added authority coverage and the physical observer/sensitivity
   control in one existing probe file. Its initial `target DB opens == 0` clause
   failed with legitimate `2/0/0`; Luna narrowed only that clause and retained the
   sidecar transaction, OPFS, shape/version, and directory absence gates.
2. **LEAD discovery:** after Luna's first completion claim, LEAD ran the omitted
   ESLint gate and found two unsafe assertions. LEAD authored **0 product/probe
   lines in 0 files** for this correction.
3. **Luna round 2:** fixed the two lint sites in the same probe file, amended the
   author evidence, and reran the final gates. The dirty untracked baseline does
   not permit an exact line-delta reconstruction, but the two current correction
   sites on the pre-remediation fingerprint were the guarded storage prototype at
   lines 482-490 and the checked reflected transaction result at lines 538-545.
4. **Sol evaluation:** authored **0 product/probe/task/runstate/author-evidence
   lines in 0 files** and made no code correction. The only Sol write is this
   explicitly authorized evaluation artifact.
5. **Luna round 3 (review remediation):** changed the same probe file only, from
   3,157 to 3,559 lines (net +402), adding fail-safe installation/restoration and
   the 12-case real-Chromium fault matrix. It amended the author evidence and
   reran focused/full and affected static gates.
6. **Sol re-review:** independently inspected the one-file fix, reran affected
   static/type/unit/focused/full/hygiene gates, and updated only this evaluation
   artifact. Sol again authored **0 product/probe/task/runstate/author-evidence
   lines in 0 files**.

No Sol-authored product correction exists.

## Evidence and handoff accuracy

The author evidence and recorded chronology accurately preserve the important
chronology: evidence-gap RED, authority coverage, sensitivity control, the
overbroad zero-open failure and narrow correction, the omitted ESLint gate, the
two LEAD-discovered lint errors, Luna's own fix, and the final reruns. Their
ordinary-path command results and hygiene claims were independently reproduced.

The amended author evidence also accurately identifies the first independent
Major, describes the one-file remediation without erasing the prior failure, and
records the 12 one-shot fault traces plus post-fault observations. Those claims
match the current code and were independently reproduced. No remaining evidence
or handoff overclaim was found.

## Provisional signal

**Mixed, with the post-fix tree CLEAN.** Luna showed good RED discipline, correctly
distinguished an evidence gap from a product defect, built a useful non-vacuous
negative control, corrected an overbroad assertion without weakening the proof,
and implemented a complete one-file remediation after review. Against that, it
first declared completion without the required lint gate and then required an
independent Major plus a third Luna round to satisfy a contract-explicit exception
path. Phase 6 may advance as clean to Phase 7, but this remains only a provisional
implementer signal; it is not the reserved post-C6 can-replace-Sol verdict.
