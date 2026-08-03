# C5 Final Storage Boundary Evidence

Date: 2026-08-02  
Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
Branch: `feat/s02-storage-port`

## Final policy

`script/check-storage-boundary.mjs` is the canonical inventory. It enumerates tracked and
uncommitted source files below `apps/web/src` and `apps/vite-example/src`, drops deleted tracked
tombstones and unit-test directories, and then adds only these exact direct-verification programs:

1. `apps/vite-example/tests/parity/snapshot.ts`
2. `apps/vite-example/tests/probe/seed.ts`
3. `apps/vite-example/tests/probe/legacy-migration.pw.ts`

There is no directory-prefix or glob exemption for test code. The `unlisted-verification` negative
fixture is immediately adjacent to an exempt probe and still exits non-zero. Mechanism hits are
classified independently from `storageService` imports/exports and `BrowserHostAdapter` references,
so removing one kind of path cannot conceal another.

The final inventory is **710 existing production modules + 3 exact verification modules = 713
source modules**. The canonical positive run reported:

- direct `storageService` imports/exports: **0**
- `BrowserHostAdapter` references: **0**
- unexpected browser-mechanism hits: **0**
- allowed mechanism hits inside `apps/web/src/services/storage/**`: **32**
- allowed mechanism hits in the three exact verification files: **8**, across exactly **3 files**
- unclassified persistence-localStorage files: **0**
- private/second storage channels, hidden Host storage properties, production in-memory storage
  fallbacks: **0**

Command and result:

```text
node script/check-storage-boundary.mjs
exit 0
check-storage-boundary: scanned 713 source module(s)
PASS direct storageService imports/exports: 0
PASS BrowserHostAdapter references: 0
PASS unexpected browser-mechanism hits: 0; allowed storage-boundary hits: 32; exact-fixture hits: 8
PASS unclassified persistence localStorage files: 0
```

## Explicit local-preference classification

The allowlist is exact-file-only. These are shell/local UI state, not durable editor libraries:

| File                                                           | Classification                                  |
| -------------------------------------------------------------- | ----------------------------------------------- |
| `apps/web/src/changelog/components/changelog-notification.tsx` | changelog acknowledgement                       |
| `apps/web/src/feedback/components/feedback-popover.tsx`        | local feedback-history convenience              |
| `apps/web/src/components/editor/mobile-gate.tsx`               | mobile-gate acknowledgement                     |
| `apps/web/src/components/ui/form.tsx`                          | generic form persistence supplied by UI callers |
| `apps/web/src/services/storage/use-local-storage.ts`           | generic local-preference hook                   |
| `apps/web/src/components/editor/onboarding.tsx`                | onboarding acknowledgement through that hook    |
| `apps/web/src/services/storage/use-storage-persistence.ts`     | browser persistence-prompt dismissal            |

`apps/web/src/sounds/sounds-store.ts` and
`apps/web/src/timeline/components/graph-editor/custom-presets-store.ts` are deliberately absent.
Their negative fixtures both fail with `durable-library-localstorage`; the real modules have no
`localStorage`/`useLocalStorage` hit.

## Public-port and Host-composition gates

The public-port gate now rejects all of the following in the contract graph:

- OpenCut project/schema imports, including relative imports;
- command-class, editor state-store/Zustand, and browser storage-implementation imports;
- IndexedDB globals and `IDBFactory`/`IDBDatabase`/`IDBObjectStore`/transaction/request types;
- OPFS/StorageManager calls and file-system handle types;
- physical `databaseName`, `objectStoreName`, `opfsPath`, `storagePath`, and
  `video-editor-*` identities.

The real tree passed with **30 contract modules**. `--negative-control` caught every positive-failure
fixture, including the new schema, command, state-store, browser-implementation, IDB type, OPFS type,
and physical database/store/path cases; its converse controls also remained not-caught as intended.

```text
node script/check-port-boundary.mjs
exit 0
node script/check-port-boundary.mjs --negative-control
exit 0 (the runner exits zero only after every internal fixture is caught as expected)
```

The composition gate inventories **710 existing production modules** and two production Host roots.
It rejects a second `StoragePort`/`MediaPort`, storage-bearing context, `projectStore`/`mediaStore` or
other hidden Host property, `storageService`, adapter resurrection, optional Host resolution,
`InMemoryProjectStore`, a missing final `BrowserProjectStore` override, and a fallback expression.

```text
node script/check-host-composition.mjs
exit 0
node script/check-host-composition.mjs --negative-control
exit 0 (12/12 targeted rules caught, including separate storage-port and media-port controls)
```

## Directory negative controls: actual non-zero exits

Each directory below was executed independently as:

```text
node script/check-storage-boundary.mjs --fixture script/fixtures/c5-storage-boundary/<name>
```

The table records the observed process exit and required targeted diagnostic. The Bun test additionally
compares its case table with the directory listing, so an added fixture cannot be silently skipped.

| Fixture                              | Exit | Targeted diagnostic                    | Observed |
| ------------------------------------ | ---: | -------------------------------------- | -------- |
| `direct-adapter`                     |    1 | `retired-adapter`                      | yes      |
| `direct-indexeddb`                   |    1 | `mechanism:indexeddb`                  | yes      |
| `direct-opfs`                        |    1 | `mechanism:opfs`                       | yes      |
| `direct-singleton`                   |    1 | `direct-singleton`                     | yes      |
| `hidden-host-storage`                |    1 | `hidden-host-storage`                  | yes      |
| `in-memory-fallback`                 |    1 | `in-memory-production-fallback`        | yes      |
| `localstorage-presets`               |    1 | `durable-library-localstorage`         | yes      |
| `localstorage-sounds`                |    1 | `durable-library-localstorage`         | yes      |
| `mechanism-type-leak`                |    1 | `mechanism:idb-factory`                | yes      |
| `physical-storage-path-leak`         |    1 | `mechanism:storage-path`               | yes      |
| `private-storage-context`            |    1 | `private-storage-context`              | yes      |
| `public-command-leak`                |    1 | `public-command-import`                | yes      |
| `public-schema-leak`                 |    1 | `public-schema-import`                 | yes      |
| `public-state-store-leak`            |    1 | `public-state-store-import`            | yes      |
| `public-storage-implementation-leak` |    1 | `public-storage-implementation-import` | yes      |
| `second-media-port`                  |    1 | `second-storage-media-port`            | yes      |
| `second-storage-port`                |    1 | `second-storage-media-port`            | yes      |
| `unlisted-verification`              |    1 | `mechanism:indexeddb`                  | yes      |

The aggregate proof was also green:

```text
bun test script/__tests__/c5-storage-boundary-red.test.mjs
exit 0
19 pass / 0 fail / 37 expectations
```

## `rg` sweep and classification of every real-tree hit

All sweeps excluded `**/__tests__/**` and the negative-fixture tree, and covered the two production
source roots plus the three exact verification files.

### `storageService`, `BrowserHostAdapter`, `browser-host-adapter`

Command:

```text
rg -n --glob '!**/__tests__/**' 'storageService|BrowserHostAdapter|browser-host-adapter' \
  apps/web/src apps/vite-example/src <three exact verification files>
```

Result: **no hits** (`rg` exit 1, the expected no-match result). There is no production singleton
import/export and no adapter reference.

### IndexedDB calls/types/names

The case-sensitive API/type sweep found exactly these files:

| Classification     | Files and match counts                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| storage boundary   | `service.ts` 1; `browser-storage-mechanisms.ts` 12; `browser-project-store.ts` 1; `indexeddb-adapter.ts` 3 |
| exact verification | `parity/snapshot.ts` 4; `probe/seed.ts` 1; `probe/legacy-migration.pw.ts` 3                                |

No other file calls the global or exposes an IDB type. A separate case-insensitive name/prose sweep
also found `apps/vite-example/src/c3-session-harness.tsx` (the C3 migration QA harness constructs the
storage boundary's `IndexedDBAdapter`, but does not call a browser API),
`apps/web/src/app/privacy/page.tsx` (user-facing disclosure prose), and
`apps/web/src/editor/ports/index.ts` (boundary documentation). Those are names/prose, not mechanism
calls or public signatures; the port gate independently verifies the latter.

### OPFS and StorageManager APIs/types

Every hit is under `apps/web/src/services/storage/**`:

| File                            | Match count | Classification                                          |
| ------------------------------- | ----------: | ------------------------------------------------------- |
| `browser-project-store.ts`      |           3 | capability and quota implementation                     |
| `browser-storage-mechanisms.ts` |           5 | OPFS root and handle implementation                     |
| `opfs-adapter.ts`               |           8 | legacy OPFS implementation retained behind the boundary |
| `quota.ts`                      |           3 | StorageManager estimate implementation                  |
| `use-storage-persistence.ts`    |           4 | persistence permission/prompt implementation            |
| `types.ts`                      |           4 | File System Access type augmentation                    |

There are zero OPFS/StorageManager API/type hits in production consumers or the three direct-IDB
verification fixtures.

### Physical storage-path literals

All 44 matches are classified by file group:

| Classification        | Files and match counts                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| storage boundary      | `service.ts` 3; `indexeddb-adapter.ts` 1; `browser-project-store-conformance.ts` 9; `browser-project-store-migration.ts` 1; `browser-project-store-internals.ts` 6; `browser-storage-mechanisms.ts` 3; `migrations/runner.ts` 2; `migrations/v1-to-v2.ts` 6 |
| exact verification    | `parity/snapshot.ts` 6; `probe/seed.ts` 5; `probe/legacy-migration.pw.ts` 1                                                                                                                                                                                 |
| classified QA harness | `apps/vite-example/src/c3-session-harness.tsx` 1: seeds the historical `video-editor-projects` identity through `IndexedDBAdapter` for the C3 migration button; it is not a browser API call or public port signature                                       |

The public-port negative fixture proves physical database/store/path fields are rejected; logical
Host-neutral `AssetRef.path` remains valid and is intentionally not confused with a physical storage
path.

### Persistence `localStorage`

The sweep found exactly the seven allowlisted files and no durable library module:

| File                          |                                   Match count |
| ----------------------------- | --------------------------------------------: |
| feedback popover              | 3 (including its unavailable-storage comment) |
| persistence-prompt hook       |                                             2 |
| generic local-preference hook |                                             3 |
| generic form                  |                                             3 |
| mobile gate                   |                                             2 |
| onboarding                    |                                             2 |
| changelog notification        | 3 (including its unavailable-storage comment) |

Finally, the second-port/context/hidden-property sweep returned no production hit.

## Formatting and syntax

```text
node --check script/check-storage-boundary.mjs
node --check script/check-port-boundary.mjs
node --check script/check-host-composition.mjs
bunx prettier --check script/check-storage-boundary.mjs script/check-port-boundary.mjs \
  script/check-host-composition.mjs script/__tests__/c5-storage-boundary-red.test.mjs \
  script/fixtures/c5-storage-boundary BOUNDARIES.md
```

These commands are rerun after the evidence/task update; section 10 is checked only if the final
rerun remains green.
