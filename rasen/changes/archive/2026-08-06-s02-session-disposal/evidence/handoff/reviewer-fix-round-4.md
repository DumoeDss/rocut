# C6 fix round 4 — reviewer handoff

Date: 2026-08-04  
Reviewer: fresh non-author Sol reviewer  
Verdict: **BLOCKED**

The complete independent record is in
`evidence/review-fix-round-4.md`. Fix round 4 closes all round-3 product
findings, but one required GREEN test remains unreliable and direct-isolated
red.

## Open finding

**Blocker B1:**
`apps/web/src/editor/session/__tests__/session-state-isolation.test.ts` checks
audio suspend/resume with a 4,000-tick (33.3 ms) project duration while polling
readiness with `Bun.sleep(1)`. On Windows the playback can reach the timeline
end before suspend, so `PlaybackManager` correctly records no pending resume and
the test never creates the expected fresh `Input`.

Direct full-isolated command failed 3/3 with `19 pass / 1 fail / 215 expect()`:

```powershell
$env:OPENCUT_SESSION_STATE_TEST_ISOLATED='1'
bun test apps/web/src/editor/session/__tests__/session-state-isolation.test.ts
```

The focused form failed 2/2 with `0 pass / 1 fail / 19 skip / 3 expect()` at
`session-state-isolation.test.ts:349`. The outer wrapper passes `1/0`, and the
full suite matches the inherited 386/8/2 identity, demonstrating that the
wrapper masks the clock dependency.

This is a test-fixture/scheduling defect, not current evidence of a production
audio scheduler defect. It still invalidates checked task 6.8 and scenarios 20
and 57. Do not increase the sleep budget. Use a fake clock or explicit deferred
signal, prove playback is active immediately before suspend, and await a named
fresh-input event. Then rerun the direct inner suite repeatedly, its wrapper,
the focused matrix, formatting/lint, and full Bun.

There is also one non-blocking Trivial: mojibake in three new comments at
`session-resources.ts:10`, `:138`, and `:644`.

## Stable green baseline

- one fresh Vite artifact:
  `apps/vite-example/dist-c6-review-fix4-sol-20260804-1`, marker
  `c6-review-fix4-sol-vite-20260804-1`;
- one fresh Next artifact:
  `apps/web/.next-c6-review-fix4-sol-20260804-1`, marker
  `c6-review-fix4-sol-next-20260804-1`;
- both builds exit 0; each browser oracle passes 3 controls × 6 cycles with
  exact ordinary/missing-created/leak polarities, real WebGPU,
  `BrowserProjectStore`, no audio fallback, quiescent suspended dwell, and
  fresh renderer activity after resume;
- fresh provenance equals the frozen 257-common/264-source closure with
  canonical SHA-256 `6ce54c5109bf886e8bb5537b980fe7f4e09f0c55e253a7e360d26cde7b4f55e4`;
- full Bun: 386 pass / 8 inherited fail / 2 inherited loader errors / 1,318
  assertions / 394 tests / 74 files;
- boundary, port, session-state, Host, storage, singleton, asset, emitted,
  type, WASM/API, reference, formatting/lint, diff, and strict Rasen gates pass;
- protected identities and exact base HEAD/tree remain intact;
- 59 scenarios: **56 PASS / 2 FAIL / 1 UNVERIFIED**;
- tasks: **113 checked / 24 unchecked / 137**, with 6.8 incorrectly checked;
  9.7 remains honestly deferred.

The durable-data dispose/reopen browser scenario remains UNVERIFIED (scenario
52); C5 unit/browser evidence is green but is not that exact C6 scenario.

## Cleanup and authority

All reviewer-owned server processes are stopped and ports 4370, 4371, and 4372
are free. The build-mutated tsconfig was restored by the LEAD to the exact HEAD
blob (`3573338ac15340d929fba6ee676c70a263db5f58`; content diff zero). Disk free at
handoff is 6.024 GB.

This reviewer changed only this handoff and the review evidence. No product,
tasks, runstate, commit, ship, integration, spec, or archive state was changed.
Return to an implementer for B1, then request a fresh delta re-review. Do not
advance to delivery while the Blocker remains open.
