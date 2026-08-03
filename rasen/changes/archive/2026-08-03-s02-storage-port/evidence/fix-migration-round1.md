# C5 review round 1 — migration safety fix

Date: 2026-08-02  
Scope: B1, M1, M2, M6 and test gaps 1, 4, 5, 9 only  
Status: implemented and verified; uncommitted

## Findings closed

### B1 — provider-private data survives v1 migration

The v1→v2 transformer now overlays normalized canonical fields on top of the
source metadata, settings, track, and clip objects. Project and scene objects
continue to retain their source fields. This covers media/image/video, text,
and audio reconstruction without allowing an unknown source field to override
the migrated canonical value.

The real browser probe seeds private sentinels at project, metadata, scene,
track, clip, and attachment-metadata levels. It migrates from v1 through the
current schema, clears runtime memoization, constructs a new store wrapper,
and reloads the project and attachment from Chromium storage. It also compares
the attachment bytes exactly.

### M1 — post-commit cleanup is durable and independently retried

Pending migration cleanup is no longer held in a module-local map. Before any
physical cleanup begins, the exact validated targets are merged into a revisioned
record in the projects database's migration-maintenance store. Each successfully
cleaned target is removed from that journal independently. A runtime reset cannot
erase the remaining work.

Cleanup retry is independent from the migration-once state:

- a new `BrowserProjectStore` retries pending cleanup during initialization;
- `prepareForSession()` retries it for every Host-created session and coalesces
  same-identity maintenance work;
- the stable Next and Vite Hosts call that hook while retaining one stable store;
- both Hosts route browser-store warnings into their real, stable diagnostics port;
- diagnostics expose only logical phase/operation/scope/code/retryable metadata.
  They do not expose database names, directories, target names, or stored payloads.

The browser fixture fails cleanup twice: once after commit and once at the next
session boundary. It observes the first `migration-postcommit-cleanup` warning,
the subsequent `migration-cleanup-retry` warning, then resets runtime state,
constructs a new wrapper, and proves the durable journal completes cleanup.

### M2 — old-schema current envelopes migrate by decoded schema

Candidate selection no longer rejects a row merely because it has the current
envelope marker. Every row is decoded first; `record.schemaVersion` is the
authoritative source version, while envelope presence only chooses whether the
migration input is the decoded data or the recognized legacy row. The current
envelope summary is retained. Chromium now upgrades a schema-30 envelope to 31,
reopens it, and retains its private sentinel.

### M6 — disposable migration cannot touch external legacy targets

Disposable project IDs must start with the exact durable identity plus `-`.
Before a legacy adapter is constructed, target discovery validates both the
project identity and the exact recognized legacy target shape:

- `video-editor-timelines-${projectId}`;
- `video-editor-timelines-${projectId}-${sceneId}`;
- `video-editor-media-${projectId}`;
- `media-files-${projectId}` when a legacy directory target is present.

Persisted cleanup-journal entries are validated again before open/delete; stage
database cleanup accepts only the two exact identity-derived stage names. The
negative Chromium fixture places an unprefixed project row in a disposable store,
preseeds an external timeline sentinel, and proves migration refuses while the
sentinel remains, the project-level timeline and media databases remain absent,
and the v1 source row is unchanged.

## Adversarial RED evidence

The preservation test was written before the transformer fix:

- command: `bun test apps/web/src/services/storage/__tests__/migration-provider-private.test.ts`
- result: **0 passed, 1 failed, 3 expectations**
- first observed mismatch: metadata contained only normalized known fields; the
  seeded `providerPrivateMetadata` object was absent. The pre-existing review
  probe had already shown track and clip private fields absent as well.

The expanded shared Chromium runner was also invoked before the migration work
was complete. Its first run failed before publishing migration assertions because
the concurrently owned cascade RED implementation raised Chromium
`InvalidModificationError` during cleanup. That result is recorded only as an
infrastructure/cross-cluster RED, not falsely attributed to this migration code.
The migration-only page/test was then added so the four migration findings could
be evaluated without cascade-probe coupling.

## GREEN evidence

| Gate | Observed result |
| --- | --- |
| focused v1/provider-private/storage RED-control tests | **20 passed, 0 failed, 46 assertions** |
| isolated migration Playwright test | **1 passed** in real Chromium |
| complete shared BrowserProjectStore Playwright matrix | **1 passed**, Chrome/Chromium **151.0.7922.34** |
| shared matrix details | store **19/19**; migration **16/16 true**; cascade **9/9 true**; `beforeDatabases=[]`, `afterDatabases=[]` |
| Vite example TypeScript | `bunx tsc --noEmit -p apps/vite-example/tsconfig.json` — **PASS** |
| repository type baseline | **PASS**, 3 inherited diagnostics and none outside the pin |
| storage boundary | **PASS**, 717 source modules, zero forbidden mechanism/singleton/fallback findings |
| port boundary | **PASS**, 30 contract modules |
| Host composition | **PASS**, 2 Host roots / 714 production modules |
| session-state boundary | **PASS**, 10/10 factories, 10/10 registry keys, 52 classified imperative modules |
| focused ESLint | **PASS**; only the repository's informational missing-pages message |
| Prettier | **PASS** |
| whole-tree `git -c core.whitespace=cr-at-eol diff --check` | **PASS**; line-ending conversion warnings only |
| strict Rasen validation | **valid: true**, 1/1 |

The full browser result explicitly reported all new migration properties true:
`legacyPrivateFieldsReopened`, `cleanupJournalRetriedByNextSession`,
`cleanupJournalRetriedAfterReload`, `cleanupWarningWasMechanismNeutral`,
`oldEnvelopeMigrated`, and `disposableExternalTargetRefused`.

## Migration-fixer write set

- `apps/web/src/services/storage/migrations/base.ts`
- `apps/web/src/services/storage/migrations/v1-to-v2.ts`
- `apps/web/src/services/storage/migrations/transformers/v1-to-v2.ts`
- `apps/web/src/services/storage/__tests__/migration-provider-private.test.ts`
- `apps/web/src/services/storage/browser-project-store-migration.ts`
- `apps/web/src/services/storage/browser-project-store.ts` (maintenance lifecycle only;
  shared file also contains the concurrent cascade/queue fix)
- `apps/web/src/services/storage/browser-project-store-internals.ts`
- `apps/web/src/services/storage/browser-project-store-conformance.ts` (migration
  probes only; shared file also contains other conformance work)
- `apps/web/src/editor/host/next-editor-host.ts`
- `apps/vite-example/src/host/vite-host-config.ts`
- `apps/vite-example/src/c5-storage-harness.ts` (migration result fields only)
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts` (migration assertions
  and failure diagnostics only)
- `apps/vite-example/c5-migration.html`
- `apps/vite-example/src/c5-migration-harness.ts`
- `apps/vite-example/tests/c5-storage/migration-round1.pw.ts`

This fixer did not edit `create-session.ts`, `session-types.ts`, consumer/library
coordinators, cascade queue/journal mechanics, the C5 task checkboxes, or the
round-1 review report. The protected session files do have concurrent shared-
worktree changes owned by other C5 work; none came from this fixer.
