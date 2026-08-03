# C5 in-memory storage conformance

Date: 2026-08-01

Command: `bun test apps/web/src/editor/ports`

Exit: 0. Bun reported `28 pass / 0 fail / 179 expect() calls` after the
contract-review repair round.

## Complete in-memory fixture report

The primary run passed `createInMemoryProjectStoreFixture()` as the exported
storage adapter fixture. Therefore capacity, fault injection, cancellation and
scheduling cases executed rather than being counted as vacuous passes.

| Port | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| store | 18 | 0 | 1 |
| assets | 2 | 0 | 0 |
| assetLoader | 1 | 0 | 0 |
| runtimeResources | 5 | 0 | 0 |
| exporter | 2 | 0 | 0 |
| diagnostics | 2 | 0 | 0 |
| ids | 2 | 0 | 0 |
| environment | 2 | 0 | 1 |

The only store skip is the ordinary no-legacy `InMemoryProjectStore` migration
case. Migration is exercised separately below with an explicit disposable
identity. The environment skip is the existing detect-mode graphics case and is
unrelated to storage.

## Store cases

All of these used the one exported `runProjectStoreConformance` matrix:

1. declares a schema version — PASS;
2. a known edit round-trips without losing opaque nested fields — PASS;
3. project values are defensively cloned in both directions — PASS;
4. list reports a defensively copied saved summary — PASS;
5. list carries no project content — PASS;
6. missing project, attachment, and library values return `null` — PASS;
7. mismatched record/summary identities return a stable precommit error and
   write neither half — PASS;
8. attachments save/load/list/replace/remove with exact metadata and bytes — PASS;
9. equal attachment keys isolate project scopes and project removal cascades only
   its own attachments — PASS;
10. libraries save/load/list/replace/remove and isolate equal keys by namespace —
   PASS;
11. zero remaining capacity differs from unavailable and unsupported storage —
    PASS;
12. an uncloneable opaque value becomes a typed `corrupt` failure before commit
    without a raw cause/platform name/path — PASS;
13. typed quota/unavailable/corrupt/conflict failures and cancellation before the
    commit point preserve the prior attachment — PASS;
14. pre-aborted project reads, attachment writes, and library writes do no work —
    PASS;
15. same-key mutations serialize while a distinct key progresses — PASS;
16. structural mutation identities avoid delimiter collisions, while project
    removal, project clear, library namespace clear, and all clear wait for
    every earlier affected mutation and commit in invocation order — PASS;
17. project, library-namespace, and all clear scopes retain their documented
    boundaries — PASS;
18. migration on the ordinary migration-free store — SKIP, explicitly reported;
19. remove deletes the record and summary — PASS.

The apparent 19 names produce `18 passed / 1 skipped`, matching the suite's own
report.

## Migration opt-in and safety

The focused migration test supplies `exerciseMigration: true` plus fixture
identities under `c5-disposable-`:

- a working migration reports PASS and a second current-version call returns
  `not-needed`, and a migrated result must report monotonic progress ending at
  `completed === total`;
- a permanently failed migration reports the case as failed;
- a non-idempotent second run reports the case as failed;
- a migrated result with no progress reports the case as failed;
- omitting opt-in reports SKIP rather than pass; and
- opting in with `production-profile` outside `c5-disposable-` reports FAIL
  before invoking migration.

The disposable declaration is accepted only when its `store`, cleanup `store`,
identity, and cleanup identity are the exact fixture objects/identity under test.
The `complete-browser` profile converts every skipped storage case into a
failure; the browser RED entry point additionally rejects either a residual
`skipped` result or the converted `required complete-browser case skipped`
failure. The ordinary portable in-memory profile may still report the explicit
no-migration skip shown above.

No browser database, filesystem path, or user profile is opened by the in-memory
fixture.

## RED-to-green control

Command (PowerShell):

```powershell
$env:OPENCUT_C5_STORAGE_RED_ISOLATED='1'
bun test apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts -t 'the public store can carry|equal attachment keys|equal library keys'
```

Exit: 0. Result: `4 pass / 0 fail / 5 unrelated skips / 15 expectations`.
Before implementation the same selectors produced `0 pass / 4 fail` because
`saveAttachment` and `saveLibraryRecord` were absent.
