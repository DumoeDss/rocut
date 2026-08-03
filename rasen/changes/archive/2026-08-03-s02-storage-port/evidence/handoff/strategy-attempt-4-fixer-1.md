# Strategy Attempt 4 — Fixer 1 Handoff

## Why this handoff exists

Context compaction triggered after the authoritative attempt-4 design/audit/review material had been read and the first implementation inventory had begun. The delegated task explicitly requires stopping at that point, recording a durable handoff, and returning `HANDOFF` instead of continuing implementation.

No attempt-4 code or test files have been edited yet. No test process or browser process was started by this fixer, and there are no disposable databases, OPFS roots, or last-run artifacts from this fixer to clean up.

## Workspace and branch

- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`
- Branch: `feat/s02-storage-port`
- Starting HEAD observed by the delegated task: `0ef35459f685d5d41a25d0ef959aff691b7519cd`
- The worktree already contains a large uncommitted C5 diff shared with other agents. Preserve it and do not reset or discard unrelated changes.

## Instructions and authority already read

- Repository `AGENTS.md` / referenced root instructions.
- `apps/web/src/services/storage/migrations/AGENTS.md`:
  - migrations must remain additive;
  - never delete, rename, or replace persisted migration data;
  - preserve old data.
- `evidence/strategy-attempt-4-design.md`
- `evidence/strategy-attempt-4-topology-audit.md`
- `handoff/strategy-attempt-4-planner.md`
- `evidence/strategy-attempt-3-review.md`

The selected remedy is the centralized, pure topology policy from attempt 4. Do not reopen that architecture decision unless implementation evidence proves a contradiction.

## Completed work

1. Distilled the attempt-4 policy, call ordering, required test fields, and minimum write set.
2. Created an implementation plan:
   - inspect existing modules and call sites;
   - add focused tests and capture RED;
   - implement the topology policy and all precommit gates;
   - run focused/full verification;
   - write implementation evidence and final handoff, then clean only artifacts created by this attempt.
3. Inventoried the main files and important call sites.
4. Read `browser-project-store-media-ownership.ts` closely enough to identify its missing topology boundaries and the required ordering changes.

## Required topology model

Canonical names:

- `PDB = projectsDatabase`
- `PS = projectsStore`
- `C = PS-cascade-maintenance`
- `O = PS-media-ownership`
- `A = PS-library-clear-bindings`
- `G = PS-migration-maintenance`
- `LDB / LS = library database / store`
- `SP = PDB-c5-projects-stage`, store `staged-projects`
- `SA = PDB-c5-attachments-stage`, store `staged-attachments`
- `MDB(binding, project) = media database prefix + projectId`
- `MDIR(binding, project) = media directory prefix + projectId`

The new `browser-project-store-topology.ts` module must own canonical naming and pure authorization for these request kinds:

- `static-identity`
- `media-access`
- `cascade-cleanup`
- `migration-cleanup`

It should return a normalized, frozen permit. Internal topology conflict reasons must be stable and must not leak physical database, store, or OPFS names.

Rules that must be enforced:

- Reserved project-store pairs are exactly `(PDB, PS/C/O/A/G)`.
- A library pair may not equal a reserved pair.
- `LDB === PDB` is legal when `LS` is a non-reserved store; this positive case must remain supported.
- A media database may never equal `PDB`.
- Cascade media database deletion must be protected against `PDB`, current and retained `LDB`, `SP`, `SA`, and the legacy timeline namespace.
- Migration whole-database deletion must be protected against `PDB`, current and retained `LDB`, all current and retained media databases, `SP`, and `SA`, except that the canonical stage cleanup may delete its own stage database when no alias exists.
- A legacy cleanup target may never equal `SP` or `SA`.
- Different owner keys may not claim the same exact database or the same exact OPFS root. The same owner plus the same tuple is idempotent and allowed.

## Mandatory call ordering

1. Static identity authorization must happen before any database or store I/O, including direct migration entry.
2. Media registration/refresh must read strict persisted state, authorize the full access topology, and only then perform descriptor, owner, certificate, or physical media access/write operations.
3. Project remove and clear must construct and authorize the complete cross-domain mutation plan before the first destructive operation.
4. Cascade retry must validate the complete retained journal plan before any database deletion, OPFS deletion, or library clearing. Validation must not occur one target at a time during mutation.
5. Migration must read/transform/plan all candidates in memory, collect media/library/cleanup claims, authorize the complete batch, and only then write owner state, stage state, recovery journal, cleanup journal, or physical data.
6. Migration recovery/cleanup must authorize the complete retained cleanup batch before journal merge/rewrite or any physical delete.
7. Early stage cleanup must operate under a previously issued permit, not authorize after cleanup begins.

## Historical and same-ID semantics

- A newly proposed unsafe mutation is refused with zero side effects: no tombstone, recovery journal, ownership record, or destructive I/O.
- After such a precommit refusal, a safe wrapper with the same project ID must be able to save successfully.
- A historically persisted unsafe cascade journal must be retained, perform zero physical I/O, emit an unavailable/non-retryable diagnostic with code `project-cascade-topology-conflict`, and keep same-ID save blocked.
- A historically persisted unsafe migration journal must likewise be retained, perform no partial cleanup, and emit `migration-cleanup-topology-conflict` as unavailable/non-retryable.
- Do not compact, discard, or silently rewrite an intrinsically unsafe historical journal; it represents recovery authority and requires external repair.

## Required explicit Chromium fields

Cascade:

1. `topologyLibraryReservedPairsRejectAtomically`
2. `topologySharedProjectsDatabaseSafeLibraryStoreWorks`
3. `topologyMediaProjectsDatabaseAccessRejectsWithoutAuthority`
4. `topologyMediaProtectedDatabasesRefuseRemoveAndClearPrecommit`
5. `topologyHistoricalProtectedMediaJournalFailsClosed`
6. `topologyHistoricalPhysicalAliasesFailClosed`
7. `topologyPrecommitRefusalAllowsSafeSameIdReuse`
8. `topologyHistoricalUnsafeJournalKeepsSameIdBlocked`
9. `topologyCollisionFreeCascadeStillConverges`

Migration:

1. `topologyStageCleanupAliasesRefuseBeforeMutation`
2. `topologyLegacyCleanupAliasesRefuseBeforeMutation`
3. `topologyHistoricalMigrationJournalFailsClosedWithoutPartialCleanup`

Also add pure unit coverage for the topology module, following the T1–T10 table in `strategy-attempt-4-topology-audit.md`. Capture a real failing RED run before implementing GREEN.

## Source inventory and findings so far

Approximate file sizes observed:

- `browser-project-store.ts`: 1404 lines
- `browser-project-store-internals.ts`: 275
- `browser-project-store-media-ownership.ts`: 893
- `browser-project-store-library-clear-bindings.ts`: 369
- `browser-project-store-cascade.ts`: 417
- cascade manager: 701
- migration: 1490
- cascade round-2 probe: 1986
- migration round-2 probe: 1059
- harness: 149
- Playwright test: 130

`browser-project-store-media-ownership.ts` currently owns local media field/prefix constants and exposes:

- `mediaOwnershipStoreName`
- `registerMediaOwner`
- `opportunisticallyCertify...`
- `planMediaClear`
- `validateMediaClearPlan`
- `deriveOwnedMediaTargets`

Observed gaps:

- `registerMediaOwner` derives the current binding/fingerprint and immediately reads descriptor/owner state from `(PDB, O)`, then validates and writes; there is no topology authorization boundary.
- `refreshMediaOwnership` may write a missing descriptor, bind legacy state, inventory physical databases/roots, and write owners/certificates before any topology check.
- `planMediaClear` relies on exact certificates and derivation but does not reject duplicate physical claims or protected database/root aliases.
- `validateMediaClearPlan` validates certificates and exact derivation only.
- `collectUnambiguousOwners` checks prefix-match cardinality but not protected names or duplicate physical names.
- `deriveTargetsForBinding` only concatenates canonical prefixes.
- Strict ownership decoding already exists in private `readMediaOwnership`; reuse or expose the minimum strict claim data needed by the new topology boundary rather than introducing a second permissive decoder.

Other located call sites:

- `browser-project-store-internals.ts` already contains identity validation, `durableIdentityKey`, `projectsControlPlaneKey`, media binding/fingerprint helpers, and media database/directory naming. Canonical naming should move to or delegate through the new topology module.
- `browser-project-store.ts` constructs/initializes the store and calls `registerMediaOwner` at several save/load-related sites; migration is also entered from this file.
- The cascade manager imports library preparation/validation and media plan preparation/validation; it is the central place for full-plan precommit/retry gating.
- The library clear-binding module performs exact descriptor authorization but no global topology check.
- Migration currently has local stage and maintenance naming, registers media owners at multiple sites, retries cleanup target-by-target, and has raw stage database deletion. These are priority ordering hazards.
- `projectsControlPlaneKey` indicates the earlier control-plane queue mechanism exists; attempt 4 must preserve it rather than redesign concurrency.

## Minimum implementation write set

- New `browser-project-store-topology.ts`
- `browser-project-store.ts`
- media ownership module
- library clear-binding module
- cascade manager
- cascade canonical naming module
- migration module
- cascade and migration round-2 probes
- browser harness and Playwright assertion file
- pure topology unit test
- attempt-4 implementation evidence and final handoff

Avoid public contract changes, Host/session changes, consumer changes, task-file edits, run-state edits, or mechanism redesign.

## Hypotheses already eliminated

1. **A constructor-only guard is sufficient — false.** Project-ID-derived media targets and retained historical claims are not fully knowable from constructor identity alone.
2. **Exact durable authorization proves a delete is safe — false.** An authentic, correctly certified target can still alias a protected projects, library, stage, or media database/root.
3. **Store-scoped media clearing alone is sufficient — false.** It does not protect OPFS roots, library cleanup, stage cleanup, or migration whole-database deletes.
4. **Validating targets one by one while deleting is safe — false.** A later conflict would leave an irreversible partial cleanup. Full batch authorization must precede all physical I/O and journal rewrites.
5. **Rejecting every `LDB === PDB` identity is acceptable — false.** The required positive case is a shared database with a non-reserved library store.
6. **An unsafe historical journal may be compacted or dropped — false.** That loses recovery authority and breaks the required same-ID blocking semantics. Retain it and fail closed.

The attempt-3 exact-target authorization was useful but insufficient. Its concrete regression was `(LDB, LS) = (PDB, A)`: an all-clear post-library fault could clear its own descriptor and make retry permanently fail. This is direct evidence for the centralized topology gate.

## Remaining work

1. Finish reading the full library-binding, cascade manager, store orchestration, migration, probe, harness, and Playwright implementations around the located call sites.
2. Add all 12 required Chromium result fields plus pure T1–T10 topology unit tests.
3. Run the focused tests before implementation and save the genuine RED counts/output.
4. Implement the pure topology module and migrate/delegate canonical naming.
5. Insert static, media, cascade, and migration authorization at the exact pre-I/O/pre-journal boundaries described above.
6. Verify both new refusals and historical unsafe journal semantics, including zero-side-effect and same-ID behavior.
7. Run focused unit tests, focused and full Chromium probes, Vite TypeScript, exact-three baseline, touched ESLint/Prettier, four boundary checks, diff inspection, and strict Rasen verification.
8. Clean only databases, OPFS roots, processes, and last-run artifacts created by attempt 4.
9. Write `evidence/strategy-attempt-4-implementation.md` and update the appropriate final handoff with red/green counts, cleanup, risks, and durable findings.

Do not commit unless the parent/user separately authorizes it.
