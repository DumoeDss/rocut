# C6 fix round 5 - independent Sol delta review

Date: 2026-08-04  
Reviewer: fresh non-author Sol reviewer  
Mode: report-only; no product, task, runstate, commit, ship, spec-sync, archive, or cleanup edits  
Exact base/HEAD: `d6ed4166b5ffb13257d1924851f2fa57d73d349f`  
Exact base tree: `3875074383b41f622e5f32942091468cf8959b61`  
Branch: `feat/s02-session-disposal`

## Verdict

**CLEAN - zero Blocker, zero Major, zero Minor, one known non-blocking Trivial.**

Fix round 5 closes round-4 Blocker B1. The required audio
suspend/resume scheduling test is now deterministic in its true isolated
process, covers the complete task-6.8 lifecycle matrix, and passes both the
implementer's repetition threshold and an independent reviewer sample. The
outer wrapper, related lifecycle suites, full Bun regression identity, and
static/type gates also match their expected results.

No new finding was identified in the fix-round-5 delta. The three comment-only
mojibake instances from round 4 remain a Trivial and do not block this review.

## Scope and attribution proof

The fix-round-5 product-tree delta is strictly test-only:

- `apps/web/src/editor/session/__tests__/session-state-isolation.test.ts`
  is the only tracked worktree file with a write time after the round-4 review
  record (`2026-08-04T22:04:26.9750686+08:00`). Its final blob is
  `d663e96b55195a8898ca087bef16e332c996f49b` and it has 1,771 lines.
- Its accumulated diff from the exact base is 748 insertions and one deletion;
  the round-5 edit is confined to the deterministic helper and the existing
  audio suspend/resume test.
- No untracked file was created or modified after the round-4 review record.
- The planning files changed after round 4 only for the implementer handoff and
  `evidence/c6-fix5-deterministic-audio-test-20260804.md` (apart from the
  round-4 reviewer handoff written milliseconds after its evidence record).
- `wasm-test-mock.ts` remains blob
  `7e28e00a1beca577f73bb0a184c353dbbc3a5036`.
- `apps/web/tsconfig.json` remains the exact HEAD blob
  `3573338ac15340d929fba6ee676c70a263db5f58`; content diff is zero.
- No production source, B2 checker/fixture, provenance script/fixture,
  build-graph input, browser harness, task file, or protected artifact changed
  after round 4. A final whole-diff `git diff --check` exits 0 (only the known
  checkout line-ending warnings).

Therefore the fresh round-4 Vite, Next, browser, and provenance evidence is
attributable to the current production bytes. The only later source edit is a
Bun test file that is not part of either production build graph. Rebuilding or
rerunning the browser would not exercise a changed production byte, so this
review inherits that evidence and independently replays the changed test and
the exact repository regression identity.

## Repair inspection

The repair is at
`apps/web/src/editor/session/__tests__/session-state-isolation.test.ts:355-382`
and `:476-555`.

### Deterministic controls

- `freezePlaybackClock()` replaces `performance.now` with a fixed zero before
  either fixture begins playback and restores the exact original property
  descriptor in `finally`.
- `holdNextMediaInput({ label })` is driven by the named
  `holdNextPrimaryAudioTrack().entered` deferred and returns the exact newly
  created media `Input`; it does not poll wall time.
- The target test contains no `Bun.sleep`, timer, polling loop, retry, or
  enlarged duration. Historical sleep helpers used by other tests are
  unchanged and are not invoked by this scenario.
- Every deferred is released in `finally`; the clock is restored; both sessions
  are disposed through `Promise.allSettled`, making failure cleanup bounded.

### Required lifecycle assertions

The test establishes all required facts in execution order:

1. Session A starts playback and reaches its named held stale input.
2. Session B starts independently, publishes its own input, and is asserted
   playing.
3. Session A is explicitly asserted playing immediately before suspend.
4. A's stale held completion is released only after suspend; it is rejected
   from live publication, its input is disposed exactly once, and A's live
   input/sink maps remain empty.
5. B remains playing, retains its own input, and has zero disposal calls while
   A is suspended and while A later terminates.
6. Resume waits for a separately named fresh A input, asserts A is playing,
   proves the fresh input differs from the stale input, releases it, and proves
   it is the published live owner.
7. A disposal releases stale/fresh inputs exactly once and empties A's maps
   without touching B. B disposal then releases its input exactly once and
   empties B's maps.

This directly cures the round-4 cause: process scheduling can no longer advance
the 33.3 ms fixture timeline to its end before suspend, and no readiness claim
depends on Windows timer resolution.

## Direct task-6.8 verification

### Formerly failing full direct isolated command

```powershell
$env:OPENCUT_SESSION_STATE_TEST_ISOLATED='1'
bun test apps/web/src/editor/session/__tests__/session-state-isolation.test.ts
```

- Implementer evidence on the final formatted blob: 5/5 green, each
  `20 pass / 0 fail / 236 assertions`.
- Independent reviewer sample: 3/3 green, each
  `20 pass / 0 fail / 236 assertions`.
- Combined attributable evidence: **8/8 green**.

### Focused direct isolated command

```powershell
$env:OPENCUT_SESSION_STATE_TEST_ISOLATED='1'
bun test apps/web/src/editor/session/__tests__/session-state-isolation.test.ts `
  -t 'suspend rejects a held sink completion'
```

- Implementer evidence on the final formatted blob: 10/10 green, each
  `1 pass / 0 fail / 19 skipped / 24 assertions`.
- Independent reviewer sample: 3/3 green, each
  `1 pass / 0 fail / 19 skipped / 24 assertions`.
- Combined attributable evidence: **13/13 green**.

There were no retries, ignored failures, sleep-budget changes, or wrapper-only
substitutions in either matrix.

### Wrapper and adjacent lifecycle coverage

| Gate | Independent result |
| --- | --- |
| Outer `session-state-isolation.test.ts` wrapper | `1 pass / 0 fail` |
| Direct isolated `session-lifecycle.test.ts` | `43 pass / 0 fail / 116 assertions` |
| `session-disposal-c6.test.ts` | `11 pass / 0 fail / 72 assertions` |
| Direct isolated `audio-resource-lifecycle.test.ts` | `5 pass / 0 fail / 42 assertions` |

These cover the remainder of checked task 6.8: finite decode success,
array-buffer failure/cancel, decode failure, delayed close, rejected close,
stable multi-cause ordering, terminal resource release, and suspend/resume
resource scheduling. Together with the repaired cross-session playback test,
the complete 6.8 claim is now supported.

## Repository regression identity and static gates

One fresh unfiltered reviewer `bun test` run reproduced the accepted inherited
identity exactly:

```text
386 pass / 8 fail / 2 loader errors / 1,318 assertions
394 tests / 74 files / 52.48 s
```

The six named failures remain only the inherited
`resolveTrackPlacement`/`ZERO_MEDIA_TIME` cases. The two loader errors remain
the inherited WASM `__wbindgen_start` and params `DEFAULTS` errors. No new
failure identity or assertion-count drift appeared.

| Gate | Result |
| --- | --- |
| `bunx prettier --check` on the changed test | PASS; all matched |
| `bunx eslint` on the changed test | PASS; no findings |
| Owned `git diff --check` | PASS; line-ending warning only |
| Whole accumulated `git diff --check` | PASS; line-ending warnings only |
| `node script/check-type-baseline.mjs` | PASS; exactly 3 current diagnostics against the pinned 13-diagnostic ceiling, none outside baseline |
| `bun run --cwd apps/vite-example typecheck` | PASS; `tsc --noEmit -p tsconfig.json` |
| Final tsconfig identity | exact HEAD blob `3573338ac15340d929fba6ee676c70a263db5f58` |
| `rasen validate s02-session-disposal --project rocut --strict --json` | PASS; 1 valid change, 1 passed, 0 failed, 0 issues |

## Inherited fresh build, browser, and provenance evidence

Because scope proof finds no production or build-graph delta, the following
round-4 reviewer evidence remains current:

- Vite artifact
  `apps/vite-example/dist-c6-review-fix4-sol-20260804-1`, unique marker
  `c6-review-fix4-sol-vite-20260804-1`, build exit 0, 2,890-module graph.
- Next artifact `apps/web/.next-c6-review-fix4-sol-20260804-1`, unique marker
  `c6-review-fix4-sol-next-20260804-1`, build exit 0, fresh NFT/source maps.
- Both Hosts pass all three browser controls for six cycles each. Ordinary
  cycles create all five resource classes and finish at five exact zero
  residuals; missing-created fails for Worker; leak fails for independent
  Worker and GPU residuals.
- Both Hosts prove `BrowserProjectStore`, real compositor/WebGPU execution, no
  audio fallback, quiescent suspended dwell, and fresh renderer activity after
  resume (`postResumeActivity=true`).
- Closure/provenance remains 257 common / 264 source with canonical SHA-256
  `6ce54c5109bf886e8bb5537b980fe7f4e09f0c55e253a7e360d26cde7b4f55e4`
  and source-closure SHA-256
  `353bff09a22738624ca48907178863c389f38e0b8bb54f5c74ee9531e3fb401d`.
- Boundary, negative-control, reference, protected-identity, port, asset,
  singleton, WASM/API, and strict Rasen evidence from round 4 remains
  attributable for the same reason.

## All 59 scenarios

The complete recomputation is:

- **PASS (57):** scenarios `1-51`, `53-56`, and `58-59`.
- **UNVERIFIED (1):** scenario 52, durable data survives all session disposal.
  C5 unit/browser controls remain green, but no fresh C6
  write/dispose-all/reopen-one-record browser scenario was executed.
- **FAIL (1):** scenario 57, complete capability corpus swept both ways. Its
  only remaining cause is scenario 52's inherited unverified execution gap;
  scenario 20 is no longer a cause.

Scenario totals: **57 PASS / 1 FAIL / 1 UNVERIFIED = 59**.

Scenario 20, audio playback quiesces and resumes, is now **PASS** only because
the complete 6.8 matrix above is green: deterministic full/focused repetition,
playing-before-suspend, stale non-publication and exact cleanup, named fresh
resume ownership, cross-session isolation, finite decode/close outcomes, and
terminal release are all executed.

Scenario 57's remaining non-pass is inherited corpus bookkeeping corresponding
to the honestly open durable-reopen work; it is not a regression or an
unsupported fix-round-5 claim. Round 4 identified B1 as the sole review
blocker, and B1 is closed here.

## Task truth

The task file remains unchanged at **113 checked / 24 unchecked / 137 total**.
Unchecked IDs remain exactly:

`1.4, 1.5, 1.6, 1.11, 1.12, 1.13, 1.14, 9.7, 11.10, 12.13,
13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 14.1, 14.2, 14.3, 14.4,
14.5, 14.6, 14.7, 14.8`.

Task 6.8 remains checked and is now supported rather than contradicted. Task
9.7 remains honestly open for the exact durable dispose/reopen browser flow.
No checkbox was changed in fix round 5 or by this reviewer.

## Finding retained from round 4

### Trivial T1 - three comments contain mojibake (confidence 1.00)

`apps/web/src/editor/session/session-resources.ts:10`, `:138`, and `:644`
contain malformed punctuation in comments. This is comment-only, predates the
fix-round-5 delta, and has no behavioral or gate impact.

## Review authority

This reviewer wrote only this evidence record and
`handoff/reviewer-fix-round-5.md`. No product, test, task, author evidence,
runstate, commit, ship, integration, browser artifact, spec, archive, or
cleanup state was changed. Delivery remains a separate authorized stage.
