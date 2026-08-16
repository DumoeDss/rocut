# Group C — composition: renderer bridge, frozen exporter override, host panel

Scope delivered: C1.1 (`renderer-export-bridge.ts`), C1.2 (`electron-export-provider.ts` + the one `canExport` IPC op it required), C1.3 (`electron-host-config.ts` exporter override), C2.4 (`export-panel.tsx`), C2.5 (`app.tsx` mount), plus the new test file. All writes stayed inside `apps/electron-host/**` and this evidence directory; no git commands were run.

## Gates (real commands, real exit codes)

| # | Gate | Command (cwd = repo root unless noted) | Result | Exit |
|---|------|----------------------------------------|--------|------|
| 1 | Typecheck | `cd apps/electron-host && bun run typecheck` (runs `tsc --noEmit -p tsconfig.json`) | clean, no output | `REAL_EXIT_CODE:0` |
| 2 | Targeted bun test | `bun test apps/electron-host/src/export apps/electron-host/src/store apps/electron-host/src/host` | **32 pass / 0 fail / 155 expect() / 7 files** | `REAL_EXIT_CODE:0` |
| 3 | New test file standalone (pre-merge run) | `bun test apps/electron-host/src/export/__tests__/electron-export-provider.test.ts` | **9 pass / 0 fail** (8 provider mapping + 1 isolated composition) | `REAL_EXIT_CODE:0` |
| 4 | Drift test standalone (pre-merge run) | `bun test apps/electron-host/src/export/__tests__/export-bridge-surface.test.ts` | **7 pass / 0 fail / 34 expect()** | `REAL_EXIT_CODE:0` |
| 5 | Build | `cd apps/electron-host && bun run build` | vite `✓ built in 1m 41s`; `dist-main/main-export-ipc.cjs 50.27 KB` (was 42.16 KB pre-`canExport`) | `REAL_EXIT_CODE:0` |
| 6 | C6 session-resource boundary | `node script/check-session-resource-boundary.mjs` | `clean — all non-exempt web editor acquisitions cross the session seam`; all 7 rules `0 violation(s)` | `REAL_EXIT_CODE:0` |

Notes on the runs:

- Gate 2's suite grew from 6 to 7 files mid-delivery: the concurrent Group-B fix agent added `src/store/__tests__/filesystem-store-migration-probes.test.ts` after my first green run (28 pass / 0 fail / 139 expect() / 6 files). One intermediate re-run of gate 2 failed with `panic(main thread): Segmentation fault at address 0x6E — oh no: Bun has crashed. This indicates a bug in Bun, not your code.` inside that new store file's isolated child process (Bun 1.2.2 native crash, store scope, not export scope). The file passes standalone (`REAL_EXIT_CODE:0`) and the full re-run above is green. Flagged for LEAD's full-suite pass: transient, reproducibly green, but it is a live Bun-1.2.2 segfault witnessed on this tree.
- Gate 5 predates the concurrent agent's later tree churn; my `apps/electron-host` sources are byte-identical since that green build (only read-only commands ran after it). LEAD's full-suite build re-validates the merged tree.

## The ops-list change: 13 → 14 (`canExport`)

The spec's scenario "No binary means unsupported, not failure" requires a renderer-askable capability probe *before any job exists*; the wire contract had no such op (main's FFmpeg discovery verdict lived only in the producer path). Exactly ONE op was added, in all three places the drift test pins:

1. `apps/electron-host/src/export/export-ipc-contract.ts` — `"canExport"` appended to `EXPORT_IPC_OPERATIONS` (13→14) + `CanExportWireResult { ffmpegAvailable: boolean }` + doc bullet naming this as the Group C addition.
2. `apps/electron-host/src/export/main-export-ipc.ts` — handler returning `{ ffmpegAvailable: args.ffmpegPath !== null }` (main.cjs's OPENCUT_FFMPEG_PATH → `<exe>/bin` → PATH discovery result, already threaded in by Group B).
3. `apps/electron-host/electron/preload.cjs` — `canExport: () => ipcRenderer.invoke(EXPORT_OP_PREFIX + "canExport")`.

Drift test stays green by construction (it asserts sorted-list equality between the contract constant and the preload's prefix occurrences). The producer surface (`beginExport`/`sendFrame`/`audio`/`finalize`/`failJob`/`jobDone`) is untouched.

**→ Group D dependency: the negative leg ("no binary discoverable → unsupported, not failure") exercises this `canExport` op.** It did not exist before this group; D's harness must run against the 14-op contract.

## Frozen-outcome mapping table (as implemented in `electron-export-provider.ts`)

| job reality | frozen `ExportOutcome` |
|-------------|------------------------|
| probe: no binary / no bridge | `unsupported`, reason `FFMPEG_UNSUPPORTED_REASON` (names `ffmpeg-missing` + the three discovery locations) — spec: "No binary means unsupported, not failure"; no job is fabricated |
| settled `completed` + `readJobOutputBytes` | `completed` with those exact bytes (F4's whole-file cost is the frozen shape's own) |
| settled `failed` | `failed` with the job's reason verbatim |
| settled `cancelled` | `failed` with reason `"cancelled"` (`CANCELLED_AS_FAILED_REASON`) — the frozen outcome has NO cancelled variant; silence or `completed` would both be lies, so failed-with-named-reason is the nearest truthful shape |
| phase `interrupted` mid-await | the promise stays PENDING — resume/recovery is a job-surface concern the frozen shape cannot express; if a resumed run later settles, the promise settles with that outcome |
| app killed mid-await | never settles (the promise died with the process); after restart the job is `interrupted`, discoverable via `listJobs` — the panel's recovery path |

Race handling: `awaitSettled` uses fetch-before-subscribe → `onJobEvent` (settled events only) → fetch-after-subscribe bookends, because the `queued` phase event fires before `startJob`'s invoke reply crosses, so subscription alone can miss transitions that happen inside the reply window. The panel applies the same reconciliation (post-`startJob` `getJob`).

`canExport` sync/async: the frozen contract's `canExport()` is synchronous; the probe is one IPC round trip. The adapter answers from a cache warmed at construction (join-concurrent `probing ??=`), refreshed by every `probe()`/`export()`, defaulting to the SAFE `false` until the first probe lands. The composition root constructs the provider at app boot, long before a user can reach an export affordance.

## LF discipline

`tr -dc '\r' < <file> | wc -c` → `0` for every touched file:

| File | CR bytes |
|------|----------|
| `apps/electron-host/src/export/renderer-export-bridge.ts` (new) | 0 |
| `apps/electron-host/src/export/electron-export-provider.ts` (new) | 0 |
| `apps/electron-host/src/export/export-panel.tsx` (new) | 0 |
| `apps/electron-host/src/export/__tests__/electron-export-provider.test.ts` (new) | 0 |
| `apps/electron-host/src/export/export-ipc-contract.ts` (edited) | 0 |
| `apps/electron-host/src/export/main-export-ipc.ts` (edited) | 0 |
| `apps/electron-host/electron/preload.cjs` (edited) | 0 |
| `apps/electron-host/src/host/electron-host-config.ts` (edited) | 0 |
| `apps/electron-host/src/app.tsx` (edited) | 0 |

## Files changed

New (4): the three modules above + the test file. Edited (5): `export-ipc-contract.ts`, `main-export-ipc.ts`, `preload.cjs`, `electron-host-config.ts`, `app.tsx`. Classic export-button untouched, as required.

## Documented deviations

1. **The bridge is deliberately NOT `implements ExportJobProvider`.** The port's `listJobs`/`getJob`/`canStartJob` are synchronous; an IPC-backed client cannot honor them without lying through a cache events can invalidate mid-render. `RendererExportBridge` mirrors the provider's method names and `{ jobId }` argument shapes but returns Promises where the wire forces them. The typed conformance that matters — the frozen `ExportProvider` — is claimed by `ElectronExportProvider implements ExportProvider` over the bridge.
2. **"A loadable project" (the spec's other canExport precondition) is answered by the outcome, not the probe.** Project loadability is not synchronously knowable from the renderer (the store is async IPC); the job surface already fails a non-loadable project with a named reason at start. The donor's own button gates on "a project is open" at the UI layer; the panel does the same (it is only mounted in the project-open branch).
3. **Sync `canExport` has a conservative-`false` boot window** (see mapping section) — truthful in both directions: absent binary stays `false` forever; present binary flips `true` at first probe, which construction fires at app boot.
4. **The bridge captures `window.opencutExport` lazily** (first use), unlike the store bridge's fail-at-construction: the frozen `canExport` must answer `false` — not throw — when composed outside Electron, and the composition root's module singletons construct before any window exists in test environments.

## Findings worth LEAD's attention

- The Bun 1.2.2 isolated-child segfault witnessed during gate 2 (store scope, transient, green on retry) — if LEAD's full-suite pass hits a segfault, retry-before-diagnosing is the empirically correct first move on this tree.
- `main-export-ipc.cjs` grew 42.16 → 50.27 KB with the `canExport` handler — expected, but it confirms the op landed in the built artifact, not just the source.
- The panel renders no filesystem path anywhere: a completed output is its opaque `file:<name>` descriptor (prefix stripped for display) plus byte size; "reveal in folder", if ever wanted, must be a main-side shell op, not a renderer one.
