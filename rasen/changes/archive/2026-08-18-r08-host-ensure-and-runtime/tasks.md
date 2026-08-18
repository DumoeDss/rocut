# Tasks — r08-host-ensure-and-runtime

> Baseline at rocut `00ef74cc`: `bun test apps/cli/src` = 30/30 green. Work lands in
> the execution worktree `rocut-wt-s08` (branch `feat/s08-host-ensure-and-runtime`).
> Groups 1–3 are Cluster 1 (CLI/daemon semantics, spec `cli-host-runtime`); group 4 is
> Cluster 2 (bundle, spec `distributable-runtime-bundle`); group 5 is verification.
> Real-daemon tests must tree-kill their children (`taskkill /pid <pid> /t /f` on
> win32, process-group kill elsewhere) and assert the kill before exiting.

## 1. Registry core: serialization, resolution, predicates

- [x] 1.1 `target-registry.ts`: write `startedAt` as epoch-ms number (`Date.now()`),
       widen the `TargetEntry` type, and add tolerant reading of legacy ISO-string
       values (mapped to a pre-boot sentinel) so existing index files never fail a
       read — unit tests: written entry passes an Elftia-shaped validating filter
       (id/port/pid/projectPath/numeric startedAt); legacy entry reads, is unroutable,
       and is reap-eligible once its pid is confirmed gone.
- [x] 1.2 Add `osBootTimeMs()` and the EPERM-safe `pidAlive` (ESRCH ⇒ dead, any other
       error ⇒ alive) and replace `alive()`'s catch-all-dead semantics with it,
       collapsing the duplicated win32/posix branches — unit test fakes `EPERM` and
       `ESRCH` probes.
- [x] 1.3 Add the probe client `probeIdentity(port, token)` → `GET /health` with
       `Authorization: Bearer <token>`, bounded response size, 2 s / 500 ms timeout
       variants — unit test against a local stub server (correct `{id}` echo, wrong
       id, refused, garbage body).
- [x] 1.4 Implement the two predicates over an entry + secret — `confirmedLive`
       (numeric current-boot `startedAt` AND pidAlive AND probe echoes the id) and
       `confirmedDead` (pid `ESRCH` OR pre-boot `startedAt` OR probe answers a
       different id), with everything else unverified — unit tests per leg including
       the PID-reuse case (live unrelated pid — use the test process's own pid — with
       a pre-boot `startedAt`) and the squatter case (stub server answering a foreign
       id).
- [x] 1.5 Add `resolveForProject(absPath)`: exact resolved-path match against
       `entry.projectPath`, case-insensitive comparison on win32 (mirror the host's
       `normalizeProjectPath` discipline), returning only a `confirmedLive` match —
       unit tests: two entries, right one wins regardless of index order; dead entry
       for the path returns null.
- [x] 1.6 Narrow `resolve("auto")`: unique `confirmedLive` entry ⇒ it; zero ⇒ null as
       today; two or more ⇒ throw an ambiguity error carrying id + projectPath per
       candidate — unit tests for all three counts.
- [x] 1.7 Add `patchEntry(id, fields)`: in-place field update on an existing entry
       (no head-move, no reorder, temp-file-then-rename write) — unit test asserts
       position and other fields are unchanged.
- [x] 1.8 Target-id collision rule in `host.ts`'s id derivation: unsuffixed sanitized
       basename unless a `confirmedLive` entry holds that id with a different project
       path, in which case `<basename>-<sha256(resolvedPath) first 8 hex>`; a dead
       same-id entry does not block reuse — unit tests for suffix, determinism across
       calls, and dead-id reuse.

## 2. Daemon surface: health, status, activity

- [x] 2.1 Add `GET /health` (the one route outside the token-path prefix): 200
       `{id, startedAt, lastActivityAt}` when `Authorization: Bearer` matches the
       daemon token, 401 otherwise with no id in the body — tests: correct bearer
       echoes the id; wrong/absent bearer gets 401.
- [x] 2.2 Record activity on the daemon: `lastActivityAt` = epoch-ms of the last
       authenticated request start (excluding `/health` probes, which track a separate
       `lastProbeAt`) and of each revision-stream event emission; expose both plus
       `id`/`startedAt`/`revision` on `GET /<token>/api/status` — tests: status shape;
       `lastActivityAt` advances across two requests.
- [x] 2.3 Throttled registry sync: the daemon patches its own index entry's
       `lastActivityAt` via `patchEntry` at most once per interval (60 s constant,
       injectable) — tests with an injected clock/interval that the entry updates,
       stays in place, and that extra activity inside the window does not rewrite.

## 3. CLI verbs: ensure, reap, selectors, mode removal

- [x] 3.1 `rocut host ensure <project-dir> [--static] [--port] [--timeout <ms>]
       [--log <file>]`: live path prints `target`/`editorUrl`/`pid` (URL reconstructed
       from the secret) plus `state reused`; start path reaps the project's
       positively-dead entries, re-checks the registry for a live match, spawns
       `process.execPath [argv[1], "host", "start", …]` detached/unref'd/windowsHidden
       with stdio to the `--log` file (truncated on open) or discarded, polls the
       registry until the entry is `confirmedLive` or the bounded wait (default 15 s)
       fires, then prints plus `state started`; exits 0 on both happy paths — tests:
       in-process host reuse (no second entry, same three lines), unverified entry
       fails closed naming the pid and remediation, timeout path with a fast-dying
       child.
- [x] 3.2 Real-spawn ensure test: temp project, no daemon → ensure spawns a real
       detached child, second ensure prints the first's id/URL, exactly one entry
       exists, and the test tree-kills the child and asserts the kill — the
       daemon-must-survive-the-caller property is asserted by checking the pid is
       still alive after the ensure process exits.
- [x] 3.3 `rocut target reap [--project <dir>] [--dry-run]`: classify every entry
       (live/dead/unverified), remove index row + secret file for confirmedDead only,
       print one verdict line per entry; `--dry-run` writes nothing; ensure's start
       path reuses the project-scoped reap — tests: dead pid removed; pre-boot
       removed; squatter removed; unverified retained and reported; dry-run touches
       no files.
- [x] 3.4 `--project <dir>` selector on `read`/`verify`/`apply`/`draft` (precedence
       `--target` > `--project` > `auto`), and the ambiguity error from 1.6 rendered
       as a CLI failure listing candidates with their project paths — test: two live
       in-process hosts, `--project` routes each correctly; bare `auto` fails listing
       both.
- [x] 3.5 Remove `--mode` from `draft begin` (always manual) and reject `--mode` on
       any draft verb with an explicit "removed from the CLI" error (never silently
       ignored); update the usage text — tests: `draft begin` opens manual;
       `--mode auto` errors and opens nothing.
- [x] 3.6 Update `target list` output to include the `lastActivityAt` field when
       present (still no tokens/URLs) and keep the usage block in `main.ts` in sync
       with every verb added here (`host ensure`, `target reap`, `--project`) —
       snapshot-style test over the usage text.

## 4. Distributable runtime bundle

- [x] 4.1 `script/pack-runtime.mjs` (esbuild JS API): refuse a dirty tree; bundle
       `apps/cli/src/main.ts` with `bundle/platform=node/format=esm/target=es2022/
       splitting=true` into `dist-runtime/rocut.mjs`, keep the migration dynamic
       import a separate chunk, mark `*.wasm` external, and copy
       `rust/wasm/pkg/opencut_wasm_bg.wasm` byte-equal beside the chunk — assert in
       the script that the chunk references the sibling filename and the copy is
       byte-equal.
- [x] 4.2 Surface + provenance stages: copy the prebuilt editor surface dist verbatim
       (fail with build instructions when absent and `--skip-surface` not passed);
       write `dist-runtime/PROVENANCE.md` (source commit, esbuild version,
       toolchain, per-file SHA-256, commit+esbuild reproducible claim wording); write
       the committed evidence manifest under this change's `evidence/` (gitignored
       output dir, committed manifest — the `pack-sdk-tarballs.mjs` shape); add the
       root `pack:runtime` script.
- [x] 4.3 Determinism control: pack the same clean tree twice into separate temp
       outputs and verify the per-file SHA-256 manifests match; record the result in
       the evidence manifest.
- [x] 4.4 Smoke in the packer: `bun <out>/rocut.mjs target list` against a temp
       `ROCUT_TARGETS_ROOT` (expects `no targets`), then a full ensure round-trip on a
       temp project (two runs, same id/URL, one entry) with tree-kill cleanup, both
       self-logging real exit codes.
- [x] 4.5 Packer test wired into the suite (slow test or script-gated): runs the pack
       into a temp dir and asserts output shape (entry, chunk, wasm sibling,
       PROVENANCE) and the two smoke outcomes; documents the bun-required-for-legacy-
       migration limit in PROVENANCE wording.

## 5. Verification and evidence

- [x] 5.1 Full gates from the repo root: `bun test apps/cli/src` green (baseline
       30/30 plus the new tests), `bun test packages/editor-contracts packages/
       editor-automation packages/editor-ports` green (registry/daemon changes must
       not have leaked into package behavior), root `check:packages` green; note any
       pre-existing full-repo failures by cause against the S05-era known list
       (reconcile by cause, not raw count).
- [x] 5.2 Acceptance evidence for B1 in this change's `evidence/`: the ensure
       transcript (two runs against one live daemon: same `editorUrl`, no second
       process) from the source CLI, and the same round-trip from the packed bundle
       (4.4) — this is the artifact Reconcile returns to Direction.
- [x] 5.3 Cross-contract check against the landed elftia supervisor: a registry
       written by the new daemon passes the elftia-shaped validating reader and the
       three-legged predicate (unit-level, mirroring `toolHostRegistryFile.ts` /
       `toolHostLiveness.ts` shapes: numeric `startedAt`, additive fields preserved,
       bearer `{id}` probe) — recorded as evidence so the plugin tail can cite it.

## 6. Review round-1 fixes (LEAD-ruled: all three minors before ship)

- [x] 6.1 F1 — legacy ISO conversion stamps the conversion moment (`Date.now()` at
       parse) instead of the pre-boot sentinel `0`, so no index rewrite
       (register/remove/patchEntry) can manufacture death for a still-running
       pre-contract daemon; rationale documented in `parseEntry` + design D5 —
       test: legacy entry (live pid) + unrelated register → re-read classifies
       unverified (not pre-boot-dead), on-disk `startedAt` numeric/recent with the
       ISO kept for display; mutation: restore `startedAt: 0` → exactly the two
       legacy tests red.
- [x] 6.2 F2 — `deriveTargetId` suffixes unless the same-basename incumbent is
       positively dead (live OR unverified occupies the id; only confirmed-dead
       frees the bare basename) — test: unverified incumbent (live pid, refused
       port) survives a same-basename newcomer's start (row + secret intact,
       newcomer gets the digest suffix); mutation: restore live-only suffixing →
       exactly the new collision test red; design D2 + Risks updated to state the
       slow-probe window.
- [x] 6.3 F3 — ensure's bounded-wait timeout error carries the `--log` pointer:
       the path when `--log` was passed, "no daemon log was captured … re-run
       with --log <file>" when not; never the content — tests: timeout without
       `--log` names the remediation, timeout with `--log` names the path;
       mutation: neutralize the pointer → exactly the two timeout tests red.
