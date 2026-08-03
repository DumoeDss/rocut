# Strategy attempt 4 / fixer 3 handoff

## Why this handoff exists

Automatic context compaction occurred after the Phase 1 pure topology test file was added and before the required genuine RED run. The assignment explicitly defines compaction or an incomplete atomic phase as a handoff trigger, so no further implementation was attempted in this turn.

## Completed

- Read the complete attempt-4 design and preceding fixer handoff:
  - `evidence/strategy-attempt-4-design.md`
  - `handoff/strategy-attempt-4-fixer-2.md`
- Read and followed the applicable `rasen-apply-change` and `rasen-tdd` instructions, including the referenced testing and mocking guidance.
- Read the migration-local `AGENTS.md`; migrations must remain additive and preserve persisted data/old fields.
- Confirmed the Phase 1 seam is a pure topology request/permit/conflict policy.
- Added `apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts` with coverage for:
  - canonical C/O/A/G and SP/SA names;
  - every reserved `(PDB, PS/C/O/A/G)` pair;
  - legal `LDB=PDB` with a safe library store;
  - whole-database protection for PDB/LDB/SP/SA;
  - exact database/directory collision across different owners;
  - idempotent exact tuple reuse by the same owner;
  - canonical migration-stage self-delete and its rejection conditions;
  - generic conflicts that do not expose physical names.
- No product implementation was added, no existing product file was changed, and no commit was created.

## Current verification state

- Genuine RED has **not** been run yet. The new test imports the intentionally absent `../browser-project-store-topology`, so the next worker must run the focused test and record the actual failing output before creating that module.
- No GREEN run, TypeScript check, ESLint, Prettier check, or diff audit has run.
- The new test may require small type/lint adjustments during the RED-to-GREEN cycle; preserve its semantic cases.

## Remaining Phase 1 work, in order

1. Run and record genuine RED:
   - `bun test apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts`
   - Confirm failure is caused by the missing topology module/API, not a malformed test.
2. Add `browser-project-store-topology.ts` as a pure, fail-closed policy owner:
   - own canonical C/O/A/G and SP/SA names;
   - accept typed static identity, media access, cascade cleanup, and migration cleanup requests;
   - return frozen normalized permits;
   - reject using stable reason enums only (`reserved-store-pair`, `protected-database`, `ambiguous-physical-owner`);
   - keep error text generic and never leak physical database, directory, store, project, or fingerprint names.
3. Delegate the existing canonical-name helpers to the topology module only:
   - cascade maintenance store;
   - media ownership store;
   - library-clear binding store;
   - migration cleanup journal store and stage database names.
4. Wire only the Phase 1 static identity pre-I/O gate:
   - create the topology policy once in `BrowserProjectStore`;
   - authorize static identity before the first IndexedDB/storage I/O;
   - translate topology conflicts to a mechanism-neutral unavailable `ProjectStoreError` with no physical names;
   - repeat the static gate in directly callable migration entry points.
5. Do **not** yet wire media registration, cascade authorization, migration-plan authorization, retry authorization, Chromium fields, or any Phase 2-4 behavior.
6. Run focused GREEN and report the exact command/test count, then minimal TypeScript, ESLint, Prettier, and scoped diff checks.

## Normative constraints to preserve

- Reserved static pairs are exactly `(PDB, PS/C/O/A/G)`.
- `LDB=PDB` is legal when the library store is not reserved. Do not introduce a blanket `LDB !== PDB` rule.
- `LDB=SP` or `LDB=SA` is illegal regardless of store name.
- PDB, current/retained LDB, SP, and SA are whole-database protected for cascade cleanup.
- Different owner keys `{fingerprint, projectId}` may not claim the same physical database or directory.
- The same owner reusing the exact physical tuple is idempotent and legal.
- A migration-stage database can self-delete only when it is the matching canonical stage and is not aliased by known media/library ownership or by the legacy target.
- Phase 1 is intentionally limited to static pre-I/O integration; dynamic policy consumers belong to later phases.

## Eliminated approaches / durable findings

1. Operation-local guards cannot prove global physical ownership and are not a substitute for the centralized topology policy.
2. Store-scoped media clearing alone is insufficient because destructive IndexedDB operations act at whole-database scope.
3. A global durable registry is not required for the minimum attempt-4 fix, while a blanket prohibition on `LDB=PDB` is over-broad and would reject the explicitly safe shared-database case.

## Working-tree scope from this interrupted turn

- Added: `apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts`
- Added by this handoff: `rasen/changes/s02-storage-port/handoff/strategy-attempt-4-fixer-3.md`
- All other pre-existing dirty/untracked C5 files belong to earlier work and must be preserved.
