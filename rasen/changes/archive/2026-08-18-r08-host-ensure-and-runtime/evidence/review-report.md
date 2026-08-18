# Review report — r08-host-ensure-and-runtime (round 1)

Reviewer: r08-reviewer, 2026-08-18 (~22:00–23:00), worktree `rocut-wt-s08` at the
implementer's uncommitted handoff (base `00ef74cc`, 14-file dirty set). Author ≠
verifier. Mutations were applied to the working tree with byte-exact backup/restore
(sha256-verified: `5428b420…` host.ts, `994a3364…` target-registry.ts, `a77529d7…`
ensure.ts before and after); the tree was returned to exactly the handoff state.

## Verdict: SHIPPABLE (0 Blocker, 0 Major, 3 Minor, 4 nits)

The cross-repo contract — the actual point of this change — was verified against the
**landed elftia source**, not the cross-contract doc: `isToolHostTarget` in
`elftia--s08-notifications-and-export/.../tool-hosts/toolHostRegistryFile.ts`,
`probeIdentity`/`pidAlive` in `toolHostLiveness.ts`, descriptor `types.ts`. The rocut
test-side mirror (`elftiaIsToolHostTarget` in `target-registry.test.ts`) is
field-for-field identical to the elftia filter.

## Items 1–6 (lead's risk list)

### 1. Cross-repo contract — SOUND

- **Filter**: elftia requires `id:string, port:number, pid:number, projectPath:string,
  startedAt:number` — rocut now writes exactly that (`Date.now()` at daemon start).
  The unit test runs a REAL daemon's on-disk `targets.json` through a copy of the
  elftia filter plus the full three-legged predicate (boot + pid + bearer `{id}`).
- **`/health` shape**: elftia's probe sends `Authorization: Bearer <token>` to
  `<healthPath>` (every elftia test descriptor uses `/health`) and parses `.id` from a
  JSON body. rocut serves `/health` outside the token-path prefix, exact-match bearer,
  200 `{id, startedAt, lastActivityAt, lastProbeAt}` / 401 with no id. Compatible;
  extras tolerated by the elftia reader.
- **Secret file**: `{id, port, token}` — exactly `readToolHostSecret`'s shape.
- **Boot leg**: `startedAt = Date.now()` ≥ `osBootTimeMs()` by construction.
- **Legacy read must not rewrite**: confirmed — `list()` never writes. **However**,
  see Minor F1: any *write* (register/remove/patchEntry) serializes parsed legacy
  entries as `startedAt: 0` + `legacyStartedAt`, which upgrades them from
  "reap-only-once-pid-gone" to "pre-boot-dead → reapable even while their pre-contract
  daemon still runs". Elftia-visible behavior is unchanged (ISO string was filtered
  out; `0` passes the filter but fails the boot leg — same "not alive" outcome, plus a
  cosmetic dead row in the host's list). Direction: early reap/orphan of a
  pre-contract daemon; never wrong routing, never a kill. Dev-machine transition
  window only.

### 2. Dual code/errno liveness — SOUND (empirically probed by reviewer)

Fresh probes on this machine (win32), real exited child + pid 4 (System):

| runtime | dead pid | pid 4 (EPERM) |
|---|---|---|
| node v24.14.0 | `{code:"ESRCH", errno:-4040}` | `{code:"EPERM", errno:-4048}` |
| bun 1.2.2 | `{code:"", errno:-4040}` | `{code:"", errno:-4048}` |

`pidAlive`'s `err.code !== "ESRCH" && err.errno !== -4040` reads every one of these
correctly. Wrong-runtime misread is structurally impossible for the dangerous
direction: `-4040` is libuv's *Windows* `UV_ESRCH` (Unix libuv uses small negative
raw errnos, never -4040), so no runtime in play can report `-4040` for a **live**
process. If some unix bun ever emits `code:""` with errno `-3`, the failure direction
is dead-reads-alive → unverified → fail-closed (never reaped, never routed), and the
"really-exited child" real-ESRCH test would catch it in CI. EPERM=alive preserved in
`pidAlive`, in `classifyEntry` (probe failure ⇒ unverified, not dead), and in reap.

### 3. `auto` narrowing blast radius — SOUND

Base behavior re-read from `00ef74cc`: old `resolve("auto")` returned the first
alive-with-secret entry in newest-first index order; zero live ⇒ `null` ⇒ the CLI
threw `no live target matches --target auto`. New: zero live ⇒ `null` ⇒ **byte-identical
error**; single live ⇒ same entry (old picked the first alive, which is that one);
two live ⇒ `AmbiguousTargetsError` naming **both ids and both projectPaths** plus the
`--project`/`--target` remediation, rendered by `runCli`'s top-level catch as a
normal CLI failure. All four verbs (`read`/`verify`/`apply`/`draft`) route through
`resolveTarget` (precedence `--target` > `--project` > `auto`, fast 500 ms probe).
The old silent-newest-pick path is gone — that is the fix working. Missing-secret and
dead-pid skip semantics carried over unchanged.

### 4. The packer — SOUND (with two legs exercised by the reviewer)

- **Determinism beyond two samples**: the double-pack comparison is a **per-pack
  gate** (every non-`--skip-determinism` pack re-runs it; divergence exits 1), not
  one-time evidence. The comparison is mechanically sound: both sides post-`buildOnce`
  walks, same `isBuildOutput` filter (surface/PROVENANCE excluded on both), identity
  by path, symmetric absent-detection. A third-run timestamp/path/ordering input would
  be caught by that run's own control. PROVENANCE's claim is correctly scoped
  (commit + esbuild + same platform, no byte-copy claim).
- **`.mjs` rename inside the deterministic step**: yes — `buildOnce` itself performs
  the `rocut.js → rocut.mjs` rename, and both the main pack and the determinism
  second pack call `buildOnce`, so both compared sides are post-rename. Entry-name
  reference safety argument (nothing imports the entry) holds.
- **`--allow-dirty` cannot masquerade**: the marker travels *inside the artifact* —
  `PROVENANCE.md` in the bundle says "DIRTY working tree … not a release artifact" —
  and the committed evidence manifest records `dirty: true`. Nothing downstream
  consumes the marker yet (plugin tail is future); the artifact is self-describing.
- **Unexercised surface leg**: exercised by the reviewer with a minimal fake
  `apps/vite-example/dist` (2 files) + `--skip-smoke --skip-determinism`:
  `surface.copied=true, fileCount=2`, both files in the manifest `files[]` AND the
  PROVENANCE table, bytes verbatim. Also exercised both **negative** legs absent from
  the suite: dirty-tree-without-`--allow-dirty` ⇒ exit 1, no output dir created;
  surface-absent-without-`--skip-surface` ⇒ exit 1 with build instructions.
  (Nit N5: the surface-absent failure leaves the already-built chunks in the out dir —
  no PROVENANCE/manifest is written, so it cannot be mistaken for a complete pack.)

### 5. SSE seam deviation — ADEQUATE, empirically re-verified

Live probe by the reviewer: started the real daemon (source CLI), then
`curl --noproxy '*' -m 4` against `/<token>/api/events` → **0 bytes received, not
even response headers** (curl exit 28). The implementer's environmental claim holds
on this machine — no cheaper curl-based live verification exists under bun 1.2.2.
The exported-writer seam test covers the writer's behavior exactly; the structural
source assertion is the honest residual. Nit N4: the assertion pins two substrings
(`revisionEventWriter({`, `noteActivity: () => context.noteActivity()`), i.e.
presence, not dataflow — a future rewiring that constructs the writer in dead code
while inlining the old emitter would stay green. Cheap hardening later: regex-pin the
`plane.watchRevision(\s*revisionEventWriter(` adjacency.

### 6. ensure's detached spawn — SOUND

`spawn(execPath, [argv[1], "host", "start", …], {detached:true, stdio:"ignore"|log-fd,
windowsHide:true})` + `unref()`. No pipe inheritance in either stdio mode (ignore ⇒
null devices; `--log` ⇒ the child's own dup of the file fd — the parent's
`logHandle.close()` in `finally` does not touch it), so no external caller's exit can
kill the daemon via a broken pipe — the C1 lesson inverted correctly. Survival is
asserted by the real-spawn test (pid alive after ensure returns) and the B1 source
transcript. The 15 s bounded wait cannot hang (deadline checked each 250 ms poll;
spawn `error`/`exit` surface in the message). Minor F3: the timeout error carries the
child pid and exit info but NOT the `--log` path pointer — pointer-not-content is
satisfied on the content side, but the pointer itself is absent when `--log` was
passed.

## Findings

- **F1 (Minor)** — Legacy write-back conversion weakens the pid gate for legacy
  entries. Any `register`/`remove`/`patchEntry` re-serializes a legacy ISO entry as
  numeric `startedAt: 0`, after which `classifyEntry` returns dead/pre-boot
  **regardless of pid** — the spec scenario says legacy entries reap "once their pid
  is confirmed gone". Blast radius: dev machines inside the one-CLI-upgrade skew
  window; worst outcome is an orphaned pre-contract daemon (still running, entry
  reaped). No wrong routing; elftia-visible behavior unchanged. Suggested follow-up:
  re-serialize legacy entries verbatim (keep the ISO string) on write-back, or reap
  legacy rows in the same write that converts them.
- **F2 (Minor)** — `deriveTargetId` treats an **unverified** incumbent (probe
  inconclusive within the 2 s slow budget — e.g. the incumbent daemon's event loop is
  stalled by a large apply) the same as a dead one: the unsuffixed id is taken and
  `register` REPLACES the incumbent's row + secret. A same-basename incumbent that is
  live-but-slow gets silently dereigstered; `--target <basename>` callers then route
  to the new project's daemon until reap/restart. Precondition is rare×rare (same
  basename AND a ≥2 s loopback probe stall at the exact start moment), recoverable,
  no project-data mutation. The design documents the two-CLIs race residual but not
  this slow-probe window. Suggested follow-up: suffix on "live OR unverified", or
  fail the start naming the incumbent pid.
- **F3 (Minor)** — ensure's bounded-wait timeout error omits the `--log` path when
  one was provided (it has pid + exit info only). One-line follow-up; the caller
  currently has to remember where they pointed the log.
- **N4 (nit)** — SSE structural assertion pins substring presence, not dataflow (see
  item 5).
- **N5 (nit)** — packer failure legs leave partial build output in the out dir (no
  manifest/PROVENANCE ⇒ not confusable with a complete pack).
- **N6 (nit)** — `--target`-over-`--project` precedence is implemented but not
  directly tested (only documented + `--project`/`auto` paths tested).
- **N7 (nit, pre-existing, disclose-only)** — `check:packages` exit 1:
  `apps/cli/src/__tests__/frame-proof.test.ts:18` imports undeclared subpath
  `@opencut/editor-classic/timeline/types`. Verified pre-existing at base: the file
  is byte-unchanged from `00ef74cc` (`git diff HEAD` empty; the import is present in
  the committed blob). Not fixed, per instructions.

## Mutations re-run (each red on exactly the intended tests)

- **M3** (startedAt → ISO string again, host.ts): the elftia-shaped validating-reader
  test red **+ 6 dependents** (7 fails total in target-registry.test.ts) — matching
  the cross-contract doc's disclosed count. Restored, hash-verified.
- **M4** (ambiguity throw disabled, target-registry.ts): exactly the two ambiguity
  tests red (unit `auto narrowing > two live targets…` + CLI `--project routing under
  ambiguity > two live targets…`), 31 pass. Restored, hash-verified.
- **M6** (patchEntry head-moves instead of in-place, target-registry.ts): exactly the
  three reorder guards red (task 1.7 in-place test + both task 2.3 throttle/reorder
  tests), 30 pass. Restored, hash-verified.
- **M9** (ensure fail-closed throw disabled, ensure.ts): exactly the fail-closed test
  red, 4 pass. Restored, hash-verified.
- Post-restore full suite re-run: 75/75 green; `git status` back to the exact
  14-file handoff set.

## Gates (run by reviewer, from the worktree)

- `bun test apps/cli/src` — **75/75 pass** (293 expect calls, 9 files).
- `bun test packages/editor-contracts packages/editor-automation packages/editor-ports`
  — **198/198 pass** (1722 expect calls, 19 files).
- `apps/cli` `tsc --noEmit` — **clean (exit 0)**.
- `ROCUT_PACK_RUNTIME_TEST=1 bun test script/__tests__/pack-runtime.test.mjs` —
  **3/3 pass** (pack completes with REAL_EXIT_CODE self-logging, output shape
  incl. byte-equal wasm sibling + PROVENANCE content, determinism reproduced +
  smoke outcomes recorded).
- `check:packages` — exit 1, pre-existing at base (N7), disclose-only.

## Evidence added by this review

- This report (`evidence/review-report.md`).
- Worktree log only (not committed): the errno probe table (item 2), the curl SSE
  zero-byte probe (item 5), and the surface-copy / dirty-refusal / surface-absent
  packer leg runs (item 4) — all reproduced from the reviewer's shell, artifacts
  cleaned up, worktree left byte-identical to the implementer's handoff.

## Shippability

**SHIPPABLE.** The load-bearing cross-repo contract (numeric `startedAt`, entry and
secret shapes, bearer `/health` `{id}` probe) is implemented as the landed elftia
reader requires and mutation-falsified; the liveness mapping is empirically sound on
both runtimes in play; the narrowing kills the misrouting vector without breaking the
zero-live path; the packer's determinism claim is a re-runnable gate with the rename
inside it. The three Minors are transition-window hygiene (F1, F2) and error-message
polish (F3) — none block landing; all have one-line-to-small follow-ups recorded
above.
