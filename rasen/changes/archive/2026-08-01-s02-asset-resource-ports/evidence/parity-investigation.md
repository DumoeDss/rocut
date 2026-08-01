# C4 Vite parity investigation (report only)

Date: 2026-08-01  
Execution worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c4`  
Branch (skill preamble): `feat/s02-asset-resource-ports`  
Baseline commit: `507cecf456ed68007c60829be5c3c41bebf64a5d`

## Contract and scope

This is a report-only investigation. No product, test, fixture, snapshot, planning, or run-state file in the C4 worktree is edited. The only write is this evidence report. The protected parity oracle remains the baseline blob `fa387ebea1e7f0cc1110eebcb922d393a1337842` and the protected parity tree remains `e1fbb55b985f4fb490c6b233d18c50c58ea14c28`.

## Phase 1: red-capable feedback signal

The authoritative C4 regression record (`evidence/regression-final.md`) contains two unchanged runs of:

```text
PARITY_HOST=vite C4_VITE_OUT_DIR=dist-c3-regression PARITY_BASE_URL=http://127.0.0.1:4173 bun run test:parity
```

Both exited 1 with exactly one failed interaction:

```text
play: after Home, Space, and 1.5 seconds, the displayed timecode remained 00:00:00:00
ledger: 00:00:00:00 -> 00:00:00:00 (playing) -> 00:00:02:01 (paused)
all other interactions completed; partial persisted snapshot/reopen passed
```

A third focused invocation was started during this investigation:

```text
cd apps/vite-example
bunx playwright test tests/parity/parity.pw.ts --project=chromium --grep "editing parity scenario"
```

Its JSON reporter (`apps/vite-example/tests/parity-artifacts/results-vite.json`, start `2026-08-01T09:51:05.160Z`) recorded the same sole semantic failure, with test duration 44,610 ms and total reporter duration 50,731 ms:

```text
Error: no interaction may fail
- Array []
+ Array [
+   "play: expect(received).not.toBe(expected) // Object.is equality
+    Expected: not \"00:00:00:00\"",
+ ]
at tests/parity/parity.pw.ts:420:4
```

The command wrapper did not return after more than six minutes even though the reporter had finalized, so the LEAD stopped its owned Playwright/Vite processes. This signal is **red-capable**, **agent-runnable**, and now **deterministic across three observations**, but it fails the investigation skill's **fast** criterion: it is a roughly 50-second scenario whose wrapper may hang. It is retained as the authoritative end-to-end red; it will not be run again during root-cause isolation.

## Minimal known reproduction

Within the protected scenario, the smallest observed failing action sequence is:

1. Reset the playhead with `Home` and observe `00:00:00:00`.
2. Press `Space` to play.
3. Wait 1.5 seconds.
4. Read the displayed timecode; C4 still shows `00:00:00:00`.
5. Press `Space` to pause; the next read shows `00:00:02:01`.

This proves playback state/time eventually advanced but the visible timecode did not update during the observation window. It does **not** yet prove that the preceding parity mutations are removable; therefore the full protected scenario remains the correct end-to-end seam, while all further isolation uses seconds-scale static or single-variable probes.

## Initial affected-area declaration

The narrow initial read-only allowlist is:

- `apps/vite-example/src/**` and `apps/vite-example/vite.config.ts`: C4 Vite Host composition, base/build, and entry/session wiring.
- `apps/web/src/editor/**`, `apps/web/src/components/providers/editor-provider.tsx`, and the preview/timeline playback call chain reached by `Space`: shared editor session/provider and visible-timecode update flow.
- `apps/vite-example/tests/parity/{parity.pw.ts,driver.ts,host-profile.ts}`: protected oracle/driver, read only, to map the exact event and observation boundary.
- C3 baseline blobs/history for those files plus the working-tree diff from `507cecf4`: regression-difference evidence.

No fix will be attempted in this investigation.

## Hypotheses and evidence

The following ranking was used before the probes. Each prediction is independently falsifiable.

### 1. The visible timecode misses the high-frequency playback channel — confirmed

**Prediction.** If the timecode listens only to the playback manager's general state channel, then advancing one animation frame will change `getCurrentTime()` and fire `onUpdate`, but will not fire the general `subscribe` listener. Pausing will fire the general listener and make the accumulated time appear at once.

The code has exactly that split:

- `apps/web/src/core/managers/playback-manager.ts:154` exposes the general `subscribe` set.
- `PlaybackManager.updateTime()` assigns `currentTime` at line 250 and calls only `notifyUpdate(newTime)` at line 251.
- `apps/web/src/editor/use-editor.ts:24` subscribes React selectors to `editor.playback.subscribe(onChange)`, not `playback.onUpdate`.
- `apps/web/src/preview/components/toolbar.tsx:64` reads the displayed time through `useEditor((e) => e.playback.getCurrentTime())`.
- `pause()` calls the general `notify()`, so it is the first guaranteed React notification after the animation-frame updates.

A seconds-scale probe used the real `PlaybackManager`, the existing WASM test mock, a fixed `performance.now()`, and one captured `requestAnimationFrame` callback. No product or fixture file was changed. The only changed input was fake wall time, from 0 to 1,500 ms:

```text
@'<dynamic import of wasm-test-mock and PlaybackManager; fake RAF; subscribe to
playback.subscribe and playback.onUpdate; play; set nowMs=1500; run one RAF; pause>'@ | bun -

exit 0, 0.8 s
{
  "afterPlay":  { "current": 0,      "isPlaying": true,  "general": 1, "updates": [0] },
  "during":     { "current": 180000, "isPlaying": true,  "general": 1, "updates": [0, 180000] },
  "afterPause": { "current": 180000, "isPlaying": false, "general": 2, "updates": [0, 180000] }
}
```

This is the exact state transition in the browser ledger: time advances internally while the general observer stays silent, then pause publishes the accumulated value.

The C3 green ledger makes the finding stronger rather than contradicting it:

```text
C3 Vite: 00:00:00:00 -> 00:00:00:02 (playing) -> 00:00:01:27 (paused)
C4 Vite: 00:00:00:00 -> 00:00:00:00 (playing) -> 00:00:02:01 (paused)
```

The protected driver waits roughly 1.8 seconds between pressing Space and reading `during` (the driver's 300 ms shortcut settle plus 1.5 seconds). C3 displayed only two frames, not roughly 1.8 seconds, and then jumped to 1:27 on pause. C3 therefore had the same stale UI and passed only because React happened to sample a non-zero early frame when the initial general play notification was processed. C4 sampled the rounded zero frame, turning that latent race into a deterministic red.

History locates the architectural omission. Commit `56ca0969` introduced the dedicated `onUpdate`/`notifyUpdate` channel. Commit `1df11ac0` later declared the C3 React subscription seam closed, but `useEditor.subscribeAll` retained only the playback general channel. The C3 isolation tests assert explicit `seek()` values and cross-session ownership; they do not assert render-time progression before pause. No current low-level test locks down this channel join.

### 2. Space is swallowed or the toggle-play action is not registered — falsified

**Prediction.** If focus/keybinding dispatch is the cause, playback remains stopped and the time cannot accumulate while the test waits.

Evidence falsifying it:

- The driver deliberately blurs the active element, sends `Space`, and waits 300 ms (`driver.ts:258-264`).
- `use-editor-actions.ts:72-75` maps `toggle-play` directly to `editor.playback.toggle()`.
- The C4 ledger's pause read is `00:00:02:01`, proving the first Space started the timer and the second stopped it.
- `git diff --exit-code 507cecf4 --` over the action files, playback manager, `use-editor.ts`, protected driver, and protected parity spec exited 0. The same comparison from C3 head `07b36c82` to integrated baseline `507cecf4` also exited 0.

### 3. C4 Host/session composition gives the action and timecode different cores — falsified

**Prediction.** If the action mutates one session/core while the toolbar observes another, a general notification from pause cannot reveal the first core's accumulated time in the toolbar; seek/scrub reads would also be inconsistent.

Evidence falsifying it:

- `ViteEditorHost` mounts one `EditorSessionHost`; it supplies one `EditorSessionProvider` beneath one `EditorHostProvider`.
- Both `useEditorInstance()` (the action) and `useEditor()` (the toolbar) resolve `editorForSession(useEditorSession())` from that provider.
- The immediately preceding protected scrub interaction updates the same visible timecode monotonically (`00 -> 01:00 -> 02:01`).
- The pause notification reveals exactly the internally accumulated playback time, which requires the toolbar to read the mutated core.

### 4. Audio decode or preview/render initialization blocks the playback clock — falsified

**Prediction.** If media/audio initialization stalls playback, the underlying playback time will not advance until that initialization completes; a manager-only run without media/audio should not reproduce the notification pattern.

Evidence falsifying it:

- The fake-RAF probe has no audio manager, media asset, renderer, canvas, Worker, or Host, yet advances `currentTime` to 180,000 while the general observer remains unchanged.
- The browser ledger already shows accumulated time immediately after pause.
- `PlaybackManager.updateTime()` computes time solely from `performance.now()`, timeline duration, and FPS. Audio consumes playback state but does not drive the clock.

### 5. Vite base/build/query/import-graph changes semantically break play — falsified as the root cause

**Prediction.** If base/build/query wiring is the semantic cause, the playback/action/subscription code or protected oracle differs, asset/runtime requests fail, or other interactions sharing the same core are affected.

Evidence falsifying it:

- The invariant source diff command above exits 0: playback manager, `useEditor`, action/keybinding files, driver, and oracle are unchanged from `507cecf4`.
- The C4 Host diff adds Host-owned asset resolution/loading/runtime resources. `createBrowserRuntimePorts()` returns only `assets`, `assetLoader`, and `runtimeResources`; it has no playback state or observer surface.
- The retained C4 evidence reports clean served assets/WASM and all other protected interactions green.
- C4 preview/base/asset work can change scheduling enough to expose whether React samples zero or an early frame on the one general play notification. That is a trigger for the false-green/false-red timing difference, not the semantic defect.

## Root cause

The root cause is a missing observer join at the visible timecode seam. Playback has two notification channels:

1. low-frequency general state (`subscribe`) for play/pause/seek/volume/scrubbing; and
2. high-frequency frame time (`onUpdate`) for animation-frame progression.

`TimecodeDisplay` reads frame time through the general-only `useEditor` subscription. It is therefore refreshed at play/pause/seek boundaries but not while frames advance. The C4 regression is the deterministic exposure of a latent inherited defect; C3's `00:00:00:02` green was a timing-dependent false green, not proof of live timecode progression.

There was no Playwright trace to inspect: `playwright.config.ts` explicitly sets `trace: "off"`. The saved JSON reporter, C4 ledger, C3 ledger, screenshots, regression record, exact source diff, and fake-RAF probe provided the discriminating evidence.

## Recommended minimal fix (not applied)

Keep the repair local to the consumer that needs frame cadence. In `TimecodeDisplay` (`apps/web/src/preview/components/toolbar.tsx`), replace the general-only `useEditor(getCurrentTime)` read with a stable `useSyncExternalStore` subscription that joins both:

- `editor.playback.subscribe(onChange)` for seek/play/pause and other general playback changes; and
- `editor.playback.onUpdate(onChange)` for animation-frame time.

Its snapshot is `editor.playback.getCurrentTime()`, and cleanup must unsubscribe both listeners. Do **not** add `onUpdate` to global `useEditor.subscribeAll`: that would execute every editor selector on every playback frame. Do **not** call the general `notify()` from every `updateTime()`: it would also wake non-React general subscribers such as `AudioManager` at frame cadence.

The narrow regression seam should be a low-level test at:

```text
apps/web/src/preview/components/__tests__/timecode-playback-subscription.test.tsx
```

Using fake wall time/RAF and the real playback manager, it should prove:

1. displayed time is zero before play;
2. one 1.5-second frame update changes the displayed value **before pause**;
3. pause holds the displayed value;
4. unmount removes both subscriptions; and
5. unrelated editor selectors are not executed per frame.

Suggested post-fix commands:

```text
bun test apps/web/src/preview/components/__tests__/timecode-playback-subscription.test.tsx

cd apps/vite-example
PARITY_HOST=vite C4_VITE_OUT_DIR=dist-c3-regression PARITY_BASE_URL=http://127.0.0.1:4173 bun run test:parity
```

The second command is the authoritative protected regression, but it is not a fast debug loop and its wrapper must be monitored for the already-observed post-reporter hang. The oracle/fixture/snapshot must remain unchanged.

## Scope audit

- No product, test, fixture, snapshot, planning, or run-state source was edited by this investigator.
- The protected parity source and oracle remained unchanged; invariant `git diff --exit-code` checks exited 0.
- The focused Playwright attempt refreshed ignored generated `results-vite.json` and `ledger-vite.json`; it introduced no tracked worktree diff.
- The C4 worktree's existing 44-file product/planning diff and untracked C4 harnesses predated this report-only investigation. No file in that set was modified here.
- The only durable write is this investigation report in the requested planning evidence directory.

## Conclusion

```text
DEBUG REPORT
------------------------------------------------------------
Symptom:         During playback, the Vite timecode remains 00:00:00:00; it jumps to accumulated time on pause.
Root cause:      TimecodeDisplay observes playback.subscribe but not playback.onUpdate, so RAF currentTime mutations are invisible to React until a general notification.
Fix:             Not applied (report-only). Recommended local dual-channel useSyncExternalStore subscription in TimecodeDisplay.
Evidence:        Three identical C4 red observations; C3 stale false-green ledger; 0.8 s fake-RAF manager probe; invariant source diffs; Host/action flow trace.
Regression test: Correct fast seam is currently absent; add the dedicated timecode playback-subscription test above, then run the protected parity scenario unchanged.
Scope audit:      Evidence report only; no tracked C4 worktree change introduced.
Related:         Dedicated onUpdate channel introduced by 56ca0969; C3 subscription-seam work 1df11ac0 did not join it and did not test live pre-pause rendering.
Status:          DONE_WITH_CONCERNS
------------------------------------------------------------
```

Concern: the authoritative E2E is deterministic but not fast and its wrapper can outlive the finalized JSON report. A seconds-scale timecode subscription regression is needed before the fix is considered locked down.
