# Handoff — C5 migration lifecycle fixer round 2

Date: 2026-08-02  
Findings: B2, M1, M2, M3 / test gaps 2–5  
State: done, verified, uncommitted

## What changed

- The complete migration transaction runs as `all-projects` in the shared
  durable-identity `BrowserMutationQueue`.
- Same/cross-wrapper save, remove, projects clear, and all clear now order with
  migration in both directions.
- Eager initialization clears a rejected instance promise, emits a fixed
  mechanism-neutral warning, and rebuilds on the next session attempt using the
  same stable store.
- Host preparation catches now publish a fixed diagnostic instead of silently
  discarding their only failure signal.
- Migration persists a recovery record before its first cleanup-intent write and
  before destination commit.
- Stage databases and original/expected rows remain until committed readback is
  validated. Initialization and `prepareForSession()` retry recovery independently
  of migration-once state.
- Recovery respects later current saves and committed deletes/clears; it never
  resurrects them with a stale stage.
- Blocked IDB open requests close any connection that succeeds after the rejection.
- Added eight round-2 result axes backed by 16 lifecycle races plus init,
  cleanup-intent, and commit-readback fault probes.

## Invariants for the next session

- Keep migration staging, recovery-intent, cleanup-intent, commit validation, and
  finalization inside one shared `all-projects` queue operation.
- The recovery record must exist before the cleanup journal or any destination put.
  Do not downgrade it to an in-memory target list.
- Never delete stage databases while a recovery record can reference them.
- Recovery may recommit only when the destination still equals the recorded
  original. An absent destination means a later delete/clear; a different current
  row means a later save. Both must win.
- Delete the recovery record only after destination validation. Physical cleanup
  may then proceed from the separately persisted cleanup journal.
- A failed eager initialization promise must be replaceable on the same instance.
  Preserve identity-level coalescing and fixed payload-free diagnostics.
- Keep migration maintenance and cascade maintenance in their separate object
  stores. Do not alter the typed cascade key/target rules.

## Verification snapshot

- RED: all 8 migration-round2 axes false; Playwright 0/1.
- GREEN: Chromium 151.0.7922.34, 1/1; lifecycle races **16/16**.
- Full matrix: store 19/19; migration R1 16/16; cascade R1 9/9; cascade R2 6/6;
  corruption 6/6; active abort 7/7.
- Focused tests: 21/21, 46 assertions.
- Vite TypeScript and type baseline: PASS (3 inherited diagnostics only).
- Storage/port/Host/session boundaries: PASS (720 modules; 30 contracts;
  2 roots/717 modules; 10/10 factories and keys).
- ESLint, Prettier, whole-tree diff check, strict validation: PASS.
- Disposable databases/stages: cleaned; port 4175: no listener; Playwright
  `.last-run.json`: removed.

Full evidence: `evidence/fix-migration-round2.md`.

## Ownership notes

The exact write set is in the evidence file. Shared store/migration/mechanism/
harness surfaces retain the cascade round-2 maintenance store, typed journals,
atomic namespace clear, and `clear(all)` recovery work. This fixer did not edit
consumer/library/preset/coordinator logic, protected `create-session.ts` or
`session-types.ts`, tasks, or review reports. No commit was created.
