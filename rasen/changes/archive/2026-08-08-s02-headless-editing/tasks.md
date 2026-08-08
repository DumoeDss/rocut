## 1. Freeze the C6-integrated base and capture truthful baseline evidence

- [x] 1.1 Assign every product-code implementation phase in this checklist to Sol; do not delegate any C7 implementation or product fix to Luna.
- [x] 1.2 Verify the implementation worktree is `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7`, branch `feat/s02-headless-editing`, clean in tracked files, at HEAD `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf` and tree `885d307814260b77397c2c2677b9361fdfc5f5e2`; stop on a different identity.
- [x] 1.3 Record the complete starting `git status --short`, `git diff --name-status`, untracked-path attribution, C6 reachability, and worktree list without deleting or reverting user/other-agent work.
- [x] 1.4 Capture the protected editor-port tree, public session-type blob, parity fixture blob, type-baseline fixture blob, relevant Rust trees, and generated JS/WASM SHA-256 identities before editing.
- [x] 1.5 Confirm the fourteen current main capability specs strict-validate and save their exact requirement/scenario counts as the pre-C7 corpus.
- [x] 1.6 Check Bun, Node, Next, Vite, browser, Rust/WASM, free-port, process-ownership, and disk-space prerequisites; derive required Next environment variable names from `.env.example` without recording any values.
- [x] 1.7 Bootstrap the fresh worktree and force fresh ordinary Vite and Next output before type verification; do not use copied or cached output as baseline evidence.
- [x] 1.8 Reproduce the C6-integrated full-suite identity of 390 passing tests, eight inherited placement failures, two inherited loader errors, and 1,328 assertions, or stop and attribute every difference.
- [x] 1.9 Reproduce the exact three inherited type diagnostics after the required fresh-build sequence, and save their file/line/code/message identities rather than only a count.
1.10 **Historical deviation (non-checkbox; permanently unmet):** The original requirement — "Reproduce focused C3-C6 Host, persistence, migration, resource, runtime, parity, and provenance gates before edits and record exact commands, exits, totals, markers, and hashes" — was not executed before product edits and cannot be completed retroactively. Later accepted controls bounded the resulting risk without erasing the deviation: pre-edit protected identities in `evidence/baseline-20260805.md`; post-edit C3-C6, Host, migration, persistence, resource, runtime, parity, and provenance replay in `evidence/final-regression.md` and `evidence/review-round2-fixes.md`; and the third fresh non-author CLEAN acceptance in `evidence/review-report.md` and `evidence/verification-report.md`.
- [x] 1.11 Create an implementation evidence index under the C7 child directory that labels baseline, RED, GREEN, negative control, Host, regression, review, ship, integration, and archive records separately; do not pre-populate pass claims.

## 2. Establish RED for the missing headless contract and unsafe measurements

- [x] 2.1 Add a focused test that imports the intended isolated headless path and fails because no `createHeadlessEditorSession` contract exists yet.
- [x] 2.2 Add a RED semantic test for seed/load/edit/save/dispose/new-owner/reopen over one in-memory store, including distinct seed and edited values.
- [x] 2.3 Add RED tests for missing-project `null`, cross-project save rejection, no replacement navigation, and no public transaction/revision/draft methods.
- [x] 2.4 Add RED tests that install throwing `document`, `window`, IndexedDB, and OPFS sentinels where supported before the isolated import and execution.
- [x] 2.5 Characterize the current full factory's migration events, failure type/message, concurrent once-per-store promise joining, distinct-store independence, and fail-then-retry behavior before extraction.
- [x] 2.6 Add RED cross-factory migration tests for full/full, full/headless, headless/full, and headless/headless creation on the same delayed store.
- [x] 2.7 Demonstrate that using the full `createEditorSession()` as the supposed headless entry reaches `EditorCore`/UI/resource composition and is therefore an invalid boundary, without weakening or stubbing that graph.
- [x] 2.8 Produce fresh output that reproduces the existing Next aggregate collector's inability to establish React sensitivity; record the observed aggregate counts only as RED diagnostics, never as a clean claim.
- [x] 2.9 Add a deliberately React-reachable application root and prove the existing aggregated NFT/manifest/source-map route inventory can miss or cannot attribute that dependency to the exact root.
- [x] 2.10 Add RED checker tests for empty modules, wrong entry, missing critical root, stale marker/base, altered file digest, copied Host graph, and React IDs with Windows/query/virtual/alias forms.
- [x] 2.11 Add RED Vite and Next build tests requiring a dedicated exact application entry, emitted membership, required repository roots, unique marker, and canonical graph/artifact digests.
- [x] 2.12 Save every RED command and expected failure signature; distinguish a meaningful oracle failure from setup, compile, or unrelated test failures.

## 3. Extract and share the React-free store-migration gate

- [x] 3.1 Move the migration promise memo, `MigrationFailedError`, and orchestration into a narrow React-free session/persistence module with no editor-core, Surface, JSX, or browser dependency.
- [x] 3.2 Adjust the full session factory to call the shared helper and preserve any direct import/re-export compatibility needed by existing tests or consumers.
- [x] 3.3 Make the headless factory call the same helper before constructing its persistence coordinator or loading project data.
- [x] 3.4 Preserve one successful/no-op memoized promise per store identity and make concurrent full/full callers join it.
- [x] 3.5 Make full/headless and headless/headless callers join the same in-flight promise rather than maintaining parallel `WeakMap` state.
- [x] 3.6 Preserve independent migration runs for distinct store identities and allow discarded stores to be garbage-collected.
- [x] 3.7 Preserve failure diagnostics and `MigrationFailedError`, delete only the failed memo entry, and prove a corrected later attempt retries.
- [x] 3.8 Prove no factory loads a project, binds a full editor, or resolves creation before the shared migration reaches a successful/no-op terminal state.
- [x] 3.9 Run the characterized full-session migration suite and cross-factory matrix GREEN, saving exact totals and event traces.

## 4. Implement the deep provider-private headless owner

- [x] 4.1 Add the isolated React-free `apps/web/src/editor/session/headless.ts` export path and nearby implementation/types without importing or re-exporting the existing React-bearing session barrel.
- [x] 4.2 Define the provider-private owner with immutable Host-issued session ID/project ID plus only `load`, `save`, and asynchronous `dispose` operations.
- [x] 4.3 Resolve the already-complete Host, use its exact project ID/store/ID/diagnostics roles, and forbid partial Host casts or fallback port construction.
- [x] 4.4 Construct exactly one `SessionPersistenceCoordinator` per headless owner after migration and scope every load/save to the Host project ID.
- [x] 4.5 Return coordinator-decoded detached project data from `load()` and explicit `null` for absence without navigation, replacement creation, or UI behavior.
- [x] 4.6 Delegate `save()` to the coordinator so durable completion precedes resolution and reject a project whose metadata ID does not equal the owner project ID.
- [x] 4.7 Serialize admitted load/save operations, retain save failures truthfully, and allow a caller to retry while the live owner remains valid.
- [x] 4.8 Close admission synchronously on the first `dispose()`, wait for earlier admitted work, destroy coordinator caches/listeners once, and return one stable terminal promise to all dispose callers.
- [x] 4.9 Reject post-dispose load/save without touching the store, and prove disposing one owner does not poison another owner on the same store.
- [x] 4.10 Keep the isolated surface free of `mount`, `suspend`, `resume`, React root, Surface, editor-manager, command, revision, idempotency, draft, conflict, and autosave behavior.
- [x] 4.11 Prove headless creation acquires none of the C6 timer, Worker, audio-context, object-URL, compositor, shared-GPU, session-store-binding, or `EditorCore` owners.
- [x] 4.12 Run focused headless contract, missing-project, cross-project, serialization, retry, concurrent-dispose, and post-dispose tests GREEN.

## 5. Prove durable data fidelity and browser-mechanism exclusion

- [x] 5.1 Build one deterministic semantic fixture that seeds an encoded project with valid known data, a nested unknown provider sentinel, and distinct seed/edit timestamps and names.
- [x] 5.2 Seed a separate project attachment with opaque metadata and deterministic body bytes, and record its pre-edit digest.
- [x] 5.3 Run first-owner load, local known-field edit, save, and awaited disposal through only the isolated headless contract.
- [x] 5.4 Create a genuinely new second owner/coordinator over the same in-memory store and prove it observes the edited value rather than the first owner's cache.
- [x] 5.5 Inspect the durable record after reopen and prove the unknown nested provider sentinel remains structurally equivalent.
- [x] 5.6 Read the unrelated attachment after both disposals and prove its key, schema version, opaque metadata, and body digest remain equivalent.
- [x] 5.7 Prove project and attachment records remain in the store after every headless owner is disposed.
- [x] 5.8 Run the same fixture with throwing browser-global sentinels in Node and prove no browser store, IndexedDB, OPFS, filesystem, network, or navigation path is accessed.
- [x] 5.9 Emit a stable machine-readable semantic result containing store/owner IDs, seed/edit/reopen values and digests, opaque/attachment proof, disposal outcomes, mount count, and errors.
- [x] 5.10 Unit-test the semantic evaluator against no-edit, no-second-owner, wrong-store, missing-digest, copied-result, post-dispose-write, and unhandled-error fixtures.

## 6. Define one attributable emitted-closure envelope and checker

- [x] 6.1 Define a versioned Host-neutral graph envelope with producer, Host, exact entry/root, accepted HEAD/tree, build marker/ID, output files/chunks, file digests, module count, normalized module IDs, and canonical set digest.
- [x] 6.2 Normalize repository, dependency, package-manager, virtual, query/hash, Windows/POSIX, and case-sensitive identities without dropping information needed by rules.
- [x] 6.3 Require every listed module to be reachable from the exact application root and assigned to emitted output; fail when the producer cannot establish either property.
- [x] 6.4 Require the isolated headless export/factory, shared migration gate, persistence coordinator, codec/opaque overlay path, Host/store contract, in-memory store, and semantic fixture in both clean closures.
- [x] 6.5 Reject an absent/duplicated/wrong root, zero modules, count mismatch, missing/truncated file/chunk/map inventory, malformed schema, or missing critical root before reporting forbidden-module absence.
- [x] 6.6 Add React-family rules for `react`, `react-dom`, JSX runtimes, React server runtimes/components, React-attributable scheduler paths, aliases, virtual/query variants, and package-manager layouts.
- [x] 6.7 Reject React-bearing session/provider/Host/Surface barrels, full `EditorCore`, and browser-store modules even if a direct React package ID is absent.
- [x] 6.8 Recompute file and canonical module-set digests during checking and reject stale marker/base, altered artifact, copied Host envelope, or result/graph identity mismatch.
- [x] 6.9 Keep graph absence proof mechanical over emitted module IDs; add a test proving source grep or an import-list manifest cannot satisfy the envelope.
- [x] 6.10 Create focused positive fixtures and negative fixtures for every anti-vacuity, normalization, forbidden-module, attribution, and cross-Host rule.
- [x] 6.11 Ensure each negative-control test is green only when the ordinary checker exits nonzero for the intended named rule, not when collection/build crashes.
- [x] 6.12 Publish stable checker JSON plus human-readable output with rule IDs, offending module IDs, graph digest, and exit semantics suitable for CI and evidence review.

## 7. Build and execute the dedicated Vite headless path

- [x] 7.1 Add a dedicated Vite headless entry/config that imports only the isolated headless path, in-memory Host/store fixture, and result reporter; do not reuse the ordinary React application entry.
- [x] 7.2 Give the headless build one explicit application façade, unique validated output directory, unique marker, accepted base identity, and no React plugin requirement unless proven build-only and absent from the closure.
- [x] 7.3 Extend or wrap the Rollup module-graph producer to collect exact modules from chunks attributable to that façade and emit the shared graph envelope with artifact digests.
- [x] 7.4 Add a proof-only alias/module that is neutral in clean builds and imports React in negative builds while preserving the same exact entry/root.
- [x] 7.5 Fresh-build the React-injected Vite control in its own directory, collect it with the ordinary producer, and require the shared checker to name the React violation.
- [x] 7.6 Run empty, missing-root, wrong-entry, stale-marker/base, mutated-digest, and cross-Host Vite envelope controls through the ordinary checker.
- [x] 7.7 After controls, create a new clean Vite artifact and require all critical roots plus zero forbidden rules.
- [x] 7.8 Serve and run the clean artifact in an isolated browser context, execute the semantic round trip, and observe zero React root/Surface mounts plus zero console/network/unhandled errors.
- [x] 7.9 Record Vite entry/marker/base, output and graph digests, store/result identity, owned server/browser PIDs, port, console/network observations, and cleanup without recording secrets.
- [x] 7.10 Terminate only owned Vite/browser processes in `finally`, confirm port release, and save cleanup evidence on both success and failure.

## 8. Replace the C7 Next measurement with an exact per-entry closure

- [x] 8.1 Add a dedicated non-React Next headless adapter that runs the same semantic fixture and returns its stable structured result without rendering a page or React Surface.
- [x] 8.2 Choose and document the narrowest proof-build compilation hook that exposes emitted module/chunk dependency edges rooted at the exact headless application module; an NFT/manifest/source-map union alone is forbidden.
- [x] 8.3 If an explicit proof-only Next/webpack mode is needed, isolate it behind C7 environment/config and keep the normal default `next build` path untouched and independently tested.
- [x] 8.4 Locate the exact root exactly once, traverse only its outgoing dependency closure, intersect with modules assigned to emitted chunks, retain dependency/virtual IDs, and emit the shared graph envelope/digests.
- [x] 8.5 Fail collection when the root is absent/duplicated/not emitted, when dependency reachability is unavailable, or when a source file list is substituted for compiler graph membership.
- [x] 8.6 Preserve the existing editor collector/callers if shared utilities are refactored; characterize and regression-test their prior output shape without treating their zero-React result as C7 evidence.
- [x] 8.7 Add the same proof-only neutral/React alias at the exact Next headless root and fresh-build the React-injected control into a unique dist directory.
- [x] 8.8 Require the per-entry collector to include the injected React dependency and the shared checker to name the same forbidden rule used for Vite.
- [x] 8.9 Run empty, missing-root, wrong-entry, stale-marker/base, altered-digest, aggregate-only, and copied-Vite Next controls through the ordinary collector/checker path.
- [x] 8.10 After controls, fresh-build a clean instrumented Next artifact in a distinct dist directory and require critical-root presence, emitted membership, exact attribution, and zero forbidden rules.
- [x] 8.11 Serve/request the clean Next adapter from an owned process/port and prove the semantic round trip with an independent Next marker/build ID/result and zero mount attempts or unhandled errors.
- [x] 8.12 Terminate only the recorded Next PID, confirm port release, and save compiler mode, entry, build/output/graph digests, request result, logs, and cleanup without exposing environment values.

## 9. Cross-check independent Host results and rebuild clean after controls

- [x] 9.1 Validate Vite and Next results through one semantic evaluator while requiring distinct Host, build, marker, output, process, and graph identities.
- [x] 9.2 Compare the deterministic edit/reopen, opaque sentinel, and attachment digest outcomes across Hosts without allowing one Host's JSON to satisfy the other.
- [x] 9.3 Require both clean graphs to contain the same critical headless behavior roots while allowing documented build-system-only modules.
- [x] 9.4 Prove Vite browser execution mounted zero React roots and Next server execution did not render or import a React Surface.
- [x] 9.5 Reject Host fallback, browser-store use, no actual edit, no second owner, mismatched project ID, incomplete disposal, missing digest, or any unhandled error.
- [x] 9.6 Rebuild and rerun each accepted clean artifact after all React and integrity controls; never promote a control output directory.
- [x] 9.7 Save a cross-Host evidence index mapping each headless-editing scenario to exact JSON/checker/test records and commands.
- [x] 9.8 Have a non-author inspect both raw graph envelopes and runtime JSON for anti-vacuity and attribution before regression acceptance.

## 10. Rerun ordinary Vite/Next Hosts and every C3-C6 invariant

- [x] 10.1 Force a fresh ordinary Vite production build with its own marker/output and rerun distributable, asset, Worker, Host-composition, browser-store, and runtime behavior gates.
- [x] 10.2 Force a fresh normal default Next production build in a separate dist directory with the required environment names and rerun production Host, asset, Worker, browser-store, and runtime behavior gates.
- [x] 10.3 Prove neither ordinary Host falls back to the C7 in-memory store and that browser durable data still survives UI session disposal/recreation.
- [x] 10.4 Rerun C3 one-handle-per-session, stale-generation, WebGL-one-preview, and WebGPU-two-preview distinct-backend/disposal jobs.
- [x] 10.5 Rerun C4 asset resolution, Host Worker, production role composition, forced-none allocation-free, and degraded-renderer gates.
- [x] 10.6 Rerun C5 store conformance, opaque round trip, attachment/library cascade and migration recovery, topology authorization, independent Host evidence, and production store identity gates.
- [x] 10.7 Rerun C6 lifecycle serialization, five-class acquisition boundary, positive CREATED counts, leak controls, multi-cycle Vite/Next oracles, and final-owner GPU teardown/reinitialization gates.
- [x] 10.8 Rerun full-session create/mount/suspend/resume/unmount/dispose and two-session isolation tests after migration extraction.
- [x] 10.9 Confirm headless disposal never appears as a false C6 resource report and does not change full-session release counts or durable-store lifetime.
- [x] 10.10 Save fresh ordinary Host build markers, output digests, backend/store identities, browser observations, exact test totals, inherited reds, and owned cleanup records independently of C7 headless evidence.

## 11. Complete regression, provenance, scope, and capability verification

- [x] 11.1 Run all focused headless, migration, persistence, graph producer/checker/evaluator, Vite adapter, Next adapter, and negative-control suites and save exact file/test/assertion totals.
- [x] 11.2 Run fresh Vite and Next builds before type verification and require no type diagnostic beyond the exact three inherited identities captured in task 1.9.
- [x] 11.3 Run the protected editing-parity oracle and require the pre-edit fixture blob and semantic result to remain unchanged.
- [x] 11.4 Rerun Rust/WASM source tests, generated-artifact provenance, SBOM, license, and API-surface gates without regenerating or editing protected artifacts.
- [x] 11.5 Run the complete Bun suite and require no red identity beyond the exact eight inherited placement failures and two inherited loader errors reproduced at baseline.
- [x] 11.6 Audit the final product diff against the design's expected write groups and explain or remove every unattributed path while preserving unrelated work.
- [x] 11.7 Recompute protected port/session/parity/type/Rust/generated identities and require exact equality with the task 1.4 record.
- [x] 11.8 Prove the final diff contains no public port/session/store/schema widening, S03 transaction/revision/draft work, S04 Surface contract, S05 packaging, E1/Elftia work, React-version decision, Rust/WASM change, or durable-data deletion.
- [x] 11.9 Sweep all fourteen inherited main specs in the falsification direction and record the concrete diff/build-tool edge that could invalidate each one plus the executed regression gate.
- [x] 11.10 Sweep all fourteen requirements and sixty-two scenarios in the `headless-editing` delta in the realization direction and map each to an executed test, graph, Host, control, review, or delivery artifact.
- [x] 11.11 Run strict validation for the child change and all main specs, saving exact commands, exits, and counts rather than paraphrasing success.
- [x] 11.12 Update architecture/provenance records only with observed implementation facts, exact build/compiler modes, graph schema/rules, and evidence paths; do not convert intended behavior into historical fact.
- [x] 11.13 Save a final evidence manifest with accepted child HEAD/tree, changed paths, commands, exit codes, exact totals, inherited-failure identities, markers, digests, and artifact paths.

## 12. Obtain independent Sol review and clean re-review

- [x] 12.1 Give a fresh non-author Sol reviewer the proposal, design, delta spec, tasks, exact base, final diff, RED/GREEN evidence, both Host raw graphs/results, every negative control, regression record, and inherited-red manifest.
- [x] 12.2 Require the reviewer to audit the Next per-entry collector for emitted membership, exact root reachability, dependency retention, required-root anti-vacuity, and React-injection sensitivity rather than trusting `react=0`.
- [x] 12.3 Require the reviewer to audit the isolated API for React/barrel leakage, S03 scope creep, migration duplication, save/dispose races, fallback store use, and opaque/attachment loss.
- [x] 12.4 Triage every review finding with severity, evidence, and disposition; do not advance with any open Blocker or Major.
- [x] 12.5 Have Sol implement every accepted product/tooling fix with a focused failing reproduction and new GREEN evidence; Luna remains excluded from product fixes.
- [x] 12.6 Give a fresh non-author Sol reviewer the post-fix delta plus prior findings and repeat until the delta is clean.
- [x] 12.7 Rerun every control or regression gate affected by review fixes and update evidence without overwriting earlier truthful records.
- [x] 12.8 Mark implementation verification complete only after every pre-delivery scenario is executed, the three delivery scenarios are explicitly retained for their later ship/integration/archive leaves, both clean Host artifacts were rebuilt after controls, strict validation passes, and review is clean.

## 13. Keep Luna-xhigh ship and archive as separate leaves

- [x] 13.1 After task 12.8 only, assign a separate Luna-xhigh local-ship leaf; it may inspect/verify and create the child commit but may not implement or repair product code. Assignment evidence: `evidence/c7-ship-deferred-luna-xhigh-20260805.md`; the external quota gate rejected execution before any repository action.
- [x] 13.2 Have the Luna-xhigh shipper reconfirm exact base ancestry, clean protected identities, attributed diff, strict validation, fresh accepted evidence, and no open Blocker/Major.
- [x] 13.3 Create only the verified C7 local child commit on `feat/s02-headless-editing`, record its commit/tree, and do not push, open a PR, integrate, sync specs, or archive from the ship leaf.
- [x] 13.4 Return the shipped child identity and evidence manifest to LEAD for serial portfolio integration after C6.
- [x] 13.5 Have LEAD integrate the exact child commit, resolve only attributable conflicts, and record the new integrated HEAD/tree rather than rewriting child evidence.
- [x] 13.6 Rerun conflict-sensitive headless semantic/graph controls, shared migration, ordinary Host/storage/runtime/disposal, fresh build/type, and full-suite gates on the integrated identity.
- [x] 13.7 Sync `headless-editing` into the main specs only after integrated acceptance, preserve the fourteen-spec falsification sweep, and strict-validate the resulting fifteen-spec corpus.
- [x] 13.8 Assign archive to a different separate Luna-xhigh leaf only after integration, spec sync, strict validation, and durable integrated evidence are complete. **2026-08-08 policy change:** the user replaced Codex/Luna with Claude Code for all remaining S02 work; the archive is assigned to a non-author Claude Code agent (distinct from the Codex/Sol implementer and reviewer), preserving the separate-non-author-leaf intent. Prerequisites (integration `be9cfc4e`, spec sync, strict validation, integrated evidence) are all complete.
- [x] 13.9 Have the archive leaf perform pre-archive verification only: confirm the proposal, design, and spec artifacts are complete; confirm every prerequisite checkbox through 13.8 is complete; verify evidence truth and strict validation; and record archive readiness without invoking archive, editing product code, rewriting history, or inventing verification. **2026-08-08:** recorded in `evidence/c7-pre-archive-verification-20260808.md`; spec delta/main verified identical (14 req / 62 scenarios); strict validation re-run PASS; archive dry-run planHash `3fe377f9` reviewed.

13.10 **Engine-owned archive postcondition (non-checkbox; evaluated only after 13.9):** Actual archive completion and return of control to LEAD are satisfied only when all three engine outputs exist and agree: the archived `archive.json`, the finalized `evidence/ship-log.md` `## Archive` section, and a successful archive-engine result recording the archive path/identity. This postcondition is evaluated after the checklist is complete, is not a prerequisite checkbox, and does not authorize E1 or later-slice scope.
