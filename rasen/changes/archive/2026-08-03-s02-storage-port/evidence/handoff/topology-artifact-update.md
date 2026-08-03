# C5 topology planning-artifact update

Date: 2026-08-02  
Planning root: `rasen/changes/s02-storage-port`  
Scope: planning artifacts only; no product-worktree, task, run-state, prior-evidence/review,
portfolio, or commit changes

## Changes

- `proposal.md`: added centralized private authorization by mutation granularity, current/retained
  fail-closed coverage, explicit no-public-port/no-journal widening, and attempt-4 write-set impact.
- `design.md`: added Decision 9 for exact library pairs, whole media/migration databases, exact
  OPFS roots, reserved project/control pairs, the valid shared-PDB library case, current precommit,
  historical retention, migration pre-discovery batch authorization, frozen permits, generic
  diagnostics, risk mitigation, and the exact minimum attempt-4 write set.
- `specs/browser-persistence-boundary/spec.md`: added the topology-safe physical authority
  requirement and scenarios for reserved/safe library pairs, ordinary media first access against
  current and retained libraries, protected media targets, current precommit, historical cascade,
  current/historical migration full-batch authorization, and safe exact retry.
- `specs/host-port-contract/spec.md`: extended failure non-leakage to topology/configuration errors
  and kept topology policy/permits out of public `ProjectStore`.

## Validation

`rasen validate s02-storage-port --project rocut --strict --json` from the `rocut` planning repo:
exit 0; 1 item passed, 0 failed, 0 issues.

## Status boundary

These artifacts describe the required invariant; they do not claim the current product fixer or
review is green. The canonical review remains `FINDINGS` with two Major requirements to verify:
ordinary media first access must include current/retained library claims, and migration must obtain
full authorization before IndexedDB/OPFS discovery. Canonical product documentation remains task
12.3 and was not changed by this planning-only update.
