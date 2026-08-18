# cli-host-runtime — delta spec

> New capability (no existing spec covers `apps/cli`). Grounded in rocut `00ef74cc`
> (`apps/cli/src/{main.ts,target-registry.ts,host.ts}`) and the landed Elftia S08
> supervisor contract (`toolHostRegistryFile.ts` / `toolHostLiveness.ts` on dev/0.2.7).

## ADDED Requirements

### Requirement: `host ensure` is idempotent by project path

The CLI SHALL provide `rocut host ensure <project-dir>` which, given a project
directory, returns the live daemon for that exact project path when one exists and
starts exactly one otherwise. A live hit SHALL print the existing target id, the
reconstructed `editorUrl` (`http://127.0.0.1:<port>/<token>/` from the target's secret
file), and the existing pid, and SHALL create no process and no registry entry. A miss
SHALL start the daemon as a detached process that survives the caller's exit, wait a
bounded time for its registry entry to appear and pass the liveness predicate, then
print the same three lines and exit successfully. The started daemon's stdio SHALL NOT
be inherited by the caller; the caller's output contains only the resolved lines.
`host start` foreground behavior SHALL be unchanged.

#### Scenario: Live daemon is reused, nothing is created

- **WHEN** `host ensure <dir>` runs while a daemon for that project path passes the
  routing predicate
- **THEN** the printed target id, `editorUrl` and pid equal the registry entry's
  existing values
- **AND** no new process is started and no registry entry is written
- **AND** the command exits 0

#### Scenario: No daemon is started detached and survives the caller

- **WHEN** `host ensure <dir>` runs with no live daemon for that project path
- **THEN** the spawned daemon's process outlives the ensure process's exit
- **AND** ensure exits 0 after the entry appears and passes the liveness predicate,
  printing target id, `editorUrl` and pid
- **AND** exactly one entry exists for the project path afterwards

#### Scenario: Ensure fails closed on an unverified entry

- **WHEN** an entry exists for the project path whose pid is alive but whose identity
  probe is inconclusive (neither confirmed ours nor confirmed foreign)
- **THEN** ensure does not route to it, does not reap it, and does not start a second
  daemon for the same project
- **AND** it exits non-zero naming the pid and the remediation (confirm and reap, or
  stop the process by hand)

#### Scenario: Bounded wait failure is reported

- **WHEN** the spawned daemon never produces a live registry entry within the bounded
  wait
- **THEN** ensure exits non-zero with the timeout and the daemon's exit information
  when available, without hanging

### Requirement: Target resolution is by project identity

The CLI SHALL resolve targets by project path: an exact normalized match of the
resolved project directory against registry entries (case-insensitive on win32). The
routing verbs (`read`, `verify`, `apply`, `draft`) SHALL accept `--project <dir>` as a
selector alongside `--target <id>`. The `auto` selector SHALL resolve to a target only
when exactly one live target exists; with zero live targets it SHALL fail as no-match,
and with two or more it SHALL fail listing the candidates instead of picking one. The
target id derivation SHALL be the sanitized project-directory basename
(`[A-Za-z0-9._-]`), and when a different live project already claims that id, the
derivation SHALL append a deterministic digest of the resolved project path so two
projects with the same basename never overwrite each other's registry entries.

#### Scenario: The project selector routes to that project's daemon

- **WHEN** two live daemons exist for two projects and a routing verb runs with
  `--project <dirA>`
- **THEN** the request is served by the daemon whose registered project path matches
  `<dirA>` exactly, regardless of index order or start recency

#### Scenario: auto with two live targets refuses to pick

- **WHEN** `--target auto` (or no selector) runs while two targets pass the routing
  predicate
- **THEN** the command fails listing both candidates with their project paths and ids
- **AND** no request is sent to either

#### Scenario: Same-basename projects do not collide

- **WHEN** `host start` (directly or via ensure) starts a project whose sanitized
  basename equals a different live project's target id
- **THEN** the new target's id is the basename plus a deterministic suffix derived
  from its resolved project path
- **AND** the pre-existing project's registry entry and secret are not overwritten

#### Scenario: A dead same-id entry does not block id reuse

- **WHEN** an entry with the wanted basename id exists but fails the routing
  predicate
- **THEN** the new start reuses the unsuffixed id and replaces the dead entry

### Requirement: Registry hygiene removes only positively-dead entries

The CLI SHALL provide `rocut target reap` which removes registry entries (index row
and secret file) only on positive evidence of death: the pid is gone (`ESRCH` only —
any other probe error, `EPERM` above all, means alive), or `startedAt` predates the
current OS boot (PID reuse across a reboot), or the token-authenticated identity probe
positively answers as a different daemon (an unrelated process squatting the port).
An entry whose pid is alive but whose identity probe is inconclusive SHALL be reported
as unverified and left in place, with `--dry-run` reporting verdicts without removing
anything and `--project <dir>` scoping the reap. `host ensure`'s start path SHALL reap
the requesting project's own positively-dead entries before starting.

#### Scenario: A dead pid is reaped

- **WHEN** an entry's pid no longer exists (`ESRCH`)
- **THEN** the entry and its secret file are removed

#### Scenario: A pre-boot startedAt is reaped even with a live pid

- **WHEN** an entry's `startedAt` predates the current OS boot and its pid is held by
  some live unrelated process (PID reuse)
- **THEN** the entry is reaped and the unrelated process is untouched

#### Scenario: A port squatter answering as a different daemon is reaped

- **WHEN** an entry's pid is alive, `startedAt` is current-boot, and the
  token-authenticated identity probe positively returns a different id
- **THEN** the entry is reaped

#### Scenario: An unverified entry is left alone

- **WHEN** an entry's pid is alive and the identity probe is inconclusive (refused,
  timed out, or unparseable)
- **THEN** the entry is not removed and is reported as unverified

#### Scenario: Dry run removes nothing

- **WHEN** `target reap --dry-run` runs over any mix of dead, live and unverified
  entries
- **THEN** verdicts are printed and no file is written

### Requirement: Liveness probing is EPERM-safe

Liveness checks SHALL treat `process.kill(pid, 0)` failure with `ESRCH` as dead and
any other error as alive. The routing predicate SHALL require all three legs —
current-boot `startedAt`, pid alive under the EPERM rule, and the identity probe
positively echoing the entry's own id — before a target may receive traffic.

#### Scenario: EPERM counts as alive

- **WHEN** a pid probe fails with `EPERM` (a process exists but cannot be signaled)
- **THEN** the pid is treated as alive, not dead

#### Scenario: Routing requires the identity leg

- **WHEN** an entry passes the boot-time and pid legs but the identity probe does not
  positively echo its id
- **THEN** the entry is not routed to

### Requirement: The registry serialization matches the host-supervisor contract

The registry index SHALL serialize `startedAt` as an epoch-milliseconds number (the
landed Elftia supervisor's validating reader accepts only a number — an ISO string is
filtered out as malformed, making every entry invisible to the host). Reads SHALL
tolerate legacy ISO-string `startedAt` values without failing, mapping them to
pre-boot (dead) for predicate purposes since their daemons predate the contract fix.
Fields beyond the five the host reader validates SHALL be permitted and preserved, and
the daemon SHALL sync `lastActivityAt` into its index entry as such an additive field,
throttled to at most one rewrite per interval, updating the entry in place without
reordering the index.

#### Scenario: Written entries pass the host's validating reader

- **WHEN** a daemon registers and the Elftia-shaped validating filter
  (`id`, `port`, `pid`, `projectPath`, numeric `startedAt`) reads the index
- **THEN** the entry survives the filter

#### Scenario: Legacy ISO-string entries are tolerated

- **WHEN** the index contains a legacy entry with an ISO-string `startedAt`
- **THEN** reads do not fail, the entry evaluates as not-live for routing, and reap
  removes it once its pid is confirmed gone

#### Scenario: lastActivityAt sync is additive and in place

- **WHEN** the daemon has served traffic beyond the throttle interval
- **THEN** its index entry carries a numeric `lastActivityAt` at least as recent as
  its last recorded activity
- **AND** the entry's position in the index array and its other fields are unchanged
- **AND** a reader that validates only the original five fields still accepts the
  entry

### Requirement: The daemon exposes identity and activity

The daemon SHALL serve `GET /health` authenticated by the target token in the
`Authorization: Bearer` header (the landed supervisor's probe shape), responding with
a JSON object whose `id` field echoes the target id, plus `lastActivityAt`; any wrong
or absent bearer SHALL get 401. The daemon SHALL serve `GET api/status` on the
existing token-path authenticated surface returning at least `id`, `startedAt`,
`lastActivityAt` and `revision`. The daemon SHALL record activity as the time of the
last authenticated request start and the last event emitted on the revision stream.

#### Scenario: Health echoes the id for the correct bearer

- **WHEN** `GET /health` carries `Authorization: Bearer <token>` for the running
  daemon's token
- **THEN** the response is 200 JSON whose `id` equals the target id

#### Scenario: Health refuses other bearers

- **WHEN** `GET /health` carries no bearer or a wrong token
- **THEN** the response is 401 and reveals no id

#### Scenario: Activity is observable and advances

- **WHEN** an authenticated request is served and `api/status` is then read
- **THEN** `lastActivityAt` is at least the time of that request
- **AND** it advances again after further activity

### Requirement: Approval mode is not settable from the CLI

The CLI SHALL NOT offer approval-mode control: `draft begin` SHALL always open a
manual-approval draft, and passing `--mode` to any draft verb SHALL fail with an
explicit error naming the flag as removed, never silently ignored. The draft contract
and the daemon's HTTP surface SHALL keep their existing `approvalMode` behavior
unchanged (the pane's machinery owns that path).

#### Scenario: draft begin is always manual

- **WHEN** `draft begin` runs with no mode flags
- **THEN** the opened draft has approval mode `manual`

#### Scenario: The removed flag errors loudly

- **WHEN** `draft begin --mode auto` runs
- **THEN** the command fails with an error that names `--mode` as removed from the
  CLI, and no draft is opened
