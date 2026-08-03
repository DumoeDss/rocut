# C5 pre-landing review — round 1

- Branch: `feat/s02-storage-port`
- Explicit base: `0ef35459f685d5d41a25d0ef959aff691b7519cd`
- Review date: 2026-08-02
- Scope: the complete tracked and untracked C5 product diff, plus the sibling planning artifacts at `rasen/changes/s02-storage-port`
- Mode: report-only; no product, task-list, or existing-evidence edits
- Verdict: **CHANGES REQUIRED**
- Tally: **Blocker 3 · Major 6 · Minor 3 · Test-gap 10**

## What is clean

The mechanism-neutral contract and composition direction are sound. The positive port, storage, Host-composition, and session-state boundary sweeps passed, as did the port and Host negative controls and all 19 C5 boundary red-control tests. In particular, I found no public `ProjectStore` signature that exposes IndexedDB/OPFS names or types, no production memory-store fallback, and no second storage/media port in the inspected source graph.

The ordinary (non-migration) opaque overlay uses identity-aware array merging and structured cloning; the focused opaque round-trip tests passed. The legacy raw `user-sounds` fallback is explicitly removed by saved-sounds namespace clear. Core and library error reporting inspected here forwards operation/code-style metadata rather than stored payloads. Those clean results do not cover the migration and concurrency failures below.

## Blockers

### B1 — The v1→v2 migration drops nested provider-private fields

**Spec axis:** provider-private/unknown preservation.  
**Standards axis:** data loss during migration.

`apps/web/src/services/storage/migrations/transformers/v1-to-v2.ts:165-179` reconstructs metadata from known fields without spreading the source. The external legacy timeline conversion similarly rebuilds tracks and elements from known fields at `:268-310`, `:313-400`, `:403-499`, and `:502-541`. Project and scene-level spreads at `:211-214` and `:258-265` do not protect metadata, track, or clip private data. `apps/web/src/services/storage/browser-project-store-migration.ts:151-178` calls this transformer for the browser migration.

A read-only direct transformer probe seeded private sentinels at project, metadata, scene, track, and clip levels. Its result was:

```text
{"skipped":false,"project":{"keep":true},"scene":{"keep":true}}
```

The metadata, track, and clip sentinels disappeared. The browser migration fixture only asserts a top-level project sentinel and attachment-metadata sentinel (`browser-project-store-conformance.ts:533-540`), so the passing probe misses the loss.

**Required action:** preserve unknown fields at every rebuilt node, preferably with the same identity-aware opaque overlay semantics used by ordinary edits, and add a real v1 browser migration fixture asserting project metadata, scene, track, clip, and attachment private sentinels after migration and reopen.

### B2 — Concurrent sessions lose saved-sound and custom-preset updates

**Spec axis:** multi-session durability/isolation.  
**Standards axis:** lost-update data loss.

`SessionPersistenceCoordinator` serializes writes only within one coordinator (`apps/web/src/editor/persistence/session-persistence-coordinator.ts:398-447`). Saved sounds uses another instance-local tail (`apps/web/src/sounds/sounds-store.ts:137-142`) around a load→append/remove→save sequence (`:283-326`); custom presets repeats the pattern at `apps/web/src/timeline/components/graph-editor/custom-presets-store.ts:43-63` and `:101-141`. Two sessions therefore load the same old record before either write and then overwrite each other, even when they share the same durable store.

A read-only repro used one `InMemoryProjectStore`, two coordinators, and two concurrent load→append→save operations for IDs 1 and 2. The final record was:

```text
{"sounds":[{"id":2}]}
```

Both calls resolved, but ID 1 was silently lost. Browser write queuing cannot make the compound read-modify-write atomic either.

**Required action:** introduce an atomic durable-key mutation/CAS operation, or a coordinator registry shared by durable store identity, and route both libraries through it. Add two complete sessions sharing one store and concurrently saving sounds/presets; assert both updates survive and each session can reload the committed union.

### B3 — Project remove/clear deletes attachments before its durable commit point

**Spec axis:** logical project cascade and cancellation/error semantics.  
**Standards axis:** partial destructive commit/data loss.

`apps/web/src/services/storage/browser-project-store.ts:258-283` performs its one pre-commit cancellation check, then physically deletes the per-project media database and OPFS directory at `:877-884`, and only afterwards deletes the project row at `:275-280`. If the later project-row delete fails, `remove` rejects while the still-readable project has irreversibly lost its attachments. `clearProjects` has the same ordering: media databases/directories are removed at `:886-896` before the project store is cleared at `:897-901`.

This violates the promised logical cascade and the pre-commit failure rule. It also makes retry ambiguous because the previous committed state is already incomplete.

**Required action:** define a recoverable commit point (for example a durable tombstone/journal), commit project invisibility first, and perform attachment cleanup as journaled, retryable post-commit work; or restore all deleted data on failure. Add injected-failure tests between attachment deletion and project-row deletion for both `remove` and project-scope `clear`.

## Majors

### M1 — Post-commit migration cleanup is neither durably retryable nor visible in production

`apps/web/src/services/storage/browser-project-store-migration.ts:70` keeps pending cleanup only in a module-local `Map`; failures are recorded at `:482-510` and retried only when migration is invoked again (`:519-537`). But `apps/web/src/editor/session/create-session.ts:347-401` memoizes every successful migration forever for a given store object, so subsequent production sessions do not invoke the browser store again. A reload also loses both in-memory maps and the migrated rows are no longer candidates. The existing cleanup probe directly calls `store.migrate()` twice (`browser-project-store-conformance.ts:347-365`), bypassing the production session path.

The production stores in `apps/web/src/editor/host/next-editor-host.ts:16-18` and `apps/vite-example/src/host/vite-host-config.ts:10-12` also provide no `diagnostic` callback, so `:501-506` and `:529-534` are silent in real hosts.

**Required action:** persist a cleanup journal and retry it during store/session initialization independently of migration-once memoization; wire mechanism-neutral warning metadata into session diagnostics. Test failure, next session, and reload/reopen.

### M2 — Current-format envelopes with an old schema version are never migrated

`readPersistedBrowserSchemaVersion` reports the minimum version across all rows (`browser-project-store-migration.ts:114-124`), but candidate selection explicitly excludes every row containing `PROJECT_ENVELOPE_KEY` (`:142-147`). A valid current-format envelope whose record schema is below `BROWSER_STORE_SCHEMA_VERSION` therefore reports old data while `migrate` returns `not-needed` and leaves it old forever.

**Required action:** select by decoded record schema version, using envelope presence only to choose the decoder/transform path. Add an old-schema current-envelope fixture and verify migration plus reopen.

### M3 — Mutation serialization is per wrapper, not per durable browser identity

Each `BrowserProjectStore` constructs its own queue at `apps/web/src/services/storage/browser-project-store.ts:84-92`; `BrowserMutationQueue` holds an instance-local pending set (`browser-project-store-control.ts:187-212`). Only migration state is keyed globally by durable identity. Two wrappers for the same identity can therefore interleave `remove(project)` with `saveAttachment(project, key)`, allowing one wrapper to recreate/write an attachment after the other's attachment deletion but before/after its project-row deletion, leaving orphaned media. The two-wrapper probe at `browser-project-store-conformance.ts:615-667` covers migration coalescing only.

**Required action:** share mutation arbitration by `durableIdentityKey` (with bounded lifecycle cleanup), and test same-key writes, replace/remove, project-tree removal, and clear across two wrappers of the same identity.

### M4 — Malformed current rows are hidden or reinterpreted instead of producing typed `corrupt`

`decodeStoredProject` falls back to legacy decoding whenever a current envelope fails validation but the outer row has an ID (`apps/web/src/services/storage/browser-project-store-records.ts:90-118`). Project list then accepts that reinterpretation (`browser-project-store.ts:172-181`). Attachment list silently skips undecodable metadata at `:304-310`; library list filters undecodable records at `:470-475`; library load falls through to legacy/null after an undecodable present row at `:504-519`. This hides storage corruption and can let later writes or clears discard data without a diagnostic.

**Required action:** distinguish absent, recognized legacy, valid current, and corrupt current records. Any present malformed current record must reject with `ProjectStoreError { code: "corrupt", operation, scope }`. Add malformed-envelope/metadata/library fixtures for list and load.

### M5 — Duplicate-project cleanup races sibling saves and can leave an orphan duplicate

`apps/web/src/core/managers/project-manager.ts:431-436` uses `Promise.all` and appends an ID only after its individual save resolves. On the first rejection, the catch immediately snapshots `committedDuplicateIds` for cleanup at `:463-468`; a slower sibling may resolve afterwards and append its ID after cleanup has already been scheduled. That duplicate remains, although the toast promises “No incomplete duplicate was kept” at `:473-475`.

**Required action:** await all creation attempts with `Promise.allSettled`, derive every fulfilled ID, then clean all of them before reporting failure. Add a deterministic early-reject/late-success save test.

### M6 — Disposable migration opt-in does not constrain legacy physical targets to its prefix

`ensureMigrationAllowed` validates the durable identity/policy pair only (`browser-project-store-migration.ts:89-112`); it does not validate project IDs loaded from that database. v1 discovery opens hard-coded legacy databases derived from the row's arbitrary project ID (`apps/web/src/services/storage/migrations/v1-to-v2.ts:96-123` and `:144-149`), and `getLegacyTimelineDbNames` returns similarly derived cleanup targets at `:212-234`. A disposable test store containing an unprefixed/project-production ID can therefore open and later delete a developer's real `video-editor-timelines-*` or `video-editor-media-*` database.

**Required action:** under disposable policy, reject every resolved legacy database/directory target that is outside the exact disposable prefix/identity before discovery, staging, or cleanup. Add a negative fixture with an unprefixed project ID and prove no external database is opened or deleted.

## Minors

### m1 — Mid-flight read cancellation is ignored

Browser read methods check `AbortSignal` before `ready`/IDB/OPFS awaits (for example `browser-project-store.ts:157-167`, `:185-196`, and `:285-311`) but do not recheck before returning. A signal aborted while I/O is in flight still resolves with data. Recheck after awaited boundaries and before publication, and add an actively aborted—not already-aborted—read test.

### m2 — The Host contract header still says the ports are unwired

`apps/web/src/editor/host/editor-host.ts:15-16` says “Nothing consumes the ports yet. Wiring is later work,” while the surrounding comment and completed C5 implementation state that the ports have arrived and runtime consumers receive the complete Host through the session. Remove or update the stale paragraph so contract documentation matches the shipped topology.

### m3 — Generated verifier output is still in the landing set

`apps/vite-example/dist-c5-verifier/` is an untracked generated build tree (including bundled JS, WASM, static assets, and `module-graph.json`) under the worktree. It should not be landed as product source. Remove it or explicitly ignore the verifier output after retaining only the intended evidence artifacts. The untracked browser-test area should likewise be checked for runner output before staging.

## Test gaps

1. Real v1 browser migration with private sentinels at metadata, scene, track, clip, attachment metadata, and project levels, verified after reopen.
2. Two full sessions sharing one store concurrently mutate saved sounds and custom presets; no lost update.
3. Fault injection after attachment deletion but before project-row delete/clear; previous state remains readable or cleanup is durably journaled.
4. Post-commit cleanup failure through `createEditorSession`, then a second session and a reload/reopen; warning is emitted and cleanup retries.
5. Old-schema current-envelope row is upgraded rather than reported `not-needed`.
6. Two `BrowserProjectStore` wrappers with one durable identity race project-tree removal/clear against attachment writes.
7. Malformed current project, attachment, and library rows cause typed `corrupt` failures for both list and load paths.
8. Duplicate creation with an early failing save and a delayed successful sibling leaves no duplicate behind.
9. Disposable migration presented with an out-of-prefix project ID refuses before opening/deleting any derived legacy target.
10. A browser read aborted after dispatch but before IDB/OPFS completion rejects as `aborted` and publishes no result.

## Commands and observed evidence

- Focused product tests: 41 passed, 0 failed, 195 assertions (port conformance, opaque round-trip, project/media rewires, persistence failure, library operations, media capacity).
- `node script/check-port-boundary.mjs`: PASS (30 contract modules).
- `node script/check-storage-boundary.mjs`: PASS (713 source modules; no singleton/adapter/mechanism/fallback violation).
- `node script/check-host-composition.mjs`: PASS (2 roots / 710 modules).
- `node script/check-session-state-boundary.mjs`: PASS (10/10).
- `node script/check-port-boundary.mjs --negative-control`: PASS; every rule demonstrated failure and non-vacuity.
- `node script/check-host-composition.mjs --negative-control`: PASS; every composition rule demonstrated failure.
- `bun test script/__tests__/c5-storage-boundary-red.test.mjs`: 19 passed, 0 failed, 37 assertions.
- `node script/check-type-baseline.mjs`: PASS; 3 diagnostics now versus 13 at the pin, no diagnostic outside the pinned baseline.
- `git -c core.whitespace=cr-at-eol diff --check`: PASS; only line-ending conversion warnings.

No broad browser suite was rerun in this report-only pass because it writes generated runner/build output; the browser probe source and its assertions were inspected directly. Existing passing tests do not exercise the ten gaps listed above.
