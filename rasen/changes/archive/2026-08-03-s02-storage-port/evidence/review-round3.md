# C5 pre-landing review — round 3

- Branch: `feat/s02-storage-port`
- Explicit base and current HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`
- Review date: 2026-08-02
- Scope: the final complete tracked and untracked C5 product diff, both prior review reports, and every round-1/round-2 fix evidence and handoff
- Mode: report-only; no product, task-list, or existing-evidence edits
- Verdict: **CHANGES REQUIRED**
- Tally: **Blocker 0 · Major 2 · Minor 0 · Test-gap 2**

## Executive result

The round-2 fixes close the reported opaque cascade collision, migration-versus-mutation race,
sticky initialization promise, first cleanup-intent failure, ordinary committed-readback retry,
namespace/all-clear injected-failure windows, and stale preset publication. All round-1 closures
also remain intact. The complete existing Chromium matrix and focused suites are green.

Two untested recovery/capability boundaries still prevent a clean landing:

1. migration recovery treats a later successful same-key attachment replacement/removal as a
   failed recovery validation and permanently prevents a new store instance from initializing;
2. project/all clear reports success on a browser without `indexedDB.databases()` while leaving
   the per-project media database behind.

Both were independently reproduced in real Chromium against the final merged tree. Neither is a
failure in an inherited test baseline.

## Majors

### M1 — Migration recovery cannot distinguish a later attachment mutation and bricks reopen

**Spec axes:** durable mutation ordering; recovery versus later write/delete precedence; save and
reopen; attachment isolation.  
**Standards axis:** a successfully committed newer mutation makes durable storage permanently
unavailable on the next session.

The round-2 recovery record stores each project's original and staged **project rows** plus cleanup
targets (`apps/web/src/services/storage/browser-project-store-migration.ts:87-100` and `:652-674`).
It stores no original/expected state or commit generation per attachment key.

During recovery, destination precedence is decided only from the project row
(`browser-project-store-migration.ts:769-803`). If that row still equals the staged project,
recovery calls `validateCommittedProject` (`:791-795`). That validator requires every migrated
attachment's metadata and body to equal the old stage exactly (`:570-611`). A successful
`saveAttachment` or `removeAttachment` invoked after the failed migration does not change the
project row, so its newer attachment state is misclassified as failed recovery instead of a later
mutation that must win.

This is not contained to one maintenance attempt. Store initialization runs migration recovery
before public reads/writes (`apps/web/src/services/storage/browser-project-store.ts:142-164`). The
replaceable initialization promise correctly retries, but the same deterministic validation fails
on every retry.

A real-Chromium counterexample used a disposable schema-30 project with attachment bytes
`[1,2,3]`, injected one failure at `beforeCommittedReadback`, then successfully replaced the same
attachment with metadata `{ generation: "newer" }` and bytes `[9,8,7]` before resetting runtime
state and reopening. Observed result:

```text
first migration: failed during commit-validation
newer attachment before reopen: { generation: "newer" }, [9,8,7]
first prepareForSession on reopened store: rejected
  "Committed attachment metadata readback did not validate"
second prepareForSession on same store: rejected with the same error
newer attachment after both failures: { generation: "newer" }, [9,8,7]
```

The newer bytes were not overwritten, which is good, but every new session/store path remains
unusable while the durable recovery record is retained. Diagnostics remained payload-free and
reported `migration-recovery` plus `storage-initialization`; delivery is not the defect.

**Required action:** give recovery per-attachment precedence information. For each migrated key,
record enough original/staged identity (or a durable revision) to distinguish exact original,
exact staged, absent-after-later-delete, and different-after-later-save. Later successful
attachment save/remove must win without being overwritten and must let recovery finalize. Retain
recovery only for genuinely ambiguous old/corrupt state.

### M2 — Project/all clear silently leaves media databases when database enumeration is absent

**Spec axes:** logical project cascade; store-wide clear; browser capability semantics; durable
cross-database convergence.  
**Standards axis:** successful destructive API result with retained user data and corrupt
same-identity reuse.

`listDatabaseNames` deliberately returns an empty list when `indexedDB.databases` is unavailable
(`apps/web/src/services/storage/browser-storage-mechanisms.ts:377-381`), and
`inventoryForIdentity` builds its database inventory only from that list (`:526-541`). The store's
support/inspection path does not require `indexedDB.databases()`; IndexedDB plus OPFS is reported
usable (`apps/web/src/services/storage/browser-project-store.ts:791-850`).

`commitProjectsClear` collects visible project IDs from project and maintenance rows
(`apps/web/src/services/storage/browser-project-store-cascade-manager.ts:165-203`), but it never
derives the exact media database/directory targets from those known IDs. It creates completed,
target-free tombstones (`:204-205`) and places only enumerated physical names into the clear
journal (`:207-227`). Therefore the fallback `[]` means a project/all clear has no database target
even though it knows every visible project ID.

A real-Chromium counterexample temporarily removed only the optional
`indexedDB.databases` function, saved one project and one attachment, and invoked
`clear({ scope: { kind: "all" } })`. Observed result:

```text
clear(all): resolved
project after clear: null
per-project media database still present: true
attachment after clear: corrupt (metadata remained; OPFS body was removed)
save a new project with the same id: resolved
attachment under the reused id: still corrupt
```

This is also an incomplete erase: the public operation says all storage was cleared while stored
attachment metadata remains. If directory inventory is likewise incomplete, old bytes can remain
as well.

**Required action:** derive the exact media database and directory for every project ID already
known from project/tombstone rows, and merge that set with enumeration-discovered orphan targets.
Use enumeration only to find otherwise unreachable orphans. If the adapter cannot guarantee the
declared all-clear semantics, it must fail before the project commit rather than return success.

## Round-2 disposition

| Round-2 item | Round-3 disposition |
| --- | --- |
| B1 opaque cascade/control-plane collision | **Closed.** Cascade state is in a dedicated maintenance store; typed keys and exact project target validation hold. The literal provider field round-trips in Chromium. |
| B2 migration bypasses shared queue | **Closed for the reported save/remove/projects-clear/all-clear races.** The complete migration lifecycle now uses the shared `all-projects` queue and all 16 same/cross-wrapper races pass. M1 is a distinct post-failure attachment-precedence gap. |
| M1 sticky initialization and missing diagnostic | **Closed.** A rejected instance promise is replaceable, identity coalescing is retained, and the same-instance retry/diagnostic probe passes. |
| M2 first cleanup-journal write loses intent | **Closed.** Recovery is persisted before cleanup intent and the injected first-write failure converges after reopen. |
| M3 committed-readback failure loses recovery | **Partially closed.** Ordinary project/attachment recovery converges and the stage survives. M1 shows that a later successful attachment write/delete cannot currently be reconciled. |
| M4 namespace/all clear partial commit | **Closed for injected transactional/library failure.** Namespace deletion is one transaction and post-project library failure has a durable clear journal. M2 is a distinct capability fallback where the journal omits a known media database. |
| M5 stale preset publication | **Closed.** The generation barrier covers save and remove, and deterministic regressions pass. |

All round-1 findings remain closed under their recorded controls. In particular, nested migration
opaque fields, same-store session library union, exact project cascade commit ordering, ordinary
same-identity wrapper arbitration, current-envelope discrimination, duplicate cleanup, disposable
target safety, active read abort, Host documentation, and generated-output exclusion did not
regress.

## Special-check results

- **Independent maintenance store upgrade/init failure:** the eager instance promise is cleared
  after any rejected initialization phase, the identity-shared run is removed after settlement,
  and a later session reconstructs the run. The existing blocked-upgrade Chromium probe passes on
  the same instance. No finding.
- **Journal control-plane versus opaque data:** cascade and migration records occupy separate
  dedicated object stores. Project envelope precedence is authoritative; a provider-private
  `__opencutProjectCascade` value is neither scanned nor executed. No finding.
- **Migration recovery versus later operations:** later current project save and committed
  project remove/clear win through project-row comparison. Same-key attachment replacement/removal
  has no equivalent precedence record and is M1.
- **All-clear cross-database semantics:** injected library failure is durably resumable and the
  public post-project operation resolves consistently. Missing database enumeration omits a known
  physical target and is M2.
- **Shared browser queue `WeakRef` lifetime:** every live store strongly retains its queue; pending
  `run` calls retain the queue; the finalizer deletes only when the map's current weak reference is
  dead, so an old finalizer cannot delete a newer live queue. No finding.
- **Shared library arbitration settlement:** rejected blockers settle, deletion checks the exact
  promise, and the weak store entry is removed only when the pending map is empty. Current
  production mutators do not recursively re-enter their own key. No finding.
- **Provider-private and diagnostics safety:** opaque envelopes, identity-aware overlays, and
  migration transformer spreads preserve private values in covered paths. Maintenance and
  consumer diagnostics contain fixed logical metadata and no raw error, physical name, body, or
  provider payload. The two new failures also emitted payload-free records. No finding.

## Test gaps

1. After a post-destination-put migration validation failure, successfully replace and remove a
   staged attachment key, reset runtime/reopen, and prove the later attachment mutation wins while
   recovery finalizes and the new store initializes.
2. Run projects/all clear with `indexedDB.databases` unavailable. Assert each known project's
   derived media database/directory is removed, no attachment can reappear under a reused ID, and
   the operation either converges durably or fails before the project commit.

## Commands and observed evidence

- Focused persistence/session/consumer suite: **46 passed, 0 failed, 201 assertions** across 14
  files.
- Existing real Chromium matrix: **2 passed, 0 failed**. Shared store matrix 19/19; migration
  round 1 16/16; migration round 2 eight result axes true with 16/16 lifecycle races; cascade round
  1 9/9; cascade round 2 6/6; corrupt rows 6/6; active abort 7/7. Chromium 151.0.7922.34.
- Independent real-Chromium counterexamples: **2/2 reproduced** (post-failure attachment recovery
  initialization lockout; no-database-enumeration clear retention). Each randomized disposable
  identity was cleaned in `finally`.
- Full `bun test`: **291 passed, 8 failed, 2 loader/module errors, 788 assertions**. The eight/two
  red identities match the inherited baseline (`ZERO_MEDIA_TIME`, WASM loader, and `DEFAULTS`
  initialization); no new full-suite red appeared.
- Storage boundary: PASS, 720 source modules and zero forbidden mechanism/singleton/fallback hits.
- Port boundary: PASS, 30 contract modules.
- Host composition: PASS, 2 roots / 717 production modules.
- Session-state boundary: PASS, 10/10 factories and registry keys / 52 classified modules.
- Storage negative controls: **19 passed, 0 failed, 37 assertions**.
- Vite TypeScript: PASS.
- Type baseline: PASS, exactly 3 inherited diagnostics versus 13 at the pin and none outside it.
- `git -c core.whitespace=cr-at-eol diff --check`: PASS; line-ending conversion warnings only.
- `rasen validate s02-storage-port --project rocut --strict --json`: PASS, 1/1 valid with zero
  issues after this report and handoff were written.
- Port 4175 and the review-started Vite process were stopped. The 45-byte Playwright
  `.last-run.json` was already present before this round and remains the same untracked runner
  artifact; it was not treated as a product edit.
- Reviewer product/task/existing-evidence edits: **0**. New files are this report and its handoff
  only. Commit created: **no**.
