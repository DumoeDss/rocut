# Proposal — r08-host-ensure-and-runtime

> Slice S08 (`08-host-owned-tool-hosts`, elftia repo) Portfolio R. Acceptance group B1
> (`host ensure` idempotent verb) plus the three CLI-side damage vectors the skill
> corrections could only document, plus the distributable runtime. The elftia-side
> supervisor (C1) has landed on dev/0.2.7 and consumes this registry as a contract.

## Why

S08's premise is that users and external clients **join** a running host instead of
restarting it. The rocut CLI cannot support that today:

- `--target auto` resolves newest-first/first-alive (`target-registry.ts:94-102`), so a
  second project's daemon silently captures the first project's mutations — the slice
  plan's primary damage vector (silent corruption, not a visible kill).
- There is no verb to recover an `editorUrl` or to start-if-absent without blocking:
  `host start` deliberately blocks forever in the foreground
  (`main.ts:108` — "agent owns the lifetime"), which is exactly the reversed-ownership
  model S08 exists to end. Both shipped skills used to instruct a restart to recover
  the URL; the secret file already holds everything needed to reconstruct it.
- Nobody reaps dead entries. The landed Elftia supervisor deliberately stopped reaping
  on inference (its M3 ruling), so the index now grows monotonically — CLI-side hygiene
  verbs are load-bearing, not optional.
- **The registry serialization violates the landed host contract**: rocut writes
  `startedAt` as an ISO string; Elftia's `isToolHostTarget` requires a number, so every
  rocut entry is silently filtered out at read time — the rendezvous cannot work at all
  until this is fixed. There is also no token-authenticated identity endpoint the
  supervisor's three-legged liveness probe (`GET <healthPath>` with bearer auth
  returning `{id}`) can call, and no `lastActivityAt`, so idle-vs-in-use is
  indiscriminable (the C1 D6 gap).
- The CLI runs only from a source checkout under bun. External agents and host plugins
  need a distributable runtime (the path `elftia-plugin-director` proved for director).

## What Changes

- **`host ensure <project-dir>`** — idempotent: a live daemon for that project path
  prints its existing `targetId`/`editorUrl`/`pid` and creates nothing; none is started
  detached (surviving the caller's exit) and the bounded registry wait prints the same
  three lines. `host start` foreground behavior is unchanged (additive verb).
- **Project-path resolution** — new registry lookup by exact project path (the target
  id derivation gets a collision rule: basename + short path-digest suffix when a
  different live project claims the same sanitized basename); a `--project <dir>`
  selector on `read`/`verify`/`apply`/`draft`; `auto` narrowed from newest-first to
  "exactly one live target, else error" (**behavior change**, by design — the old
  semantics are the damage vector).
- **Registry hygiene** — `target reap` plus ensure's start path remove only
  positively-dead entries (PID gone `ESRCH`-only, or `startedAt` predates the OS boot,
  or the identity probe positively answers as a different daemon). Routing requires the
  full three legs; ambiguous "unverified" entries are neither routed to nor reaped —
  `ensure` fails closed on them. `pidAlive` treats `EPERM` as alive (the current
  `alive()` treats every error as dead).
- **Daemon-side activity** — `lastActivityAt` recorded on the daemon (request starts
  and SSE emissions), exposed through a new bearer-authenticated `GET /health`
  (returning `{id}` in the shape the landed supervisor probes) and `GET
  api/status`, and synced throttled into the registry entry as the additive
  `lastActivityAt` field.
- **Registry contract fix (BREAKING serialization, tolerant read)** — `startedAt`
  becomes an epoch-ms number as the landed Elftia reader requires; legacy ISO-string
  entries are read tolerantly and reaped once their daemon is confirmed dead.
- **`draft begin --mode auto` removed from the CLI** — approval-mode `auto` stays in
  the contracts and the HTTP surface (the pane's machinery), but is no longer reachable
  from the documented agent surface; passing `--mode` errors explicitly.
- **Distributable runtime** — `script/pack-runtime.mjs`: esbuild bundle of the CLI
  (entry + the lazy migration chunk kept separate with its `.wasm` sibling — the only
  load-bearing sibling file in the CLI closure; the director worker-sibling lesson maps
  onto the wasm here), optional copy of the built editor surface for `--static`,
  PROVENANCE (source commit + esbuild version + per-file SHA-256; commit+esbuild
  reproducible, no byte-copy claims; double-pack determinism control), and a smoke run
  of the bundled CLI (`target list` + an `ensure` round-trip on a temp project).

## Capabilities

### New Capabilities

- `cli-host-runtime`: the agent CLI's host lifecycle semantics — ensure idempotence,
  project-identity resolution and the `auto` rule, the registry hygiene predicates,
  the liveness/identity probe surface, `lastActivityAt`, the registry serialization
  contract with the host supervisor, and the approval-mode CLI surface.
- `distributable-runtime-bundle`: packing the CLI (and the editor surface) into a
  runnable distribution with provenance, determinism control, and smoke evidence.

### Modified Capabilities

None — no existing spec in `rasen/specs/` covers `apps/cli` (verified: no spec mentions
`host start`, `target list`, `apps/cli`, or `target-registry`; the S06 CLI landed
without a synced capability).

## Impact

- Code: `apps/cli/src/main.ts` (verbs/usage), `apps/cli/src/target-registry.ts`
  (resolution, predicates, serialization, activity sync), `apps/cli/src/host.ts`
  (health/status routes, activity recording, target-id collision rule), a new
  `apps/cli/src/ensure.ts` (detached spawn + bounded wait), new tests under
  `apps/cli/src/__tests__/`; `script/pack-runtime.mjs` + a root `pack:runtime` script.
- Contract surfaces: the registry index/secret files (additive `lastActivityAt`;
  `startedAt` type corrected to the already-landed consumer's requirement) and two new
  authenticated daemon routes (`/health` bearer, `api/status` token-path). The daemon's
  existing routes, `host start` behavior, and the `@opencut/*` package exports are
  unchanged.
- Out of scope: director's equivalents (separate repo), the shipped skill texts
  (already corrected, B2/B3), a `host stop` verb (stopping stays with the process
  owner — Elftia's supervisor for its spawns, the spawning caller for ensure), and any
  Elftia-side consumption of `lastActivityAt` (E's follow-up).
