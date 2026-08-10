## Why

T1 made atomic, revisioned transactions durable, but an Agent still cannot stage several edits for review without exposing partial work or risking a stale overwrite. T2 adds an isolated Draft workflow so reversible project-content edits can be accumulated, reviewed, rejected, or approved as one transaction while operations with external side effects remain immediate and non-rejectable.

## What Changes

- Add isolated Draft editing sessions under `apps/web/src/editor/contracts/draft/**`; every Draft captures one consistent base snapshot and shares its parent session's transaction engine while maintaining private working content and an ordered operation journal.
- Evaluate each Draft tool call against a savepoint with T1's shared transaction evaluator. A failed call rolls back that call completely without changing earlier accepted Draft work, the durable project, revision, idempotency state, or watchers.
- Support explicit `manual` and `auto` approval modes. Manual Drafts remain reviewable until approved or rejected; auto Drafts use the same state machine and apply path but approve after each successful Draft call.
- Generate review summaries from structured accepted operations and expose deterministic Draft status/errors rather than relying on Agent-authored prose.
- Approve a Draft by flattening its accepted operations in original order into one T1 transaction batch with the captured base revision as `expectedRevision`; stale Drafts fail with a conflict and never silently rebase or fall back from manual to auto.
- Return a structured application receipt and inverse-operation plan representing the approved Draft as one undo unit. T3 may later attach that unit to the UI command journal; T2 does not modify `commands/**`.
- Define a closed, type-level and runtime classification of Draft-safe reversible project-content operations versus immediate side-effecting operations. Generation, export, source-package deletion, external-resource deletion, and other external effects are rejected by the Draft path and exposed only through a separate immediate interface.
- Retain or preflight every asset resource referenced by accepted Draft content so applied content remains usable if a source package is removed later, without making package deletion part of the Draft.
- Add reusable Draft conformance coverage for multi-Draft isolation, per-call rollback, approval state transitions, stale rejection, one-batch apply, structured undo receipts, operation classification, and immediate-path rejection.
- Keep the T0/T1 public contract frozen. Narrow T1-internal changes may provide
  committed-state capture and preserve one batch's private reference graph; do not
  change `commands/**`, session/Host ports, Surface/Host composition, Rust, or WASM.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `transaction-automation-api`: add isolated multi-step Draft sessions, approval/rejection semantics, conflict-safe atomic application with a structured undo receipt, and the Draft-safe versus immediate-operation contract.

## Impact

- Product/test touch set: `apps/web/src/editor/contracts/draft/**` plus narrowly
  scoped T1-internal capture/projection/evaluator support. The T0/T1 public barrel,
  types, and method surface remain unchanged.
- Dependency: archived and review-clean T1 transaction engine. All Drafts created for one editor session must share that engine because `ProjectStore` does not provide cross-engine compare-and-swap.
- Downstream: T3 can consume the structured one-undo receipt when routing UI commits, and T4 can use Draft review/apply evidence; neither integration is implemented here.
- Verification preserves the transaction boundary check and negative control, type-baseline ceiling of 3, both Host builds/parity, and a falsification sweep over every current capability spec.
