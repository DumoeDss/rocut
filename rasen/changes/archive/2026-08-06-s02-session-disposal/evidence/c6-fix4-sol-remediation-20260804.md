# C6 Fix-round 4 Sol remediation evidence (2026-08-04)

## Scope and acceptance boundary

This round completes only tasks 4.8, 6.6, 6.8, and 7.12. It adds the missing timer,
audio-generation, finite-audio, object-URL, media-cache, and service-drain scenarios; fixes the
production lifecycle races those tests exposed; and reruns the fresh build, browser, boundary,
provenance, and regression tail.

The product worktree is `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`.
The accepted base remains:

- HEAD: `d6ed4166b5ffb13257d1924851f2fa57d73d349f`
- tree: `3875074383b41f622e5f32942091468cf8959b61`

No commit, push, PR, integration, spec sync, archive, cleanup, or durable-data deletion was
performed. Existing dirty/untracked files and every superseded diagnostic artifact were
preserved. Product source was frozen before the final build and verification tail.

## RED-to-GREEN scenario completion

### 4.8 — independent timer/interval/RAF ownership

- Added an independent timer ledger and a focused fake-clock matrix covering fired timeout
  self-release, early cancellation, duplicate cancellation, stale timeout callbacks, stale
  interval ticks, RAF self-release, RAF cancellation races, suspended-dwell quiescence, and no
  post-quiescence publication.
- The ledger RED observed `created: 4, released: 2`; GREEN is `created: 4, released: 4`.
- The stale-callback RED published twice. `SessionResources` now gives each timeout, interval,
  and RAF registration its own active flag, so cancellation and generation closure make a
  captured callback inert while release remains exactly-once.

### 6.6 and 6.8 — live/finite audio generation and closure matrix

- A held `getPrimaryAudioTrack()` completion demonstrated that `AudioManager` could populate a
  sink after suspend, Host replacement, or disposal. The fix carries the requesting session ID
  through the async path, checks it before and after each await and before construction, transfers
  ownership only to the still-current session, and disposes any untransferred `Input` in `finally`.
- Session service draining is ordered so the old audio owner terminates before a replacement can
  publish.
- Sounds decode now checks the activity generation after fetch, `arrayBuffer`, and decode, before
  cache insertion or error publication; stale results close instead of reaching a resumed
  generation.
- Waveform decode uses a session activity-generation token. Decode failure closes the finite
  input, clears the rejected cache entry, and permits a fresh retry.
- Subtitles asset extraction/transcription and media processing image/video/capacity paths now
  check their activity generation before publication, caption insertion, or error reporting.
- The finite-audio matrix covers success, failure, cancellation, delayed close, rejected close,
  double-close avoidance, and terminal closure.
- Unsupported video codec initialization now disposes its `Input`, clears the failed cache entry,
  and retries with a fresh input.

### 7.12 — object URL, media ownership, and drain ordering

- Added early-revoke, double-revoke, error/abort/removal-failure, equal-logical-blob two-session,
  project-replacement, and service-drain tests.
- `downloadBlob` and `downloadBuffer` now remove the temporary anchor and revoke the URL through
  nested terminal `finally` paths, including click and removal failures.
- Legacy SVG sniff replacement retains exact ownership and revokes the superseded URL.
- Undo → redo → second undo restores fresh exact URLs without reusing revoked identities.
- Equal logical media values in separate sessions keep separate live URL owners.

## Focused test evidence

The accepted focused matrix was run sequentially after source freeze to avoid conflating Bun
wrapper startup instability with product assertions. All 13 focused files exited 0: **34 passed,
0 failed** at the top level. Important direct totals were:

| Matrix | Result |
| --- | --- |
| Independent timer ledger | 4 pass / 0 fail / 16 assertions |
| Session disposal and object URL ownership | 11 / 0 / 72 |
| Session-state/audio isolation child | 20 / 0 / 222 |
| Async sounds store child | 15 / 0 / 82 |
| Waveform generation/closure | 4 / 0 / 16 |
| Browser resource utilities | 3 / 0 / 11 |
| Media persistence | 4 / 0 / 12 |
| Media processing activity child | 2 / 0 / 9 |
| Video cache failure/retry child | 4 / 0 / 23 |

One batched session-state wrapper run missed its 1 ms held-audio polling window under load, while
the isolated child was repeatedly clean at 20/20/222. Bun 1.2.2 also once exited in the media
processing wrapper before running tests; its isolated child immediately passed. Neither startup/
scheduling event was accepted as evidence, and neither prompted a source workaround.

## Fresh final builds and provenance

All paths below are relative to the product worktree.

### Vite

- marker: `c6-fix4-sol-final2-vite-20260804-1`
- output: `apps/vite-example/dist-c6-fix4-sol-final2-20260804-1`
- Vite 7.3.6; 2,890 modules; 307 files / 35,021,696 bytes; five marker occurrences
- module graph SHA-256: `54a5a60f855ce2c9d821503aeeda7cd85cdac641e0ea57aaf311e6e097cbce0f`
- asset manifest SHA-256: `d51cf22db840c9d3bd0dd0a95cca20c7499471ce61030b72d6777a08094c4cc0`
- emitted module IDs: 2,890, digest
  `8a1f28c96bca7b0ba5518083877eb3aab81a4245949998bd6bacec36b19906fa`
- web source IDs: 591, digest
  `731c0fcdadd3fdd2d1b29c765f76e6c6072ad371bde70d08e026751778773e7d`
- attributable source IDs: 602, digest
  `1492ae6ac334021bb10c2c434154e8b0004ac37f41d05e8799be45914c63d9fb`

### Next

- marker: `c6-fix4-sol-final2-next-20260804-1`
- output: `apps/web/.next-c6-fix4-sol-final2-20260804-1`
- Next 16.1.3; `/c6-disposal` present; five marker occurrences
- BUILD_ID: `JHOATRtReGJgHbI6v_Bnv`, digest
  `6a449dfcd7e7d8799e88b565bb175bee82277af94ce1bdb12df5d4daedfa4fea`
- NFT digest: `203ca9063d36939bd6bd67f2e148e40120d862f7f729009c41e7c2f006ab6817`
- route page digest: `aff1e85c085f2195381bc871613361e92375d1c365037a18f43d09ae2904845f`
- route manifest digest: `c7102fe36ed8563a05c262b50f743023959ee1938132d932208944126dd2b30e`
- route files: 82, digest
  `e5fd18dcfdd10833eb404c1d30e3e1cddc3229b392d2afb78a8186cd8fcdd213`
- source maps: 78, digest
  `a3a170b36c7710fe411303a4031d104f16077e5a310328ef1d67307cb54a54b9`
- module IDs: 2,557, digest
  `9e6f2cc5da65e89a6b37efff56b2b65a925818ab446bce7486aa5a3d08b0ca87`
- source IDs: 596, digest
  `d9d45357e1ab7e7833b59a1d0cece92e0f67e6e9ec3ef2e2db09bfc99319d11a`

Next's build rewrote `tsconfig.json`; it was restored through the reviewed patch path and the
worktree/HEAD blob is exactly
`3573338ac15340d929fba6ee676c70a263db5f58`. The standalone deployment copy includes 336 public
files and 110 static files at the custom distDir expected by the generated server.

### B2 closure and independent anchor

- canonical closure payload digest:
  `6ce54c5109bf886e8bb5537b980fe7f4e09f0c55e253a7e360d26cde7b4f55e4`
- common set: 257; closure: 264; closure digest:
  `353bff09a22738624ca48907178863c389f38e0b8bb54f5c74ee9531e3fb401d`
- refreshed B2 anchor independently reported source 712 / closure 264, Vite 2,890 / 591 and
  Next 82 / 78 / 2,557 / 596, with provenance PASS.
- protected B2 tests: 18 pass / 0 fail / 95 assertions; reviewer negative controls: 8 / 0 / 24;
  downgrade and BUILD_ID controls passed; superseded final1 references were zero and old outputs
  were rejected.
- ordinary semantic boundary: source 712 / closure 264 / all seven rule counts zero; its negative
  control and final2 provenance gate exited 0.

## Final browser oracle

Both accepted runs used `BrowserProjectStore`, exact final2 markers, real production Host
composition, six cycles, and `postResumeActivity=true` in all six cycles. Every page status was
ready; `audioFallback=false`; console/page error counts were zero. Six expected revoked-blob
diagnostics per Host were classified as expected lifecycle observations.

| Host | Accepted artifact | Ordinary | Missing-CREATED control | Deliberate leak |
| --- | --- | --- | --- | --- |
| Vite | `apps/vite-example/c6-fix4-sol-final2-vite-browser-oracle-20260804-1.jsonl` | clean; every class residual `[0,0,0,0,0,0]` | non-clean; Worker lacked CREATED in all six cycles; all residuals zero | non-clean; Worker and GPU `[0,0,0,0,0,1]`; all other classes zero |
| Next | `apps/web/c6-fix4-sol-final2-next-browser-oracle-20260804-2.jsonl` | clean; every class residual `[0,0,0,0,0,0]` | same expected Worker-CREATED failure; all residuals zero | same expected Worker/GPU final-cycle residuals |

The first Next browser artifact,
`apps/web/c6-fix4-sol-final2-next-browser-oracle-20260804-1.jsonl`, stopped before observations
because static chunks were initially copied beneath a literal `.next/static` rather than the
custom distDir. It is preserved as a deployment-assembly failure. Static files were additionally
copied to the generated server's expected custom path without deleting the earlier copy; the
accepted `-2` run is the result above.

Owned browser/server PIDs were stopped exactly. Ports 4362 and 4363, and all other owned tail
ports, were verified free.

## Regression and provenance tail

- Type baseline: exit 0 with exactly the three inherited diagnostics. Vite `tsc --noEmit`: exit 0.
- Targeted ESLint across 22 changed files, targeted Prettier check, and product
  `git diff --check`: exit 0 (line-ending warnings only).
- Port, session-state, Host-composition, storage, runtime-asset, reference, Next-import,
  distributable, singleton, emitted-resource, and asset-manifest ordinary/negative controls:
  green with non-vacuous source/emitted counts.
- Served final2 asset manifest: 298 copied files / 4,481,207 bytes and 7 emitted files /
  30,247,277 bytes; MIME, byte, digest, category, graph, and exclusion checks passed.
- `check:wasm`, the WASM API contract, and runtime WebGL capacity/handle/cancellation/concurrent-
  failure gates passed. The no-write SBOM validation found 1,359 npm packages and 80 Rust/WASM
  crates with D1–D5 dispositions matching; `SBOM.md` remained byte-identical at
  `1a55a1587f20b40b0bb031998eacc91d22354b0eb23823b460f791affe6599dd`.
- C3 WebGL accepted run:
  `tests/.pw-output-c6-fix4-sol-final2-c3-webgl-20260804-2`, 1 passed. The initial `-1` run is
  preserved; it used the C6 marker as the legacy C3 commit expectation instead of the correct
  `missing` value and failed only that test configuration.
- C3 WebGPU accepted replay:
  `tests/.pw-output-c6-fix4-sol-final2-c3-webgpu-20260804-1`. It reached ready two-session,
  capacity, handle, frame, and project checks, then reproduced the inherited
  `data-migrating=true` expectation failure (expected true, received false at line 88).
- C4 unit gate: 53 pass / 0 fail / 309 assertions across 9 files.
- C5 unit gate: 59 / 0 / 306 across 14 files. C5 live/forced-none Playwright:
  `tests/.pw-output-c6-fix4-sol-final2-c5-storage-20260804-1`, 5/5 passed.
- Protected parity: final Vite and full-env Next runs each passed. The normalized comparison had
  0 semantic differences, 9 incidental differences, and 195 leaves. Final artifacts are at
  `apps/vite-example/tests/parity-artifacts-c6-fix4-sol-final2-20260804-1`; the original 28-file
  parity artifact directory was restored exactly. The first Next parity attempt is preserved at
  `apps/vite-example/tests/parity-artifacts-c6-fix4-sol-final2-next-failed-env-20260804-1`; it
  lacked eight runtime environment variables and was not accepted.
- Full Bun log: `c6-fix4-sol-final2-bun-full-20260804-1.log`. Accepted identity is **386 pass /
  8 fail / 2 loader errors / 1,318 assertions / 394 tests / 74 files / 52.40 s**. The six named
  failures are the inherited `resolveTrackPlacement`/`ZERO_MEDIA_TIME` cases; the two unchanged
  loader errors are `wasm.__wbindgen_start is not a function` and the params `DEFAULTS` TDZ.
  No additional product or wrapper failure appears in this final suite.

## Protected identities and cleanup proof

- port-boundary HEAD tree: `efe499db6bec7afb8c35ac1a2aaa5fe851fac667`
- in-memory port worktree/HEAD blob:
  `c28d9b0b6389db814fc4e7647e484afe25abe895` (content diff zero)
- session types worktree/HEAD blob:
  `c67d9822a2a6c994be14f367e6980fbbaa6e454b` (content diff zero)
- parity HEAD tree: `e1fbb55b985f4fb490c6b233d18c50c58ea14c28`
- type fixture HEAD: `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8`
- Rust WASM/GPU/compositor trees: `d782b046c0f39e85b8a5ed518b42389214c211e5`,
  `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2`, and
  `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34`
- generated JS/WASM SHA-256:
  `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1` and
  `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`

The protected-path diff check exited 0. Ports 4173, 4175, and 4362–4367 were all free after the
tail; no owned server remained.

The final frozen-source audit reran `git diff --check` (exit 0, line-ending warnings only), the
ordinary boundary (712 source / 264 closure / seven zero-violation rules), and the protected B2
suite (18 / 0 / 95). HEAD/tree and the tsconfig, protected port, and session-type worktree/HEAD
identities remained exact. `rasen validate s02-session-disposal --project rocut --strict --json`
returned exit 0 with one valid change, one passed item, zero failed items, and no issues.

## Task truth at freeze

The task file now contains **112 checked / 25 unchecked / 137 total**. This round advances exactly
4.8, 6.6, 6.8, and 7.12. Task 9.7 remains the only implementation/scenario leaf: the project
contract did not require `SOURCE_INVENTORY.md`/`PATCHES.md` regeneration, so it was not performed.
Independent artifact review (11.10), the dedicated exclusion proof (12.13), all independent
review/model-evaluation work (13.1–13.6), and every ship/integration/spec-sync/archive leaf
(14.1–14.8) remain intentionally unchecked.
