# C6 fix round 2 — lifecycle, media, and protected-state remediation

Date: 2026-08-04 (+08:00)  
Leaf: C6 lifecycle/resource admission, media/cache ownership, and protected-state
integration  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`

## Remediation delivered

- **B4 lifecycle/admission:** `SessionResources` now has a synchronous activity-admission
  gate and generation counter. Timer, RAF, Worker, AudioContext, object URL, and GPU
  acquisitions refuse while a session is suspended/disposed; callbacks and Worker
  messages/errors are suppressed during the suspended dwell. `createEditorSession`
  closes the gate before suspend, reopens it before resume, closes it on a failed resume,
  and returns to `created` after root unmount. `SaveManager.pause()` cancels pending
  timers and suppresses queued/publication work. Transcription checks admission before
  Worker creation and before posting work.
- **B6 media undo:** `RemoveMediaAssetCommand.restoreLiveState()` uses the mediated
  object-URL seam when present and remains compatible with the canonical editor test
  double; optional cache-clears are awaited/reported without an undefined promise call.
- **B7 protected port:** `apps/web/src/editor/ports/in-memory/index.ts` is byte-identical
  to HEAD (`c28d9b0b6389db814fc4e7647e484afe25abe895`); no ambient `AudioContext`
  implementation was left in the protected port. Audio-dependent tests use the
  Host-scoped `c6-test-audio-context.ts` fixture instead of mutating `globalThis`.
- **Cache/media integration:** VideoCache and WaveformCache invalidation/disposal are
  awaited by MediaManager; project replacement, close, delete, and EditorCore disposal
  await cache/media teardown and aggregate owner failures.
- **B6/B7/C6 runtime leaf:** cache ownership and WASM wrapper-failure/retry tests remain
  green; no Rust or generated-WASM source was edited.

## Verification

### Focused product tests

The combined C6/lifecycle/media/WASM matrix passed **15 tests, 0 failures, 38
expectations**:

```text
bun test \
  apps/web/src/editor/session/__tests__/session-disposal-c6.test.ts \
  apps/web/src/editor/session/__tests__/disposal-oracle.test.ts \
  apps/web/src/editor/session/__tests__/session-lifecycle.test.ts \
  apps/web/src/editor/session/__tests__/session-runtime-ownership.test.tsx \
  apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts \
  apps/web/src/core/managers/__tests__/media-persistence-rewire.test.ts \
  apps/web/src/core/managers/__tests__/project-persistence-rewire.test.ts \
  apps/web/src/services/video-cache/__tests__/service-ownership.test.ts \
  apps/web/src/services/waveform-cache/__tests__/service-ownership.test.ts
```

### Fresh production browser controls

- Vite build output: `apps/vite-example/dist-c6-fix2-vite-20260804-2`, marker
  `c6-fix2-vite-20260804-2`. The fresh node/Playwright run is
  `apps/vite-example/c6-fix2-vite-browser-oracle-20260804-7.log` and exited 0:
  ordinary is clean for six cycles; `missing-created` and `leak` are deliberately
  non-clean; all six suspended-dwell proofs have stable timer/Worker/save/render
  counts, `acquisitionRefused=true`, and `postResumeActivity=true`.
- Next production build exited 0 with route `/c6-disposal`. The fresh run is
  `apps/web/c6-fix2-next-browser-oracle-20260804-5.log` and exited 0 with the same
  three-control polarity and suspended-dwell proof. Temporary `apps/web/.env.local`
  and both preview/start listeners were removed/stopped after capture.

### Boundary, type, format, and lint gates

- `node script/check-type-baseline.mjs`: PASS; 3 diagnostics, all inherited from the
  pinned baseline and no out-of-baseline diagnostic.
- `node script/check-session-resource-boundary.mjs` and `--negative-control`: PASS;
  711 source modules, 7 rules, 0 violations. With fresh outputs: Vite **2,889
  modules / 590 source IDs**; Next **82 attributable files / 78 maps / 2,557 module
  IDs / 596 source IDs**; all required roots and exact Host/session entries present.
- `node script/check-port-boundary.mjs`: PASS (34 contract modules).
- Combined changed-file Prettier, ESLint, and `git diff --check`: all exit 0 (ESLint
  only prints the repository's generic pages-directory warning).
- `node script/check-wasm-source.mjs`, `check-wasm-paths.mjs`, and
  `check-wasm-api-surface.mjs`: all PASS.

### Full-suite identity and attribution

Two clean full-suite runs were used to remove parallel Bun noise. The accepted stable
run is `c6-fix2-full-suite-20260804-3.log`: **346 pass, 8 fail, 2 errors, 1,141
expectations, 354 tests / 70 files**. The six failing test names exactly match
`evidence/c6-bun-test-full-final12.log`:

1. `firstAvailable picks the first compatible track without overlap`
2. `firstAvailable creates a new track when all compatible tracks are full`
3. `aboveSource tries the track above source, then any compatible track`
4. `aboveSource creates a new overlay track in the overlay zone when none fit`
5. `batch time spans reject tracks when any span overlaps`
6. `existingTrack on main video includes adjustedStartTime when start snaps`

Both inherited loader errors are also unchanged: `wasm.__wbindgen_start is not a
function` and `DEFAULTS before initialization`. An intervening run recorded a Bun
segmentation fault in `media-persistence-rewire`; its isolated rerun passed, so it
was not accepted as a product failure. The async-store and media-capacity controls
that briefly failed in a parallel run pass in isolation after the Host-scoped audio
fixture fix.

### Protected/generated identities

- `apps/web/src/editor/ports/in-memory/index.ts`: blob
  `c28d9b0b6389db814fc4e7647e484afe25abe895`, equal to `HEAD`; protected port
  content diff is empty.
- `rust/wasm/pkg/opencut_wasm.js`: SHA-256
  `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1` (exact
  protected wrapper).
- `rust/wasm/pkg/opencut_wasm_bg.wasm`: SHA-256
  `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1` (exact
  protected binary).
- Ignored generated `rust/wasm/pkg/opencut_wasm_bg.js` remains the recorded
  compiler-generated identity `63414885a3ffc631b9dcc28a9e83f2fb2554c6c1655ddbc27b10d80257098c1c`;
  it was not manually edited or rebaselined. `check-wasm-api-surface` verifies the
  exact export/import signatures.

No review, task, evaluation, commit, ship, integration, spec-sync, archive, or broad
cleanup action was performed by this leaf. Generated build directories and oracle logs
under the product worktree remain for the integrator's explicitly enumerated cleanup.
