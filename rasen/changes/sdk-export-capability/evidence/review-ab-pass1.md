# Review pass 1 — landed Groups A + B + F1 (independent reviewer, 2026-08-16)

Reviewer: opus fork, no hand in the implementation. Scope: Group A
(`packages/editor-ports/src/export-jobs.ts` + tests + exports/surface rows),
Group B (`apps/electron-host/src/export/**`, `electron/{main,preload}.cjs`,
`src/export-renderer/**`, vite/package/build edits, store surface-test edit),
F1 (`docs/export-legal-review-2026-08.md`). Group C/E files in flight were
excluded except where they share files B owns (the contract gained `canExport`;
the shared-file state at review time is internally consistent).

## What I ran myself (real exit codes)

- `bun test apps/electron-host/src/export apps/electron-host/src/store packages/editor-ports/src` — **75 pass / 0 fail / 392 expects / 8 files, RC 0**.
- `node script/check-package-boundary.mjs` — **RC 0**, clean.
- `node script/check-sdk-surface-labels.mjs` — **RC 0**, census 36 entries
  (ports: 7 = frozen 5 + experimental 2), dangling 0.
- `node script/check-session-resource-boundary.mjs` — **RC 0**, clean.
- `git diff 661d7ac8 --stat -- <frozen paths>` — **empty**:
  `export-provider.ts`, `index.ts`, `in-memory/**`, `host/**` untouched.
- Legal citation spot-checks (WebFetch): Audacity FFmpeg page (patent quote
  verbatim, LAME-bundled contrast ✓), ffmpeg.org/legal.html (LGPL default /
  `--enable-gpl` / checklist ✓ — the doc correctly cites LICENSE.md
  separately for the nonfree-redistribution line), gyan.dev builds (GPLv3 +
  LGPLv3-tools ✓). No uncited substantive claim found in §1; "not legal
  advice" disclaimers present.

## Findings

### Blocker

**B-1. The producer reads the wgpu compositor canvas as a 2D canvas — every
frame capture will throw.** `apps/electron-host/src/export-renderer/main.ts:311-314`
calls `canvas.getContext("2d")` inside the capture callback. The canvas it
receives is `compositor.getCanvas()` (`canvas-renderer.ts:112` passes exactly
that), which is the **wgpu surface canvas** — `rust/wasm/src/compositor.rs:76`
does `create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))`, so the
canvas's context is webgl/webgpu, and `getContext("2d")` on such a canvas
returns **null** per the HTML spec → the producer throws "no 2d context for
capture" on frame 0 → `failJob`. B4 was never executed (its evidence is
build+typecheck only), which is why this survived. The donor's own readout
pattern is `canvas-renderer.ts:135-148` (`renderToCanvas`): `drawImage` the
compositor canvas onto a separate 2D canvas, then read that. **Fix:** create
one intermediate 2D canvas (or OffscreenCanvas) at the assignment size; in
capture: `intermediateCtx.drawImage(compositorCanvas, 0, 0)` then
`getImageData` from the intermediate. Group D cannot produce a single export
until this lands.

### Major

**M-1. Resume never validates the raw stream against the record — three
concrete paths to a silently-wrong deliverable.** The manager appends to the
raw file *before* the store transition and persists the record *after*
(`job-manager.ts:798-834`); `resumeJob`/`beginExport` check only
`existsSync(raw)` (`job-manager.ts:632, 1216`). Paths to
`rawSize ≠ acceptedFrames × frameBytes`:
(a) store transition throws after the append (cancel-window refusal,
`job-manager.ts:814-830` throws WITHOUT cleanup) and the process dies before
`cancelJob`'s cleanup runs; (b) process death mid-`writeSync` loop (a partial
frame tail); (c) any append whose subsequent persist never landed. On resume,
frames are appended after the orphan/partial bytes; the store counts are
satisfied, `finalize` runs, and **FFmpeg reads T+k frames → the output's
duration is silently longer than the timeline**. The gap/duplicate startIndex
check cannot see it (the index matches; only the file is wrong). The B3
resume test feeds in the happy order so it cannot catch this; Group D2's
kill-mid-render proof could hit it *nondeterministically* — the worst way for
evidence to go red. **Fix** (one site): on producer attach to an interrupted
or re-attached rendering job, `statSync` the raw file: `size > expected` →
truncate to `expected` (`openSync("r+")` + `ftruncateSync`; expected is
frame-aligned so a partial tail is covered); `size < expected` → fail with a
named reason (`raw-stream-short`). The write-then-transition comment at
`job-manager.ts:798-799` documents the write-failure direction but not this
one; the validation makes the file a fact again.

### Minor

**m-1. Producer ack-hang is guarded only by main's window destruction.** If
the `settled` event fires while the producer is between batches (inside
`renderAndCapture`), `releaseAck(null)` is dropped (no waiter yet,
`export-renderer/main.ts:138-152`); the loop then sends a batch that main
rejects (job not live → no ack) and the new waiter never resolves. The window
hangs until main's `settled`→`destroyExportWindow` (`main.cjs` forwardJobEvent)
kills it — which does happen, so behavior is correct, but a one-line
`settledSeen` flag checked before `sendBatchAwaitAck` would make the producer
self-terminating instead of externally terminated.

**m-2. Mid-encode app-death recovery is an accident that currently works —
name it before it stops working.** `main.cjs` never calls `manager.dispose()`
on quit. On Windows the non-detached child is reaped by libuv's job-object
close, the record stays `encoding` at rest, and the boot scan interrupts it →
resume replays to `rendering` with accepted===total → producer skips the loop
→ re-`finalize` — correct. But if anyone later wires `dispose()` at quit (its
docblock invites exactly that), the SIGTERM'd child routes through the exit
handler (`job-manager.ts:993-1017`: not cancelRequested, phase not settled →
nonzero code → `failJob`) and the job settles **failed**, destroying
resumability the current accident preserves. Either comment the invariant at
the dispose docblock or make the exit handler treat a job whose record is
already `interrupted` as an expected death.

**m-3. Window-open failure after a state move strands the job.**
`startJob`/`resumeJob` IPC handlers move state, then `openExportRenderer`
(`main-export-ipc.ts:130-143, 202-206`); a throw there leaves a `queued`/
`rendering` job with no producer and no `failJob`. Recoverable by cancel, and
the next boot's scan interrupts it, but a same-session retry of `resumeJob`
is impossible (`rendering` ≠ `interrupted`). Catch → `failJob` with a named
reason would close it.

**m-4. `whenSettled` can hang forever on discard** (`job-manager.ts:1356-1367`):
the subscriber set dies with the entry, nothing resolves the promise. Nothing
in the landed tree awaits it across a discard path (the IPC surface doesn't
expose it), so it is latent — fine to note and leave.

### Trivia

- `acceptAudio` overwrites silently; the contract says "sent once" — not enforced, no harm.
- `resolveFfmpegPath`'s cache key omits `PATH` (`job-manager.ts:1395`); a process-lifetime PATH change is unobserved.
- ESLint's config does not cover `apps/electron-host` (warned "File ignored" when run) — the new tree gets no lint gate; the house's own disclosed-lint posture doesn't cover it either. Not this change's job, worth a house note.

## What I checked and found clean (explicitly)

- **Store↔manager SSOT wiring:** every in-process transition routes through
  `ExportJobStore`; the two record-surgery cases (boot interrupt, dead-producer
  failJob) emit the store's event vocabulary and are the documented exceptions.
  Reconstruct-replay (`open→beginRendering(total)→acceptFrames(accepted)`) is
  faithful to the store's `resume()` patch and keeps events behind the cursor.
- **Cancel/exit races:** the exit gate releases on both `exit` and `error`;
  cancel-window deaths route to the cancel flow; a natural exit-0 during the
  cancel window still settles `cancelled` and discards the partial; double
  settle is guarded (`isSettledPhase` re-read). `killChildAwaitExit` cannot
  hang (childExit always releases).
- **Windows file semantics:** `renameSync` over an existing record is libuv
  MoveFileEx-with-replace (atomic write OK); cleanup closes the raw fd before
  unlink; partial→final rename is same-volume.
- **Frame math:** `ticksPerFrame`/`totalFrames`/`fps` mirror the donor
  byte-for-byte; RGBA→RGB24 channel drop is byte-order-correct (modulo B-1's
  context problem); batch sizing ≤4 frames and ≤8 MB.
- **Boundaries:** frozen bytes untouched (verified); react-free-base green
  (export-jobs imports only `./identity` types); no-elftia green; ops list
  three-way consistent (drift test green, includes Group C's `canExport`);
  CSP byte-identical (asserted by the bridge surface test); no path crosses
  any bridge (asserted + audited — descriptor is `file:<relative-name>`).
- **Test honesty (B3):** ffprobe `-count_frames`/`-show_streams` JSON
  assertions are real; the mid-encode cancel's "resolved cancel = exit proof"
  is sound (the await chain releases only on child exit); boot-scan and
  gap/duplicate cases assert file and record state on disk.
- **Legal doc:** every substantive §1–§3 claim I sampled carries a fetched,
  accurate source; uncertain items are marked as such.

## Verdict

**FIX-BEFORE-D.** B-1 blocks all of Group D (no export can succeed);
M-1 must land before D2's kill-mid-render proof or that evidence is a
nondeterministic coin-flip on exactly the semantic it exists to prove. The
rest can ride to ship with notes.
