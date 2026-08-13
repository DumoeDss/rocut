# Independent Codex review cycle: `s0304-draft-editing-sessions`

Date: 2026-08-10

Mode: report-only, Codex-only, strict flat leaf; Tier C non-author fallback

- Round-3 base: `0892a0b675b4f55f60649fe6733d0cdfc4bf226a`
- Round-3 tested HEAD: `7b290c5667f4331695c9947031ecec9937645df6`
- Independently tested HEAD tree: `b882259bf22128b7b794474bbebb3f2e8e3b20cc`
- Exact re-review delta: `0892a0b675b4f55f60649fe6733d0cdfc4bf226a..7b290c5667f4331695c9947031ecec9937645df6`
- Delta size: 10 files, 919 insertions, 186 deletions

## Verdict

**CHANGES REQUIRED — 0 Blocker / 2 Major / 1 Minor / 0 Trivial.**

Round 3 resolves all three Round-2 findings: ordinary Draft undo no longer broadens a local edit into unrelated operation kinds, one-field compensation remains constant-sized across 8,000 markers, and standard native-container error evidence is preserved in tagged immutable snapshots. The new implementation is substantially safer and faster.

Two exactness gaps remain. Compensation preflight evaluates undo against a content-only projection whose idempotency ledger is empty, while the real post-forward document contains the committed `:apply` entry; a deterministic policy can therefore accept preflight and reject the published undo. Separately, the private-data comparator tracks object aliases only left-to-right, so distinct-to-shared alias changes can be misclassified and a valid reversible edit is rejected. The all-changed-files Prettier gate also fails on three Rasen Markdown artifacts.

The configured three-round review cap is reached. The two open Major findings require the material-change strategies recorded below before this stage can be declared clean or proceed to ship.

## Round summary

| Round                         | Findings (B/Ma/Mi/T) | Work                                                                                                                                                 | Independent result                                        |
| ----------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Round 1 re-review             | 0/1/2/0              | Found ordering loss, malformed-ID poisoning, and unsafe generic error evidence.                                                                      | Fix required.                                             |
| Round 2 independent re-review | 0/2/1/0              | Confirmed the Round-1 fixes, then found provider-policy broadening, whole-document quadratic compensation, and native built-in evidence loss.        | Fix required.                                             |
| Round 3 fixer                 | —                    | Commit `7b290c5` introduced minimal suffix repair, compensation policy preflight, operation-count coverage, and tagged native evidence snapshots.    | Fixer claims treated only as hypotheses.                  |
| Round 3 independent re-review | 0/2/1/0              | Read all changed source/planning hunks, ran fresh exact-tree gates, exhaustive/targeted restoration probes, and adversarial public-interface probes. | Round-2 N1–N3 resolved; M1–M2 and formatting gate remain. |

## Round-2 finding disposition

| Round-2 finding                                                             | Disposition                                                               | Independent evidence                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1 Major — full-rebuild undo introduced unrelated policy-visible operations | **RESOLVED for ordinary deterministic policy-visible operation surfaces** | Draft stage, compensation preflight, durable forward apply, and real undo all exposed only the legitimate `update-marker`. A provider rejecting that exact inverse rejected approval before forward durable mutation.                                                                                                         |
| N2 Major — a one-field undo expanded to whole-document O(N²) work           | **RESOLVED**                                                              | The public 8,000-marker one-field edit returned exactly one `update-marker` inverse. Measured stage: 178.8 ms; approval including preflight: 380.8 ms; undo: 155.8 ms; the original value restored exactly. The planner makes bounded linear collection passes and reconstructs only the first non-updateable ordered suffix. |
| N3 Minor — `Map`/`Set`/`Date`/`RegExp` evidence lost internal-slot state    | **RESOLVED**                                                              | Public evidence retained tagged entries/members/timestamp/source/flags/`lastIndex`, nested self-cycles and custom-property cycles. Getter reads remained 0, later mutation of the originals did not affect snapshots, and no mutable native container prototype remained.                                                     |

## Confirmed Round-3 behavior

- Exhaustive marker subset/permutation coverage exercised 65 cases with zero restoration failures.
- Targeted track reorder, asset replacement, own-property removal, extra-entity deletion, and track-cascade scenarios restored exact ordered content with valid referential operation ordering.
- The 8,000-marker public regression emitted one inverse operation and restored the exact prior field value.
- A restrictive deterministic policy observed only `update-marker` through stage, compensation preflight, forward apply, and undo; rejection of the legitimate inverse blocked before forward durable mutation.
- Tagged native error snapshots are frozen, cycle-preserving, getter-inert, detached from original mutation, and retain their meaningful internal-slot data.
- Known `TransactionError` and `ProjectStoreError` prototypes and ownership remain covered by focused tests.
- No `JSON.stringify` equality oracle remains in the six changed Draft source/conformance/test files.

## Remaining findings

### M1 — Major — compensation preflight projects the wrong post-forward idempotency state

`apps/web/src/editor/contracts/draft/manager.ts:80-86` reconstructs a transaction document through `documentFromContent(...)`, which always sets `idempotency: []`. Approval then evaluates compensation against that content-only document at `manager.ts:281-293`. The real T1 durable apply appends the forward batch's `:apply` idempotency record at `engine/engine.ts:228-238` before publishing the committed document.

`PlacementPolicyContext.document` publicly exposes the document, including `idempotency`. Consequently the preflight policy context and the later real undo context differ even when the exact same deterministic policy list is supplied to the Draft manager and parent engine.

Public-interface reproduction with one deterministic policy:

1. Stage a valid `update-marker` while the forward `:apply` key is absent.
2. Let compensation preflight accept because its projected document also lacks that key.
3. Let forward apply commit and append the `:apply` idempotency entry.
4. Apply the published undo; the same policy now observes the entry and rejects.

Observed result:

```text
approved: true
undo: TransactionError(validation, "undo forbidden after forward entry becomes visible")
marker note remains: "forward"
revision: 2
```

Policy observations:

```text
stage:     applyVisible=false
preflight: applyVisible=false, key=:undo
forward:   applyVisible=false, key=:apply
undo:      applyVisible=true,  key=:undo
```

This contradicts the design's “correct projected post-forward state”, policy-closed receipt, and no-policy-bypass claims. Approval publishes an undo that the same deterministic policy rejects solely because the preflight omitted metadata T1 necessarily commits.

**Post-cap material-change strategy:** extract a pure T1 projection helper shared by durable engine apply and Draft compensation preflight. Given the evaluated forward document and batch, it must construct the exact would-be committed document, including the forward idempotency entry, fingerprint, result, and revision-visible state. Run compensation evaluation from that exact projection. Add a regression policy that inspects `document.idempotency` and proves compensation preflight and actual undo receive equivalent policy-visible state.

### M2 — Major — asymmetric graph equality rejects a valid provider-private alias change

`apps/web/src/editor/contracts/draft/inverse.ts:26-42` implements `sameDraftData` with one `WeakMap<left,right>`. Repeated left references must map to the same right reference, but two distinct left objects are allowed to map to one shared right object. The result is asymmetric for alias graphs.

Public comparator result:

```text
base:      left !== right (two structurally equal objects)
candidate: left === right (one shared object)

hasSameDraftContent(base, candidate) = true
hasSameDraftContent(candidate, base) = false
```

`entityRepair` compares base to candidate at `inverse.ts:179-185`, so the distinct-to-shared provider-private edit can be misclassified as unchanged and the forward patch reused as compensation. Final restoration proof correctly compares the restored candidate to the base in the opposite direction and returns:

```text
compensation-failed: "Draft compensation did not restore the captured base"
```

The public Draft sequence stages successfully, terminates approval as `compensation-failed`, and performs no forward durable mutation. This is corruption-safe, but it rejects a valid reversible provider-private update and fails the exact-private-preimage requirement.

**Post-cap material-change strategy:** make graph equality bijective with paired `leftToRight` and `rightToLeft` weak maps. Before descending, require any existing mapping in either direction to match the current pair; then register both directions. Use that comparator consistently in repair planning and final restoration proof. Add distinct-to-shared and shared-to-distinct regressions that verify approval succeeds and the inverse restores exact alias topology, not merely structural values.

### M3 — Minor — all-changed-files Prettier gate fails

`bunx prettier --check` over all 10 files in the Round-3 commit reports style issues in:

- `rasen/changes/s0304-draft-editing-sessions/design.md`
- `rasen/changes/s0304-draft-editing-sessions/evidence/implementation-report.md`
- `rasen/changes/s0304-draft-editing-sessions/specs/transaction-automation-api/spec.md`

The six changed Draft source/conformance/test files were not reported. This is a mechanical artifact-formatting failure, not a product-runtime defect, but the requested exact-delta gate is red and cannot be recorded as passing.

**Repair:** format only the three reported artifacts, then rerun Prettier over the same exact 10-file list, strict UTF-8/BOM checks, strict Rasen validation, and `git diff --check`.

## Test and gate evidence

Tier C non-author fallback was used because this reviewer was constrained to one flat Codex leaf with no delegation. Independence came from an exact non-author diff/final-source read, fresh gates on the tested tree, and adversarial public-interface probes. No fixer claim was counted as proof.

| Exact command / procedure                                                                                                            | Result                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `git rev-parse HEAD`; `git rev-parse 'HEAD^{tree}'`                                                                                  | `7b290c5667f4331695c9947031ecec9937645df6`; `b882259bf22128b7b794474bbebb3f2e8e3b20cc`.                                |
| `git diff --stat` / `--name-status 0892a0b..7b290c5` plus every changed hunk and final source                                        | 10 files; 919 insertions / 186 deletions; all changed source/planning hunks reviewed.                                  |
| Exhaustive marker subset/permutation probe                                                                                           | PASS — 65 cases, zero restoration failures.                                                                            |
| Targeted reorder/replacement/own-key/deletion/cascade probes                                                                         | PASS — exact content and referential operation ordering restored.                                                      |
| Public 8,000-marker one-field edit                                                                                                   | PASS — one `update-marker` inverse; stage 178.8 ms, approve 380.8 ms, undo 155.8 ms; exact restoration.                |
| Public restrictive ordinary-policy surface probe                                                                                     | PASS — only `update-marker` at stage/preflight/forward/undo; rejected inverse stopped before forward durable mutation. |
| Public idempotency-visible policy probe                                                                                              | FAIL as M1 predicts — preflight saw no `:apply` entry, actual undo did, and the durable forward edit remained.         |
| Public alias-topology probe                                                                                                          | FAIL as M2 predicts — equality was asymmetric and approval terminated `compensation-failed` without durable mutation.  |
| Public native error-evidence probe                                                                                                   | PASS — tagged internal-slot data, cycles, custom properties, detachment, freezing, and zero getter reads verified.     |
| `bun test apps/web/src/editor/contracts/draft/__tests__/draft.test.ts apps/web/src/editor/contracts/engine/__tests__/engine.test.ts` | PASS — 26 tests, 180 expectations, 0 failed.                                                                           |
| `node script/check-transaction-boundary.mjs`                                                                                         | PASS — 28 contract modules scanned; both rules clean.                                                                  |
| `node script/check-transaction-boundary.mjs --negative-control`                                                                      | PASS — all forbidden samples caught and converse controls remained clean.                                              |
| `node script/check-type-baseline.mjs`                                                                                                | PASS — TypeScript 5.9.3; 3 diagnostics, none outside the pinned baseline.                                              |
| `rasen validate s0304-draft-editing-sessions --strict --project rocut --json`                                                        | PASS — 1 change, 0 failed, 0 issues.                                                                                   |
| `bunx prettier --check -- <all 10 changed files>`                                                                                    | **FAIL** — the three Rasen Markdown artifacts listed in M3 need formatting.                                            |
| `git diff --check 0892a0b..7b290c5`                                                                                                  | PASS — no whitespace errors.                                                                                           |
| `rg -n 'JSON\.stringify'` over the six changed Draft source/conformance/test files                                                   | PASS — zero matches; no lossy JSON equality oracle remains.                                                            |

## Accepted-known candidates

- No open finding is accepted-known. M1 and M2 violate explicit receipt/exact-preimage behavior and require material changes. M3 is mechanical and should be fixed.
- Requiring callers to supply the same placement-policy list to the manager and engine remains an explicit design contract, not a new finding in this round.
- Stateful or nondeterministic policy behavior beyond equivalent deterministic policy-visible state is not used to justify M1; the reproduction needs only one deterministic policy.

## Durable findings

1. Compensation preflight must project the complete metadata-bearing committed document, not only business content; policy-visible idempotency state is part of transactional behavior.
2. Exact private-preimage equality over object graphs requires a bijection in both directions; a one-way visited map checks recursion but not alias topology.
3. Frozen operation unions can still support efficient exact undo by repairing only the first non-updateable ordered suffix, while native error evidence requires explicit internal-slot snapshots.

No source, planning artifact, run-state, commit, branch, delivery, ship, archive, or unrelated untracked artifact was modified by this Round-3 re-review. The only reviewer write is this report.

---

# Post-cap strategy attempt 1 independent re-review

Date: 2026-08-10

Mode: report-only, Codex-only, fresh non-author leaf reviewer

- Strategy-1 base: `7b290c5667f4331695c9947031ecec9937645df6`
- Strategy-1 tested HEAD: `6def258b517e321db02b5bee43ffa16c9a08edb7`
- Independently tested HEAD tree: `fb4fbe05c224e6e2caf985a339551537120feeb2`
- Exact re-review delta: `7b290c5667f4331695c9947031ecec9937645df6..6def258b517e321db02b5bee43ffa16c9a08edb7`
- Delta size: 10 files, 473 insertions, 89 deletions

## Strategy-1 verdict

**CHANGES REQUIRED — 0 Blocker / 2 Major / 0 Minor / 0 Trivial.**

The direct native-engine path now preserves the prior keyed ledger and forward
entry during compensation preflight, the focused suites remain green, and M3's
format/encoding/validation work is complete. However, M1 is not closed for the
publicly accepted `TransactionEngine` boundary: the new committed-document reader
is discoverable and configurable on the public engine object, while a conforming
wrapper that does not forward that private Symbol silently falls back to an empty
ledger and can publish an undo that the real engine rejects. M2 is also incomplete:
the paired maps are bypassed by the object-identity fast path, and per-entity repair
does not restore alias topology shared across entities.

Shipping remains blocked by both Major findings. The existing Strategy-1 tests prove
important native/single-entity cases but do not cover either failing public path.

## Strategy-1 finding disposition

| Round-3 finding                                                     | Disposition                | Independent evidence                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 Major — projected compensation omitted durable idempotency state | **PARTIAL; Major remains** | Direct native conformance now sees the prior and forward entries in both preflight and real undo. A conforming engine wrapper hides the attached Symbol, triggers the empty-ledger fallback, and reproduces the same invalid published undo with a pre-existing keyed entry. |
| M2 Major — graph equality was not bijective                         | **PARTIAL; Major remains** | Fresh distinct/shared references inside one entity now pass and undo. Shared identity across the two compared graphs bypasses both maps, and alias topology spanning two entities still causes a valid ordinary update to terminate as `compensation-failed`.                |
| M3 Minor — exact changed-file Prettier gate failed                  | **RESOLVED**               | Both the original Round-3 ten-file list and the Strategy-1 ten-file list pass Prettier; strict UTF-8/no-BOM, strict Rasen validation, and both exact-range diff checks pass.                                                                                                 |

## Remaining findings

### S1-M1 — Major — the private committed-document reader leaks through the public engine and its fallback still publishes metadata-incomplete undo

`apps/web/src/editor/contracts/engine/projection.ts:5-18` stores the complete committed
document reader as a configurable Symbol property on the returned public engine.
Although the engine barrel does not export that Symbol, `Reflect.ownKeys(engine)`
reveals it. An independent runtime probe found one Symbol named
`transaction-engine-committed-document`, confirmed `configurable: true`, invoked its
function, and obtained all committed fields: project, tracks, clips, assets, markers,
revision, and idempotency. This is both a private-state leak and a tamperable runtime
extension of the public engine surface.

`apps/web/src/editor/contracts/draft/manager.ts:595-606` separately reads that hidden
property after the public revision sandwich. If it is absent, throws, or no longer
matches, the manager silently calls `documentFromContent`, whose implementation at
`manager.ts:84-90` replaces the prior idempotency ledger with `[]`. The two reads are
not one atomic capture, and the fallback does not enforce the complete-commit
projection invariant.

The failure does not require malicious Symbol tampering. A plain conforming wrapper
that delegates every documented `TransactionEngine` method, but naturally does not
copy an undocumented Symbol, is enough. The independent public-flow reproduction:

1. Created one prior keyed marker transaction (`prior-entry`) on the native engine.
2. Passed a method-for-method conforming wrapper to `createDraftEditingManager`.
3. Used the same deterministic placement policy in the manager and native engine.
4. The policy accepted undo only while the prior entry was absent and rejected it
   when that real durable entry was visible.

Observed result:

```text
approvalApplied: true
preflight undo keys: [draft:...:apply]
real undo keys:       [prior-entry, draft:...:apply]
undo: TransactionError(validation, "undo rejected when prior entry is visible")
marker note: "forward"
revision: 2
```

Thus the receipt again advertised a policy-closed undo that the same deterministic
policy rejected without intervening work. The native direct path passing is not a
substitute for the public `TransactionEngine` contract accepted by the manager.

**Materially different Strategy 2:** remove the Symbol property and the empty-ledger
fallback. Keep private access in a module-scoped `WeakMap` keyed by the exact native
engine, so neither `Reflect.ownKeys` nor deep imports expose the reader. Capture the
content and metadata as one serialized engine snapshot, or retry the entire capture
when the public snapshot and private document do not match. If the manager cannot
obtain a complete committed document for an otherwise conforming wrapper, return a
structured unsupported/open failure rather than inventing an empty ledger. Add (a) a
plain delegated-wrapper regression, (b) a Symbol/introspection non-leak check, and (c)
a forced capture-mismatch test that proves retry/failure rather than fallback.

### S1-M2 — Major — graph equality and repair are not document-wide bijections

`apps/web/src/editor/contracts/draft/inverse.ts:43` returns immediately on
`Object.is(left, right)` before consulting or registering either weak-map direction.
If one object is literally shared by the two compared graphs at one position, a later
distinct object can still map to that same right-side object. An independent comparator
negative control returned `true` in both directions for:

```text
left:  { a: shared, b: distinct-but-equal }
right: { a: shared, b: shared }
```

The fresh-graph controls behaved correctly: isomorphic self-cycles compared equal, a
split cycle compared unequal, and a `Map` whose two distinct object values collapsed
to one shared value compared unequal. The defect is specifically the unregistered
object-identity shortcut, so the paired maps do not yet prove a bijection for every
graph.

Planning has a second, independently observable gap. `entityRepair` at
`inverse.ts:169-224` creates fresh comparisons for one entity at a time. It can repair
alias changes among fields of that entity, but cannot see an alias shared between two
entities. A public Draft probe seeded two markers whose provider-private fields pointed
to the same object, then changed only marker 1's ordinary `note`. Staging succeeded,
but approval returned:

```text
applied: false
draftError.kind: compensation-failed
message: "Draft compensation did not restore the captured base"
durable note/shared topology/revision: unchanged, shared, 0
```

This is corruption-safe but rejects a valid reversible edit. The Strategy-1
distinct-to-shared/shared-to-distinct test uses one marker with two private fields, so
it cannot detect document-wide alias loss.

**Materially different Strategy 2:** register object pairs before the identity fast
path (primitives may still use the fast path), and make repair planning graph-aware at
document/collection scope rather than restarting equality for every entity. When an
alias relationship crosses operations/entities, repair the earliest affected suffix
and clone the complete pre-image operation graph once so the same references span all
required patches. Add non-circular regressions whose oracle is explicit identity
assertions, not the production comparator: shared base data across two markers plus an
unrelated field update, distinct/shared values inside Maps, self-cycles, and the
same-object-across-both-graphs negative control.

## M3 artifact and text audit

- `bunx prettier --check` passes over the exact original Round-3 ten-file list.
- `bunx prettier --check` passes over the exact Strategy-1 ten-file list.
- The union contains 12 files; strict `UTF8Encoding(false, true)` decoding reports 0
  failures, 0 BOMs, 0 mixed line endings, 0 NULs, and 0 replacement/mojibake matches.
- `rasen validate s0304-draft-editing-sessions --strict --project rocut --json`
  passes 1/1 with zero issues.
- The three formatted Markdown artifacts preserve their headings, fenced TypeScript,
  requirement/scenario structure, and pre-existing semantics. Their non-format
  additions are the intended commit-projection/alias decisions, scenarios, evidence,
  and Strategy-1 task records; no unrelated Markdown content was removed.
- `git diff --check` passes for both `0892a0b..7b290c5` and `7b290c5..6def258`.

## Independent checks and bounded regression audit

| Check                                           | Result                                                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact commit/tree binding                       | PASS — HEAD `6def258b517e321db02b5bee43ffa16c9a08edb7`; tree `fb4fbe05c224e6e2caf985a339551537120feeb2`.                                                       |
| Exact Strategy-1 diff/read                      | PASS inventory — 10 files, 473 insertions / 89 deletions; every source and artifact hunk plus final T1 projection/engine and T2 manager/inverse path reviewed. |
| Focused Draft + engine suites                   | PASS — 27 tests, 190 expectations, 0 failed; Draft conformance remains 20 passed / 0 failed / 1 deliberate zero-assertion skip.                                |
| Transaction boundary                            | PASS — 29 contract modules scanned; both rules clean.                                                                                                          |
| Boundary negative control                       | PASS — every forbidden sample caught and every converse control remained clean.                                                                                |
| Type baseline                                   | PASS — TypeScript 5.9.3; exactly 3 current diagnostics, none outside the pinned set.                                                                           |
| Exact Prettier gates                            | PASS — original ten files and Strategy-1 ten files.                                                                                                            |
| Strict UTF-8/BOM/mixed-ending scan              | PASS — 12-file union, zero failures.                                                                                                                           |
| Strict Rasen validation                         | PASS — 1 change, 0 failed, 0 issues.                                                                                                                           |
| Exact range whitespace/scope                    | PASS — both range diff checks clean; Strategy-1 source is confined to four Draft files and two T1 engine-internal files.                                       |
| Native prior-ledger/forward-entry policy path   | PASS — direct reference fixture exposes equivalent preflight/real-undo document and keeps inverse rejection before forward apply.                              |
| Conforming wrapper policy path                  | **FAIL (S1-M1)** — preflight omitted the prior keyed entry, approval succeeded, real undo rejected, forward value remained.                                    |
| Committed-reader encapsulation                  | **FAIL (S1-M1)** — the reader and full document are discoverable through one configurable public-engine Symbol.                                                |
| Single-entity distinct/shared alias regressions | PASS — both directions apply and undo with exact within-entity identity assertions.                                                                            |
| Cross-entity alias restoration                  | **FAIL (S1-M2)** — ordinary marker update terminates `compensation-failed` before durable apply.                                                               |
| Cycle/Map paired-map controls                   | PASS for fresh graphs — isomorphic/split cycles and distinct-to-shared Map values are distinguished.                                                           |
| Shared-identity paired-map negative control     | **FAIL (S1-M2)** — many-to-one graph compared equal because `Object.is` bypassed pair registration.                                                            |
| Minimal ordinary policy-visible compensation    | PASS on the native direct path — only `update-marker`; S1-M1 limits the metadata-equivalence claim.                                                            |
| One-field O(N) / constant-size inverse          | PASS — 8,000-marker regression returns one inverse update and restores first/middle/last observations.                                                         |
| Native error evidence snapshots                 | PASS — Map/Set/Date/RegExp internal slots, cycles/custom properties, getter inertness, freezing, and known T1 prototypes remain covered.                       |
| Draft ID/replay protections                     | PASS — base/incarnation keys, same-Draft retry, arbitrary UTF-16/lone surrogates, and failed-incarnation reservation all pass.                                 |
| Exact ordering/own keys                         | PASS — minimal suffix repair restores collection order and absent clip/marker own properties.                                                                  |
| Conformance public interface                    | PASS — provider retention policy consumer and literal optional feature typing remain green.                                                                    |

## Accepted-known

None. S1-M1 contradicts the complete policy-visible committed-document and no-public-
leak requirements. S1-M2 contradicts the exact provider-private alias-topology and
valid reversible-edit requirements. Neither is suitable for acceptance at ship.

## Durable findings

1. A hidden Symbol attached to a public object is discoverable capability state, not a
   private channel; committed metadata belongs in an inaccessible registry or an
   explicitly enforced internal engine type.
2. Metadata projection must fail closed when complete state is unavailable. Falling
   back to reconstructed business content recreates the exact policy mismatch the
   shared projection was intended to remove.
3. Graph equality is bijective only if every object pair, including identical object
   references, participates in both maps; repair planning must preserve aliases across
   the whole document, not merely within one entity.

No source, planning artifact, run-state, commit, branch, delivery, ship, archive, or
unrelated untracked artifact was modified by this Strategy-1 reviewer. The only write
is this review-cycle report.

---

# Post-cap strategy attempt 2 independent re-review

Date: 2026-08-10

Mode: report-only, Codex-only, fresh non-author leaf reviewer

- Strategy-2 base: `6def258b517e321db02b5bee43ffa16c9a08edb7`
- Strategy-2 tested HEAD: `55db42274fac8e9a64c26053ea1e45d518044455`
- Independently tested HEAD tree: `3bbe042196bee669c2b062c9b193bb45aa84fe1a`
- Exact re-review delta: `6def258b517e321db02b5bee43ffa16c9a08edb7..55db42274fac8e9a64c26053ea1e45d518044455`
- Delta size: 14 files, 1,100 insertions, 113 deletions

## Strategy-2 verdict

**CHANGES REQUIRED — 0 Blocker / 2 Major / 0 Minor / 0 Trivial.**

The public-engine Symbol and the empty-ledger fallback are gone. Ordinary wrappers
without a port fail closed, supplied wrapper ports preserve the prior and forward
ledger entries, capture loss/mismatch is rejected before retention or apply, the
expected-revision write gate closes the approval TOCTOU interval, cross-entity
shared/distinct repairs work for the tested direct graphs, and the 8,000-marker local
edit remains one inverse operation.

Two required proofs remain false. M1's registry is stored in a `WeakMap`, but its
writer is exported and can overwrite the native engine's capture; a deterministic
public flow then reproduces the metadata-incomplete receipt Strategy 2 was meant to
eliminate. M2 registers the directly identical pair, but both equality and alias
inspection stop at that first identical container and never register its descendants;
a nested many-to-one alias collapse is still accepted in both comparison directions.

Tasks 11.1 and 11.2 are therefore checked complete while their corresponding
committed-state provenance and “every object pair” requirements remain unmet. Ship
stays blocked pending a materially different Strategy 3.

## Strategy-2 finding disposition

| Strategy-1 finding                            | Disposition                | Independent evidence                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1-M1 — Symbol reader / empty-ledger fallback | **PARTIAL; Major remains** | No Symbol is attached and missing/failed wrapper capture fails closed. The explicit-port wrapper path sees exact prior + forward entries. However, exported `registerCommittedTransactionStateCapture` can replace the native registry entry, after which approval publishes an undo that the real engine rejects. |
| S1-M2 — non-document-wide graph bijection     | **PARTIAL; Major remains** | Direct cross-track/clip/asset/marker shared↔distinct repairs, Map/Set cycles, one-graph operation cloning, and bounded repair pass. A first-visit identical container still terminates traversal before its nested pairs are registered, so the required identity-shortcut negative control is incomplete.         |
| M3 — exact changed-file formatting            | **RESOLVED**               | All 14 Strategy-2 files pass exact-file Prettier, strict UTF-8/no-BOM inspection, strict Rasen validation, and exact-range `git diff --check`.                                                                                                                                                                     |

## Remaining findings

### S2-M1 — Major — the exported WeakMap writer lets any deep importer forge the native committed-state capture

`apps/web/src/editor/contracts/engine/projection.ts:9-20` keeps the registry itself in
module state, but exports `registerCommittedTransactionStateCapture`. The exported
function performs an unconditional `WeakMap.set`, so a second caller can replace the
capture associated with an already-open native engine. `bindCommittedTransactionStateCapture`
at `projection.ts:31-40` then returns the replacement as if it were native provenance.

The Draft manager automatically trusts that binding at
`apps/web/src/editor/contracts/draft/manager.ts:696-699`. Its sandwich check at
`manager.ts:207-220` can prove revision and public content, but cannot prove the
private ledger that the replacement capture supplied. This is not the documented
explicit wrapper/provider port: it overwrites the implicit native capability itself.

Independent no-write runtime reproduction:

1. Open a native engine and commit a marker under idempotency key `real-prior`.
2. Preserve the real capture, then deep-import the exported registry writer and
   replace the engine's capture with the same detached content/revision but
   `idempotency: []`.
3. Create a native Draft manager without an explicit port. A deterministic undo
   policy accepts only while `real-prior` is absent.
4. Stage and approve one marker update, then apply the published undo.

Observed result:

```text
approvalApplied: true
undo: TransactionError("real prior entry visible")
marker note: "forward"
revision: 2
public engine Symbol count: 0
```

Thus Symbol removal is real, but the stated unforgeable/private provenance is not.
The preflight again sees a metadata-incomplete document, the real undo sees the prior
entry, and forward state remains published. This violates the complete-ledger,
policy-equivalence, and module-private capture requirements.

**Materially different Strategy 3:** make registration non-exported and owned by the
same module that constructs the native engine. For example, keep the `WeakMap` and its
one-time setter inside `engine.ts`, export only a read-only internal binder needed by
the Draft integration, and add an import-boundary rule so no other module can acquire
or replace the setter. Reject duplicate registration defensively. Add an adversarial
regression proving there is no callable overwrite surface and that native provenance
cannot be replaced after engine creation; retain the explicit provider port as the
only wrapper customization path.

### S2-M2 — Major — identity still terminates traversal before nested pairs are registered

`apps/web/src/editor/contracts/draft/inverse.ts:52-61` now registers the directly
compared object in both maps before `Object.is`, but immediately returns on identity.
Its document-wide alias walker repeats the same pattern at `inverse.ts:253-263`.
Neither function descends into the first identical container, so objects reachable
only through that container never participate in the bijection.

Independent non-circular negative control used one identical provider-private
container in the first marker. That container held `nested`; a later second marker
used a distinct-but-equal object on the left and `nested` on the right. The graphs
therefore differ by a nested distinct→shared collapse, but the current comparator
returned:

```text
hasSameDraftContent(left, right) = true
hasSameDraftContent(right, left) = true
```

The added test at `draft.test.ts:916-949` covers a directly identical leaf followed by
a collapse, so it passes; it does not cover an identical container whose descendants
participate in the later alias. This contradicts the Strategy-2 spec's “every object
pair is registered before identity can terminate comparison” scenario and leaves the
same blind spot in repair-owner discovery.

**Materially different Strategy 3:** on a first-seen object pair, register both
directions and still descend even when `left === right`. Cycle termination already
exists in the preceding paired-object branch, so revisiting a self-cycle can return
there without an identity early exit. Apply the same rule to `inspectDraftAliases`,
including Map keys/values and Set members. Add the nested identical-container negative
control above, plus a repair-path version whose direct identity assertions—not the
production comparator—prove the affected owners and restored topology.

## Confirmed behavior and bounded regression audit

- Missing wrapper capability returns `committed-state-unavailable:missing-capability`
  before a Draft exists; capture failure at approval is terminal before parent apply.
- A forced same-revision public/capture content mismatch returns
  `committed-state-unavailable:state-mismatch`; failed open releases the Draft id, and
  the same id opens after the port recovers. Approval mismatch calls neither retention
  nor parent apply.
- A mutation injected after approval capture but during retention advances only the
  external transaction. The Draft's final expected-revision apply fails, leaving only
  the external marker and no Draft forward marker.
- A supplied wrapper port exposes the prior ledger and forward entry identically to
  compensation preflight and actual undo; the direct official regression passes.
- The exact native capture is detached through complete-graph cloning. The engine and
  manager import the same relative projection module; an in-memory two-entry Bun build
  succeeds with one `committedStateCaptures` WeakMap declaration, so no ordinary
  same-realm bundle-copy availability regression was found. A wrapper remains a
  deliberately different identity and must supply the documented port.
- Cross-track/clip/asset/marker distinct↔shared repair, cyclic Map/Set topology,
  minimal policy-visible inverse behavior, exact own keys/order, error-evidence
  hardening, Draft id/replay protection, and all prior conformance cases remain green.
- The nested-identity failure above and the forged native registry are the only open
  findings from the bounded earlier-T2 audit. No Minor/Trivial item is accepted-known.

## Independent checks

| Check                                       | Result                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact commit/tree binding                   | PASS — HEAD `55db42274fac8e9a64c26053ea1e45d518044455`; tree `3bbe042196bee669c2b062c9b193bb45aa84fe1a`.                                       |
| Exact Strategy-2 diff/read                  | PASS inventory — 14 files, 1,100 insertions / 113 deletions; every exact-range hunk and final M1/M2 path reviewed.                             |
| Focused Draft + engine suites               | PASS — 32 tests, 240 expectations, 0 failed.                                                                                                   |
| Reusable Draft conformance                  | PASS through the focused suite — 20 passed / 0 failed / 1 deliberate zero-assertion skip.                                                      |
| Native Symbol / empty-ledger removal        | PASS — zero public-engine Symbols; no content-only committed-base fallback remains.                                                            |
| Wrapper missing/lost capability             | PASS — open/approval fail closed with no Draft forward mutation.                                                                               |
| Explicit wrapper ledger equivalence         | PASS — prior + forward key/fingerprint/result/revision observations match preflight and actual undo.                                           |
| Approval mismatch / TOCTOU probes           | PASS — ids recover after failed open, retention is not called on approval mismatch, and expected revision rejects a concurrent write interval. |
| Native capture overwrite probe              | **FAIL (S2-M1)** — exported writer replaces the registry entry; approval succeeds, real undo rejects, forward value remains.                   |
| Direct cross-entity alias restoration       | PASS — both shared↔distinct directions across two tracks, clips, assets, and markers restore direct identity.                                  |
| Cyclic Map/Set unrelated-edit topology      | PASS — one inverse update preserves the shared cycle and container identities.                                                                 |
| Nested identical-container negative control | **FAIL (S2-M2)** — both comparison directions return true for a real nested alias collapse.                                                    |
| Minimal/O(N) compensation                   | PASS — 8,000-marker one-field edit returns one `update-marker`; cross-collection repair remains bounded.                                       |
| In-memory module/bundle identity probe      | PASS — browser ESM build succeeds with one WeakMap declaration across the engine/manager entry graph.                                          |
| Transaction boundary                        | PASS — 29 contract modules scanned; both rules clean.                                                                                          |
| Boundary negative control                   | PASS — every forbidden sample is caught and converse controls remain clean.                                                                    |
| Type baseline                               | PASS — TypeScript 5.9.3; exactly 3 current diagnostics, none outside the pinned set.                                                           |
| Strict Rasen validation                     | PASS — 1 change, 0 failed, 0 issues.                                                                                                           |
| Exact-file Prettier / whitespace            | PASS — all 14 Strategy-2 files formatted; exact-range `git diff --check` clean.                                                                |
| Strict UTF-8/text integrity                 | PASS — all 14 files decode strictly with zero BOM, U+FFFD/mojibake, NUL, or stray CR findings.                                                 |

## Accepted-known

None. S2-M1 reopens the exact invalid-receipt behavior under a callable native-capture
overwrite, and S2-M2 violates an explicit exact-graph requirement. Neither is safe to
accept at ship.

## Durable findings

1. A private `WeakMap` does not make provenance unforgeable when its unconditional
   writer is exported; the registry setter must be construction-owned and unavailable
   after native engine creation.
2. Register-before-identity is insufficient when identity still skips descendants.
   First-seen identical containers must be traversed; the existing paired-object branch
   is the cycle guard.
3. Green conformance and direct alias tests do not prove graph exactness or capability
   provenance. Adversarial controls must target the first identity shortcut and every
   callable registry mutation surface.

No source, planning artifact, run-state, commit, branch, delivery, ship, archive, or
unrelated untracked artifact was modified by this Strategy-2 reviewer. The only write
is this review-cycle report.

# Post-cap strategy attempt 3 independent re-review

Date: 2026-08-10

Mode: report-only, fresh non-author Codex leaf; no delegation

- Strategy-3 base: `55db42274fac8e9a64c26053ea1e45d518044455`
- Independently tested HEAD: `ac2590ccd2f4d462c74653146849f0d0f1ef5ade`
- Independently tested HEAD tree: `3bd5ac8d115d935da4e3625e9863137b731d7d8b`
- Exact re-review delta: `55db42274fac8e9a64c26053ea1e45d518044455..ac2590ccd2f4d462c74653146849f0d0f1ef5ade`
- Delta size: 10 files, 562 insertions, 128 deletions

## Strategy-3 verdict

**CLEAN — 0 Blocker / 0 Major / 0 Minor / 0 Trivial.**

The final post-cap strategy closes both Strategy-2 Major findings. Native committed
capture now has one construction-owned, duplicate-rejecting writer that is unavailable
from every module namespace, barrel, and engine object. Native provenance takes
precedence over caller-supplied substitutes; wrapper capabilities are copied into a
frozen once-bound port and missing capabilities fail closed. A separately bundled
engine/manager pair also failed closed without an explicit provider port, so module
identity loss did not activate an implicit fallback.

The graph comparator and repair-owner walk now descend through every first-seen
identical container and terminate object traversal only through an already-recorded
matching pair. Paired maps enforce both directions, custom native-container data and
typed-array backing buffers participate in the graph, and one document-wide repair
context restores cross-entity identity. Direct non-circular identity assertions—not
the production comparator or JSON serialization—confirmed the restored topology.

No Blocker or Major remains after the final strategy budget. No escalation is required,
and the review-loop may be marked clean.

## Strategy-3 finding disposition

### S2-M1 — exported/overwriteable native capture writer

**RESOLVED.**

- `engine.ts` owns the only `nativeCommittedStateCaptures` `WeakMap` and its private
  `registerNativeCommittedStateCapture` closure. The setter rejects a second entry
  before `WeakMap.set`; repository-wide search found no other runtime writer.
- Compile-only module-key assertions and independent runtime namespace inspection show
  that the construction module exports only `openTransactionEngine` plus the read-only
  binder, while `projection.ts` exports only the pure commit projection. The engine
  barrel exports neither binder nor writer, and the public engine has no Symbol or
  capture/register property.
- The native binder returns a frozen port and detached documents. Mutating one captured
  ledger did not affect a later capture. A supplied forged native port was ignored;
  the construction-owned capture retained the real prior entry.
- Wrapper omission returned `committed-state-unavailable:missing-capability`. A valid
  explicit wrapper port remained usable after its caller replaced the original
  `capture` property, proving the manager had bound the function once.
- Two independent standalone ESM bundles were built in memory—one for engine
  construction and one for the manager. The copied manager could not silently bind the
  foreign native registry and failed closed without a port; only an explicitly supplied
  provider port enabled the wrapper path.
- A deterministic policy recorded the complete `{ document, batch }` presented during
  compensation preflight and the real published undo. Independent
  `deepStrictEqual` comparison passed for both observations, including revision,
  pre-existing and forward idempotency entries, fingerprints, results, content, and
  undo batch. The undo restored the prior marker value.

### S2-M2 — first-seen identical containers skipped descendants

**RESOLVED.**

- `sameDraftData` registers both weak-map directions before traversing and has no
  first-identity return. `inspectDraftAliases` follows the same rule. Their prior-pair
  branches are now the only object-cycle termination points.
- Independent bidirectional alias-collapse probes passed for first-seen identical plain
  objects, arrays, Map keys, Map values, Set members, Date and RegExp custom data,
  ArrayBuffer custom data, typed-array custom data, and typed-array backing buffers.
- Isomorphic self-cycles compared equal, while shared-to-split and split-to-shared
  cycle controls compared unequal, confirming that cycle termination requires an
  existing matching pair.
- A non-circular cross-entity repair hid a later distinct-to-shared collapse beneath
  an identical track container and a marker. Planning emitted the required
  `update-track` plus `update-marker`; independent direct identity assertions proved
  the restored values were structurally equal but referentially distinct.
- The full focused suite also re-confirmed both shared/distinct directions across
  tracks, clips, assets, and markers; cyclic Map/Set topology; exact published undo;
  and the one-operation 8,000-marker bound.

## Independent checks and bounded earlier-T2 regression

| Check                                     | Result                                                                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact commit/tree and range               | PASS — HEAD `ac2590ccd2f4d462c74653146849f0d0f1ef5ade`; tree `3bd5ac8d115d935da4e3625e9863137b731d7d8b`; exact range contains 10 allowed files.                                                                                                           |
| Full exact-delta/source/spec read         | PASS — all production, test, type-boundary, design, task, and implementation-report hunks were independently reviewed against tasks 12.1–12.3 and the original T2 scope.                                                                                  |
| Focused Draft + engine suites             | PASS — 35 tests, 276 expectations, 0 failures.                                                                                                                                                                                                            |
| Reusable Draft conformance                | PASS inside the focused suite — 20 passed, 0 failed, 1 deliberate zero-assertion skip; repeated/concurrent and mutation negative controls also passed.                                                                                                    |
| Capture namespaces and public object      | PASS — no discoverable runtime writer, no unreviewed module export, no engine Symbol/capture/register property, and detached frozen native port behavior.                                                                                                 |
| Duplicate/overwrite/substitution controls | PASS — private setter rejects duplicates by source inspection and compile boundary; forged native option called 0 times; native and wrapper late-replacement probes passed.                                                                               |
| Separate-bundle identity control          | PASS — no explicit port produced `missing-capability`; only the deliberate explicit provider-port path opened.                                                                                                                                            |
| Prior-ledger policy equivalence           | PASS — two complete policy contexts were independently deep-equal; prior + forward ledger and published undo matched and restored base.                                                                                                                   |
| First-seen container adversarial matrix   | PASS — 10 bidirectional object/array/Map/Set/Date/RegExp/ArrayBuffer/typed-array cases, including Map keys and backing-buffer aliasing.                                                                                                                   |
| Document-wide cross-entity repair         | PASS — two necessary inverse operations and direct distinct-identity restoration across track/marker owners.                                                                                                                                              |
| Earlier T2 functional findings            | PASS — conformance boundary, Draft-id incarnation/replay, absent-own-property undo, immutable engine errors, metadata-bearing projection, wrapper loss/mismatch, TOCTOU, cross-collection aliases, Map/Set cycles, and bounded compensation remain green. |
| Transaction boundary                      | PASS — 30 contract modules scanned; both rules clean.                                                                                                                                                                                                     |
| Boundary negative control                 | PASS — every forbidden sample was caught and every converse control remained clean.                                                                                                                                                                       |
| Type baseline                             | PASS — TypeScript 5.9.3; exactly 3 current diagnostics, none outside the pinned baseline; capture-boundary type assertions included.                                                                                                                      |
| Strict Rasen validation                   | PASS — 1 change, 0 failures, 0 issues.                                                                                                                                                                                                                    |
| Exact-file Prettier and whitespace        | PASS — all 10 exact-range files use Prettier style; exact-range `git diff --check` is clean.                                                                                                                                                              |
| Strict UTF-8/text integrity               | PASS — all 10 files decode strictly as UTF-8 with no BOM, U+FFFD/mojibake, NUL, or stray CR.                                                                                                                                                              |
| JSON-oracle and scope checks              | PASS — zero JSON equality oracles in the seven changed TypeScript files; no source outside the T2 Draft/T1-internal and owned change-artifact roots.                                                                                                      |

## Accepted-known

None.

## Durable findings

1. A native capability registry is construction-owned only when the write closure and
   object construction share one module, duplicate writes fail, and every public/deep
   namespace exposes at most a detached read-only binder.
2. Module copies must be treated as a capability boundary: loss of registry identity
   fails closed, while wrapper/provider recovery must remain an explicit port choice.
3. Graph bijection requires descending every first-seen identical container. Registering
   the outer pair is insufficient unless Map keys/values, Set members, custom data,
   backing buffers, and cross-entity owners all join the same traversal.

No source, planning artifact, run-state, commit, branch, delivery, ship, archive, or
unrelated untracked artifact was modified by this Strategy-3 reviewer. The only write
is this review-cycle report.
