# Independent VERIFY review: s0304-project-settings-transaction-operation

## Outcome

- Review execution: **DONE**
- Verdict: **FAIL — not review-clean; do not bless `b79f7995019df0a27da1d15a5503c127ff3faff0` for T3/T4 consumption yet**
- Canonical findings: **1 Blocker / 2 Major / 1 Minor / 0 Trivial**
- Reviewed range: `3978d724a43329ca75b2d71cb7ec3859e86ea6ae..b79f7995019df0a27da1d15a5503c127ff3faff0`
- Reviewed commit tree: `b3e351f94a06aed6457c0936eb13a5e295e0a18f`
- Scope check: **CLEAN** — 14 transaction contract/engine/Draft product or test files plus 7 corrective Change artifacts; no T3/T4 product source, Host root, Surface, Rust/WASM, adapter/store interface, parity oracle, or type-baseline fixture changed.

Intent: add the twelfth typed `update-project` operation through T0, T1, and T2, then hand off an explicit reviewed prerequisite to T3/T4.

Delivered: the operation inventory, normal Project apply/replay/save/reopen path, final-document FPS validation, Draft classification/review/savepoints/inverse/compensation, focused tests, conformance, and downstream recovery handoff are present. Three adversarial contract paths remain incorrect.

## Findings

### F1 — Blocker / ASK — provider-private data can be smuggled through `ProjectPatch.frameRate`

Evidence: `apps/web/src/editor/contracts/engine/evaluator.ts:62-115` closes only the top-level patch keys, while `apps/web/src/editor/contracts/engine/invariant.ts:30-56` validates only `frameRate.numerator` and `frameRate.denominator`. The equivalent T0 path at `apps/web/src/editor/contracts/in-memory/index.ts:71-147` has the same hole. A structurally valid value such as `{ numerator: 30, denominator: 1, providerPrivate: "persisted-smuggle" }` is accepted as `frameRate`; the adversarial probe observed the extra field unchanged in the live Project read, the persisted transaction-native record, and a reopened engine. The in-memory reference also retained it.

This violates the delta requirement at `specs/transaction-automation-api/spec.md:5-10` that the public operation accept no generic/provider-private payload and defeats the runtime trust-boundary rationale in `design.md:67`. It is not just an opaque prior-record sibling: the public operation introduces the field and returns it through `TransactionRead.project()`.

Recommended fix: validate `frameRate` itself as an exact plain enumerable data object with exactly `numerator` and `denominator` own string keys (no excess/symbol/accessor/non-enumerable keys), or normalize it to a freshly constructed two-field value before it can enter the candidate. Apply the same behavior to T0 and T1 and add live/persisted/reopen conformance cases.

### F2 — Major / ASK — eager Project-patch validation breaks idempotency precedence and validation aggregation

Evidence: `apps/web/src/editor/contracts/engine/evaluator.ts:603-624` returns on the first invalid Project patch before canonical fingerprinting, durable idempotency lookup, expected-revision evaluation, or the normal multi-operation reducer. After committing a valid `update-project` under `probe-key`, submitting the same key with the different empty patch produced:

- durable engine `dryRun`: `invalid-entity`, operation 0;
- durable engine `apply`: `TransactionError { code: "validation", operationIndex: 0 }`;
- T0 in-memory reference: `TransactionError { code: "duplicate" }`.

The same probe passed two independently invalid Project patches to `validate` and received only the first issue. This contradicts `design.md:84` (same key with **any** different Project patch is `duplicate`), the frozen idempotency contract, and canonical `rasen/specs/transaction-automation-api/spec.md:274-278` (validation reports every deterministically attributable issue). Current replay/collision tests cover only a different *valid* patch, so they do not detect the T0/T1 divergence.

Recommended fix: preserve the established evaluator order—canonical identity and keyed replay/collision first—then validate serializable Project patches through the normal reducer so `collectAllIssues` can aggregate operation-indexed failures. Retain a structured fallback only for non-canonicalizable inputs. Add apply/dry-run tests for same-key + empty/excess patch and a validate test with two invalid Project operations.

### F3 — Major / ASK — FPS placement failures caused by `update-project` lose the responsible operation index

Evidence: the reducer records the Project origin at `apps/web/src/editor/contracts/engine/evaluator.ts:214-216`, but timebase placement issues in `apps/web/src/editor/contracts/engine/placement.ts:37-50,73-101,213-225` name only the affected clip or marker. For an untouched 4,000-tick clip followed by operation 0 changing 30 fps to 24 fps, the adversarial probe observed `timebase-misaligned` with `entityIds: ["c"]` and no `operationIndex`; `apply` likewise threw `TransactionError { code: "validation" }` without an index.

The final-document rejection itself is correct and same-batch typed repair works, but T1's canonical placement contract requires every placement failure to carry the responsible operation index. Existing FPS tests assert only the code/final state, so this attribution regression is vacuously green.

Recommended fix: make timebase issues caused by a Project timebase mutation causally include or otherwise resolve the Project origin (while keeping the affected clip/marker IDs), then assert operation index for untouched-clip and untouched-marker rejection plus repaired same-batch behavior.

### F4 — Minor / accepted-known — Host evidence is reproducible but only partially bound to the reviewed tree

Positive binding: `.rasen/.../auto-run.json` records apply commit `b79f7995...` and tree `b3e351f9...`; both match `git rev-parse b79f7995^{tree}` and current `HEAD^{tree}`. The ignored Vite/Next snapshots exist with UTC mtimes before the commit, SHA-256 values `A49213DF4F9D4F55B36F0A34DDDD24238CC7E6BB588F5F7742A1909B157FD9BD` and `0E3813B4FCCC2EB3A8B5A3B04B2D8ADAFB17A3E5408E03CD17D9011147FD3ED6`, and rerunning the unchanged diff oracle reproduced 195 leaf values, 0 semantic differences, and 9 incidental classifications.

Limitation: `implementation-report.md:7-9` names the branch and pre-commit `HEAD` as the base commit, not the tested worktree tree/digest; it stores no build/parity log hashes or snapshot hashes. The run-state binds the committed output tree, but it does not prove no source changed between each Host run and the commit. This is non-blocking for this no-runtime-caller corrective child, but future Host evidence should record the exact tested tree/worktree digest and artifact hashes. Cross-Host equality is also not T3 before-routing/after-routing parity; the handoff correctly leaves that separate evidence to T3.

## Standards and spec axes

### Standards axis

- F1 is a hard public trust-boundary violation: a Host-neutral operation becomes a carrier for undeclared private data.
- F2 is a consistency/control-flow defect: the durable implementation no longer matches the reference contract and bypasses the evaluator's issue-collection mode.
- F3 is a structured-error completeness defect: a causal operation is known but omitted.
- No independent Fowler smell, performance, bundle, SQL, LLM, or frontend-design finding was found.

Standards count: **1 Blocker / 2 Major / 0 Minor / 0 Trivial**; worst issue F1.

### Spec axis

- F1 falsifies the provider-private/generic-payload prohibition and makes tasks 1.2/2.1 partial.
- F2 falsifies keyed collision semantics and all-attributable validation reporting; tasks 1.4/2.3/2.4/2.5 are partial.
- F3 falsifies T1 placement attribution while preserving the final-placement accept/reject result; task 2.5 is partial.
- F4 is an evidence-binding limitation for task 5.4, not a product behavior failure.

Spec count (deduplicated against Standards): **1 Blocker / 2 Major / 1 Minor / 0 Trivial**; worst issue F1.

## Requirement audit

| Corrective scenario | Status | Evidence |
| --- | --- | --- |
| Closed operation inventory | PASS | Exported types and exact 12-kind inventory; T0/T1/T2 probes pass. |
| Selected non-null Project and matching ID | PASS | Focused null/mismatch tests return indexed `not-found`, zero save. |
| Closed patch keys and valid resulting Project | **FAIL** | Top-level excess keys reject, but F1 introduces and persists nested private `frameRate` data. |
| Empty versus non-empty same-value semantics | PASS | Empty rejects; same-value produces one revision/save/watch and Project ID in `changedIds`. |
| Changed Project commits once and survives reopen | PASS | Focused native-adapter and conformance cases cover Project, summary, opaque sibling, one save/watch, reopen. |
| Canonical Project idempotency | **FAIL** | Valid reordered replay/collision pass; F2 violates different invalid-patch collision precedence and T0/T1 equivalence. |
| Validation/dry-run purity and structure | PARTIAL | State/save/watch purity passes; F2 drops independently attributable issues. |
| Complete final-document FPS placement | PARTIAL | Reject/explicit same-batch repair/no implicit retime pass; F3 loses causal operation attribution. |
| Draft classification/review/savepoint/stale approval | PASS | T2 conformance and focused suite execute Project cases. |
| Minimal Project compensation and preflight | PASS | One Project inverse, exact changed public pre-images, large-document constant size, preflight and stale undo covered. |
| UI settings public/private honesty | DEFERRED (T3) | Correctly captured by `handoff/downstream-recovery.md`; no T3 product source belongs to this child. |
| First-image 1920x1080 -> 320x180 one-root behavior | DEFERRED (T3) | Handoff matches `git show 552f15a1:.../handoff/design-audit-1.md`, including baseline `pushHistory:false` undo ownership. |
| Corrected Host parity safeguards | DEFERRED (T3) | Handoff requires per-Host before/after behavior evidence separately from Vite-vs-Next equality. |
| Agent twelfth-operation evidence | DEFERRED (T4) | Handoff requires typed Project apply/replay/collision/reopen without inference. |

## Task audit

| Task | Status | Review evidence |
| --- | --- | --- |
| 1.1 | PASS | Types, union member, inventory, and barrel export present. |
| 1.2 | **FAIL** | F1: nested `frameRate` private data is accepted and persisted. |
| 1.3 | PASS | Atomic working Project copy commits only after every T0 operation succeeds. |
| 1.4 | PARTIAL | Empty/same-value/rollback/reordered valid replay pass; invalid-patch keyed precedence is missing (F2). |
| 1.5 | PASS | Exact inventory plus seeded Project conformance; in-memory Project case executes, not skips. |
| 2.1 | PARTIAL | Exhaustive reducer and IDs present; closed public value boundary is incomplete (F1). |
| 2.2 | PASS | Final candidate policy rejects old grid and accepts explicit same-batch repair; no implicit retime. |
| 2.3 | PARTIAL | Normal one-save/reopen/purity pass; idempotency precedence diverges from T0 (F2). |
| 2.4 | PARTIAL | Added durable Project cases pass but do not falsify invalid-patch collision or attribution (F2/F3). |
| 2.5 | PARTIAL | Broad invalid/same/save/FPS coverage exists; the three adversarial gaps are absent. |
| 2.6 | PASS | Native adapter Project/summary/opaque/reopen evidence passes without interface edits. |
| 3.1 | PASS | Exhaustive Draft-safe register, Project affected ID, dynamic 12-kind review counts. |
| 3.2 | PASS | Mixed Project/entity rejected call restores exact snapshot/journal with zero durable effects. |
| 3.3 | PASS | At most one Project inverse with changed allowed pre-images; null/ID transitions fail closed. |
| 3.4 | PASS | Inverse composes with entity repairs and exact compensation preflight. |
| 3.5 | PASS | T2 12-kind journal/inverse, mixed apply, timebase, undo, and repeatability execute. |
| 3.6 | PASS | 1-4 Project fields remain one Project inverse across 8,000 markers; stale/preflight paths covered. |
| 4.1 | PASS | Handoff blocks T3 until an exact independently reviewed corrective commit is recorded/consumed; current hash is deliberately not blessed by this failing review. |
| 4.2 | PASS | Projection/draft-context/settings/FPS recovery matrix is explicit. |
| 4.3 | PASS | First-image equality/failure/minification/audio/no-double-save/undo ownership are explicit. |
| 4.4 | PASS | FPS baseline and two-axis Host parity requirements are explicit; no oracle/Host product edit. |
| 4.5 | PASS | T4 twelve-kind typed Agent evidence and replay/collision/reopen requirements are explicit. |
| 5.1 | PASS (executed gates) | Focused 41/0/522; embedded T0+T1 36/0/2 and T2 21/0/1. Functional gaps remain findings rather than hidden test failures. |
| 5.2 | PASS | Boundary 31 modules, zero violations; every negative control and converse passes. |
| 5.3 | PASS | 3 current diagnostics, zero outside pinned baseline. |
| 5.4 | PARTIAL / accepted-known | Existing Host artifacts reproduce their cross-Host result, but tested-tree binding is incomplete (F4). |
| 5.5 | **FAIL** | The report's “no canonical assertion falsified” claim is disproved by F1-F3. |
| 5.6 | PASS | Exact 21-file scope; forbidden product/seam files untouched. |
| 5.7 | PASS | 21/21 strict UTF-8; zero BOM/U+FFFD/mojibake/mixed-EOL and `git diff --check` clean. |
| 5.8 | PASS | Strict change validation 1 passed / 0 failed / 0 issues. |

## Coverage diagram

```text
CODE PATH COVERAGE
==================
[+] operation inventory / exhaustive consumers
    |-- [*** TESTED] exact 12 kinds through T0, T1, T2
[+] top-level Project patch validation
    |-- [*** TESTED] empty/id/unknown/symbol/value/null/mismatch rejection
    `-- [GAP] nested frameRate excess private field accepted (F1)
[+] Project apply lifecycle
    |-- [*** TESTED] same-value, changedIds, atomic rollback, one save/watch, reopen
    |-- [*** TESTED] reordered valid replay and valid different-patch collision
    `-- [GAP] invalid different-patch collision precedence and multi-issue validate (F2)
[+] final timebase
    |-- [*** TESTED] untouched old-grid rejection; explicit same-batch clip repair
    `-- [GAP] causal operationIndex for untouched clip/marker rejection (F3)
[+] Draft lifecycle/inverse
    `-- [*** TESTED] classify/review/savepoint/stale/one apply/minimal inverse/preflight/undo/large document

USER FLOW COVERAGE
==================
[+] corrective child (no runtime caller)
    `-- [** TESTED] existing Vite/Next Host parity artifacts reproduce cross-Host comparison
[DEFERRED -> E2E] T3 first-image 1920x1080 -> 320x180 success/failure/undo ownership
[DEFERRED -> E2E] T3 public-only/mixed/private-only settings and per-Host before/after parity
[DEFERRED -> E2E] T4 third-party Agent apply/replay/collision/reopen

Scoped child code paths: 14/17 review-critical paths covered; 3 adversarial gaps.
Downstream flows: 0/3 implemented by design; all 3 are explicitly gated in the handoff.
```

## Verification evidence

| Check | Result |
| --- | --- |
| Focused Bun T0/T1/T2 | PASS — 41 tests, 0 failures, 522 assertions. |
| T0+T1 conformance (asserted inside focused suite) | PASS — 36 passed, 0 failed, 2 intentional zero-assertion skips; seeded Project case passed. |
| T2 conformance (asserted inside focused suite) | PASS — 21 passed, 0 failed, 1 intentional zero-assertion skip. |
| Boundary | PASS — 31 modules, 0 violations. |
| Boundary negative control | PASS — every deliberate violation caught and every converse non-match retained. |
| Type baseline | PASS — 3 current diagnostics, 0 outside pinned set. |
| Strict change validate | PASS — 1/1, 0 failed, 0 issues. |
| Strict all-current-spec validation | PASS — 16/16, 0 failed; 7 informational long-text notices only. |
| Diff/text | PASS — 21 changed files; `git diff --check` clean; strict UTF-8 failures 0, BOM 0, U+FFFD 0, mojibake 0, mixed EOL 0. |
| Host snapshot re-diff | Reproduced — 195 leaf values, 0 semantic, 9 incidental; this is cross-Host evidence, not T3 pre/post evidence. |
| Tree binding | Commit/run-state/current HEAD all name tree `b3e351f94a06aed6457c0936eb13a5e295e0a18f`; Host run-to-tree binding remains partial per F4. |
| Adversarial Project probes | FAIL as expected — nested private value persisted/reopened; engine collision returned validation while T0 returned duplicate; two invalid operations yielded one issue; FPS rejection omitted operation index. |

## Accepted-known / deferred

1. F4 is non-blocking evidence friction for this corrective child; future Host runs should bind tree/worktree and artifact/log hashes explicitly.
2. T3 first-image/settings/before-after parity and T4 Agent evidence are intentionally downstream, not silently counted as implemented here.
3. Existing `cross-engine-cas: false` and the parity oracle's documented one-frame classification blind spot are unchanged; neither is widened or “fixed” by this child.

## Durable findings

1. Closing only the outer patch keys is insufficient for a public trust boundary: nested structured public values must be exact or normalized, or they become provider-private payload carriers.
2. Idempotency identity/lookup is semantic ordering, not an optimization; operation validation must not preempt same-key replay/collision or disable all-issue validation.
3. A global Project mutation needs causal attribution in downstream entity validation: affected entity IDs alone cannot recover the responsible Project operation index.

## Required next action

Route F1-F3 to a non-author fixer, add the named regression tests, rerun the focused/conformance/boundary/type/strict gates, and obtain an independent delta re-review. Do not update the T3 prerequisite with `b79f7995...` unless the corrected commit is review-clean.
