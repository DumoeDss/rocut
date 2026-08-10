## 1. OpenCut transaction projection and adapter

- [x] 1.1 Create the donor-aware `apps/web/src/editor/transactions/opencut/**` module outside `editor/contracts/**`, with sealed types for routing class, detached project draft, staged candidate, commit token, and encoded publication receipt
- [x] 1.2 Implement OpenCut-to-contract projection for the loaded project/current scene, including project settings, timeline tracks/elements, bookmarks, and the project-record asset catalog, using standalone contract `MediaTime` casts only at this donor seam
- [x] 1.3 Implement a deterministic before/after projector diff that emits the minimal closed `TransactionOperation[]` in stable dependency order and rejects an empty or unrepresentable transaction projection
- [x] 1.4 Implement the OpenCut `TransactionDocumentAdapter` decode/automation-encode path with a versioned revision/idempotency envelope, exact `ProjectRecord`/`ProjectSummary` identity, and overlay preservation of unrelated opaque donor fields
- [x] 1.5 Implement staged UI candidate registration keyed by unique idempotency token, base revision, and previous-record digest; require exact public re-projection equality before encode and clear candidate/receipt state in every success or failure path
- [x] 1.6 Add the session transaction-engine facade and per-project mutation arbiter so UI, automation apply/validate/dry-run, and coordinator project saves share one ordered authority while the raw T1 engine stays private
- [x] 1.7 Add adapter/projection tests for all supported entity mappings, deterministic operation order, automation-only apply, staged UI apply, mismatched token/base/projection rejection, metadata reopen, and nested opaque sentinel round-trip

## 2. Session lifecycle and persistence coordination

- [x] 2.1 Extend `SessionPersistenceCoordinator` with a no-save adoption method that validates/decodes the exact committed `ProjectRecord` and refreshes `projectSnapshots` plus `projectCache` only after durability
- [x] 2.2 Add a scoped SaveManager path for publishing an already durable transaction candidate so scene/timeline notifications do not schedule a second save and unrelated pre-existing dirty work is not silently cleared
- [x] 2.3 Open the canonical router/engine during `ProjectManager.loadProject` before the project becomes editable, and retire all old-project candidate/router state on project switch, failure, and session disposal
- [x] 2.4 Expose the one canonical engine facade from the session-owned editor core for both command dispatch and later automation composition without changing either Host root or adding a second engine
- [x] 2.5 Serialize coordinator saves and router commits across their complete load/encode/save/adopt lifecycles so either invocation order preserves the newest revision, idempotency ledger, and opaque overlay
- [x] 2.6 Add persistence tests proving one routed command causes exactly one underlying project save after the debounce window, exact cache adoption, legacy dirty-save retry, and no stale overwrite in both transaction/legacy orderings

## 3. Command preparation and atomic dispatch

- [x] 3.1 Refactor `Command`/`EditorCommandContext` around an explicit routing class and deterministic detached-draft transition, with asynchronous durable `execute`, `undo`, and `redo` completion for transaction-routable commands
- [x] 3.2 Refactor `BatchCommand` to prepare every transaction child against one draft, preserve “latest explicit selection wins,” and reject immediate/provider-private/mixed children before any transition or effect runs
- [x] 3.3 Refactor `CommandManager.execute` to capture base revision and previous selection, prepare one root candidate, submit exactly one router commit, and publish live managers/selection/history plus redo clearing only after success
- [x] 3.4 Move ripple computation and registered reactor work onto the same detached candidate so empty-track pruning and ripple clip updates contribute to the root batch rather than a second mutation/save
- [x] 3.5 Replace ambiguous nested `executeWithoutHistory` use with a preparation-only nested path; migrate continuous external uses to local preview plus final commit or an explicit non-transaction routing class
- [x] 3.6 Add exhaustive command routing registration so every module under `apps/web/src/commands/**` is classified as transaction, preview, provider-private, or immediate and an unclassified command fails before mutation
- [x] 3.7 Update command call sites that depend on committed state to await completion, and route intentionally detached calls through `void` plus the existing structured persistence-failure diagnostics instead of unhandled rejections

## 4. Command-category migration and honesty boundary

- [x] 4.1 Migrate deterministic track/element/bookmark create, update, move, trim, split, snapshot, and delete commands to detached project transitions whose public diffs use only the frozen operation union
- [x] 4.2 Consume the reviewed typed `update-project` prerequisite for public Project deltas; retain public fps/canvas fields in detached candidates, classify settings patches per changed field, and keep nested `pushHistory: false` settings in the forward durable root but outside the command inverse
- [x] 4.3 Register scene-only structure, mute, effects, masks, keyframes, retiming, source-audio flags, and other empty-public-projection edits as explicit provider-private gaps; preserve them alongside a routable public change but never submit a no-op public batch for a private-only edit
- [x] 4.4 Register attachment save/remove, URL and cache mutation, media processing, generation, export, and external-resource deletion as immediate effects outside transaction history, and reject any `BatchCommand` that attempts to mix them with routed work
- [x] 4.5 Audit media/asset commands so project-record asset metadata is distinguished from attachment bytes and no test or capability claim treats multiple port calls as one atomic project transaction
- [x] 4.6 Add negative classification tests proving unregistered commands, mixed batches, private-only fake transactions, and immediate effects hidden behind nested execution all fail before project mutation, external effect, save, revision, or history publication

## 5. Undo, redo, and pointer-preview finalization

- [x] 5.1 Store forward and inverse prepared material for the complete successful root command, including ripple/reactor results, without retaining transaction metadata inside donor history snapshots
- [x] 5.2 Route undo through one inverse typed batch at the current revision and move history/restore selection only after one successful durable commit; preserve live state and both stacks on failure
- [x] 5.3 Route redo through one forward typed batch at the current revision and move the entry back to history/apply selection intent only after one successful durable commit
- [x] 5.4 Change `TimelineManager.commitPreview` to await one normal routed `TracksSnapshotCommand`, clear the overlay only after success, and retain the local overlay after durable failure for retry or discard
- [x] 5.5 Update preview controllers, transform handles, mask/keyframe/property hooks, and timeline hooks so pointer frames remain local and finalization handles asynchronous success/failure without duplicate commits
- [x] 5.6 Add instrumented tests proving N pointer frames produce zero applies/saves/revisions/watch calls/history entries, pointer-up produces exactly one of each, cancel produces zero, and failed pointer-up leaves committed state unchanged with preview retained
- [x] 5.7 Add undo/redo tests for one-save/one-revision semantics, selection behavior, Batch/ripple/reactor parity, expected-revision validation, and injected save-failure stack preservation

## 6. Shared-engine, atomicity, and parity evidence

- [x] 6.1 Run T0 conformance and T1 engine conformance against the concrete OpenCut adapter/facade with fresh donor records, controlled save failures, reopen, and opaque sentinels; record every executed pass/fail/skip case
- [x] 6.2 Add a shared-engine test that interleaves UI and automation applies without awaiting the first and proves invocation ordering, consecutive revisions, one watcher notification per success, and no sibling engine construction
- [x] 6.3 Add command tests proving a valid multi-child Batch plus ripple and empty-track reactor performs one apply/save/revision/history publication and a failing child publishes nothing
- [x] 6.4 Add durable-before-publication tests for preparation, validation, adapter, and store failures, asserting live project, selection, history/redo, revision, idempotency, watchers, and later queue usability
- [x] 6.5 Capture the established normalized editing parity fixture before/after routing on both Hosts and require the snapshot to remain unchanged; any semantic delta is a defect rather than an accepted update
- [x] 6.6 Record a focused pointer-drag trace with frame count, apply count, project-save count, revision delta, watcher count, and history delta as T3 observable evidence

## 7. Verification and scope gates

- [x] 7.1 Run the focused Bun suites for the adapter/router, command manager, migrated commands, persistence coordination, undo/redo, and pointer preview with zero failed executed cases
- [x] 7.2 Run `node script/check-transaction-boundary.mjs` and its `--negative-control`; confirm the donor adapter stays outside `contracts/**` and every forbidden-import rule remains sensitive
- [x] 7.3 Run `node script/check-type-baseline.mjs` and keep the diagnostic count at or below the pinned ceiling of 3 without regenerating the fixture
- [x] 7.4 Build `apps/web` and `apps/vite-example` and run the established parity path for both Hosts; classify only independently reproduced baseline/environment failures as pre-existing
- [x] 7.5 Sweep every canonical `rasen/specs/*/spec.md` present at verification time for SHALL/MUST assertions falsified by the implementation, including the complete updated `transaction-automation-api` behavior
- [x] 7.6 Audit the T3-authored product diff for the declared scope: no additional T0/T1 public contract or engine edits beyond the merged reviewed `update-project` prerequisite, no `ProjectStore` widening, and no Host composition root, Surface, Rust/WASM, package extraction, parity-oracle, or type-baseline fixture change
- [x] 7.7 Run `rasen validate s0304-ui-commit-routing --strict --project rocut --json` and resolve every artifact/spec error before implementation is reported ready
