# Independent verification review: `s0304-draft-editing-sessions`

Mode: dispatched, report-only, Codex reviewer (non-author)

- Base: `f2e36b9b9ced88f3bee9514d5fa5f37febdd8abd`
- Reviewed commit: `cbfb4f6852f30baff4427fac0df1486a9db53b1a`
- Tested source tree: `42edfe8d99046f09ea08c9e488d2aa54dbb1574e`
- Exact scope: 18 added files, 3,259 insertions; product/test source is confined to the 10 files under `apps/web/src/editor/contracts/draft/**`
- Scope check: **REQUIREMENTS MISSING**, with no out-of-scope product-source drift

## Verdict

**CHANGES REQUIRED — 0 Blocker / 3 Major / 2 Minor / 0 Trivial.**

The focused suites and mechanical gates pass, but two public Draft behaviours and the reusable conformance type boundary do not meet the T2 spec. Shipping remains blocked by the three Major findings.

Pre-Landing Review: 5 issues (3 critical, 2 informational)

## Standards axis

### S1 — Major — The exported conformance fixture is coupled to the private in-memory retention adapter

**Classification:** AUTO-FIX (mechanical public test-harness typing repair)

`apps/web/src/editor/contracts/draft/conformance/index.ts:30-38` makes every `DraftEditingConformanceFixture` expose `InMemoryDraftResourceRetentionPolicy`, including its test-control methods `setRetainedAssetIds`, `failNext`, and `preflightCount`. The runner never uses `fixture.retention`, yet a provider fixture with a valid public `DraftResourceRetentionPolicy` fails to type-check.

Independent TypeScript 5.9.3 consumer probe result:

```text
TS2739: Type 'DraftResourceRetentionPolicy' is missing the following properties
from type 'InMemoryDraftResourceRetentionPolicy': setRetainedAssetIds, failNext,
preflightCount
```

This violates the requirement that `runDraftEditingConformance(factory)` test any conforming manager/engine fixture through the public Draft interface. Type `retention` as the public policy, remove the unused field, or make adapter controls a separate optional test capability; add the provider-policy consumer probe as a compile regression.

### S2 — Minor — A mutable parent-engine error escapes an otherwise immutable outcome

**Classification:** AUTO-FIX

`apps/web/src/editor/contracts/draft/manager.ts:276-282` freezes only the outer conflict object and returns the caught `engineError` by reference. `ProjectStoreError` and `TransactionError` instances and their nested fields are mutable at runtime. The current test at `apps/web/src/editor/contracts/draft/__tests__/draft.test.ts:392-399` checks only instance identity/code and never checks freezing or mutation resistance.

Preserve T1 error ownership while recursively freezing the same error object (no clone is required), and add an attempted-mutation assertion for both the error and its structured scope/revision fields.

### S3 — Minor — Host build/parity claims are not bound to the tested Git tree

**Classification:** AUTO-FIX (evidence repair)

`rasen/changes/s0304-draft-editing-sessions/evidence/implementation-report.md:23-34` records successful Vite/Next builds and parity but no tested commit/tree fingerprint. The ignored parity snapshots contain no commit/tree metadata. The apply run-state records the final tree, but does not bind that tree to those Host commands.

The filesystem timestamps are consistent with the claimed order (all Draft source files predate the Vite/Next snapshots), and the new Draft entry point has no runtime importer, so no Host regression is indicated. However, timestamps are not a durable tree binding. Record `git rev-parse HEAD^{tree}` beside the Host evidence or rerun the Host checks on the final tree and record it.

Standards axis: **1 Major / 2 Minor**; worst issue is S1.

## Spec axis

### P1 — Major — Reusing a Draft id in a new manager can replay an old transaction and falsely report `applied`

**Classification:** ASK (idempotency/lifecycle design)

`apps/web/src/editor/contracts/draft/manager.ts:243` derives the durable key only as `draft:${id}:apply`, while the uniqueness register at `manager.ts:429-471` is local to one manager instance. Recreating a manager over the same parent engine can therefore reuse the same key. T1 checks a matching idempotency fingerprint before expected revision, so an old result is replayed rather than committing the new Draft.

Independent public-interface probe:

```text
first receipt:  base=1 applied=2; saves=1 watches=1 revision=2
second manager, same id and same operation:
                 base=2 applied=2; saves=1 watches=1 revision=2
```

The second Draft returned `applied: true` without a save, revision increment, watch, or content application. If intervening work changes the content back, this path silently leaves the requested edit unapplied. It violates unique Draft identity, one successful apply/save/revision/watch, and truthful receipt semantics.

Make durable keys unique to the Draft incarnation/base (for example include the captured base revision or a manager/session nonce with an enforceable uniqueness contract), ensure undo keys cannot collide across incarnations, and reject any non-replay success whose returned revision is not exactly `base + 1`. Add a manager-recreation regression with intervening content.

### P2 — Major — Undo does not exactly restore absent optional fields, and the test oracle hides the mutation

**Classification:** ASK (inverse representation semantics)

`apps/web/src/editor/contracts/draft/inverse.ts:83-97` restores `Clip.assetId` by writing `assetId: previous.assetId`; `inverse.ts:134-146` similarly writes `Marker.note` and `Marker.color`. When the pre-image omitted those optional properties, the inverse creates own properties whose value is `undefined` instead of restoring absence.

Independent forward/apply/undo probe through the public Draft and engine interfaces:

```text
base clip keys:     id,trackId,startTime,duration,trimStart,trimEnd
restored clip keys: id,trackId,startTime,duration,trimStart,trimEnd,assetId
base marker keys:     id,time
restored marker keys: id,time,note,color
Object.hasOwn(restoredClip, "assetId") = true
Object.hasOwn(restoredMarker, "note")  = true
Object.hasOwn(restoredMarker, "color") = true
```

The conformance checks at `apps/web/src/editor/contracts/draft/conformance/index.ts:718-731` and `:795-856` compare `JSON.stringify(...)`, which drops `undefined` object properties and therefore reports these unequal documents as equal. This can leak representation changes into a provider adapter that distinguishes missing from explicit clearing and violates the exact base-content restoration/one-undo contract.

Generate an inverse that restores property presence as well as value (for example delete/recreate the entity when an optional field was originally absent, or introduce an explicit clearing/omission semantic at the contract layer). Replace the JSON oracle with structural own-key-aware equality and add absent-optional clip/marker regressions.

Spec axis: **2 Major / 0 Minor**; worst issues are P1 and P2.

## Requirement and task audit

| T2 area | Result | Independent evidence |
| --- | --- | --- |
| Revision-sandwich snapshot and bounded retry | PASS | `manager.ts:75-131` re-reads the entire project/tracks/clips/assets/markers sequence per attempt and compares before/after revisions; retry/exhaustion conformance passed. |
| One parent engine shared by all Drafts | PASS within one manager | `manager.ts:423-480` retains the injected engine and never opens another. P1 covers the unguarded multi-manager identity collision. |
| Per-call savepoint atomicity and non-poisoning queue | PASS | Disposable cloned document, replace-on-success journal, rejected/thrown provider-policy recovery, and later dependent call all passed. |
| Sibling stale exclusion | PASS for distinct ids | Same-base winner committed; loser returned T1 conflict with expected `0` / actual `1`; no loser content was published. |
| Manual/auto state transitions and terminal state | PASS | Manual approve/reject, auto apply/conflict, queued terminal observation, empty/mode-incompatible approval, and post-terminal calls passed. |
| Exact-once approval/idempotency | **FAIL (P1)** | Same session re-observation is stable, but manager recreation can return a stale replay as a new application. |
| Retention ordering and TOCTOU | PASS with adapter contract caveat | Candidate referenced assets are computed before preflight; apply occurs only after retained evidence. Any concurrent engine commit is caught by `expectedRevision`. The provider must truthfully guarantee project-owned backing independent of source-package removal. |
| Terminal conflicted behaviour | PASS | Retention and engine failures become terminal `conflicted`; subsequent queue work cannot stage/apply. S2 covers mutability of the returned error evidence. |
| Defensive immutability | **PARTIAL (S2)** | Snapshots, reviews, journal copies, receipts, retention evidence, and undo batches are cloned/frozen; caught engine errors are not. |
| Inverse ordering/referential integrity and one undo | **FAIL (P2)** | Track-cascade order and all 11 operation kinds execute, but absent optional fields are not exactly restored. |
| Exhaustive operation classification | PASS | Runtime/type register covers all 11 T0 operation kinds; five named immediate categories are separate. |
| No execution seam for immediate operations | PASS | Forged immediate input is rejected before journal/durable mutation; no public generic `invoke`/`execute` surface exists. |
| Generic conformance, non-vacuity, concurrency | **FAIL (S1)** | Assertion accounting is run-local; repeated/concurrent runs and three named negative targets pass. The exported fixture type is not implementation-generic. |
| Provider-private preservation | PASS | Independent transaction-native adapter probe retained an opaque nested sentinel through Draft apply and undo. |
| Public boundary leakage | PASS | Boundary checker scanned all 28 contract modules; no donor schema, command/core/store implementation, Zustand, storage mechanism, wasm, React, or Electron leak. Negative control remained sensitive. |
| All 37 task checkmarks | NOT VERIFIED COMPLETE | Tasks 2.3, 4.3/4.5/4.6, 5.1, and 6.4/6.5 are contradicted or incompletely evidenced by S1-S3/P1-P2. |

## Coverage map

```text
CODE PATH COVERAGE
==================
[+] draft/manager.ts
    |-- [*** TESTED] clean/torn/exhausted snapshot acquisition
    |-- [*** TESTED] per-Draft queue, savepoints, provider reject/throw recovery
    |-- [*** TESTED] manual/auto/retention/stale/store-failure paths
    |-- [GAP]        same Draft id across manager recreation (P1)
    `-- [GAP]        immutable nested engine-error evidence (S2)
[+] draft/inverse.ts
    |-- [*** TESTED] 11 operation kinds, cascade order, stale undo
    `-- [FALSE PASS] absent optional fields hidden by JSON.stringify (P2)
[+] draft/conformance/index.ts
    |-- [*** TESTED] zero-assertion skip, repeated/concurrent run-local accounting
    |-- [*** TESTED] three named non-conforming runtime targets
    `-- [GAP]        provider retention adapter at public type boundary (S1)
[+] classification/retention/review/public index
    `-- [*** TESTED] exhaustive 11+5 classification, immediate rejection,
                     retention-before-apply, structured journal review, no invoke seam

USER / CONSUMER FLOW COVERAGE
=============================
[+] open -> multi-call edit -> review -> approve/reject
    `-- [*** TESTED] manual, auto, sibling conflict, failed call, terminal calls
[+] apply -> one receipt -> one compensating transaction
    |-- [**  TESTED] ordinary create/delete/update and track cascade
    `-- [GAP] exact optional-property restoration and recreated manager identity
[+] third-party conformance adoption
    `-- [GAP] a public retention policy cannot satisfy the exported fixture type
[+] Vite/Next Host regression flow
    `-- [**  EVIDENCE] claimed green and snapshots present, but tree binding absent (S3)

Coverage summary: 12/16 audited path groups have direct passing evidence;
4 groups contain the gaps above. No frontend/E2E or LLM-eval path was added by T2.
```

## Independent checks

| Check | Result |
| --- | --- |
| Focused Draft + existing engine suites | PASS — 20 tests, 103 expectations, 0 failed; Draft conformance 18 passed / 0 failed / 1 deliberate skip. |
| Transaction boundary | PASS — 28 contract modules scanned. |
| Boundary negative control | PASS — every forbidden rule caught and converse control clean. |
| Type baseline | PASS — TypeScript 5.9.3; exactly 3 current diagnostics, none outside the pinned set. |
| Strict Rasen validation | PASS — 1 item, 0 issues. |
| Exact diff whitespace | PASS — `git diff --check` on base to reviewed commit. |
| Current capability inventory | PASS inventory — 16 strict UTF-8/no-BOM specs, 330 SHALL/MUST assertions; no `rasen/specs/**` delta in T2. |
| Current transaction spec plus T2 delta | FAIL semantics — P1, P2, and S1 contradict the new approval/undo/generic-conformance requirements. |
| Provider-private sentinel probe | PASS — opaque nested data survived Draft apply and undo. |
| Reused-id replay probe | **FAIL as expected** — second manager reported applied with no new save/revision/watch. |
| Optional-field undo probe | **FAIL as expected** — own-key sets differed while the current JSON oracle reported equality. |
| Public conformance consumer type probe | **FAIL as expected** — TS2739 from the concrete in-memory retention requirement. |

## Host evidence and capability sweep

The current capability inventory independently matches the implementation report: 16 specs and 330 SHALL/MUST assertions, all strict UTF-8 without BOM. T2 changes no canonical `rasen/specs/**` file and no existing runtime caller, Host, session, command, port, Rust/WASM, parity oracle, or type-baseline fixture. The existing 64-assertion transaction capability is unchanged; the active T2 delta adds 20 assertions. P1, P2, and S1 falsify that delta despite the mechanical validation pass.

The Vite/Next parity artifacts exist and were produced after the final Draft source mtimes, and the Draft entry point is currently unreachable from either Host graph. This supports “no Host regression,” but does not replace final-tree binding; S3 remains an evidence-quality finding.

## Accepted-known candidates

- S2 may be accepted only if the public immutability promise is explicitly narrowed to Draft-owned data while parent-engine errors are documented as borrowed mutable values.
- S3 may be accepted for this additive, runtime-unreachable child if the LEAD records that Host evidence is timestamp-correlated rather than tree-bound. It should not be reused as proof for T3/T4, where the transaction seam becomes reachable.

No Blocker or Trivial finding was found. No source, planning, run-state, commit, branch, delivery, ship, or archive mutation was performed by this reviewer.
