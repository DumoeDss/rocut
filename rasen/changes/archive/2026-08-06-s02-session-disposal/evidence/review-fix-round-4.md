# C6 fix round 4 — independent Sol review

Date: 2026-08-04  
Reviewer: fresh non-author Sol reviewer  
Mode: report-only; no product, task, commit, ship, spec-sync, or archive edits  
Exact base commit: `d6ed4166b5ffb13257d1924851f2fa57d73d349f`  
Exact base tree: `3875074383b41f622e5f32942091468cf8959b61`

## Verdict

**BLOCKED — one Blocker, zero Major, zero Minor, one Trivial.**

Fix round 4 closes every round-3 product finding: the whole-tree acquisition
boundary rejects aliases/computed access/destructuring/arbitrary mediators, the
renderer waits for active exporter terminal settlement, failed audio-track
discovery releases its untransferred `Input`, both fresh Hosts prove retained
renderer activity after resume, and all previously red static gates are green.

The change is not approvable because checked task 6.8 claims a GREEN audio
suspend/resume scheduling test, but the test's true isolated mode fails
reliably when invoked directly. The outer wrapper and the repository-wide suite
mask that failure by changing process scheduling. This review found a
clock-dependent test-fixture defect rather than evidence of a production audio
scheduler defect, but the required scenario is still red and cannot remain
checked as GREEN.

## Findings

### Blocker B1 — the required audio suspend/resume GREEN test is clock-dependent and direct-isolated red (confidence 0.99)

Locations:

- `apps/web/src/editor/session/__tests__/session-state-isolation.test.ts:195-244`
- `apps/web/src/editor/session/__tests__/session-state-isolation.test.ts:339-350`
- `apps/web/src/editor/session/__tests__/session-state-isolation.test.ts:435-475`
- `apps/web/src/core/managers/playback-manager.ts:55-93`
- `apps/web/src/core/managers/playback-manager.ts:190-224`
- `apps/web/src/editor/session/__tests__/wasm-test-mock.ts:3`

Direct full-suite reproduction, three of three fresh attempts:

```powershell
$env:OPENCUT_SESSION_STATE_TEST_ISOLATED='1'
bun test apps/web/src/editor/session/__tests__/session-state-isolation.test.ts
```

Each attempt produced `19 pass / 1 fail / 215 expect()` across 20 tests. The
failure is:

```text
AudioManager media Input ownership > suspend rejects a held sink completion,
resume schedules freshly, and another session stays isolated

session-state-isolation.test.ts:349
Error: Audio playback did not acquire a media Input.
```

The focused command also reproduced twice:

```powershell
$env:OPENCUT_SESSION_STATE_TEST_ISOLATED='1'
bun test apps/web/src/editor/session/__tests__/session-state-isolation.test.ts `
  -t 'suspend rejects a held sink completion'
```

It returned `0 pass / 1 fail / 19 skip / 3 expect()` in approximately
640–656 ms. In contrast, the outer wrapper currently returns `1 pass / 0 fail`,
and the unfiltered `bun test` run contains no extra failure. The wrapper starts
the same file with stdout/stderr pipes, so process scheduling changes whether
the inner test reaches suspend before playback ends.

The cause is bounded and reproducible from the fixture:

- the mocked WASM clock declares `TICKS_PER_SECOND = 120_000`;
- `seedEmptyProject()` overrides `timeline.getTotalDuration()` to 4,000 ticks,
  only 33.3 ms;
- readiness and disposal are polled with repeated `Bun.sleep(1)` calls, whose
  Windows timer delay is materially larger than one millisecond;
- `PlaybackManager.updateTime()` pauses at the timeline maximum;
- if that happens before `session.suspend()`, `resumePlaybackAfterSuspend` is
  false and `resume()` correctly does not schedule a new input.

Thus the test sometimes exercises “resume an already-ended playback” instead
of “resume playback that was active at suspend.” The held primary-track promise
is deterministic, but the precondition for the resume branch is not. Increasing
the polling delay would make this worse and would not prove the transition.

Required remediation: control `performance.now`/RAF with a fake clock or use an
explicit deferred scheduling signal; assert that playback is still active
immediately before suspend; and await an explicit fresh-input event instead of
polling wall time. The direct isolated command must pass repeatedly before task
6.8 and scenario 20 can be accepted. If only the test fixture changes, the
product/browser evidence below remains attributable; the direct test, wrapper,
focused matrix, formatting/lint, and full Bun identity still need replay.

Impact: task 6.8 is incorrectly checked; the fix-round-4 execution-map claim
for 6.8 is false; scenario 20 is FAIL; and the all-scenario acceptance in
scenario 57 is FAIL. This is a release blocker because GREEN scheduling evidence
is an explicit in-scope acceptance requirement.

### Trivial T1 — three new comments contain mojibake (confidence 1.00)

`apps/web/src/editor/session/session-resources.ts:10`, `:138`, and `:644`
contain `鈥?` in place of an em dash. This is comment-only and does not affect
behavior, formatting, or gates.

## Round-3 finding closure

| Prior finding | Fix-round-4 disposition |
| --- | --- |
| B1: browser resume did not prove post-resume activity | **Closed.** Both fresh Hosts report `postResumeActivity=true` in all 18 control cycles, with a larger renderer generation, a different renderer resource ID, and publications after resume. |
| B2: boundary accepted alias/computed/destructured/mediator escapes | **Closed.** The checker uses TypeScript AST/value flow. The eight exact new negatives plus truncation, downgrade, and coordinated self-approval controls pass. |
| B3: renderer suspend/disposal did not await active exporter terminal state | **Closed.** `invalidatePublications()` snapshots exporters, awaits stable `cancel()` promises with `Promise.allSettled`, attributes cancellation failures, and still drains later owners. Held suspend/project-drain/failure tests pass. |
| M1: rejected `getPrimaryAudioTrack()` leaked its local `Input` | **Closed.** Ownership transfers only after sink publication; rejection/null/constructor failure release the untransferred input exactly once. |
| M2: session-state gate red | **Closed.** Ordinary and negative controls pass: 10/10 factories, 10/10 registry keys, 52 imperative modules. |
| m1: port boundary red | **Closed.** Ordinary and negative controls pass. |
| m2: formatting/lint hygiene red | **Closed.** Exact changed/untracked source-like lists pass Prettier and ESLint; both diffs pass `git diff --check`. |

## Fresh artifact and browser evidence

Exactly one reviewer-owned Vite/Next pair was built. No second pair was
generated.

| Host | Fresh artifact | Marker | Build | Browser oracle |
| --- | --- | --- | --- | --- |
| Vite | `apps/vite-example/dist-c6-review-fix4-sol-20260804-1` | `c6-review-fix4-sol-vite-20260804-1` | exit 0; Vite 7.3.6; 2,890 modules | exit 0; 3 controls × 6 cycles |
| Next | `apps/web/.next-c6-review-fix4-sol-20260804-1` | `c6-review-fix4-sol-next-20260804-1` | exit 0; Next 16.1.3; 19 routes | exit 0; 3 controls × 6 cycles |

For both Hosts:

- ordinary: `clean=true`; timer, Worker, audio context, object URL, and GPU
  residual series are each `[0,0,0,0,0,0]`;
- missing-created: non-clean for the intended missing Worker CREATED proof and
  zero residuals;
- leak: non-clean for the intended independent Worker residual and live GPU
  residual in the final cycle;
- all cycles use `BrowserProjectStore`, `audioFallback=false`, and real
  `selectedBackend=webgpu`;
- the editor/project/root remain mounted and identical through suspend;
- suspended dwell has no timer callback, Worker message/error, save/render
  publication, or timer-resource-creation growth;
- admission is refused during suspend;
- after resume, renderer generation increases, the resource ID changes,
  publications increase, and both `postResumeOperation` and
  `postResumeActivity` are true;
- no unexpected console or page errors occur.

Expected post-revocation blob fetch errors are classified separately and do not
hide console failures.

Reviewer-owned server processes were stopped exactly. Vite PIDs `68976` and
`43360`/port 4370, Next PID `56260`/port 4371, and the manifest replay PIDs
`12112` and `47580`/port 4372 are all terminal and the ports are free. Disk
space after the tail is 6.024 GB.

The Next build rewrote `apps/web/tsconfig.json`; the LEAD restored the exact
HEAD content. Its working and HEAD Git blob are both
`3573338ac15340d929fba6ee676c70a263db5f58`, and its content diff is zero.

## Independent fresh provenance

`generate-session-resource-closure.mjs` was run against the exact reviewer
artifacts above. The generated `{requiredRoots, common, hosts}` value is
byte-for-byte canonical-equal to the frozen fixture.

| Measure | Fresh result |
| --- | --- |
| common source modules | 257 |
| source closure modules | 264 |
| canonical closure SHA-256 | `6ce54c5109bf886e8bb5537b980fe7f4e09f0c55e253a7e360d26cde7b4f55e4` |
| source-closure SHA-256 | `353bff09a22738624ca48907178863c389f38e0b8bb54f5c74ee9531e3fb401d` |
| Vite module graph | 2,890; `8a1f28c96bca7b0ba5518083877eb3aab81a4245949998bd6bacec36b19906fa` |
| Vite web-source IDs | 591; `731c0fcdadd3fdd2d1b29c765f76e6c6072ad371bde70d08e026751778773e7d` |
| Vite attributable IDs | 602; `1492ae6ac334021bb10c2c434154e8b0004ac37f41d05e8799be45914c63d9fb` |
| Vite graph file SHA-256 | `54a5a60f855ce2c9d821503aeeda7cd85cdac641e0ea57aaf311e6e097cbce0f` |
| Vite manifest SHA-256 | `2165d6b7a5de0bb823adc491916f775b0e776d349073025772134db8009b13ef` |
| Next route files | 82; `36c005883466172f9e3acf723cfaf84266865e91a89f6b7458284d668bd21a44` |
| Next source maps | 78; `7b5b24a22d83adf8480a4e96f3bf495b2ecb6568d43c9af3099ad1f6a999ebd3` |
| Next module IDs | 2,557; `cdd30dc34de7ebaf15f3409c3a47574c788c8a8ab267f2e6695ced496c04b26f` |
| Next source IDs | 596; `d9d45357e1ab7e7833b59a1d0cece92e0f67e6e9ec3ef2e2db09bfc99319d11a` |
| Next editor NFT SHA-256 | `203ca9063d36939bd6bd67f2e148e40120d862f7f729009c41e7c2f006ab6817` |
| Next editor page SHA-256 | `aff1e85c085f2195381bc871613361e92375d1c365037a18f43d09ae2904845f` |
| Next build ID | `QGBBIDIbkPMtdN0clG0b5` |

The Vite manifest, Next build-specific files, and build ID legitimately differ
from final2. Closure membership and the source-ID sets do not.

## All 59 scenarios

`PASS` means supported by fresh execution or an attributable protected/current
control plus implementation inspection. `FAIL` means current code/evidence
contradicts the requirement. `UNVERIFIED` is not treated as pass.

| # | Scenario (spec order) | Status | Independent disposition |
| ---: | --- | --- | --- |
| 1 | Concurrent disposal joins one teardown | PASS | Focused lifecycle/ownership controls pass. |
| 2 | Dispose wins over a queued resume | PASS | Explicit queued-resume race passes. |
| 3 | Repeated suspend and resume are idempotent | PASS | Repeated/no-op lifecycle control passes. |
| 4 | Host replacement cannot publish from a stale generation | PASS | Host generation/churn controls pass. |
| 5 | Suspend stops active publications | PASS | Held exporter keeps suspend pending; cancellation and failure attribution are terminal. |
| 6 | Suspend retains non-activity identity | PASS | Both fresh Hosts retain editor/project/root identity. |
| 7 | Resume restarts only the owner | PASS | All 36 fresh Host/control cycles show fresh renderer generation/resource and post-resume publication. |
| 8 | Retained resources are not falsely reported released | PASS | Suspended identity is retained; release is recorded only at terminal disposal. |
| 9 | The complete editor graph has one acquisition mediator | PASS | Whole web tree scans 712 modules; frozen closure is 264; arbitrary wrapper negatives fail. |
| 10 | Direct acquisition fails mechanically | PASS | Alias, computed timer/Worker/audio/URL cases are rejected. |
| 11 | Empty or truncated scanning cannot pass | PASS | Empty/truncated/padded/downgraded/self-approved controls fail. |
| 12 | Operation-bounded offline rendering is classified | PASS | Destructured/aliased OfflineAudioContext control is rejected. |
| 13 | A fired timeout self-releases | PASS | Independent timer ledger passes. |
| 14 | Suspend cancels activity timers | PASS | Interval/RAF/nested-paint matrix passes. |
| 15 | Disposal cancels every remaining timer kind | PASS | Timer/interval/RAF terminal drain passes. |
| 16 | Transcription Worker stops on suspend | PASS | Pending generation termination/listener cleanup passes. |
| 17 | Resume creates a fresh Worker generation | PASS | Fresh generation and stale-event controls pass. |
| 18 | Disposal observes platform termination | PASS | Both Hosts create/message/terminate a real local Worker. |
| 19 | Audio decode closes its finite context | PASS | Success/reject/cancel/dual-failure matrix passes. |
| 20 | Audio playback quiesces and resumes | FAIL | Direct isolated GREEN test is clock-dependent and red (B1). |
| 21 | Disposal waits for terminal closed state | PASS | Delayed close keeps disposal pending until terminal close. |
| 22 | Rejected close is not clean release | PASS | Rejection is attributed and later owners still drain. |
| 23 | Loaded media retains its URL owner | PASS | Persistence/ownership matrix passes. |
| 24 | Replacement and removal revoke once | PASS | Undo/redo/replacement matrix passes. |
| 25 | Transient processing revokes on every exit | PASS | Image/video/SVG/export/download success/failure/cancel matrix passes. |
| 26 | Disposal drains retained URLs | PASS | Both Hosts prove fetch-before-dispose and failure after revoke. |
| 27 | Two sessions do not share live cache identity | PASS | Equal-key video/waveform/input generations remain distinct. |
| 28 | Project replacement drains prior live state | PASS | Canonical replacement and direct owner drains pass. |
| 29 | Session disposal drains every service owner | PASS | Failed input acquisition and active/failing exporters are now terminally joined. |
| 30 | Shared resolver lease releases only on final owner | PASS | Final-owner recreation control passes. |
| 31 | Reverse acquisition order is terminal order | PASS | Registry records awaited reverse order. |
| 32 | One failure does not skip later cleanup | PASS | Later resources/owners are attempted. |
| 33 | Multiple failures are preserved | PASS | Aggregate ordering/control passes. |
| 34 | Repeated disposal preserves first outcome | PASS | Fulfilled/rejected outcome is stable. |
| 35 | No acquisition occurs after admission closes | PASS | Synchronous suspend/dispose admission rejection passes. |
| 36 | First of two owners releases only its compositor | PASS | Two-owner runtime control passes. |
| 37 | Final owner tears down shared state | PASS | Exact handle/runtime teardown passes. |
| 38 | Live handles prevent false final release | PASS | Real leak remains named and non-clean. |
| 39 | Concurrent owner release calls one teardown | PASS | Serialized final release invokes shared teardown once. |
| 40 | Fresh generation initializes after final teardown | PASS | Fresh runtime generation control passes. |
| 41 | Runtime query wrappers outlive reconciliation | PASS | Failure/retry ordering controls pass. |
| 42 | Every ordinary cycle creates all five classes | PASS | Both Hosts create all five classes in every cycle. |
| 43 | Every ordinary cycle has zero exact residuals | PASS | All ten ordinary series are exact zero arrays. |
| 44 | Residual growth is assessed across cycles | PASS | Series are emitted and the deliberate final-cycle growth is caught. |
| 45 | Missing creation fails before release proof | PASS | Missing Worker control stays non-clean with zero residuals. |
| 46 | Deliberate leakage is caught by same evaluator | PASS | Same evaluator catches independent Worker and GPU residuals. |
| 47 | Fresh Vite evidence is attributable | PASS | Unique marker, fresh graph/manifest, provenance and browser control all match. |
| 48 | Fresh Next evidence is attributable | PASS | Unique marker, fresh NFT/maps/provenance and standalone browser control all match. |
| 49 | Host fallback cannot pass | PASS | Browser store/runtime roles and no-audio-fallback are enforced. |
| 50 | Supplemental process metrics cannot override leakage | PASS | Exact residuals keep the leak negative non-clean. |
| 51 | Disposing one session preserves another session | PASS | Cross-session manager/cache/runtime controls pass. |
| 52 | Durable data survives all session disposal | UNVERIFIED | C5 unit/browser controls pass, but no fresh C6 write/dispose-all/reopen-one-record browser scenario was executed. |
| 53 | Forced-none remains allocation-free | PASS | Current protected C4 forced-none browser evidence is attributable and the path is unchanged. |
| 54 | Backend capacity behavior remains unchanged | PASS | WebGL passes; WebGPU passes capacity/handle/frame/project assertions before the base-attributed migration-wait red. |
| 55 | Protected artifacts remain identical | PASS | Exact trees/blobs/generated hashes match the design/base. |
| 56 | Existing regression identity does not grow | PASS | Type ceiling is exact; full Bun is exactly 386/8/2 with no new identity. |
| 57 | Complete capability corpus is swept both ways | FAIL | Scenario 20 is red and scenario 52 remains unverified. |
| 58 | C7 and E1 remain out of scope | PASS | No headless/Elftia/D2/private-port/Rust/generated-WASM/durable-delete expansion. |
| 59 | Review and delivery remain independent | PASS | Reviewer wrote only these two reports; no delivery action occurred. |

Scenario totals: **56 PASS / 2 FAIL / 1 UNVERIFIED = 59**.

## Task truth and provenance audit

The task file contains **113 checked / 24 unchecked / 137 total**. Unchecked IDs
are exactly:

`1.4, 1.5, 1.6, 1.11, 1.12, 1.13, 1.14, 9.7, 11.10, 12.13,
13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 14.1, 14.2, 14.3, 14.4,
14.5, 14.6, 14.7, 14.8`.

Task 6.8 is checked but contradicted by B1. The exact wrapper/full-suite commands
saved for 12.1/12.14 do not expose the direct-isolated red, so they cannot cure
the 6.8 claim. Task 12.10 remains true: the full suite has exactly the inherited
identity. Task 9.7 is honestly open.

`PATCHES.md` contains 261 unique rows. Rows P225–P272 are 48 unique rows and
exactly cover all 48 tracked product paths that existed at the upstream pin;
there are no missing, extra, or duplicate rows.

`SOURCE_INVENTORY.md` and `.json` are unchanged, with SHA-256 values
`96fc58d3edda0a5470f6d53740c1ef040042ce273dbbda687a306dbd3acfc9be`
and `2f46765725866df895ddb157548b0a7c1b836c43ce14812d1ff222dcd8ab781d`.
The post-commit tracked/untracked generator constraint is correctly recorded;
9.7 must not be pre-checked.

The deterministic SBOM correction only adds the already-base-present
`apps/web/public/workers` directory to the documented present-directory set.
It is not C6 product scope. Current `SBOM.md` SHA-256 is
`d29e6b20caefee855dd2321ff47d457b7c238009093a177db6cddee4d10c6b6d`;
the generator evidence reports 1,359 npm packages and 80 Rust/WASM crates with
D1–D5 dispositions matching.

## Command/gate record

| Gate | Independent result |
| --- | --- |
| Focused C6 files | Wrapper commands pass for timers, lifecycle/disposal, media, cache, preview, transcription, and exporter ownership; B1 records the direct inner exception. |
| Full `bun test` | exit 1; **386 pass / 8 fail / 2 loader errors / 1,318 assertions / 394 tests / 74 files / 72.26 s**. Six named `resolveTrackPlacement`/`ZERO_MEDIA_TIME` failures plus unchanged WASM-start and params-`DEFAULTS` loader errors only. |
| C6 boundary suite | 18/18, 95 expectations; first eight exact alias/computed/destructured/mediator negatives pass. |
| Whole-tree resource boundary | 712 web source modules, 264 closure modules, seven zero-violation rules; negative/truncation/provenance controls pass. |
| Port boundary | ordinary and negative controls pass. |
| Session-state boundary | 10/10 factories, 10/10 registry keys, 52 imperative modules; negative controls pass. |
| Host/storage/runtime/Next/singleton | Host composition, storage, runtime-asset, Next-import, distributable (591 web + 13 Vite + 2,282 dependency + 4 other), singleton (724 runtime/39 commands), and their applicable negatives pass. |
| Type | exact three inherited diagnostics only; Vite `tsc --noEmit` passes. |
| Formatting/lint | Prettier 88/88 and ESLint 85/85 exact changed/untracked source-like files pass. |
| Fresh builds | Vite and Next exit 0 with the unique artifacts/markers above. |
| Browser C6 | Vite 18/18 control cycles; Next 18/18 control cycles; intended polarities exact. |
| Emitted assets | Vite 1 each entry/Worker/WASM/ORT; Next 11/3/1/1; ordinary and negative controls pass. |
| Served manifest | 298 copied files / 4,481,207 bytes and 7 emitted files / 30,247,277 bytes; MIME/bytes/digest/category/graph/exclusion and 18 negative controls pass. |
| C3/C4/C5 | Current final2 C3 WebGL pass; C3 WebGPU base-attributed migration-wait red after relevant assertions; full Bun includes current C4/C5 unit files green; attributable C5 browser is 5/5. |
| Protected parity | Current final2 Vite/Next each pass; 0 semantic, 9 incidental, 195 normalized leaves; protected tree exact. |
| WASM/API/reference | `check:wasm`, runtime API contract, API negative controls, and reference/license boundary pass: 38 JS exports, 58 binary exports, 609 imports. |
| `git diff --check` | product and planning exit 0; line-ending warnings only. |
| strict Rasen validation | exit 0; 1 valid change, 0 issues. |

## Protected/scope identities

- port tree: `efe499db6bec7afb8c35ac1a2aaa5fe851fac667`
- in-memory port current/HEAD blob:
  `c28d9b0b6389db814fc4e7647e484afe25abe895`
- session-types current/HEAD blob:
  `c67d9822a2a6c994be14f367e6980fbbaa6e454b`
- parity HEAD tree: `e1fbb55b985f4fb490c6b233d18c50c58ea14c28`
- type fixture HEAD: `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8`
- Rust WASM/GPU/compositor trees:
  `d782b046c0f39e85b8a5ed518b42389214c211e5`,
  `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2`, and
  `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34`
- generated JS SHA-256:
  `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1`
- generated WASM SHA-256:
  `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`

No C7 headless graph, E1 Elftia/packaging work, D2 React decision, new private
port, Rust API/source change, generated-WASM edit, main-spec sync, or browser
database/OPFS deletion appears in the product diff. Durable storage changes are
limited to live media-owner draining; they do not delete durable C5 data.

Scope Check: **IN-SCOPE BUT NOT ACCEPTABLE**. The write set is C6-scoped and
protected identities are exact. Acceptance remains blocked solely by B1: the
checked audio suspend/resume GREEN requirement is direct-isolated red. No ship,
commit, integration, spec-sync, or archive action is authorized.
