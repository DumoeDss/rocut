# C5 reviewer round 3 handoff

## Status

**CHANGES REQUIRED** against explicit base and current HEAD
`0ef35459f685d5d41a25d0ef959aff691b7519cd`.

- Blocker: 0
- Major: 2
- Minor: 0
- Test-gap: 2
- Product/task/existing-evidence edits by reviewer: 0
- Commit created by reviewer: no

Full findings, prior-round dispositions, Chromium counterexamples, and command evidence:
`evidence/review-round3.md`.

## Remaining majors

1. After migration fails during committed readback, a later successful same-key attachment
   replacement/removal is not represented in recovery precedence. Reopen repeatedly rejects
   initialization while the newer attachment remains durable.
2. Without `indexedDB.databases()`, projects/all clear knows the project IDs but journals no
   derived media-database targets. `clear(all)` resolves while the media database remains, and a
   same-ID project reuse exposes a corrupt old attachment record.

## Required regression evidence

1. Fault after destination put, then later attachment replace **and** remove, runtime reset/new
   wrapper: later operations win, recovery finalizes, and session initialization succeeds.
2. Projects/all clear with database enumeration unavailable: derive and remove every known
   project's physical targets, then reuse an ID and prove no metadata/body resurrection.
3. Keep the complete existing Chromium matrix, 46-test focused suite, positive/negative
   boundaries, Vite typecheck, exact-three type ceiling, and inherited full-suite comparison green.

## Clean special checks

Dedicated cascade/migration maintenance stores preserve opaque isolation; project-level migration
save/delete/clear precedence is conservative; initialization retry and payload-free diagnostics
work; the shared browser queue's `WeakRef`/finalizer lifecycle is sound; library weak arbitration
settles and cleans up correctly; injected library failure during all-clear remains durably
resumable. All round-1 findings remain closed.

The review-started Vite server is stopped, both disposable counterexample identities were cleaned,
and no product file was edited. The pre-existing untracked Playwright `.last-run.json` remains.
