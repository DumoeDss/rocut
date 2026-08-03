# C5 review-cycle strategy attempt 1 - M1 implementation evidence

Date: 2026-08-02  
Branch/worktree: `feat/s02-storage-port` / `rocut-wt-c5`  
Base: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Scope: preferred M1-A only; M2 was not started  
Disposition: **M1 implemented and locally green; independent re-review still required**

## Outcome

Migration recovery no longer infers same-key attachment precedence from the
project row. Attachment saves now commit a revision-2 envelope containing a
fresh mutation ID, SHA-256 body digest, and byte length. Removes commit a
revision-2 delete tombstone instead of physical absence. Public list/load hide
valid tombstones as logical absence while malformed rows remain `corrupt`.

Migration staging generates one stable migration mutation ID per key and stores
exact original/staged metadata snapshots plus body fingerprints in both the
validated attachment stage and revision-2 recovery journal. Recovery classifies
the project row and every staged key independently:

- exact original is staged only while the project row is original;
- exact staged with the migration ID is migration-owned;
- another valid v2 mutation with a matching body fingerprint is a later save and
  wins;
- another valid tombstone is a later remove and wins;
- physical absence, malformed state, an unexplained legacy/current row, or a
  digest/length mismatch retains recovery and rejects initialization.

For an original project, attachment reconciliation completes before the staged
project row is put last. For a staged project, recovery never rewrites the
project. A later project save/remove continues to win at project level. Recovery
and stage evidence are deleted only after every applicable project/key is
reconciled and validated. Tombstones are not compacted by M1; a later save may
replace one, and project cascade remains responsible for whole-project physical
cleanup.

## RED evidence

The existing round-2 Chromium probe/harness was extended before product changes.
The first real-Chromium run produced the intended result:

```text
originalProjectLaterSaveWins: false
originalProjectLaterRemoveWins: false
stagedProjectLaterSaveWins: false
stagedProjectLaterRemoveWins: false
physicalAbsenceRetainsRecovery: true
digestMismatchRetainsRecovery: true
```

The four legal later-mutation paths failed exactly at the missing durable
precedence boundary. Both ambiguous/corrupt controls already rejected and kept
their stage. The same run had an unrelated transient C4 forced-none harness
timeout; the browser-store failure itself was deterministic and the later full
matrix passed all three tests.

## Required Chromium acceptance evidence 1-4

All probes use randomized disposable identities, seed a schema-30 project plus a
legacy attachment, inject a deterministic migration interruption, reset runtime
state, construct a new wrapper, and inspect cleanup inventory.

1. **Staged-project later replace:** failure after destination/project puts,
   later save of `{ generation: "newer", providerPrivate: { keep: true } }` and
   bytes `[9,8,7]`, reopen succeeds, exact newer opaque metadata/body survive,
   and migration stage databases are removed.
2. **Staged-project later remove:** the same failure followed by public remove
   reopens successfully, `loadAttachment` remains `null`, no resurrection
   occurs, and recovery/stage evidence is removed. This is also a behavioral
   proof that remove committed a tombstone: unexplained physical absence is
   rejected by the adjacent control.
3. **Original-project phase:** a new hook interrupts after at least one staged
   attachment metadata put but before the staged project-row put. Both a later
   save and a later remove win after reset/reopen, with the same preservation,
   logical-absence, and cleanup checks.
4. **Ambiguity controls:** raw physical metadata deletion without a tombstone and
   OPFS body replacement causing digest mismatch each reject two consecutive new
   wrapper initialization attempts and retain migration stage evidence.

Final Chrome 151 result:

```text
stagedProjectLaterSaveWins: true
stagedProjectLaterRemoveWins: true
originalProjectLaterSaveWins: true
originalProjectLaterRemoveWins: true
physicalAbsenceRetainsRecovery: true
digestMismatchRetainsRecovery: true
```

## Implementation write set

- `apps/web/src/services/storage/browser-project-store-records.ts`
- `apps/web/src/services/storage/browser-project-store.ts`
- `apps/web/src/services/storage/browser-project-store-migration.ts`
- `apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`

`BrowserMigrationHooks.beforeProjectCommit` is test-only fixture plumbing for the
original-project interruption. No public port, Host, consumer,
library-coordinator, protected session, task list, ownership registry, clear
capability, or M2 file changed for this implementation.

One pre-existing CR-at-EOL strict-diff failure in
`apps/web/src/core/managers/save-manager.ts` was mechanically normalized with
Prettier while running the required whole-C5 diff gate; no logic was changed by
that normalization.

## Verification

```text
bun run --cwd apps/vite-example typecheck
  PASS, zero diagnostics

bun test <two C5 storage tests + storage-boundary negative test>
  PASS, 21 tests / 0 failed / 43 expectations

bunx playwright test --config apps/vite-example/playwright.c5-storage.config.ts \
  apps/vite-example/tests/c5-storage/browser-store.pw.ts
  PASS, 1/1
  shared store conformance 19/19
  migration lifecycle races 16/16
  all six new M1 axes true

bunx playwright test --config apps/vite-example/playwright.c5-storage.config.ts
  PASS, 3/3
  browser store complete matrix, C4 forced-none, migration round 1
  Chromium 151.0.7922.34

node script/check-port-boundary.mjs
  PASS, 30 contract modules / five rules
node script/check-session-state-boundary.mjs
  PASS, 10/10 factories, 10/10 registry keys, 52 classified modules
node script/check-storage-boundary.mjs
  PASS, 720 source modules, zero forbidden hits
node script/check-host-composition.mjs
  PASS, two Host roots / 717 production modules

bunx prettier --check <six M1 files>
  PASS
git -c core.whitespace=cr-at-eol diff --check
  PASS after the mechanical line-ending normalization noted above
rasen validate s02-storage-port --project rocut --strict --json --no-interactive
  PASS, 1/1 valid, zero issues
```

The complete browser fixture cleanup arrays were populated, no disposable stage
database remained after successful recovery, the Playwright `.last-run.json`
artifact was removed, and port 4175 had no remaining listener. No user-profile
identity was opened and no commit was created.

## Remaining review-cycle state

M1 is ready for independent non-author re-review. M2 remains open exactly as
designed in `evidence/strategy-attempt-1-design.md`: implement the independent
media-owner registry/coverage certificate and capability-aware exact clear
planner, then run acceptance evidence 5-7. The review cycle must not be called
clean and C5 must not ship until M2 is green and both Majors are independently
confirmed.
