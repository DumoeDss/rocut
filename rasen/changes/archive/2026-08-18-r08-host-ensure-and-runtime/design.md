# Design — r08-host-ensure-and-runtime

## Context

Ground truth read at rocut `00ef74cc`; the consumer contract read at the elftia repo's
merged dev/0.2.7 tip (worktree `elftia--s08-notifications-and-export`,
`packages/desktop/app/main/services/platform/tool-hosts/`). Where the slice plan and
the code disagree, code wins; the disagreements are recorded in Decisions D0.

The CLI (`apps/cli`) is the sole agent surface: `host start` (foreground, blocks
forever at `main.ts:108` by design — "agent owns the lifetime"), `target list`,
`read`/`verify`/`apply`/`draft` routed through `TargetRegistry.resolve(selector)`.
The registry is two files under `~/.rocut/` (override `ROCUT_TARGETS_ROOT`): a public
index `targets.json` (`{id, port, pid, projectPath, startedAt}`) and per-target
secrets `targets/<id>.json` (`{id, port, token}`). The target id is the sanitized
project-dir basename (`host.ts:187-189`). The daemon serves one loopback origin with
the token in the URL path (`http://127.0.0.1:<port>/<token>/…`); credential URLs are
printed only by `host start` and never listed.

The wasm question, investigated honestly: the CLI's **static** import closure has no
runtime `opencut-wasm` dependency — `frame-proof.ts` is deliberately pure TS and the
`./wasm` import in `transactions.ts` is type-only. The **lazy** dynamic import of
`@opencut/editor-classic/storage/migrations` (pulled only when a persisted record is
below the current schema, `editor-plane.ts:133-137`) does reach `opencut-wasm` at
runtime (`src/wasm/media-time.ts` value imports) and `culori` (dual CJS/ESM; the
`import` condition gives esbuild the ESM build). The wasm glue
(`rust/wasm/pkg/opencut_wasm.js`) is wasm-bindgen's bundler target: `import * as wasm
from "./opencut_wasm_bg.wasm"` — a native wasm ESM import, which bun executes
natively and node only accepts behind `--experimental-wasm-modules`.

The landed Elftia supervisor reads this registry as a plain-data contract and (facts
that shape this design): its validating reader requires numeric `startedAt` (rocut
writes an ISO string today — every entry is filtered out); its liveness is
three-legged (`startedAt >= osBootTimeMs()`, `pidAlive` with EPERM=alive/ESRCH-only
dead, bearer-authenticated identity probe returning `{id}`); it deliberately stopped
reaping on inference (M3), so CLI-side hygiene is the load-bearing cleanup; its D6
review flagged daemon-side `lastActivityAt` as this change's real fix.

## Goals / Non-Goals

**Goals:**

- B1: an idempotent `host ensure <project-dir>` usable by external clients (agents in
  Claude Code/Codex, humans, later the plugin tail) — returns the live daemon's URL
  or starts one, and always exits.
- Kill the misrouting mechanism: resolution by project identity; `auto` can no longer
  silently pick "newest".
- Load-bearing registry hygiene with the same liveness rigor the host supervisor
  landed, plus fail-closed behavior on ambiguity.
- Make the registry actually consumable by the landed host (numeric `startedAt`,
  identity probe endpoint) and discriminable for idleness (`lastActivityAt`).
- Remove the last agent-reachable approval-mode bypass from the documented surface.
- A packed, provenance-pinned, smoke-tested runtime bundle runnable without the repo.

**Non-Goals:**

- `host stop` / any kill verb: stopping stays with the process owner (Elftia's
  supervisor for its spawns; the ensure caller for daemons it started — it receives
  the pid). A stop verb is a plausible follow-up but no S08 acceptance needs it.
- Director's equivalents (separate repo), the shipped skill texts (B2/B3 done),
  Elftia-side consumption of `lastActivityAt` (E's follow-up), multi-project daemons,
  export paths, and any lease/wire-level lock (locked decision 14).
- Making the bundle run on node **with legacy-record migration**: node runs everything
  else; the lazy migration chunk's wasm import needs bun (see D7).
- Changing `@opencut/*` package exports, the draft contract, or the daemon's existing
  routes.

## Decisions

### D0 — Where the plan's R assumptions meet the real code (code wins)

1. The plan says "resolve-by-project-path is a new selector over existing data, not a
   schema change". Half true: the selector needs no schema change, but the registry
   **is** out of contract with the landed consumer — `startedAt` must be numeric. This
   change fixes the serialization (tolerant read, see D5) even though the plan framed
   the format as frozen; "additive only" applies to what the host *reads* (unknown
   fields are preserved), not to rocut's write side, which is simply wrong today.
2. The director "two entry points / same-named worker sibling" lesson does **not**
   transfer as a worker: the CLI closure contains no `new URL('./worker.ts',
   import.meta.url)` pattern (the transcription worker is web-surface-side). The
   load-bearing sibling here is the **`.wasm` file next to the lazy migration chunk**.
   Same principle, different artifact — the pack design (D6) follows the principle.
3. The plan's scout note "an editor-url verb [is] additive": folded into `ensure`
   rather than a separate verb. `target list` keeps its never-show-URLs posture; the
   URL is revealed only to a caller that names the project (and thus can already read
   the secret file) or starts the host.
4. The scout note "verb surface today is only `host start` and `target list`"
   undercounts the CLI: `read`/`verify`/`apply`/`draft` all exist and all route through
   `resolve()` — which is exactly why the `auto` narrowing (D2) fixes four verbs at
   once.

### D1 — `host ensure` process model: spawn-detached, bounded registry wait, exit

Decision: ensure spawns the daemon as a **detached child** and exits. Live path:
resolve by project path → three legs → print `target <id>` / `editorUrl <url>` /
`pid <pid>` (same first-three-line shape as `host start`, plus a trailing `state
reused|started` line) → exit 0. Start path: reap this project's positively-dead
entries → spawn `process.execPath` with `[process.argv[1], "host", "start", <dir>,
…]` (`detached: true`, `stdio: "ignore"`, `windowsHide: true`, `unref()`; forwarded
`--static`/`--port`) → poll the registry (short interval) until an entry for the
project path appears and passes the routing predicate, or the bounded wait
(default 15 s, `--timeout`) fires → print → exit. `process.execPath`/`argv[1]` makes
the same code work for the source CLI (`bun …/src/main.ts`) and the packed bundle
(`bun …/rocut.mjs`).

Tradeoffs by caller:

- External agent (Claude Code/Codex): must have the command return — detached is the
  only honest model; a foreground ensure would hang the agent's shell call forever.
- Human at a terminal: gets background-with-URL; `host start` remains the attached
  foreground experience, unchanged.
- Elftia: does not call ensure (its supervisor spawns via its own descriptor); it
  benefits only from ensure's reuse semantics existing for external clients. No
  conflict: ensure reuses daemons the supervisor spawned (project-path match +
  liveness, regardless of spawner).

Rejected: (a) foreground ensure — hangs every external caller; (b) ensure-as-fork
inheriting stdio — the daemon would die with the caller's terminal on SIGHUP and the
one-time URL print would be bound to a terminal that may close; (c) teaching `host
start` a `--detach` public flag — surface growth without a caller that needs it
(ensure *is* that verb). Stdio: default discard (no new token-bearing log surface; the
secret file is the durable record), with `--log <file>` opt-in for diagnostics, the
file truncated on open (mirroring the host-side M6 ruling so repeated ensures never
accumulate token-bearing output).

### D2 — Resolution: `--project` selector; `auto` narrowed to exactly-one-live

Decision: `TargetRegistry.resolveForProject(absPath)` — exact match on the resolved
project path against `entry.projectPath`, compared case-insensitively on win32 and
verbatim elsewhere (mirroring the host's `normalizeProjectPath` discipline); all
routing verbs gain `--project <dir>`; precedence: explicit `--target` > `--project` >
`auto`. `auto` becomes "the unique live target, else error": zero live → the existing
no-match error; ≥2 live → a new ambiguity error listing candidates (id + project
path) and telling the caller to pass `--project` or `--target`. This is a deliberate
behavior change (the plan calls newest-first `auto` the primary damage vector);
single-target dogfood flows are unaffected because one live target resolves exactly
as before.

The `resolve()` internals gain the three-legged routing predicate (D4), so `auto`,
`--target`, and `--project` all route only through confirmed-live entries.

Id derivation with collisions: the base id stays the sanitized basename. Before
`register`, `startHost` checks the registry: if an entry for a *different* project
path holds that id and is **not positively dead**, the new id becomes
`<basename>-<first 8 hex of sha256(resolved projectPath)>` (deterministic — the same
project always derives the same id, so ensure is stable across runs). "Not positively
dead" means live **or unverified** (fix-round F2 ruling): an unverified incumbent —
identity probe inconclusive within the 2 s slow budget, e.g. a live daemon whose
event loop is stalled by a large apply — occupies its basename exactly like a live
one, because letting the newcomer take the unsuffixed id would make `register`
REPLACE the incumbent's row and secret file while its process still runs (the
same-directory re-start orphan this slice exists to remove; rare×rare is not rare
enough to fail open). Only a confirmed-dead incumbent frees the unsuffixed id: the
newcomer reuses it and register replaces the dead row. The plan's "rocut needs no
selector — the id is derivable" holds in the common case; the suffix rule exists so
the derivation fails safe (a distinct id) instead of silent overwrite when two
projects share a basename.

### D3 — Hygiene predicates: two predicates, not one; fail closed between them

Decision: split liveness into two exported predicates over an entry (+secret):

- `confirmedLive`: all three legs pass (numeric current-boot `startedAt`; pid alive
  under the EPERM rule; bearer identity probe against `GET /health` echoing the entry
  id). Required for **routing** and for **ensure reuse**.
- `confirmedDead`: pid `ESRCH`, or `startedAt` predates the current boot (kills the
  PID-reuse-after-reboot case even when a live unrelated process holds the pid), or
  the probe positively answers as a *different* id (a squatter). Sufficient for
  **reaping**.
- everything else is `unverified` (e.g. pid alive, probe refused/timed out —
  including a pre-`/health` daemon from an older CLI): never routed to, never
  reaped; ensure fails closed with the pid and remediation; `target reap` reports it.

This mirrors the host supervisor's landed M3 principle (reap on positive evidence
only) and its D4 predicate leg-for-leg, implemented once on the CLI side
(`target-registry.ts`), replacing today's `alive()` — which treats *any* probe error
as dead (the classic EPERM bug) and whose win32 branch is textually identical to its
posix branch (collapse it). `osBootTimeMs()` is `Date.now() - os.uptime()*1000`, as
the host computes it. Probe timeout: 2000 ms for reap/ensure-start confirmation,
500 ms for per-verb routing (loopback; a healthy daemon answers in single-digit ms —
the short budget only bounds the squatter/timeout case).

`target reap [--project <dir>] [--dry-run]`: iterate entries, classify, remove
index row + secret file for confirmedDead (temp-file-then-rename write, same accepted
non-atomicity class as the host's `reapEntries` — documented there, not fixed here),
print one verdict line per entry. ensure's start path runs a project-scoped reap
first (a stale entry for the same id/path must not block a fresh start).

### D4 — Daemon additions: `/health` (bearer) and `api/status`; `lastActivityAt`

`GET /health` — the one route outside the token-path prefix: 200 `{id, startedAt,
lastActivityAt}` when `Authorization: Bearer <token>` equals the daemon's token, 401
otherwise (no id leak). This is the exact shape the landed supervisor's
`probeIdentity` expects (it reads only `record.id`; extras are tolerated).
`GET /<token>/api/status` — existing auth surface; returns `{id, startedAt,
lastActivityAt, revision}` (the pane/agents' readable mirror; `context` stays as is).

`lastActivityAt` semantics: epoch-ms of the last **authenticated request start**
(any method, any route, including `/health` probes? — no: probes are infrastructure
traffic and would fake activity; record them on a separate counter `lastProbeAt`,
exposed but not used for idle decisions) plus each **revision-stream event emitted**.
Known limit, stated honestly: a silent viewer pane (SSE connected, no revisions, no
saves) reads as idle — a pane heartbeat is a pane-side follow-up, not a daemon
invention.

Registry sync: the daemon rewrites its own index entry's `lastActivityAt` in place
(no head-move — `register()` prepends, so a new `patchEntry(id, fields)` updates by
id at its existing position), throttled to ≥60 s between writes (constant, injectable
for tests). Rationale: `target list` and any future idle-sweep can read idle age
without HTTP-probing every daemon. The host's validating reader ignores unknown
fields, so the field is purely additive.

### D5 — Registry serialization: numeric `startedAt`, tolerant read

Write `Date.now()` (number). Read side: accept number (contract) or legacy ISO string
(stamped with the **conversion moment** on read — fix-round F1: a pre-boot sentinel
`0` written back by any register/remove/patchEntry re-reads as numeric with the
legacy marker dropped, i.e. pre-boot-dead regardless of pid — manufactured death for
a still-running pre-contract daemon; the conversion-moment stamp keeps such an entry
fail-closed, unverified while its pid lives, reapable once the pid is confirmed
gone).
Rationale: the landed host reader filters non-number entries outright, so ISO-writing
makes rocut invisible to the host — this is a correctness fix to match the consumer,
not a gratuitous break. Existing on-disk registries (dev machines) carry at most
stale string entries; `target reap` cleans them once their pids are gone.

### D6 — `draft begin --mode auto`: removed from the CLI, loudly

Decision: `draft begin` always opens manual; `--mode` on any draft verb is an
explicit error ("--mode has been removed from the CLI; approval mode is set by the
editor surface"). The contract (`editor-contracts` draft manager) and the daemon's
HTTP `POST api/drafts` keep `approvalMode` unchanged — the pane's machinery owns that
path, and the contract is frozen surface.

Why removal over gating: the plan floated "an explicit opt-in an agent cannot reach",
but an agent runs the CLI as the same user with the same env and filesystem — no
local gate is truly unreachable, only undocumented. Undocumented-but-present is the
worst of both (discoverable in usage text, unreviewable in policy). Removal makes the
documented agent surface incapable of bypassing the review gate; a determined actor
can still POST the HTTP API with the secret, which is the same trust boundary the
skill corrections already accept (defense against briefed/accidental use, not
adversaries). No test or dogfood flow uses `--mode` (verified: all draft tests POST
`approvalMode: "manual"`).

### D7 — Packed runtime: esbuild with splitting; wasm external as a sibling

Decision: `script/pack-runtime.mjs` (esbuild JS API) with
`bundle/platform=node/format=esm/target=es2022/splitting=true`, entry
`apps/cli/src/main.ts` → `<out>/rocut.mjs`, dynamic import of the migration chain
**kept as a separate chunk** (that is what splitting buys: the
`import("./opencut_wasm_bg.wasm")` in `opencut_wasm.js` stays inside the chunk that
only loads on legacy-record migration), `--external:*.wasm` so the specifier is
preserved verbatim, and `rust/wasm/pkg/opencut_wasm_bg.wasm` copied byte-equal beside
the chunk (the sibling name is load-bearing — same principle as director's
`node-worker.js`, different file). Output `dist-runtime/` (gitignored, like
`dist-sdk-tarballs/`); the committed record is the evidence manifest under this
change. The packer also copies the prebuilt editor surface (`apps/vite-example`'s
production dist — required by default with explicit build instructions on absence,
`--skip-surface` opt-out) so the plugin tail can vendor one directory, and writes
`PROVENANCE.md` into the output (source commit — refusing a dirty tree, esbuild
version, toolchain, per-file SHA-256, claim wording "commit+esbuild reproducible")
plus a determinism control that packs twice and compares manifests — the shape
`pack-sdk-tarballs.mjs` already proved in this repo.

Runtime story, honestly: **bun is the bundle's documented runtime** (the source CLI is
bun-run today; the wasm ESM import is native there). Plain node runs the whole
surface except legacy-record migration, whose chunk requires
`--experimental-wasm-modules` — an acceptable, documented limit given fresh projects
(current schema) never load that chunk.

Rejected: (a) single-file, no-splitting — inlines the dynamic import and hoists the
wasm import to the top of the single file, making the whole bundle die at load time
on node and coupling startup to the wasm; (b) esbuild wasm-loader plugin shims
(readFileSync + `WebAssembly.Instance` re-exported as a namespace) — namespace
re-export of dynamic wasm exports through esbuild interop is fragile and recreates
what wasm-bindgen's bundler target already solves natively under bun; (c) excluding
the migration closure — silently bricks pre-bump projects in the bundle, against the
portability line this repo already fought for (S01); (d) reusing the npm-pack tarball
path for this — tarballs target *installation into a consumer's node_modules*; the
plugin tail needs *a directory of files runnable as-is*.

CJS/banner: culori resolves ESM via its `import` condition; no closure-wide CJS need
is known, so **no createRequire banner by default** — the packer's smoke will catch a
`require is not defined` failure and the fix (director's `__nodeModule`-aliased
banner) is documented here as the known remedy rather than pre-applied cargo cult.
Top-level await: none known in the closure (the CLI is bun-run ESM, so even TLA would
bundle); if the build ever hits TLA, ESM output already permits it.

Smoke (runs in the packer, gated like director's): execute `bun <out>/rocut.mjs
target list` against a temp registry root (expects "no targets"), then an `ensure`
round-trip on a temp project (two runs, same id/URL, one entry, daemon killed
afterwards with a tree-kill: `taskkill /pid <pid> /t /f` on win32, process-group kill
elsewhere), plus a static check that the chunk references the wasm sibling and the
sibling is byte-equal to `rust/wasm/pkg`.

### D8 — Testing strategy

`bun test apps/cli/src` (baseline at `00ef74cc`: 30/30 green) grows:

- registry unit tests: numeric `startedAt`; tolerant legacy read; `resolveForProject`
  (exact, case-folded on win32); `auto` zero/one/many; id collision (suffix) and
  dead-id reuse.
- predicate tests per leg: EPERM=alive (fake the probe), pre-boot `startedAt` with a
  live pid (the PID-reuse case — use the test process's own pid), foreign-id squatter
  (an HTTP server answering a different id on the entry's port), unverified (probe
  refused) left in place.
- ensure tests: reuse against an in-process host (no second entry); start path
  spawning a **real detached child** (`process.execPath` + the real entry file) with
  the tree-kill cleanup; fail-closed unverified; bounded-wait timeout with a
  fast-dying child.
- daemon tests: `/health` bearer ok/wrong; `api/status` shape and `lastActivityAt`
  advance; throttled in-place registry patch (injected clock/interval).
- `--mode` removal: explicit-error test; manual default test.
- packer test (slow-flagged or its own script gate): pack to temp, run the two smoke
  commands, assert the wasm sibling; determinism double-pack.

Real-daemon tests spawn real children — the cleanup discipline is part of the design
(task-level): kill by the registry entry's pid with a tree kill, and assert the kill
succeeded before the test ends so a suite run cannot leak daemons holding ports.

## Risks / Trade-offs

- [Detached ensure daemons have no owner once their spawner exits] → accepted by
  design (S08's ownership model: daemons are joined, not owned); the pid is printed
  for the caller, `lastActivityAt` makes idle ones visible, and reap keeps the
  registry truthful. A future idle-reaper or stop verb is a non-goal recorded above.
- [Two CLIs racing ensure on the same project] → both pass the resolve step with no
  live daemon, both spawn; the second `register()` for the same id replaces the first
  entry (the id is path-derived and unique per project) and the first daemon becomes
  an orphaned same-project twin holding a different port. Mitigation: keep the
  check-start-check window tight, and make ensure re-check the registry right before
  spawning; the residual race equals the registry's accepted non-atomicity class.
  Documented, not locked (locked decision 14 — no lease).
- [Same-basename start against an unverified incumbent (slow-probe window, fix-round
  F2)] → `deriveTargetId` treats an unverified incumbent — pid alive, identity probe
  inconclusive within the 2 s slow budget, e.g. its event loop stalled by a large
  apply — as occupying its basename: the newcomer takes the digest-suffixed id and
  the incumbent's row + secret survive. The window is the probe budget at the exact
  start moment; treating the incumbent as dead (the round-1 behavior) re-created the
  orphan-and-overwrite damage class — a silently dereigstered incumbent that
  `--target <basename>` callers then stopped routing to. Cost of the fix: a
  never-verified incumbent holds the bare basename for other projects until it
  becomes positively dead; recovery is `target reap` (reports it unverified) or
  stopping its pid by hand.
- [Registry rewrite races with the host supervisor's reap or another daemon's
  register] → same accepted non-atomic read-filter-write window the host documented
  for `reapEntries`; temp-file-then-rename everywhere here too. Not fixed by this
  change (would need a protocol the slice explicitly excluded).
- [`auto` narrowing breaks a caller that relied on newest-first with two live
  targets] → that caller was silently misrouted (the damage vector); the new error is
  the fix working. Single-target callers are unaffected.
- [Packed bundle drifts from the source CLI's behavior (bun version skew, esbuild
  version skew)] → PROVENANCE pins commit + esbuild version; the determinism control
  catches same-tree nondeterminism at pack time; the smoke exercises the packed
  artifact, not the source.
- [Wasm ESM import ties the bundle's migration path to bun] → the chunk is lazy;
  current-schema projects (all fresh ones) never load it; documented in PROVENANCE.
- [`lastActivityAt`'s silent-viewer blind spot] → stated in the spec/design; a
  pane-side heartbeat is the follow-up if idle sweeps over-kill viewers.

## Migration Plan

All changes land in one branch/worktree pass; no coordinated deploy. Rollback is
revert. On-disk compat: legacy ISO `startedAt` entries become inert (unroutable) the
moment the new CLI reads them — acceptable because they were already invisible to the
landed host and describe daemons from before this change; `target reap` clears them.
Running old daemons (pre-`/health`) are `unverified` to the new CLI: not reaped, not
routed; ensure fails closed with remediation. The skew window is one CLI upgrade on
dev machines — restart the daemon to clear.

## Open Questions

None blocking. Two recorded for the tail: (1) whether the plugin tail vendors the
packed directory as-is (like director's `vendor/`) or re-packs — its call, the pack
output is self-contained either way; (2) whether Elftia's idle sweep consumes
registry `lastActivityAt` or probes `api/status` — both are exposed by this change.
