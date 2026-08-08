# C6 Scenario 52 / Host-ID tail review

Date: 2026-08-05

Reviewer role: fresh non-author, report-only

Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`

Planning change: `rasen/changes/s02-session-disposal`

Exact base/HEAD: `d6ed4166b5ffb13257d1924851f2fa57d73d349f`

Exact base tree: `3875074383b41f622e5f32942091468cf8959b61`

## Verdict

**CLEAN.** The acceptance conditions requested for this tail are met:

- findings: **0 Blocker / 0 Major / 0 Minor / 1 retained Trivial**;
- delta-spec recomputation: **59 PASS / 0 FAIL / 0 UNVERIFIED**;
- exact FINAL3 Vite and Next browser artifacts independently replay all three controls and the
  durable dispose/reopen proof;
- the production Host-ID fix removes the fresh-Host collision while preserving fresh identity for
  every non-stable Host port role;
- focused, boundary, full-suite, protected-identity, static, type, WASM, strict, and hygiene gates
  have no new red identity.

This review supports adjudicating task 11.10 as satisfied. The reviewer did **not** edit
`tasks.md` or mark its checkbox. Task 9.7 and the chronology/delivery leaves remain open as recorded
below. No commit, ship, integration, spec-sync, archive, cleanup of pre-existing product artifacts,
or product/source edit was performed.

## Findings

There is no open Blocker, Major, or Minor finding.

### Trivial T1 - three comments retain mojibake (confidence 1.00)

`apps/web/src/editor/session/session-resources.ts:10`, `:138`, and `:644` contain malformed
punctuation in comments (`閳?`). This predates the Scenario 52 / Host-ID tail, is not executable, and
does not affect any gate. It is retained only for accurate finding history.

## Review authority and scope attribution

The last prior non-author review is `evidence/review-fix-round-5.md`, whose evidence cutoff is
`2026-08-04T22:46:11+08:00`. I attributed every later Scenario 52 / Host-ID source or gate input.

| Area | Current file identity / disposition |
| --- | --- |
| Vite Host ID fix | `apps/vite-example/src/host/vite-host-config.ts`, 2,931 bytes, SHA-256 `2a46b1b4f986a1d2bb0069b72c43d5936f9d758afb6e555669c08b13f1375c1d` |
| Next Host ID fix | `apps/web/src/editor/host/next-editor-host.ts`, 2,894 bytes, SHA-256 `4b708336869135f2c8e2e7809aaf2cbc4bd374f3bcc202eb9b6dade2a90a3ae4` |
| Vite entry | `apps/vite-example/src/app.tsx`, SHA-256 `a982615a4571d487d07be3f180fb550a9ae9faf918d90b174f33dafe8be0f173` |
| Next proof page | `apps/web/src/app/c6-disposal/page.tsx`, SHA-256 `cb9208a963395e6b1af7f0b9c76866404063c4302bbb6b23f1ddcf7792f019e7` |
| Shared browser harness | `apps/web/src/editor/session/c6-disposal-harness.tsx`, SHA-256 `bf7c19f1833d3eab56d8e819373d7df471b4ffee6cf7f9a0cdf51a784203500b` |
| Durable browser proof | `c6-durable-reopen-browser.ts`, SHA-256 `e91e5a9bc1dd2f5339f7ff927145fa122eb36dcad67d1c88979ca25030341fb0` |
| Durable evaluator | `c6-durable-reopen.ts`, SHA-256 `d73ce10fa717a867079a6beeb962b2f7483fe70fc6e73494f33242ed8a04599c` |
| Durable unit tests | `__tests__/c6-durable-reopen.test.ts`, SHA-256 `e2a7be01f7605036b8d2b873d9ade81a915c6fae6ec58dcbe28e344ad90bafbb` |
| Host composition tests | `production-composition.test.ts`, SHA-256 `0d9cf2ed4f691ec006cc24532a171407098846df53e042e41e3232b766d62012` |
| B2 checker / tests | SHA-256 `78f83f22c230f0990351eb224dbc0b9515822db186bb68e07e46541587de5242` / `936302637bdfd6561683d97acaefd82603689acaf59dfd7b5562ec38cb3dbcdd` |
| B2 independent anchors | SHA-256 `7712e764485a78b8dd0305e1f224267c34cc82471f8ca0d5aac8f897bb9d0a30` / `0e4c903241512c030a9e916fd4b9cc006484e1435ff6779ab27b9680db839948` |
| External evidence tools | `run.mjs` SHA-256 `de3393d00681605a79d93b85990b150d33ba4ae9cba72291bfe690bb67780931`; `start-next.mjs` SHA-256 `6a74e1c7d7566561c3199cbb92322a509ad7b72b00326f31c6c0ff097c6d9efd` |

`script/collect-next-editor-module-ids.mjs` and
`script/generate-session-resource-closure.mjs` predate the round-5 cutoff and were not falsely
attributed to this tail. The only source mtime after both FINAL3 builds is the Host composition test;
it is test-only and absent from both production build graphs.

## Production Host-ID review

The original Scenario 52 failure was real: each fresh production Host previously received a fresh
`DeterministicIdGenerator`, allowing two Hosts in one application realm to publish the same public
session ID (`session-1`). Both production factories now retain a module-stable ID generator and
apply it in the final Host-port override:

- Vite: `viteIds` at `vite-host-config.ts:18`, applied at `:105`;
- Next: `nextIds` at `next-editor-host.ts:24`, applied at `:103`.

The fix is narrowly composed. Each factory still starts with a new `createInMemoryPorts()` result;
only the intended process-lifetime `ids`, `store`, and `diagnostics` roles are stable. Direct
identity assertions prove that `assets`, `assetLoader`, `runtimeResources`, `exporter`, and
`environment` remain distinct between fresh Hosts. Navigation, services, branding, and links are
also freshly constructed. Fresh sessions created by one or several Hosts have distinct public IDs.
The Vite and Next modules are separate application realms, so each owning one module-stable
generator is the correct scope.

The durable harness is not synthetic:

- the entry modules import the exact production `BrowserProjectStore` class and inject only
  `store => store instanceof BrowserProjectStore`;
- store provenance is taken from `session.host.store`; minified constructor names are diagnostic
  only;
- the first and second public sessions use the exact same Host object, store object, and project
  ID, while their session IDs are distinct;
- the known edit, private sentinel, raw project record, attachment metadata, and attachment bytes
  are written/read through public `ProjectStore` operations;
- no native IndexedDB/OPFS access, private React/fiber inspection, or emitted-bundle mutation is
  present.

## FINAL3 artifact provenance

| Host | Frozen artifact | Marker | Tree SHA-256 | Accepted JSONL |
| --- | --- | --- | --- | --- |
| Vite | `apps/vite-example/dist-c6-s52-final3-vite-20260804-1` | `c6-s52-final3-vite-20260804-1` | `a515cbcb336946dd0a565e6720bd3e82a02d4fe5e12bce05a6070d3ac8128bb8` | 5 lines, 121,606 bytes, SHA-256 `1c8b374893545b36a35254adccc1ac542414ac9c658eb0f5735bc602bb501d59` |
| Next | `apps/web/.next-c6-s52-final3-next-20260804-1` | `c6-s52-final3-next-20260804-1` | `4fada1582be20cfdfadc102e3dcc7009a8ac42752930d775d2dc4fd983d149e7` | 5 lines, 122,239 bytes, SHA-256 `4814beaf725b43f9d49cf6e33fa25b96eb73576caf410247873e5d0d4783edde` |

The B2 anchor independently reaccepted canonical closure payload
`433314cfb301b3b30781151255d36a4d6a7893032b6d7cbf7a7280a34665dd99`, common source count 257,
closure count 266, and source-closure SHA-256
`c94d2126b82aae7c40a5edeec5193da2576b0fdea977a9b014e037c04bf9923a`.
It records 2,892 Vite modules / 593 web source IDs and 82 Next route files / 78 maps / 2,557
module IDs / 596 source IDs; Next BUILD_ID is `bkdPLKJK7Ps0LPLLDcsZf`.

I independently scanned all 256 current FINAL3 Next source maps. Their `sourcesContent` is
byte-identical to the current Next Host, proof page, shared harness, durable browser proof, and
durable evaluator sources listed above. The Vite module graph contains the exact current relevant
source IDs, and its minified bundle contains the unique marker, durable-reopen proof, browser-store
attribution, sentinel edit, and attachment key. Both current `tsconfig.json` files are exact HEAD
content. Thus the FINAL3 browser records are attributable to the current product/harness source,
not a stale build.

## Independent FINAL3 browser replay

I served the frozen directories without rebuilding and used the external evidence runner with
system Chrome and a fresh browser context per control. Reviewer JSONL files were temporary by
design and deleted after their hashes/results were recorded.

| Host | Reviewer port | Reviewer JSONL identity | Result |
| --- | ---: | --- | --- |
| Vite | 41973 | 5 lines / 122,744 bytes / SHA-256 `24de907181a668234b854444e4ed0365f03bed07ee21a2ee08cfb5e363e8d484` | ordinary PASS; missing-created PASS; leak PASS; durable PASS; summary PASS |
| Next | 31973 | 5 lines / 122,177 bytes / SHA-256 `a0cfb1a8375ee256328fc9ddb094da3846c7f17c1c0aaf88aff3c0df76d6962c` | ordinary PASS; missing-created PASS; leak PASS; durable PASS; summary PASS |

For each Host:

- ordinary executes six cycles, creates all five classes in every cycle, reports no failures or
  browser/page errors, and emits six zeros for timer, Worker, audio context, object URL, and GPU;
- missing-created stays non-clean for all six cycles because Worker creation is zero, while all
  residuals remain zero;
- the deliberate leak stays non-clean and ends with exact Worker and GPU residual `1`, while the
  other three residuals remain zero;
- the durable record uses sessions `session-1` and `session-2`, with `distinct`, `sameHost`,
  `sameProjectId`, `sameStore`, and `instanceOfBrowserProjectStore` all true;
- the project name is `Scenario 52 known edit`, raw bytes and private sentinel are equal across
  reopen, and attachment SHA-256 is exactly
  `bdc3eaacc133fc08118f8e69a969417403735f8441000061d3018bb02fdc1ea4` with metadata/body equality;
- all five first-cycle resource counts are non-zero, both first and second disposal residual
  vectors are five exact zeros, both sessions are removed, final active session count is zero, and
  console/page errors are zero.

The raw project digest is intentionally Host/run-specific because the private sentinel contains
Host-specific data; equality within each dispose/reopen run is the requirement. The fresh replay
recorded Vite `9ed45ac0a400cafb27080191c3572229db613f3eb0a82ccee216e954210b5ba3`
and Next `4f06e778fc594edb36b0bb7b37e0be7fe3a43aed3e07725641bd7d35189496ee`,
each equal before/after reopen.

Two initial Vite reviewer attempts invoked the Node ESM Playwright runner with Bun and timed out
during browser launch before navigation or evidence emission. They created no JSONL and implicated
only the invocation choice. Re-running the unchanged runner with Node succeeded on the first Vite
and Next attempts. All exact reviewer-owned processes were then terminated.

## Independent gates

| Gate | Fresh result |
| --- | --- |
| Durable evaluator + composition wrapper | 5 pass / 0 fail / 10 assertions |
| Direct production composition | 9 pass / 0 fail / 47 assertions; stable intended roles and fresh non-stable roles proven |
| Direct lifecycle matrix | 43 pass / 0 fail / 116 assertions |
| Direct session-state isolation matrix | 20 pass / 0 fail / 236 assertions |
| C6 B2 protected suite | 18 pass / 0 fail / 95 assertions; eight executable negatives, truncation, padding, downgrade, self-approval, BUILD_ID stability, emitted and provenance controls all pass |
| C6 source boundary | 714 source modules / 266 attributable closure / all seven rule totals zero |
| Port boundary | 41 contract modules; normal and all negative controls clean |
| Session-state boundary | 10/10 factories, 10/10 keys, 52 classified imperative modules; normal and all negative controls clean |
| Final3 emitted assets | Vite 1 entry / 1 Worker / 1 editor WASM / 1 ORT; Next 11 entries / 3 Workers / 1 editor WASM / 1 ORT; 25 negative cases fail closed |
| Full Bun replay | exact accepted baseline: 390 pass / 8 fail / 2 loader errors / 1,328 assertions / 398 tests / 75 files in 45.58 s |
| Full-suite red identity | exactly six inherited `ZERO_MEDIA_TIME` placement failures plus inherited `wasm.__wbindgen_start` and `DEFAULTS` loader errors; no new identity |
| Type | `check-type-baseline`: 3 current diagnostics, all within the 13-diagnostic pin; Vite `tsc --noEmit`: exit 0 |
| Static | Host composition, distributable boundary, Next imports, storage boundary, runtime assets, reference boundary, editor singleton: all exit 0 |
| WASM | source/path/API surface and combined `check:wasm`: exit 0; exact 38 JS / 58 binary exports and 609 imports |
| Style/syntax | targeted ESLint, Prettier, Node syntax, and base-relative `git diff --check`: exit 0 |
| Strict planning | `rasen validate s02-session-disposal --project rocut --strict --json`: 1/1 valid, no issues |

The full-suite aggregate intentionally exits 1 because of the eight accepted failures and two
accepted loader errors. Acceptance is based on exact identity and totals, not a false green exit.

## Protected identities and exclusion

Every protected identity matches the design and has zero content diff:

| Protected object | Exact identity |
| --- | --- |
| `apps/web/src/editor/ports` | tree `efe499db6bec7afb8c35ac1a2aaa5fe851fac667` |
| `session-types.ts` | blob `c67d9822a2a6c994be14f367e6980fbbaa6e454b` |
| parity fixture tree | `e1fbb55b985f4fb490c6b233d18c50c58ea14c28` |
| type baseline fixture | blob `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8`, SHA-256 `0f7cc855fc8f5c7edd68b2c371bae993fe8e713d2ffd4ef21956de72bd387622` |
| `rust/wasm` | tree `d782b046c0f39e85b8a5ed518b42389214c211e5` |
| `rust/crates/gpu` | tree `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2` |
| `rust/crates/compositor` | tree `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34` |
| generated JS / WASM | SHA-256 `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1` / `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1` |

The independent base-relative path set is still exactly 72 tracked content paths plus 24
non-ignored untracked source/gate paths, 96 unique. There are zero deleted product paths, zero
protected port/session-type or Rust content paths, zero dependency-decision files, zero path hits
for C7 headless or E1/desktop packaging, and zero added durable-store deletion call tied to a
`ProjectStore`/Host store. This reaccepts task 12.13 without expanding C6 into C7, E1, or D2.

## All 59 scenarios

`PASS` means supported by fresh execution or an attributable current/protected control plus direct
implementation inspection. No scenario is inferred merely from a checked task.

| # | Scenario (spec order) | Status | Independent disposition |
| ---: | --- | --- | --- |
| 1 | Concurrent disposal joins one teardown | PASS | Direct lifecycle/ownership controls pass. |
| 2 | Dispose wins over a queued resume | PASS | Queued-resume race passes. |
| 3 | Repeated suspend and resume are idempotent | PASS | Repeated/no-op control passes. |
| 4 | Host replacement cannot publish from a stale generation | PASS | Generation/churn controls pass. |
| 5 | Suspend stops active publications | PASS | Pending export/cancellation/failure attribution is terminal. |
| 6 | Suspend retains non-activity identity | PASS | Editor/project/root identity is retained. |
| 7 | Resume restarts only the owner | PASS | Both fresh Hosts prove a new owned generation and publication. |
| 8 | Retained resources are not falsely reported released | PASS | Release is recorded only at terminal disposal. |
| 9 | Complete editor graph has one acquisition mediator | PASS | 714/266 boundary and wrapper negatives pass. |
| 10 | Direct acquisition fails mechanically | PASS | Alias/computed timer, Worker, audio, and URL negatives fail closed. |
| 11 | Empty or truncated scanning cannot pass | PASS | Empty/truncated/padded/downgraded/self-approved controls fail closed. |
| 12 | Operation-bounded offline rendering is classified | PASS | Destructured/aliased OfflineAudioContext negative is caught. |
| 13 | A fired timeout self-releases | PASS | Independent timer ledger passes. |
| 14 | Suspend cancels activity timers | PASS | Interval/RAF/nested-paint matrix passes. |
| 15 | Disposal cancels every remaining timer kind | PASS | Timer/interval/RAF terminal drain passes. |
| 16 | Transcription Worker stops on suspend | PASS | Pending generation termination/listener cleanup passes. |
| 17 | Resume creates a fresh Worker generation | PASS | Fresh generation and stale-event controls pass. |
| 18 | Disposal observes platform termination | PASS | Both Hosts message and terminate a real local Worker. |
| 19 | Audio decode closes its finite context | PASS | Success/reject/cancel/dual-failure matrix passes. |
| 20 | Audio playback quiesces and resumes | PASS | Round-5 deterministic matrix plus current lifecycle replay passes. |
| 21 | Disposal waits for terminal closed state | PASS | Delayed close holds disposal until terminal state. |
| 22 | Rejected close is not clean release | PASS | Rejection is attributed and later owners drain. |
| 23 | Loaded media retains its URL owner | PASS | Persistence/ownership matrix passes. |
| 24 | Replacement and removal revoke once | PASS | Undo/redo/replacement matrix passes. |
| 25 | Transient processing revokes on every exit | PASS | Success/failure/cancel processing matrix passes. |
| 26 | Disposal drains retained URLs | PASS | Both FINAL3 Hosts prove fetch-before and failure-after revoke. |
| 27 | Two sessions do not share live cache identity | PASS | Equal-key cache/input generations remain distinct. |
| 28 | Project replacement drains prior live state | PASS | Canonical replacement and direct owner drains pass. |
| 29 | Session disposal drains every service owner | PASS | Input/exporter/service drains are joined. |
| 30 | Shared resolver lease releases only on final owner | PASS | Final-owner recreation control passes. |
| 31 | Reverse acquisition order is terminal order | PASS | Awaited reverse release order passes. |
| 32 | One failure does not skip later cleanup | PASS | Later resources and owners are attempted. |
| 33 | Multiple failures are preserved | PASS | Aggregate error ordering passes. |
| 34 | Repeated disposal preserves first outcome | PASS | Fulfilled/rejected outcomes remain stable. |
| 35 | No acquisition occurs after admission closes | PASS | Suspend/dispose admission rejects synchronously. |
| 36 | First of two owners releases only its compositor | PASS | Two-owner runtime control passes. |
| 37 | Final owner tears down shared state | PASS | Exact handle/runtime teardown passes. |
| 38 | Live handles prevent false final release | PASS | The deliberate GPU leak remains named and non-clean. |
| 39 | Concurrent owner release calls one teardown | PASS | Shared teardown executes once. |
| 40 | Fresh generation initializes after final teardown | PASS | Fresh runtime generation passes. |
| 41 | Runtime query wrappers outlive reconciliation | PASS | Failure/retry ordering passes. |
| 42 | Every ordinary cycle creates all five classes | PASS | 12 fresh reviewer ordinary cycles prove all five. |
| 43 | Every ordinary cycle has zero exact residuals | PASS | Both Hosts emit five six-zero series. |
| 44 | Residual growth is assessed across cycles | PASS | Series are emitted; final-cycle Worker/GPU growth is detected. |
| 45 | Missing creation fails before release proof | PASS | Missing Worker stays non-clean with zero residuals. |
| 46 | Deliberate leakage is caught by the same evaluator | PASS | Same evaluator catches Worker and GPU residual 1. |
| 47 | Fresh Vite evidence is attributable | PASS | Marker, graph, manifest, source identity, and reviewer replay align. |
| 48 | Fresh Next evidence is attributable | PASS | Marker, NFT/maps, exact sources, and reviewer replay align. |
| 49 | Host fallback cannot pass | PASS | Browser store/runtime roles and no-audio-fallback are enforced. |
| 50 | Supplemental process metrics cannot override leakage | PASS | Exact residuals keep the leak control non-clean. |
| 51 | Disposing one session preserves another session | PASS | Cross-session manager/cache/runtime controls pass. |
| 52 | Durable data survives all session disposal | PASS | Both production Hosts write, dispose, reopen through a distinct session, and preserve exact record/attachment data. |
| 53 | Forced-none remains allocation-free | PASS | Protected C4 evidence remains attributable; protected path is exact. |
| 54 | Backend capacity behavior remains unchanged | PASS | Current protected C3/C4 controls and unchanged runtime identities remain attributable. |
| 55 | Protected artifacts remain identical | PASS | All recorded trees/blobs/generated hashes match. |
| 56 | Existing regression identity does not grow | PASS | Type ceiling and exact 390/8/2 full-suite identity pass. |
| 57 | Complete capability corpus is swept both ways | PASS | Scenario 20 and Scenario 52 are now both executed PASS; the two-way corpus has no non-pass row. |
| 58 | C7 and E1 remain out of scope | PASS | 96-path audit finds no C7/E1/D2/private-port/Rust/WASM/durable-delete expansion. |
| 59 | Review and delivery remain independent | PASS | This fresh reviewer changed reports only and performed no delivery action. |

Scenario totals: **59 PASS / 0 FAIL / 0 UNVERIFIED = 59**.

## Task truth and delivery state

Mechanical recount of `tasks.md`: **114 checked / 23 unchecked / 137 total**. The exact unchecked
IDs are:

`1.4, 1.5, 1.6, 1.11, 1.12, 1.13, 1.14, 9.7, 11.10, 13.1, 13.2,
13.3, 13.4, 13.5, 13.6, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7,
14.8`.

- `1.x`: chronology/provenance bookkeeping remains unchecked; this review does not rewrite history.
- `9.7`: remains open for the project-contract/post-commit inventory and `PATCHES.md` action.
- `11.10`: this report provides the mandated independent artifact review and supports later
  adjudication; the reviewer intentionally left the checkbox untouched.
- `13.1-13.6`: review/evaluation orchestration and completion recording remain delivery-owner work.
- `14.1-14.8`: local ship, integration, spec-sync, and archive remain entirely unperformed.

## Worktree hygiene, cleanup, ports, and disk

The product worktree was already intentionally dirty and remains so. Current counts are 72 tracked
content-diff paths, 74 tracked status entries, 160 untracked roots, and 20,774 untracked files. The
two status-only tracked paths are `apps/web/src/editor/ports/in-memory/index.ts` and
`apps/web/src/services/renderer/__tests__/host-effect-preview.test.ts`; each has zero content diff.
The audited source/gate subset remains 24 untracked files and 96 unique base-relative paths total.
No pre-existing artifact or user file was cleaned.

`apps/web/next-env.d.ts` is ignored by `apps/web/.gitignore:12`, is 280 bytes, and has SHA-256
`1a2af02e8c441b0176ef0b6365451b4f3f19de6e8f98f4c5304adc1269ab6bce`. It points to the
superseded generated `.next-c6-s52-sol-next-20260804-2/types/routes.d.ts`. This is a generated,
ignored diagnostic and is absent from the FINAL3 build/source provenance; it is recorded as hygiene,
not a finding.

Reviewer cleanup removed exactly six reviewer-owned temporary JSONL/server-log files after their
identities were recorded; none remains. This deletion is not recoverable through the worktree, but
the files were ephemeral reviewer output and their substantive results are preserved above.

Ports `4173`, `4175`, `4362-4367`, `41953`, `31953`, `41973`, and `31973` all have zero listeners.
Reviewer-owned PIDs `69172`, `37140`, `69144`, `41876`, and `23740` are gone; the process query found
no matching reviewer browser/server process other than the query shell itself. Final free space on
drive E is **5,289,672,704 bytes (4.926 GiB)**.

## Final review statement

The Scenario 52 durable-reopen gap and fresh-Host ID collision are closed on both production Hosts.
The B2 artifact/provenance tail is independently anchored, the exact FINAL3 builds replay cleanly,
all 59 scenarios pass, and no Blocker or Major remains. The change is ready to leave independent
review and proceed only through the still-separate task/delivery leaves.
