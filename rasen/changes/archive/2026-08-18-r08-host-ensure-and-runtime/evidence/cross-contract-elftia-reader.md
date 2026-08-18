# Cross-contract evidence — the rocut registry against the landed elftia supervisor reader (task 5.3)

Recorded 2026-08-18, worktree `rocut-wt-s08` (branch `feat/s08-host-ensure-and-runtime`, base `00ef74cc`).

The registry file `~/.rocut/targets.json` is a cross-repo contract: the landed
elftia supervisor reads it with a validating filter and a three-legged liveness
predicate. This change (`r08-host-ensure-and-runtime`) had to keep the shapes
aligned; the alignment is enforced by unit tests in the rocut repo that mirror
the elftia source read at elftia commit of 2026-08-15 (files:
`packages/desktop/app/main/services/platform/tool-hosts/toolHostRegistryFile.ts`
— `isToolHostTarget` filter; `.../toolHostLiveness.ts` — `pidAlive` + bearer
probe with 64 KB response bound).

## What is mirrored, where it is enforced

| elftia shape | rocut implementation | enforcing test (`apps/cli/src/__tests__/target-registry.test.ts`) |
|---|---|---|
| `isToolHostTarget`: `id`/`port`/`pid`/`projectPath` must be `string`/`number`/`number`/`string`, `startedAt` must be a **number** (ISO string ⇒ filtered out) | `host.ts` writes `startedAt: Date.now()` (epoch ms) | "registered entries pass the elftia-shaped validating reader (numeric startedAt)" — reads the raw on-disk `targets.json` written by a real daemon and runs it through a copy of the elftia filter; also asserts `typeof startedAt === "number"` |
| additive fields survive | `lastActivityAt` is additive; unknown fields are ignored by both readers | same test family; `patchEntry` tests assert field preservation |
| `pidAlive`: `ESRCH` ⇒ dead, any other error (`EPERM` above all) ⇒ alive | `pidAlive` in `target-registry.ts`, incl. the bun ≤ 1.2.2 Windows `errno: -4040`/`-4048` encoding | "EPERM counts as alive" / "ESRCH is the only dead verdict" (fakes) + "a really-exited child is dead without any monkeypatch" and "an unsignalable system process counts as alive (real EPERM)" (real probes) |
| bearer probe: `GET /health`, `Authorization: Bearer <token>`, response `{id}` | daemon route `GET /health` (the one route outside the token-path prefix) + client `probeIdentity` (64 KB bound, 500 ms/2000 ms timeouts) | `host-health.test.ts` bearer ok/wrong/absent; `target-registry.test.ts` probeIdentity suite + the three-legged live assertion over a real daemon |

## The one sanctioned correction

Pre-S08 rocut wrote `startedAt` as an ISO string — every entry was invisible to
the elftia filter (treated as malformed, filtered out). This change writes
epoch ms and reads legacy ISO values tolerantly (never routable, reap-eligible
once the pid is confirmed gone). The test "a legacy ISO-string startedAt
reads tolerantly…" pins both sides: the tolerant read AND that the legacy raw
shape fails the elftia filter (which is why the fix was required).

Mutation-falsified: writing an ISO string again (M3) turns the elftia-shaped
reader test red, along with 6 dependents.

## For the plugin tail

A daemon started by this CLI produces a registry entry the landed elftia
supervisor accepts and classifies live without any shim: numeric `startedAt`,
additive fields preserved, bearer `{id}` probe on `/health`. The activity
signal (`lastActivityAt`, throttled to 60 s in-place patches) is additive and
ignored by the current elftia reader — a future supervisor can consume it
without a registry-format change.
