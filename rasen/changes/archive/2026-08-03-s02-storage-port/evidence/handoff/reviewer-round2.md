# C5 reviewer round 2 handoff

## Status

**DONE_WITH_CONCERNS — CHANGES REQUIRED** against explicit base `0ef35459f685d5d41a25d0ef959aff691b7519cd`.

- Blocker: 2
- Major: 5
- Minor: 0
- Test-gap: 7
- Product/task/existing-evidence edits by reviewer: 0
- Commit created by reviewer: no

Full findings, round-1 dispositions, browser repros, and command evidence: `evidence/review-round2.md`.

## Landing blockers

1. `__opencutProjectCascade` occupies the same physical namespace as opaque provider data. A successful save can become invisible, and prefix-only target validation lets that row delete another project's attachments. This was reproduced in real Chromium.
2. `BrowserProjectStore.migrate()` bypasses the durable-identity mutation queue. A concurrent successful save was overwritten by migration's older staged snapshot in real Chromium; remove/clear resurrection is the same unsynchronized class.

## Required fix order

1. Separate cascade maintenance state from opaque project rows and validate project tombstone targets exactly by project ID.
2. Put the full migration lifecycle into the shared all-projects arbitration domain.
3. Make failed store initialization retryable on the same production singleton and emit a diagnostic.
4. Persist migration cleanup intent before the first fallible post-commit cleanup step; retain source/stage recovery state through committed-readback validation.
5. Make namespace/all clear atomic or durably resumable after its first destructive commit.
6. Invalidate stale custom-preset loads when a newer mutation starts.

## Verification summary

- Focused: 45/45 pass.
- Chromium: 3/3 pass, including the existing 19-case store matrix and all round-1 repair probes.
- Full suite: 291 pass / 8 fail / 2 loader errors; failures match the inherited baseline.
- Storage/port/session/Host boundaries, negative controls, Vite typecheck, type baseline, and diff check pass.
- The two blockers and the sticky-initialization failure were independently reproduced in Chromium; the preset stale-publication race was reproduced directly.

The review's Playwright run regenerated the 45-byte `apps/vite-example/tests/.pw-output-c5-storage/.last-run.json`; the reviewer removed that known test side effect after verification, restoring the pre-run worktree state.
