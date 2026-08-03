# Strategy Attempt 4 — Fixer 11 Handoff

## Trigger and status

This handoff was created because automatic context compaction occurred during PHASE 4B. The parent task explicitly requires a handoff on compaction or loss of self-evaluation. Work stopped immediately after compaction; this document does **not** claim DONE or CLEAN.

- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`
- Change artifacts: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\changes\s02-storage-port`
- Branch/worktree is intentionally dirty with the larger C5 change. Preserve unrelated and earlier-phase changes.
- Do not modify tasks, runstate, or existing review artifacts. Do not commit.
- Leaf assignment: no subagents.

## Parent objective

Complete attempt-4 PHASE 4B FINAL IMPLEMENTATION ONLY, building on the already-GREEN PHASE 4A implementation. Extend the real-browser migration round-2 probes, C5 harness, and Playwright assertions with three independently asserted booleans:

1. `topologyStageCleanupAliasesRefuseBeforeMutation`
2. `topologyLegacyCleanupAliasesRefuseBeforeMutation`
3. `topologyHistoricalMigrationJournalFailsClosedWithoutPartialCleanup`

Coverage must be table-driven where practical and include:

- stage aliases: SP=LDB and SA=current MDB;
- legacy aliases: PDB, LDB, current MDB, and retained MDB;
- mixed safe + unsafe cleanup targets proving no partial delete or journal shrink;
- a safe stage-cleanup positive control;
- preservation of every existing migration and cascade result field.

Then run focused browser and full C5 suites, four isolated focused unit processes, Vite TypeScript, repository exact-three baseline, touched ESLint/Prettier, four C5 boundary checks, diff check, and strict Rasen validation. Record Chrome/version, field counts, inventory, cleanup, complete attempt-4 RED/GREEN evidence, and remaining risks in the final evidence/handoff. The implementing author must explicitly avoid self-certifying CLEAN; non-author review remains required.

## Completed before PHASE 4B

### PHASE 3B browser evidence

- Focused browser: 1/1 passed in 18.3s.
- Full C5 browser: 3/3 passed in 38.6s.
- Chromium: 151.0.7922.34.
- Cascade round-2: 33 boolean fields, all true.
- Final disposable inventory: empty.
- Phase 3B logs/processes were cleaned and port 4175 had zero listeners.

### PHASE 4A implementation

Touched product/test files:

- `apps/web/src/services/storage/browser-project-store-migration.ts`
- `apps/web/src/services/storage/browser-project-store-topology.ts`
- `apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts`

Implemented behavior:

- Full migration cleanup-batch planning occurs before owner, stage, or journal mutation.
- Current and retained media/library claims are collected strictly.
- Migration authorization is one-shot; early cleanup consumes the migration permit.
- Recovery and cleanup use batch authorization.
- Cleanup topology conflicts emit fixed diagnostics: phase `migration-cleanup-topology-conflict`, code `unavailable`, retryable `false`.
- Topology migration ownership now checks protected databases.

Evidence already obtained:

- RED: new migration topology unit file — 2 passed, 5 failed, 10 expectations.
- GREEN: same file — 7 passed, 0 failed, 29 expectations.
- Four isolated unit processes: topology 9/9, media 5/5, cascade 7/7, migration 7/7; total 28/28 and 185 expectations.
- A combined single-process four-file Bun run is invalid because global `mock.module` state leaks across files. It reached 21 passes before the migration file received the media test mock lacking `opfsRead`. Keep running the four files in separate processes.
- Targeted TypeScript passed using a temporary `apps/web/tsconfig.phase4a.json`; that temporary file was deleted.
- Touched ESLint passed (only the existing Pages-directory environment message).
- Prettier passed.
- `git diff --check` passed with existing CRLF notices.

## PHASE 4B work completed immediately before compaction

Only this file was partially patched:

- `apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts`

Successful additions:

- imports for `mediaBindingFingerprint`, `mediaBindingForIdentity`;
- import for `retryBrowserProjectMigrationCleanup` and `BrowserMigrationHooks`;
- import for `libraryClearBindingFingerprint`;
- imports for `browserMigrationStageNames` and `browserProjectTopologyStoreNames`;
- imports for `idbGetAll` and `idbPutMany`;
- constants `MEDIA_OWNER_FIELD = "__opencutMediaOwner"` and `LIBRARY_CLEAR_BINDING_FIELD = "__opencutLibraryClearBinding"`;
- the three requested fields in `BrowserMigrationRound2ProbeResult`;
- calls to three planned probe functions inside `runBrowserProjectStoreMigrationRound2Probes`;
- inclusion of their results in the returned object.

The following functions are referenced but **do not exist yet**:

- `probeTopologyStageCleanupAliases`
- `probeTopologyLegacyCleanupAliases`
- `probeTopologyHistoricalMixedCleanup`

Therefore the probe file currently does **not compile**. Import ordering/unused imports may also fail until the implementations are added and Prettier is run. No harness or Playwright changes were made. No PHASE 4B browser/static runs were started, and no PHASE 4B process/log cleanup is needed at this handoff point.

## Relevant existing structures and APIs

The probe file's existing `withFixture` helper creates a disposable identity and always calls `cleanupDisposableBrowserStorage`. External legacy databases named `video-editor-timelines-${projectId}` are outside that disposable prefix and must be deleted explicitly with `deleteDatabaseExact` in `finally`; never use broad deletion.

Migration maintenance store:

```ts
browserProjectTopologyStoreNames(identity.projectsStore).migrationMaintenance
```

Cleanup journal shape:

```ts
{
  id: "postcommit-cleanup",
  revision: 1,
  targets: [
    { kind: "stage-database", name },
    { kind: "legacy-database", name, projectId },
  ],
}
```

Retry entry point:

```ts
retryBrowserProjectMigrationCleanup({
  identity,
  policy: { kind: "disposable", identity: identity.identity, prefix },
  diagnostic,
})
```

Expected rejection diagnostic:

```ts
{
  phase: "migration-cleanup-topology-conflict",
  code: "unavailable",
  retryable: false,
}
```

Useful storage helpers already available/imported include `idbGet`, `idbGetAll`, `idbPut`, `idbPutMany`, `deleteDatabaseExact`, and `listDatabaseNames`.

Raw media claim form, adapted from the cascade round-2 probes:

```ts
const binding = {
  revision: 1,
  mediaDatabasePrefix,
  mediaStore,
  mediaDirectoryPrefix,
};
const fingerprint = await mediaBindingFingerprint(binding);
await idbPutMany({
  database: controlIdentity.projectsDatabase,
  store: browserProjectTopologyStoreNames(controlIdentity.projectsStore).mediaOwnership,
  values: [
    {
      id: `.c5-media-binding:${fingerprint}`,
      [MEDIA_OWNER_FIELD]: {
        revision: 2,
        kind: "binding",
        fingerprint,
        binding,
      },
    },
    {
      id: `.c5-media-owner-v2:${fingerprint}:${encodeURIComponent(projectId)}`,
      [MEDIA_OWNER_FIELD]: {
        revision: 2,
        kind: "owner",
        fingerprint,
        projectId,
      },
    },
    {
      id: `.c5-media-coverage:${fingerprint}`,
      [MEDIA_OWNER_FIELD]: {
        revision: 2,
        kind: "coverage",
        fingerprint,
        coverage: "complete",
      },
    },
  ],
  context: { operation: "clear", scope: { kind: "store" } },
});
```

Use `mediaBindingForIdentity(identity)` for the current media binding. A retained media binding can derive its database/directory prefixes from a target ending in `projectId`.

Raw retained library descriptor form:

```ts
const binding = {
  revision: 1,
  projectsDatabase: control.projectsDatabase,
  projectsStore: control.projectsStore,
  libraryDatabase: targetDatabase,
  libraryStore: targetStore,
};
const fingerprint = await libraryClearBindingFingerprint(binding);
await idbPut({
  database: control.projectsDatabase,
  store: browserProjectTopologyStoreNames(control.projectsStore).libraryClearBindings,
  value: {
    id: `.c5-library-clear-binding:${fingerprint}`,
    [LIBRARY_CLEAR_BINDING_FIELD]: {
      revision: 1,
      kind: "clear-authorization",
      fingerprint,
      binding,
    },
  },
  context: { operation: "clear", scope: { kind: "store" } },
});
```

The binding's `projectsDatabase` and `projectsStore` must equal the control-plane identity. The descriptor can point its library database/store at the protected target.

For sentinels, write byte-distinct records with `idbPut` and read with `idbGet`. To prove a safe target was deleted, use `listDatabaseNames`; reading a deleted database would recreate it. Read the raw cleanup journal before/after for exact equality and no shrink.

## Planned probe implementations

### 1. `probeTopologyStageCleanupAliases`

Aggregate independently checked subcases:

- **SP=LDB:** obtain canonical stage names via `browserMigrationStageNames(base.projectsDatabase)`. Construct an identity whose `libraryDatabase` equals the projects stage database and whose library store is distinct. Seed a sentinel in that stage database plus a stage cleanup journal. Retry cleanup and verify rejection before mutation: sentinel and journal are unchanged.
- **SA=current MDB:** use project id `stage` and set `mediaDatabasePrefix` so the current media database resolves exactly to the attachments stage database. Seed current media ownership using `mediaBindingForIdentity(customIdentity)`, a sentinel, and the cleanup journal. Verify fixed topology diagnostic, unchanged sentinel, and unchanged journal.
- **Safe-stage positive control:** using an unaliased base identity, seed both canonical stage databases and put both in the cleanup journal. Retry cleanup. Verify both databases are absent via `listDatabaseNames` and the cleanup journal is removed.

If the SP=LDB subcase is rejected by static identity validation before journal decoding, this still proves refusal before mutation. A retained-library descriptor targeting SP can be added as a second subcase if needed to exercise the fixed migration conflict diagnostic.

### 2. `probeTopologyLegacyCleanupAliases`

Use table-driven cases for PDB, LDB, current MDB, and retained MDB. For each case:

- create a syntactically valid legacy name `video-editor-timelines-${projectId}`;
- adjust the test identity/claim so that exact legacy database is protected by the selected role;
- seed a byte sentinel in the legacy database;
- store a one-target legacy cleanup journal;
- retry cleanup;
- assert no physical delete, no journal mutation/shrink, and the fixed nonretryable topology diagnostic;
- explicitly delete the external legacy database in `finally`.

Case setup:

- PDB: make `projectsDatabase` equal the target; the journal consequently lives in that PDB.
- LDB: make `libraryDatabase` equal the target.
- current MDB: choose `mediaDatabasePrefix = "video-editor-timelines-"` and seed current ownership for `projectId`.
- retained MDB: retain the base current media identity and write a retained media binding whose resolved database is the target and whose directory ends in the same `projectId`.

### 3. `probeTopologyHistoricalMixedCleanup`

- Make the PDB equal an unsafe legacy target `video-editor-timelines-${unsafeProjectId}`.
- Create another syntactically valid safe legacy target and place it **first** in the cleanup journal; place the unsafe PDB target second.
- Seed distinct sentinels in both targets and snapshot the journal.
- Retry cleanup.
- Assert both sentinels survive, the journal is byte/deep unchanged with no shrink, and the fixed nonretryable diagnostic is emitted.
- Explicitly delete both external targets in `finally`.

Recommended local helpers:

- migration maintenance-store lookup;
- put/read cleanup journal;
- seed/read database sentinel;
- seed current/retained media claim;
- seed retained library claim if used;
- detect the fixed migration topology diagnostic;
- retry wrapper returning rejection + diagnostics;
- exact cleanup of a supplied list of external databases.

## Harness and Playwright changes still required

In `apps/vite-example/src/c5-storage-harness.ts`, add all three fields to `migrationRound2Passed` without removing any existing field.

In `apps/vite-example/tests/c5-storage/browser-store.pw.ts`:

- add all three fields to the migration round-2 `toMatchObject` expectation;
- add an independent migration boolean count assertion; expected count after this change is 19;
- keep the cascade independent count at 33;
- add `migrationRound2BooleanFieldCount` to the console JSON/result summary;
- preserve every existing migration/cascade assertion and field.

## Required verification still pending

### Browser

Run long commands in the background with separate stdout/stderr logs and poll at intervals no longer than 270 seconds. Inspect for existing task-owned processes/logs before restarting. Suggested logs are `.phase4b-focused.stdout.log`, `.phase4b-focused.stderr.log`, `.phase4b-full.stdout.log`, and `.phase4b-full.stderr.log`.

```powershell
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts
```

Record from actual output:

- focused and full pass counts/durations;
- Chromium version/protocol/revision;
- migration round-2 boolean count (expected 19 after +3);
- cascade round-2 boolean count (must remain 33);
- all field values;
- final disposable DB/OPFS inventory (must be empty).

Do not assume the earlier Chromium data, though it was 151.0.7922.34/protocol 1.3/revision `@782af9cb30a53f54487e5d2e44738645a8ec457c`.

### Units and static checks

Run the four focused unit files in **four independent processes**:

- topology: expected 9/9;
- media: expected 5/5;
- cascade: expected 7/7;
- migration topology: expected 7/7.

Run targeted Vite TypeScript. A temporary `apps/vite-example/tsconfig.phase4b.json` may be created with `apply_patch`, extending the Vite config and including the migration probe, harness, Playwright test, and required dependencies; remove it afterward with `apply_patch`.

Then run:

```powershell
node script/check-type-baseline.mjs
node script/check-port-boundary.mjs
node script/check-session-state-boundary.mjs
node script/check-storage-boundary.mjs
node script/check-host-composition.mjs
git diff --check
rasen validate s02-storage-port --project rocut --strict
```

Also run touched-file ESLint and Prettier over at least:

- `browser-project-store-topology.ts`
- `browser-project-store-migration.ts`
- `browser-project-store-migration-round2-probes.ts`
- `browser-project-store-migration-topology.test.ts`
- `c5-storage-harness.ts`
- `browser-store.pw.ts`

The repository type baseline command is the requested exact-three baseline check; record its actual reported count/result.

## Cleanup requirements

After verification:

- delete only this run's disposable databases and OPFS entries;
- terminate only task-owned processes;
- delete task-owned `.phase4b-*` logs and Playwright `last-run` output;
- verify port 4175 has zero listeners;
- do not touch the user's Chrome session;
- never perform broad persisted-storage deletion.

## Final artifacts still required after successful completion

Write both:

- `rasen/changes/s02-storage-port/evidence/strategy-attempt-4-implementation.md`
- `rasen/changes/s02-storage-port/handoff/strategy-attempt-4-implementation.md`

They must include complete attempt-4 PHASE 1–4 RED/GREEN history, the preserved 33 cascade fields plus three new migration fields and final migration field count, browser/static results, Chrome identity, inventory and cleanup proof, and all unresolved risks. Explicitly state that the implementing author is **not** self-certifying CLEAN and that open findings await independent non-author review.

## Durable findings and cautions

- Cleanup safety must authorize the entire journal batch before any deletion or journal rewrite; a safe first target followed by an unsafe target must fail closed with no partial mutation.
- Current and retained media/library topology claims are both security-relevant cleanup aliases.
- Exact equality is required for alias matching; do not broaden names by fuzzy/prefix checks beyond the established legacy decoder.
- Raw reads of a deleted IndexedDB recreate it; prove deletion with database inventory instead.
- External legacy database names are not covered by the disposable fixture prefix and need exact explicit cleanup.
- Bun's global `mock.module` state makes the combined unit invocation misleading; use isolated processes and document why.
- Preserve all previous migration/cascade result fields and independently assert field counts to catch accidental omission.
- The partially patched migration round-2 probe is currently the immediate compile blocker.
