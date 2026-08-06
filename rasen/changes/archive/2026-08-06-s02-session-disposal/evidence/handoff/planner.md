# C6 Planner Handoff

## Status

`DONE` — the ONE_SHOT `s02-session-disposal` planning package is complete, strict-valid, and
apply-ready. No product code was edited and no commit, push, PR, merge, integration, ship, archive,
parent-state update, or runstate write was performed.

## Start identity

- HEAD: `d6ed4166b5ffb13257d1924851f2fa57d73d349f`
- tree: `3875074383b41f622e5f32942091468cf8959b61`
- includes C5 product commit: `0bfcf0457385b55de815c75ec712e9b9d69da242`
- verified clean read-only integration worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-s02`

Implementation must stop if these identities or the protected identities in `design.md` and
`evidence/planning-audit.md` do not match.

## Deliverables

- `.openspec.yaml`: Rasen change scaffold metadata.
- `proposal.md`: motivation, scope, new capability declaration, protected impact.
- `design.md`: design-it-twice comparison, selected deep interface, lifecycle/resource/GPU/browser
  decisions, expected write set, risks, rollback, and verification/delivery separation.
- `specs/session-resource-disposal/spec.md`: 14 ADDED requirements and 59 scenarios.
- `tasks.md`: 137 unchecked RED/GREEN, implementation, browser, regression, review, evaluation, and
  separate delivery tasks.
- `evidence/planning-audit.md`: authority/base/current-product findings, exact identities, counts,
  scope boundaries, risks, and validation result.

## Implementation spine

1. Freeze the exact C5-inclusive base and reproduce inherited red identities.
2. Add private serialized lifecycle/admission and an awaitable exhaustive resource drain without
   widening public session/Host/port/report types.
3. Propagate existing session resources through all live timer, Worker, audio, object-URL, cache,
   service, and compositor ownership paths.
4. Add a serialized final-owner shared-WASM lease; release exact session handles first and call
   `disposeGpu()` only after a live empty-handle query on the final lease.
5. Widen the acquisition boundary with exact classifications, empty-inventory guards, and a
   non-zero violating fixture for every rule.
6. Reuse one at-least-six-cycle evaluator in fresh marked Vite and Next production-shaped Hosts;
   require CREATED for all five classes, zero per-cycle exact residuals, monotonicity assessment,
   and the same evaluator rejecting a deliberate leak.
7. Run the full C3/C4/C5/provenance/parity/type/full-suite and 13-main-spec two-way verification
   tail, then independent review and the mandated fresh-Sol Luna evaluation synthesis.
8. Leave local ship, portfolio integration, spec sync, and archive to their separately assigned
   leaves.

## Decisions that must not be reopened casually

- Suspend is quiescence with retained identity/root, not dispose-and-recreate.
- The public resource/session/Host surface remains frozen; lifecycle coordination is private.
- Terminal cleanup is awaited, exhaustive, reverse-order, stable, and truthful on failure.
- `OfflineAudioContext` is operation-bounded and mechanically classified.
- C4 Host-owned Worker construction and C5 durable store topology are preserved.
- Shared GPU teardown is a serialized last-owner operation, never per-session teardown.
- Exact class/platform observations dominate noisy heap/listener diagnostics.
- D2 is unmade; C7 and E1 remain out of scope.

## Open risks, not open product questions

- Synchronous platform terminators require exact probe bookkeeping to catch attempted-but-not-real
  cleanup.
- Concurrent final GPU lease release must keep one query alive until reconciliation and teardown.
- The editor acquisition graph is wide; implementation must preserve exact inventory attribution
  and avoid broad exemptions.
- C5's inherited failures and exact type ceiling must remain identity-stable; no rebaseline is
  authorized.

## Validation

`rasen validate s02-session-disposal --project rocut --strict` exited 0 with
`Change 's02-session-disposal' is valid`.

`rasen status --change s02-session-disposal --project rocut --json` reports `isComplete: true` and
all four planning artifacts `done`.
