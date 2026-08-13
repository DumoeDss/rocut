## 1. Draft interface and classification seam

- [x] 1.1 Create the additive `apps/web/src/editor/contracts/draft/**` layout and a `draft/index.ts` entry point without editing the frozen root `contracts/index.ts`, T1 `engine/**`, or any caller
- [x] 1.2 Define immutable Draft ids, approval modes, lifecycle states, snapshots, tool-call inputs, review entries, application receipts, and undo-plan types using only T0/T1 Host-neutral contract types
- [x] 1.3 Define structured open, call, retention, invalid-state, apply, and conflict outcomes/errors with expected/actual revision detail where applicable
- [x] 1.4 Implement exhaustive type-level and runtime classification registers for Draft-safe transaction operations and named immediate categories, including runtime rejection of forged immediate input and no generic invoke escape hatch
- [x] 1.5 Define the read-only `DraftResourceRetentionPolicy` preflight interface and an in-memory conformance adapter that reports structured retained/missing asset evidence without performing external deletion

## 2. Consistent snapshots and lifecycle ownership

- [x] 2.1 Implement bounded revision-sandwich snapshot acquisition over project/tracks/clips/assets/markers, discarding torn attempts and returning a structured busy/conflict failure on exhaustion
- [x] 2.2 Implement `createDraftEditingManager` over one injected parent `TransactionEngine`, enforce stable non-empty unique Draft ids, and ensure every opened Draft shares that engine rather than opening another
- [x] 2.3 Store a deep-cloned immutable base, private working document, and private ordered journal per Draft; defensively clone/freeze every value returned through the public interface
- [x] 2.4 Add a non-poisoning per-Draft invocation queue and enforce the `editing → applying → applied|conflicted` and `editing → rejected` terminal state machine for manual Drafts
- [x] 2.5 Implement explicit auto mode so the first successfully staged call enters the same approval path, becomes terminal after the apply attempt, and never silently resets its base or falls back to another mode

## 3. Per-call savepoints and structured review

- [x] 3.1 Evaluate each non-empty Draft tool call against a clone/savepoint with T1's `evaluateTransactionBatch`, using the working revision internally and withholding caller idempotency/expected-revision metadata
- [x] 3.2 Thread the manager's frozen provider placement-policy list through Draft evaluation and make validation, placement, provider-policy, and thrown-policy failures leave the queue usable
- [x] 3.3 Replace the working document and append deep-cloned operations only after a complete call succeeds; prove every failed multi-operation call preserves the exact prior working document and journal
- [x] 3.4 Derive immutable review entries and aggregate counts exclusively from the accepted structured journal, preserving stable call/operation order and affected entity ids
- [x] 3.5 Reject empty approval, mode-incompatible approval, staging/rejection after a terminal transition, and queued calls that observe an earlier terminal transition with stable invalid-state outcomes

## 4. Retention, one-batch apply, and inverse receipt

- [x] 4.1 Implement inverse planning for every T0 operation kind by simulating the forward journal from the base, restoring update pre-images, and preserving referential order for cascades such as delete-track plus its clips
- [x] 4.2 Compute the final candidate's referenced asset ids and require successful structured retention preflight before any parent-engine apply; map missing/failed evidence without changing durable state
- [x] 4.3 Flatten all accepted operations in original order into one final `TransactionBatch` with the captured durable base revision and deterministic Draft-id apply idempotency key
- [x] 4.4 Call the shared parent engine `apply` exactly once, transition an expected-revision failure to terminal `conflicted`, and prohibit rebase, second apply, mode change, save, revision, or watch leakage on failure
- [x] 4.5 Return one defensively immutable `DraftApplicationReceipt` containing origin/mode, base/applied revisions, review, forward batch/result, retention evidence, and one compensating transaction
- [x] 4.6 Give the compensating transaction the applied revision and a stable undo idempotency key; prove one apply restores the base content and a later intervening edit makes the undo conflict
- [x] 4.7 Preserve T1 error ownership for engine failures and ensure all Draft-specific failure paths remain structured, terminal where specified, and idempotent when the caller re-observes an applied receipt

## 5. Draft conformance and focused tests

- [x] 5.1 Add generic `runDraftEditingConformance(factory)` reporting with assertion/result arrays local to each run and fixture typing that preserves literal optional engine feature names
- [x] 5.2 Add snapshot and isolation cases for a clean revision sandwich, bounded torn-read retry/exhaustion, unique ids, two independent same-base Drafts, defensive clones, and zero durable effects while editing
- [x] 5.3 Add per-call cases for dependent successful calls, a failing middle operation, provider-policy rejection, thrown-policy recovery, prior-call preservation, operation order, and no save/revision/watch/idempotency effects
- [x] 5.4 Add mode/review cases for multi-call manual approve/reject, auto success/conflict, fixed modes, structured summary derivation, same-Draft call ordering, empty approval, and every terminal invalid-state transition
- [x] 5.5 Add apply/undo cases for one flattened apply/save/revision/watch, first-sibling-wins stale rejection, stable retry observation, every inverse operation kind, track-cascade restoration, and stale undo refusal
- [x] 5.6 Add classification/retention and negative-target cases proving exhaustive registers, forged immediate rejection before mutation, project-delete versus external-delete distinction, no generic invoke surface, referenced-asset preflight failure, source-package independence, repeatable/concurrent run-local accounting, and that each deliberate protocol violation produces a named failure

## 6. Verification and scope gates

- [x] 6.1 Run the focused Bun Draft test/conformance suite plus the existing T0/T1 transaction suites and record zero failed executed cases without changing their generic runner behavior
- [x] 6.2 Run `node script/check-transaction-boundary.mjs` and `node script/check-transaction-boundary.mjs --negative-control`; confirm every new `draft/**` module is scanned and every negative rule remains sensitive
- [x] 6.3 Run `node script/check-type-baseline.mjs` and confirm the diagnostic count does not exceed the pinned ceiling of 3; do not regenerate the fixture
- [x] 6.4 Build `apps/web` and `apps/vite-example`; keep Vite green and, if the known missing-Freesound-environment `/api/sounds/search` Next build failure remains, demonstrate it matches the pre-existing baseline rather than hiding it as a T2 regression
- [x] 6.5 Run the established editing parity fixture against both Hosts and confirm zero semantic differences, because T2 adds no runtime caller or Host wiring
- [x] 6.6 Sweep every current `rasen/specs/*/spec.md` capability for SHALL/MUST assertions falsified by the T2 diff, including all pre-T0 capabilities and the canonical `transaction-automation-api`
- [x] 6.7 Audit the product-source diff as additive-only `apps/web/src/editor/contracts/draft/**`: no T0/T1 file, `ports/**`, session, commands, Surface, Host root, Rust, generated WASM, type-baseline fixture, or parity-oracle edit
- [x] 6.8 Strictly decode every new/modified text artifact as UTF-8 and inspect the diff for replacement characters, mojibake, unexpected BOMs, mixed line endings, secrets, or unrelated whole-file rewrites
- [x] 6.9 Run `rasen validate s0304-draft-editing-sessions --strict --project rocut --json` and resolve every artifact/spec error before implementation is reported apply-ready

## 7. Review-cycle round 1 repairs

- [x] 7.1 Decouple the reusable conformance fixture from in-memory retention controls and compile/run a provider-policy consumer regression
- [x] 7.2 Namespace apply/undo idempotency by Draft base and incarnation, preserve same-Draft retry stability, and reject replay-shaped revision results
- [x] 7.3 Restore absent versus explicitly undefined clip/marker properties exactly and replace JSON equality proofs with own-key-aware structural checks
- [x] 7.4 Clone and recursively freeze parent-engine errors and nested scope/revision evidence while preserving their T1 prototypes
- [x] 7.5 Bind proportionate Vite/Next build and parity evidence to the exact tested source commit/tree

## 8. Review-cycle round 2 repairs

- [x] 8.1 Reconstruct ordered transaction content through the frozen T1 operation surface so one undo restores complete track/clip/asset/marker order, optional-property presence, references, and provider-private pre-images after delete/recreate edits
- [x] 8.2 Encode every JavaScript Draft id injectively as UTF-16 code units before reservation; prove lone-surrogate acceptance, collision separation, duplicate behavior, and retry after incarnation-key failure
- [x] 8.3 Sanitize generic engine-error evidence without invoking getters or retaining executable/live values; support cycles, symbols, bigints, functions, and nested custom errors while preserving frozen `TransactionError` and `ProjectStoreError` semantics

## 9. Review-cycle round 3 repairs

- [x] 9.1 Replace whole-document undo reconstruction with a linear T2-private planner that emits direct inverse updates and recreates only the smallest ordered suffix required for insertion, reordering, or own-property removal
- [x] 9.2 Preflight the exact compensation against the projected post-forward candidate and the same provider policies before parent-engine apply; return a structured terminal failure without durable mutation when the inverse is rejected or throws
- [x] 9.3 Add an adversarial provider policy that rejects unrelated create/delete operations, exact minimal-suffix operation-count proof, and an 8,000-marker regression proving one field edit returns one inverse operation
- [x] 9.4 Preserve Map, Set, Date, and RegExp error evidence as deeply frozen tagged internal-slot snapshots, including nested cycles and custom data properties, without invoking evidence-owned accessors or weakening known T1 error semantics

## 10. Post-cap strategy attempt 1 repairs

- [x] 10.1 Extract one pure T1 committed-document projection helper, reuse it in durable apply and T2 compensation preflight, and prove deterministic policy-visible revision/idempotency equivalence with inverse rejection still blocking before forward apply
- [x] 10.2 Make private-data graph equality bijective with paired weak maps and prove both distinct-to-shared and shared-to-distinct provider-private edits approve and undo to the exact base alias topology
- [x] 10.3 Format only the three reported Markdown artifacts and rerun focused suites, public policy/idempotency/alias probes, boundary/negative control, type baseline, strict UTF-8/BOM, strict Rasen validation, exact changed-file Prettier, and diff/scope checks

## 11. Post-cap strategy attempt 2 repairs

- [x] 11.1 Remove the public-engine Symbol reader and empty-ledger fallback; bind native capture through private module state, require an explicit wrapper/provider port, and fail closed at open and approval when exact committed state is unavailable
- [x] 11.2 Register object pairs before identity comparison, plan alias repair with one document-wide graph, clone operation batches once, and prove shared/distinct, cycle, Map/Set, and cross-track/clip/asset/marker topology by direct identity assertions
- [x] 11.3 Rerun focused/adversarial Draft and engine suites, public wrapper/capability/ledger/alias probes, boundary/negative control, type baseline, strict validation, exact-file Prettier, UTF-8/BOM, diff/scope checks, and commit only the strategy-2 delta

## 12. Post-cap strategy attempt 3 repairs

- [x] 12.1 Move the native committed-state `WeakMap` and defensive one-time setter into the engine construction module; expose no writer under any name, preserve only the read-only internal binder, prefer native provenance over supplied substitutes, and bind wrapper ports once
- [x] 12.2 Traverse every first-seen identical object/container pair and terminate only through a previously recorded matching pair; include plain arrays/objects, Map/Set entries, tagged native custom data, typed-array backing buffers, cycles, both comparison directions, and repair-owner discovery with a direct non-circular identity oracle
- [x] 12.3 Rerun focused/adversarial Draft and engine suites, compile/runtime capture-boundary proofs, native/wrapper prior-ledger equivalence, graph and real-undo probes, transaction boundary/negative control, type baseline, strict validation, exact-file Prettier, strict UTF-8/BOM, diff/scope checks, and commit only the strategy-3 delta
