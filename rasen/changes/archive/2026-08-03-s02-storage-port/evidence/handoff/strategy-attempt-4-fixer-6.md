# Strategy attempt 4 — fixer 6 handoff

## Reason for handoff

Automatic context compaction occurred immediately after the Phase 3A kickoff and skill reload, before Phase 3A source inspection or focused RED tests. The parent instruction explicitly names compaction/self-assessment loss while Phase 3A is incomplete as a mandatory handoff trigger, so this agent stopped without making Phase 3A edits.

## Completed before this handoff

### Phase 1 — topology authority

- Added `apps/web/src/services/storage/browser-project-store-topology.ts`.
- Centralized the canonical project database/store identities (PS/C/O/A/G) and migration staging identities (SP/SA).
- Added frozen topology permits for static identity, media access, cascade cleanup, and migration cleanup.
- Enforced reserved-store-pair, protected-database, and ambiguous-owner conflicts.
- Kept the safe shared-database case `LDB=PDB` valid when the library store is not an exact reserved project-store pair.
- Delegated existing cascade/media/library/migration identity helpers to the canonical topology names.
- Created one topology authority in `BrowserProjectStore` and authorized static identity before I/O.
- Added static gates to direct migration read/run/recovery/cleanup entry points.
- Focused Phase 1 verification was green: 8 tests, 47 expectations.

### Phase 2 — media topology integration

- Added `apps/web/src/services/storage/__tests__/browser-project-store-media-topology.test.ts`.
- Extended `MediaOwnershipState` with strictly decoded `knownMedia` claims.
- Changed `registerMediaOwner` to preflight before I/O, read one strict ownership snapshot, derive claims only through the existing strict ownership decoder, authorize the complete dynamic set, and then write.
- Gated refresh/inventory and legacy bind paths before inventory and before ownership/certificate writes.
- Passed the topology authority through all five `registerMediaOwner` call sites and opportunistic certification.
- Mapped media topology conflicts to the generic unavailable project-store error.
- Captured a genuine RED after correcting the test WASM setup: 1 pass, 4 failures, 6 expectations.
- Combined Phase 1/2 GREEN: 13 tests, 0 failures, 102 expectations.
- Minimal TypeScript check passed via a temporary `apps/web/tsconfig.phase2.json`, which was removed afterward.
- Touched ESLint, Prettier, and diff checks passed.

### Phase 3A status

- Confirmed branch `feat/s02-storage-port`.
- Reloaded the complete `rasen-apply-change` and `rasen-tdd` instructions plus their testing and mocking references.
- Made no Phase 3A source or test edits.
- Did not capture a Phase 3A RED.

## Remaining Phase 3A work

1. Read only the focused implementation surface: library-clear bindings, cascade codec/manager, project remove/clear paths, topology authority, and their tests. Do not reread the large design set.
2. Add focused tests for:
   - attempt-3 A/O reserved exact pairs;
   - `MDB=PDB/LDB/SP/SA` remove and clear refusals before commit;
   - safe shared `LDB=PDB` positive behavior;
   - historical mixed safe and unsafe targets with zero partial physical I/O and whole-journal retention;
   - fixed nonretryable `project-cascade-topology-conflict` unavailable diagnostic;
   - historical same-ID targets remaining blocked;
   - new/current refusal producing no tombstone or journal.
3. Run those tests and preserve the genuine RED evidence before implementation.
4. Make the library binding module expose strict current and retained library physical claims, reusing its existing strict decoder rather than adding another decoder.
5. For project remove, authorize the current media target before the project delete/tombstone commit point.
6. For projects/all clear, authorize all current/historical media and exact library targets as one batch before the PS/C/A logical transaction.
7. For cleanup/retry, validate codec, certificate, and descriptor inputs first; then obtain one complete permit before any DB/OPFS/library clear or journal rewrite, and execute only the permit's frozen targets.
8. On historical topology conflict, retain the entire journal, perform zero physical I/O, emit the fixed nonretryable unavailable diagnostic, and preserve same-ID blocking. On current refusal, create neither tombstone nor journal.
9. Run combined topology/media/cascade focused tests, minimal TypeScript, touched lint/format, and diff checks.
10. Leave Chromium nine-field work, migration, public port/Host/session/codecs, tasks/run-state/evidence, and commits untouched. Those remain Phase 3B/4 or out of scope.

## Durable findings / eliminated approaches

- Do not authorize raw journal inputs or operation-local names. Validate codecs and descriptors first, normalize the full target set, and authorize that set.
- Do not execute individually safe targets before discovering an unsafe historical target. One batch permit is required to guarantee zero partial physical I/O.
- Do not add a loose or second library-binding decoder. Both current and retained physical claims must come from the existing strict decoder.
- Do not rewrite or partially consume a historical journal after topology refusal. The entire journal must remain retryable only by a future state change, while the topology diagnostic itself is fixed and nonretryable.
- Do not relax exact same-ID blocking for historical cleanup. The positive shared-database case is specifically `LDB=PDB` with a non-reserved library store, not an exemption for identical protected targets.
- Keep authorization before logical commit points: current remove refusal must precede project deletion/tombstone creation; clear refusal must precede the PS/C/A transaction.

## Existing touched files to preserve

- `apps/web/src/services/storage/browser-project-store-topology.ts`
- `apps/web/src/services/storage/browser-project-store-media-ownership.ts`
- `apps/web/src/services/storage/browser-project-store.ts`
- `apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts`
- `apps/web/src/services/storage/__tests__/browser-project-store-media-topology.test.ts`
- Existing delegated cascade/library/migration helper changes from Phase 1.

The worktree already contains a large untracked C5 change set. Preserve it, make no commit, and avoid unrelated cleanup.
