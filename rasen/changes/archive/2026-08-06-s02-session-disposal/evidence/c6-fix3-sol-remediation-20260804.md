# C6 Fix3 Sol remediation evidence

Date: 2026-08-04

Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`

Planning worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`

Base HEAD: `d6ed4166b5ffb13257d1924851f2fa57d73d349f`

This is a new Fix3 record. It does not overwrite Fix1/Fix2 evidence. The shared dirty product
worktree was preserved; no commit, push, ship, integration, spec sync, archive, recursive cleanup,
server, or browser process was performed by this remediation pass.

## Remediated findings

### B2: semantic resource boundary and offline ownership

- Replaced count/presence-only closure acceptance with a frozen schema-2 attributable closure in
  `script/fixtures/c6-session-resource-expected-closure.json`. The reviewed common closure has 263
  modules and a canonical payload SHA-256 of
  `9f88e3cb8db8065b066707a3739e35e8ae02fd0da9a6742ec8af76adf640a0fd`.
- The TypeScript-AST scanner checks the exact source closure, required roots, provenance/integrity,
  the sole acquisition mediator, direct timers/RAF, Workers, live audio, object URLs, unkeyed
  compositors, and `OfflineAudioContext` escape/terminal-await behavior. The ordinary scan covered
  711 source modules with zero violations in all seven rules.
- Negative controls now falsify direct and aliased acquisition, arbitrary/block-bodied second
  mediators, missing/truncated/padded graphs, missing roots, offline storage/export/return/container
  escape, unrelated `finally`, lifecycle escape, and missing awaited rendering. Positive controls
  retain the bounded local offline-render pattern.
- `retime/audio-stretch.ts` now awaits offline rendering inside its bounded ownership scope.
- Scanner subprocess cases carry explicit 30-second per-test budgets so a semantic pass is not
  converted into Bun's default five-second timeout under a full-suite load.

### B3: real project-replacement drain

- `EditorCore.drainProjectLiveState()` uses exhaustive `Promise.allSettled` cleanup and turns
  synchronous owner throws into settled promise failures.
- `ProjectManager.loadProject()` awaits the old project's live-state drain before loading or
  publishing the new project's media. The focused thumbnail harness now supplies the same private
  drain/report hooks required by the real manager boundary.
- The real-owner integration test drives `EditorCore`, `ProjectManager.loadProject`, `MediaManager`,
  `VideoCache`, `WaveformCache`, effect preview, transcription, and the durable store. It proves the
  old project is not replaced while held video/waveform work remains; old input/context/URL/preview
  and Worker owners terminate once; stale effect publication is suppressed; fresh publication
  succeeds; and both old and next durable attachments survive replacement/reload.

### B4: terminal suspend/dispose semantics and publication guards

- Session suspend/resume/dispose transitions are serialized. Disposal wins a queued resume, and a
  mount during suspended dwell attaches the root without reopening activity until resume publishes.
- Terminal activity drain now awaits delayed releases in stable reverse-acquisition order, retains
  every attributed failure, settles retained interval/RAF/paint waiters, removes Worker message and
  error listeners even when a hostile Host `terminate()` does not, and reacquires only through the
  next admitted generation.
- Renderer generation tokens guard render, export progress/result, delayed snapshot `toBlob`,
  download, and clipboard publication. Suspend/project drain cancels active exporters; resume can
  create a fresh exporter. `SceneExporter` propagates the fixed operation token into its internal
  renderer and aggregates cancellation failure rather than masking it.
- `AudioManager` invalidates playback generation on stop, checks the owning session across resume
  and clip collection, and synchronously settles catch-up waiters when suspend/dispose terminates
  their timer generation.
- Lifecycle discovery in retained RAF loops and nested paint waits is now a type-safe structural
  guard, with an actionable error when a non-session resource object is supplied.

### M2 and transcription Major

- Finite audio helpers release every media input exactly once on success and failure; delayed and
  rejected terminal operations are covered in `audio-resource-lifecycle.test.ts`.
- Transcription termination now settles pending initialization and requests through their ordinary
  `finish` paths before terminating the resource handle. Both message/error listeners are removed,
  duplicate termination is idempotent, a closed gate allocates no Worker, stale old-generation
  events cannot settle fresh work, and the next admitted demand gets a fresh Worker.

## Executed verification

| Gate | Exact result |
| --- | --- |
| `bun test --timeout 30000 script/__tests__/c6-session-resource-boundary.test.mjs` | 7 pass, 0 fail, 60 expectations |
| isolated `project-persistence-rewire.test.ts` | 6 pass, 0 fail, 53 expectations |
| isolated `session-lifecycle.test.ts` | 43 pass, 0 fail, 116 expectations; post-static-delta wrapper replay also exited 0 |
| isolated `session-state-isolation.test.ts` | 9 pass, 0 fail, 177 expectations |
| `session-disposal-c6.test.ts` | 9 pass, 0 fail, 60 expectations |
| isolated `session-runtime-ownership.test.tsx` | 16 pass, 0 fail, 103 expectations |
| isolated `audio-resource-lifecycle.test.ts` | 4 pass, 0 fail, 31 expectations |
| `services/transcription/__tests__/session-service.test.ts` | 4 pass, 0 fail, 35 expectations |
| remaining C6 media/cache/preview/transcription batch | 20 pass, 0 fail, 108 expectations across 6 files |
| all 16 Bun subprocess-wrapper files | 23 pass, 0 fail across 16 files |
| `node script/check-type-baseline.mjs` | exit 0; exactly 3 diagnostics, all inherited |
| Vite `tsc --noEmit` | exit 0 |
| targeted production and Fix3-test ESLint | exit 0; 0 errors, one inherited `audio-manager.ts` empty-block warning |
| targeted Prettier `--debug-check` | exit 0 |
| `git diff --check` | exit 0 |

The final default `bun test` replay returned:

- 360 pass, 8 fail, 2 errors;
- 1,222 expectations;
- 368 tests across 71 files;
- exit 1 solely because the accepted inherited red remains present.

The six named test failures are exactly the inherited `resolveTrackPlacement` cases:

1. `firstAvailable picks the first compatible track without overlap`
2. `firstAvailable creates a new track when all compatible tracks are full`
3. `aboveSource tries the track above source, then any compatible track`
4. `aboveSource creates a new overlay track in the overlay zone when none fit`
5. `batch time spans reject tracks when any span overlaps`
6. `existingTrack on main video includes adjustedStartTime when start snaps`

The two error identities are unchanged: `wasm.__wbindgen_start is not a function` and the params
registry `DEFAULTS` temporal-dead-zone error. Relative to the accepted Fix2 identity (346 pass,
354 tests, 70 files, 1,141 expectations), the final identity contains only the valid added-test
delta: +14 passing tests, +1 test file, and +81 expectations, with the inherited red set unchanged.

Two preceding broad samples selected different already-isolated subprocess wrappers as transient
failures (`processing-capacity` once and effect-preview ownership once). Both passed alone; the
entire 16-file wrapper cohort passed 23/23; and the final default full replay contained neither.
Those transient samples were not accepted as a new baseline.

## Task truth

Newly completed tasks are 2.5, 2.10, 4.7, 5.4, 5.5, 5.7, and 6.4. The checklist now contains
**108 checked / 29 unchecked / 137 total** items.

Items 4.8, 6.6, 6.8, and 7.12 remain unchecked because their wording requires broader complete
fake-clock/audio/media matrices than this remediation proves. Independent review, exclusion proof,
ship, integration, spec sync, and archive also remain with the parent workflow.
