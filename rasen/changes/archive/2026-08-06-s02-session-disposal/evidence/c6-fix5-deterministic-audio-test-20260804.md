# C6 fix-round 5 deterministic audio test evidence (2026-08-04)

## Scope and fixed identity

- Role: fix-round implementer; test-only remediation of review finding B1 and task 6.8 evidence.
- Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`.
- Exact base commit: `d6ed4166b5ffb13257d1924851f2fa57d73d349f`.
- Exact base tree: `3875074383b41f622e5f32942091468cf8959b61`.
- Sole product path edited in this round:
  `apps/web/src/editor/session/__tests__/session-state-isolation.test.ts`.
- Final test-file blob: `d663e96b55195a8898ca087bef16e332c996f49b` (1,771 lines).
- Final accumulated diff stat for that already-modified C6 file, relative to the base commit:
  `748 insertions / 1 deletion`. This is the whole C6 file delta, not a claim that fix-round 5
  authored every accumulated line.
- `apps/web/src/editor/session/__tests__/wasm-test-mock.ts` was not edited. Its current blob is
  `7e28e00a1beca577f73bb0a184c353dbbc3a5036`; the existing held-track seam was sufficient.

No production source, B2 boundary file, task checklist, build/browser artifact, provenance file,
cleanup target, commit, ship, integration, spec-sync, or archive state was changed.

## B1 reproduction and diagnosis

The independent review recorded three of three direct isolated full-suite failures at
`19 pass / 1 fail / 215 assertions`, and two of two focused failures at
`0 pass / 1 fail / 19 skipped / 3 assertions`. Each failed at the old polling helper with:

```text
Error: Audio playback did not acquire a media Input.
```

The review bounded the cause to the 4,000-tick fixture duration (33.3 ms at the mock's 120,000
ticks/second), Windows wall-clock polling, and `PlaybackManager` correctly reaching the timeline
end before suspend. The outer process changed scheduling and could mask the true isolated failure.

Local pre-edit replay showed the same scheduling sensitivity, although the local failure frequency
differed from the reviewer's machine:

- An initial three-run loop whose output was captured through a PowerShell pipeline returned green.
  It was discarded as invalid evidence because piping was already known to alter scheduling.
- Three true direct, unpiped, isolated full attempts happened to return
  `20 pass / 0 fail / 222 assertions` locally.
- The first true direct focused attempt returned
  `0 pass / 1 fail / 19 skipped / 3 assertions` with the same media-Input error.
- The second and third true direct focused attempts returned green; the second was
  `1 pass / 0 fail / 19 skipped / 10 assertions`.

That red/green variation confirms that the pre-edit test depended on process scheduling. It does
not contradict the reviewer's durable three-of-three and two-of-two reproduction, and no attempt
was made to hide the local frequency difference.

## Deterministic test-only remediation

The named test now drives only explicit events and a manually frozen playback clock:

1. `freezePlaybackClock()` replaces `performance.now` with a fixed zero value and restores the
   exact original property descriptor in `finally`. Playback therefore cannot reach the 4,000-tick
   end because Windows timers happen to run slowly; the timeline was not enlarged.
2. `holdNextMediaInput({ label })` wraps the existing `holdNextPrimaryAudioTrack()` test seam and
   exposes a named `inputCreated` promise. The target test no longer polls with `Bun.sleep`, adds
   retries, or depends on a longer delay.
3. Session A is asserted `playing` immediately before `suspend()`. Its held stale completion is
   released while suspended and is proven to dispose exactly once without repopulating either the
   live input map or sink map.
4. Resume awaits the explicitly named fresh-input event, proves the new input differs from the
   stale input, releases the held completion, and proves fresh A ownership is published.
5. Session B remains playing and retains its own input throughout A's suspend, stale completion,
   resume, and disposal. B releases exactly once only when B is disposed.
6. Terminal assertions prove stale A, fresh A, and isolated B each dispose exactly once and both
   sessions finish with empty input/sink maps. The `finally` block releases every deferred,
   restores the original clock descriptor, and idempotently disposes both sessions.

The other tests' historical polling helper remains untouched because this round owned only the
6.8 scenario and its necessary helper.

## GREEN verification on the final formatted bytes

### Focused direct isolated repetitions

Command shape:

```powershell
$env:OPENCUT_SESSION_STATE_TEST_ISOLATED='1'
bun test apps/web/src/editor/session/__tests__/session-state-isolation.test.ts `
  -t 'suspend rejects a held sink completion'
```

Ten consecutive, direct, unpiped attempts passed. Every attempt reported:

```text
1 pass / 0 fail / 19 skipped / 24 assertions
```

Result: **10/10 attempts green; zero retries and zero ignored failures.**

### Full direct isolated repetitions

```powershell
$env:OPENCUT_SESSION_STATE_TEST_ISOLATED='1'
bun test apps/web/src/editor/session/__tests__/session-state-isolation.test.ts
```

Five consecutive, direct, unpiped attempts passed on the final formatted source. Every attempt
reported:

```text
20 pass / 0 fail / 236 assertions
```

Result: **5/5 attempts green.** The assertion delta from the local pre-edit 222 total is the 14
additional direct lifecycle/ownership assertions in the repaired scenario.

### Wrapper and related lifecycle matrices

| Gate | Result |
| --- | --- |
| Outer `session-state-isolation.test.ts` wrapper | `1 pass / 0 fail` |
| Direct isolated `session-lifecycle.test.ts` | `43 pass / 0 fail / 116 assertions` |
| `session-disposal-c6.test.ts` | `11 pass / 0 fail / 72 assertions` |
| Direct isolated `audio-resource-lifecycle.test.ts` | `5 pass / 0 fail / 42 assertions` |

### Repository-wide Bun baseline

One unfiltered direct `bun test` run returned the accepted inherited identity exactly:

```text
386 pass / 8 fail / 2 loader errors / 1,318 assertions
394 tests / 74 files / 41.11 s
```

The six named test failures remain only the inherited
`resolveTrackPlacement`/`ZERO_MEDIA_TIME` cases. The two loader errors remain the inherited WASM
`__wbindgen_start` and params `DEFAULTS` errors. The repaired session-state wrapper introduced no
additional failure and did not alter the aggregate assertion count because its isolated child
output is not counted by the outer runner.

## Static and type gates

| Gate | Result |
| --- | --- |
| `bunx prettier --check` on the owned test | exit 0; all matched |
| `bunx eslint` on the owned test | exit 0; no findings |
| `git diff --check -- <owned-test>` | exit 0; only the existing LF-to-CRLF checkout warning |
| `node script/check-type-baseline.mjs` | exit 0; exactly 3 current diagnostics against the pinned 13-diagnostic baseline, none outside baseline |
| `bun run --cwd apps/vite-example typecheck` | exit 0; `tsc --noEmit -p tsconfig.json` |

## Task truth and freeze

Task 6.8 remains checked because its formerly contradicted audio suspend/resume leaf now has
repeatable direct-isolated evidence. Scenario 20's test-fixture blocker is repaired, subject to
fresh independent reviewer acceptance. No checkbox was changed: checklist truth remains
**113 checked / 24 unchecked / 137 total**. The unrelated open items remain owned by the parent or
later workflow roles.

Per the review's attribution rule for a test-fixture-only correction, prior production build and
browser evidence remains applicable. This round deliberately did not rebuild or rerun a browser,
and it did not change any production byte.
