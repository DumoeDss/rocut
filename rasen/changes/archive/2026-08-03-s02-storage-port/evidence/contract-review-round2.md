# C5 pre-wiring contract re-review — round 2

Date: 2026-08-02

Reviewer scope: fresh, independent, report-only re-review of the contract repair
before any production consumer is wired. Reviewed inputs:

- `evidence/contract-review.md`;
- `handoff/contract-fixer-round1.md`;
- the complete current product delta in
  `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`;
- the updated contract/conformance evidence; and
- the C1/C4 contract constraints retained by the first review.

## Verdict

**ACCEPTED CLEAN.** Finding tally: **B 0 / Ma 0 / Mi 0 / T 0**.

- Task 3.11 may now be checked: the materialized C1 risk, the in-place
  `ProjectStore` amendment, the rejected alternatives, and the repaired proof
  are independently accepted.
- Task 3.12 is verified **not triggered**. This review does not require restoring
  the byte-exact C1 surface and does not authorize `MediaStore`, `StoragePort`,
  `StorageContext`, a hidden Host property, a new factory/session argument, or a
  singleton escape hatch.
- Production wiring may proceed to task 5. This acceptance covers the public
  contract, reference implementation, and shared conformance seam; it does not
  pre-accept the not-yet-implemented real browser store, migration mechanics, or
  cleanup implementation, which remain subject to tasks 5-6 and their browser
  evidence.

## Direction and boundary ruling

The architectural ruling from round 1 stands: the C1 risk genuinely
materialized, because project-only CRUD cannot carry media attachment bodies,
durable saved-sound/preset libraries, or capacity/clear semantics. Deepening the
existing `EditorHost.store` is the only reviewed option that retains one
persistence owner without making the Host understand OpenCut schema.

The repaired delta remains Host-neutral:

- `EditorHostPorts.store` is the sole persistence role;
- public values use logical project/key/namespace scopes, opaque data, portable
  bytes, generic inspection states, and stable mechanism-neutral errors;
- the public port imports no project/media/sound/preset schema and names no
  IndexedDB, OPFS, database, object-store, or filesystem path;
- no private context/port, hidden property, singleton, or public factory-shape
  change entered the contract delta; and
- `ProjectStoreError` now exposes only stable code, operation, logical scope,
  and a sanitized message.

## Round-1 closure audit

### Ma1 — hierarchical ordering, collision freedom, and distinct progress: CLOSED

The reference store replaced delimiter-joined string queues with structural
`MutationIdentity` values and a symmetric conflict relation. Pending mutations
are registered before waiting, so later barriers also observe earlier work that
is itself blocked. The relation now gives:

- same project-record and same attachment-key ordering;
- project-tree barriers over that project's record and attachments;
- all-project barriers over every project mutation;
- namespace barriers over that namespace's library records;
- all-store barriers over every mutation; and
- no conflict for genuinely distinct keys/scopes.

The original round-1 probe was reproduced. Before releasing the paused earlier
attachment write, the later project removal remained blocked; after release and
completion, both project and attachment were `null`:

```json
{"blockedBeforeRelease":true,"after":{"project":null,"attachment":null}}
```

The shared matrix additionally exercises collision-shaped pairs
`("a:b", "c")` and `("a", "b:c")`, project removal, project clear, namespace
clear, all clear, same-key serialization, and distinct-key progress. Focused
regression controls independently repeat the remove, clear, and collision
cases. All pass.

### Ma2 — complete browser profile, disposable binding, and list aliases: CLOSED

`ProjectStoreConformanceProfile` now distinguishes the portable run from
`complete-browser`. In the complete profile, every skipped store case is
converted into a failed required case before the report tally is produced. A
manual no-control complete-profile probe observed:

```json
{"passed":false,"storeSkipped":0,"convertedFailures":5}
```

The browser RED entry point now:

- creates a randomized identity below the exact `c5-disposable-` prefix;
- obtains the store, controls, migration declaration, and cleanup from one
  browser-specific fixture factory called with that identity;
- requires store/control/disposable presence;
- requires the tested store, declared store, cleanup store, requested identity,
  declared identity, and cleanup identity to be the same bound values;
- runs `complete-browser` with migration explicitly enabled;
- rejects residual or converted required skips; and
- invokes the bound cleanup in `finally`.

The real browser fixture factory remains intentionally absent until task 5.10.
That RED state is correctly represented and does not falsely claim that cleanup
has already run. Its future implementation must still prove that the internal
database/path resolved from the bound identity is disposable before deletion.

The shared matrix now mutates nested attachment metadata and every relevant body
byte returned by `listAttachments()`, and library data returned by
`listLibraryRecords()`, then reloads the durable values. A deliberately aliasing
adapter fails the matrix. The conforming in-memory implementation passes.

### Ma3 — raw platform error leakage: CLOSED

The public `ProjectStoreError` constructor no longer accepts or forwards a raw
`cause`. Opaque clone failures catch the platform exception inside the adapter
and emit a sanitized, mechanism-neutral public message. The original probe now
observes:

```json
{"name":"ProjectStoreError","code":"corrupt","hasCause":false,"message":"Project store save-library-record received an invalid opaque value"}
```

Both the shared matrix and a focused negative control reject `cause`, platform
exception names, database text, and path text on the public failure.

### Mi1 — migration progress proof: CLOSED

A `migrated` result must now emit at least one progress record; every record must
have positive total, bounded non-negative completion, and non-decreasing
completion; the final record must satisfy `completed === total`. Passing
fixtures report progress, while a deliberately silent migrated result fails.
Idempotent second execution remains required to return `not-needed`.

### Mi2 — record/summary identity atomicity: CLOSED

The public contract explicitly requires equal IDs. The reference implementation
checks equality before cloning, queueing, or writing and returns a stable
pre-commit `conflict`; neither the record nor summary is visible afterwards.
The shared matrix and focused control both prove no half-commit. The manual probe
observed:

```json
{"code":"conflict","record":null,"summary":false}
```

### T1 — unrelated formatting churn: CLOSED

The current diff restores the pre-existing decision prose, barrel formatting,
non-storage conformance formatting, in-memory factory formatting, and graphics
tests. `DECISIONS.md` now contains only the five-decision count change and the
new storage decision; `ports/index.ts` contains only the required storage
exports. The remaining large conformance/reference diff is attributable to the
new storage cases and implementation.

## Verification

| Command/probe | Exit | Result |
| --- | ---: | --- |
| `bun test apps/web/src/editor/ports/__tests__/conformance.test.ts` | 0 | 28 pass / 0 fail / 179 expectations; primary in-memory store 18 pass / 0 fail / 1 intentional portable migration skip |
| original cascade/error/mismatch plus complete-profile stdin probe | 0 | cascade blocks then leaves no orphan; public error has no cause; mismatch is atomic conflict; complete profile has zero skips and five converted failures |
| `node script/check-port-boundary.mjs` | 0 | 30 contract modules; all positive Host-neutral rules pass |
| `node script/check-port-boundary.mjs --negative-control` | 0 | every port-boundary rule catches its violation and accepts its converse |
| `node script/check-storage-boundary.mjs` | 0 | expected intermediate provisional state; 736 sources and the still-planned adapter user |
| `bun test script/__tests__/c5-storage-boundary-red.test.mjs` | 1 | expected pre-final RED: 3 pass / 3 fail; private context, singleton, and production in-memory fallback remain tasks 10.5-10.7, not contract-round regressions |
| `node script/check-type-baseline.mjs` | 0 | exactly three current diagnostics, all inherited/pinned; no new identity |
| `git diff --check` | 0 | no whitespace errors; only Git LF-to-CRLF warnings |
| `rasen validate s02-storage-port --project rocut --strict --json` | 0 | valid, zero issues |

## Proceed condition

This gate is complete. The next implementer may check task 3.11, leave task 3.12
unchecked as a verified non-triggered hard-stop rule, and begin the production
browser-store phase. The complete-browser profile, bound disposable factory,
cleanup `finally`, typed error mapping, and hierarchical ordering semantics are
normative downstream constraints; weakening them reopens this gate.

