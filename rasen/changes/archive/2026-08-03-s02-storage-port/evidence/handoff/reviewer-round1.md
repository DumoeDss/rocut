# C5 reviewer round 1 handoff

## Status

**CHANGES REQUIRED** against explicit base `0ef35459f685d5d41a25d0ef959aff691b7519cd`.

- Blocker: 3
- Major: 6
- Minor: 3
- Test-gap: 10
- Product/task/existing-evidence edits by reviewer: 0
- Commit created by reviewer: no

Full findings and evidence: `evidence/review-round1.md`.

## Fix order

1. Stop migration data loss at metadata/track/clip levels.
2. Make library read-modify-write atomic across sessions.
3. Give project remove/clear a recoverable commit point before destructive attachment cleanup.
4. Persist/retry migration cleanup through the production session path and wire diagnostics.
5. Cover old current envelopes, same-identity wrapper mutation races, typed corrupt rows, duplicate cleanup races, and disposable-prefix safety.
6. Add active read-cancellation coverage, correct the stale Host comment, and remove generated verifier output before staging.

## Minimum re-review evidence

- The ten adversarial tests listed in the full report.
- Port/storage/Host/session positive and negative boundary controls remain green.
- Focused persistence and opaque-round-trip suites remain green.
- Type baseline and diff whitespace checks remain green.

Do not treat the current passing conformance/browser probes as closure for the blockers: their fixtures do not cover nested migration private fields, cross-session read-modify-write, or mid-cascade failure injection.
