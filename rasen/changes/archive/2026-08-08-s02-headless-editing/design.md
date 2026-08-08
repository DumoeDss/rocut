## Context

C7 is the final S02 child. Its accepted product base is HEAD `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf`, tree `885d307814260b77397c2c2677b9361fdfc5f5e2`, after C6 integration. The current `createEditorSession()` is deliberately a full editor lifecycle: after migration it binds session stores and acquires an `EditorCore` through `session-core-owner`. That graph reaches UI/render managers (including a `sonner` dependency) and owns C6 resources, so it is not a truthful data-only entry and cannot be made the C7 proof merely by omitting `mount()`.

C5 already supplied the deeper reusable seam. `SessionPersistenceCoordinator` imports no browser mechanism, loads and saves `TProject` values through `ProjectStore`, overlays known encoded data onto retained opaque provider data, serializes durable writes, and can be destroyed cheaply. `InMemoryProjectStore` supplies the required non-browser implementation. The remaining migration-once logic is React-free in behavior but is private inside the full session factory, so using it from C7 requires extraction rather than duplication.

The emitted-graph measurement also has a known RED. The existing Next collector unions route files, client-reference metadata, NFTs, and source maps; a read-only reconnaissance saw a large UI-route inventory report zero `react`/`react-dom` IDs. That result is not evidence that the UI route is React-free. C7 therefore must first replace this aggregation for its own proof with an exact application-entry closure, assert required modules are present, and demonstrate that a real injected React import is detected.

No C7 office-hours override exists. Authority is the S02 Target State, Roadmap, Slice specification, corrected Slice plan, planning context, and the accepted base above, in that order.

### Design-it-twice comparison

| Approach | Boundary depth | Benefits | Rejection / selection reason |
| --- | --- | --- | --- |
| Reuse full `createEditorSession()` but never call `mount()` | Shallow; React and resource-heavy transitive composition remains | Little new code | Rejected. Absence of a mount call does not remove `EditorCore`, notification, renderer, audio, or React-family modules from the emitted graph, and it acquires resources irrelevant to load/save. |
| Expose `ProjectStore` or a general mutable transaction API directly to consumers | Shallow storage wrapper or premature public API | Easy fixture code | Rejected. It leaks provider-private schema/store concerns and preempts S03 transactions, revisions, idempotency, and drafts. |
| Add a provider-private headless session over the existing persistence coordinator | Deep module with a small load/save/dispose surface | Reuses migration and opaque round-trip semantics, hides Host/store composition, and stays independently measurable | Selected. The caller edits its detached `TProject` value between `load` and `save`; C7 does not define transaction semantics. |

For measurement, source grep and the current aggregated Next collector are rejected. The selected design records the emitted dependency closure rooted at one named headless application entry in each build system, then applies one shared anti-vacuity and React-family checker to those records.

## Goals / Non-Goals

**Goals:**

- Load an existing project, alter a bounded known field, save, dispose, and reopen the durable result with no React Surface mounted.
- Use the C5 non-browser store and the same once-per-store migration gate as a full session while preserving opaque project data and unrelated attachment bytes.
- Provide an isolated headless import surface whose emitted application closure contains the expected persistence/Host modules and no React-family module.
- Execute and attribute independent fresh Vite and Next headless artifacts, with real React-import and evidence-integrity negative controls.
- Preserve all C3-C6 session isolation, Host composition, browser persistence, runtime asset, disposal, provenance, protected-oracle, and inherited-failure identities.

**Non-Goals:**

- Defining S03 public edit transactions, revisions, command idempotency, drafts, conflict handling, or autosave.
- Defining the S04 React Surface contract, choosing React 18 versus 19 for D2/E1, packaging the editor for S05, or changing Elftia.
- Adding a new public Host port, changing `EditorSession`, `ProjectStore`, provider schema, Rust/WASM APIs, generated WASM, or the protected parity/type fixtures.
- Proving export quality, performance budgets, crash recovery, browser storage from the headless path, or UI behavior from the headless entry.
- Treating a source import scan, a unioned route inventory, an old build directory, or an unexecuted scenario as acceptance evidence.

## Decisions

### 1. Freeze the exact C6-integrated base and keep C7 additive

Implementation starts only from the accepted HEAD/tree/branch/worktree identity in the proposal. The implementer records the clean tracked status, complete pre-existing diff, protected identities, fresh-build prerequisites, and exact inherited test/type failures before RED work. A base mismatch, unexplained protected change, or changed inherited-red identity stops implementation rather than silently rebasing this design.

The headless path is additive. `EditorSession`, `EditorHost`, `EditorHostPorts`, `ProjectStore`, persistence record formats, resource report shapes, Rust/WASM exports, and generated artifacts remain unchanged. Existing Vite and Next application entries continue to compose their production Hosts and `BrowserProjectStore` exactly as before.

### 2. A dedicated headless session owns data coordination but not UI resources

Add a React-free implementation module and an isolated import surface, nominally:

```ts
// apps/web/src/editor/session/headless.ts -- contains no React exports
export interface HeadlessEditorSession {
  readonly id: SessionId;
  readonly projectId: ProjectId;
  load(args?: { signal?: AbortSignal }): Promise<TProject | null>;
  save(args: { project: TProject; signal?: AbortSignal }): Promise<void>;
  dispose(): Promise<void>;
}

export function createHeadlessEditorSession(args: {
  host: EditorHost;
}): Promise<HeadlessEditorSession>;
```

The implementation may split the type and factory into nearby files, but the isolated `headless.ts` path is the only entry used by proof harnesses. It must not re-export or import the existing `session/index.ts`, `EditorSessionProvider`, `EditorSessionHost`, `EditorCore`, managers, Surface modules, resource owners, JSX, or React.

The factory resolves the already-complete Host, obtains a session ID from `host.ids`, runs the shared migration gate, and creates one `SessionPersistenceCoordinator` over `host.store`. `load()` is scoped to `host.projectId` and returns the coordinator's detached clone. The caller can change that detached provider-private `TProject` (the acceptance fixture renames the project and updates its timestamp) and pass it to `save()`. `save()` rejects a mismatched project ID and delegates durable serialization to the coordinator. There is deliberately no `mutate`, command, revision, draft, or generic transaction method.

Operations are admitted and serialized by the headless owner. `dispose()` closes admission synchronously, joins prior accepted work, destroys the coordinator exactly once, and returns one stable promise to concurrent callers. Later load/save calls reject. Disposal does not delete the store, project, attachments, or library data and does not construct or report any C6 timer/Worker/audio/object-URL/GPU resource.

Alternative: make the full `EditorSession` interface optional or add `load/save` to it. Rejected because it widens a frozen public lifecycle with provider-private project data and makes no-React consumers import the React-bearing session barrel.

### 3. Extract one React-free migration gate and preserve its exact semantics

Move `MigrationFailedError`, the `WeakMap` promise memo, and the migration orchestration into a small React-free session/persistence module. Both `createEditorSession()` and `createHeadlessEditorSession()` call it before project load or editor construction. Preserve all existing event/progress payloads and error identity, and re-export any direct legacy import needed for compatibility.

The shared gate remains once per store identity, concurrent callers join the same in-flight promise, a successful/no-op run stays memoized, and a failed run is removed so a later factory retries. Tests must run a full/full, full/headless, and headless/headless concurrency matrix plus a fail-then-retry case. Duplicating a second `WeakMap` or letting the headless path bypass migration is forbidden.

Alternative: invoke a temporary full session solely for migration. Rejected because it acquires the very UI/runtime graph C7 must exclude.

### 4. The acceptance round trip uses the non-browser store and proves data fidelity

The shared semantic fixture creates an `InMemoryProjectStore` (optionally injected through `createInMemoryHost`), seeds one valid encoded project containing a known field plus an unknown nested provider sentinel, and seeds a separate attachment with known metadata and byte digest. No `BrowserProjectStore`, IndexedDB, OPFS, filesystem, network persistence, or production Host fallback is allowed in the headless execution.

The first headless session loads the project, changes only the selected known field/timestamp, saves, and disposes. A newly created second headless session over the same store loads the project. Acceptance requires the edit to survive, the unknown provider sentinel to remain byte/structure-equivalent, the attachment metadata/body digest to remain unchanged, and the store's durable record to remain present after both owners dispose.

Focused Node tests install throwing browser-global sentinels (for example `document`, `window`, `indexedDB`, and OPFS access when definable) before importing/executing the isolated entry. A clean run must not touch them. Vite browser evidence separately proves that running in a browser does not imply mounting a React root.

### 5. Vite uses a single-purpose fresh headless build and exact emitted IDs

Add a dedicated Vite headless entry/config rather than reusing the ordinary React application entry. It runs the shared semantic fixture, publishes a machine-readable result for the harness, and uses a unique output directory and marker. The build contains one application entry, so the Rollup output chunks attributable to that façade form an exact closure. Extend or wrap the existing module-graph plugin to emit a versioned envelope containing the exact entry ID, Host kind, marker, base HEAD/tree, chunk/file digests, module count, and normalized emitted module IDs. Virtual IDs, query suffixes, dependency paths, and case differences remain inspectable.

The accepted Vite artifact is built after deleting only its validated C7 output directory. It is executed in an isolated browser context. Evidence records the semantic result, no mounted React root, console/network/unhandled errors, owned process/port identities, output digests, graph digest, and cleanup. The ordinary Vite production build and its existing Host/browser-store gates are rerun independently; the headless build cannot replace them.

### 6. Next records a per-entry emitted application closure, not the existing aggregate

Add a dedicated non-React Next headless adapter (a route handler or an equivalent server entry) that calls the same semantic fixture. The proof build uses a unique dist directory and marker and produces a graph rooted at the exact headless application module. If build-system instrumentation is required, use a conditional proof-only Next/webpack build and compilation module/chunk graph; do not infer closure from source imports or from the existing editor route's union of NFTs, client manifests, and source maps. A normal fresh default Next build remains a separate Host regression gate.

The collector must follow only emitted dependency connections reachable from the named headless application root, intersect them with modules assigned to emitted chunks, retain dependency/virtual IDs, and write the same versioned envelope as Vite. It must fail if the root is absent, duplicated, not emitted, mapped only through a source file scan, or cannot be associated with the recorded output digests. Framework bootstrap modules outside the application's dependency closure are not the measurement target; a React dependency reachable from the headless root is.

Before any clean claim, reproduce the current aggregate collector's inability to establish React sensitivity and save that as RED. The new per-entry collector is GREEN only after it both includes required repository modules and detects an injected React dependency. The existing `collect-next-editor-module-ids.mjs` may be generalized only if its old editor-route behavior and callers retain their prior output contract; C7 acceptance must use the new exact-root mode.

Alternative: accept the current aggregate's `react=0`. Rejected as a known false-negative-prone measure with no anti-vacuity proof.

### 7. One checker enforces anti-vacuity, React absence, and evidence integrity

Use one checker implementation and rule set for both Host graph envelopes. It first validates schema and attribution, then the closure, then forbidden modules. A pass requires:

- the expected Host, exact normalized entry ID, unique marker, accepted base HEAD/tree, non-empty emitted files/chunks, matching file and canonical module-set digests, and no missing/truncated inventory;
- required closure roots for the isolated headless export, headless factory, shared migration gate, `SessionPersistenceCoordinator`, codec/opaque overlay path, `EditorHost`/store contract, and the in-memory store/fixture;
- no React-family dependency (`react`, `react-dom`, JSX runtimes, React server components/runtime, scheduler paths attributable to React, aliases, or virtual/query/case-normalized forms), React-bearing provider/Host/Surface/barrel, full `EditorCore`, or browser-store implementation.

Required-module checks are as important as forbidden-module checks: an empty graph, an unrelated tiny entry, or an app-only filter that drops dependencies must fail before absence can be reported.

Each Host performs a separate fresh negative build of the same named entry with a proof-only alias/module that imports React. The same collector and checker must fail nonzero and name the React ID/rule. Additional controls cover an empty module set, removed required root, wrong entry, stale/wrong marker or base, altered artifact digest, and a graph copied from the other Host. Negative output lives in a distinct validated directory; the final accepted clean build is produced afterward.

### 8. Runtime proof is independent on Vite and Next

Vite and Next execute the same fixture contract but produce independent JSON with their own Host kind, build marker/ID, base, entry, store implementation identity, first-load digest, edit, reopened digest, opaque sentinel, attachment digest, disposal results, React-mount count, and error list. The evaluator rejects missing fields, Host fallback, shared marker/output, a result copied across Hosts, no actual edit, no second owner, or any unhandled error.

The Vite harness owns its server/browser processes and ports; the Next harness owns its server process and request. Each terminates only recorded PIDs and confirms port release in `finally`. A failed negative control is successful evidence only when the ordinary checker detects the intended defect; a broken build or unrelated crash is not sensitivity proof.

### 9. C3-C6 and both ordinary Hosts remain regression gates

C7 touches shared migration/session composition and build tooling, so acceptance includes focused full-session migration tests, project-store conformance, persistence opaque/cascade tests, session isolation, Host composition, C4 runtime asset/Worker/degraded-renderer behavior, C6 disposal/leak controls, and fresh ordinary Vite/Next production builds. Browser storage durability is proven by rerunning the C5/C6 production Host gates, not by substituting the in-memory headless fixture.

The protected port tree, public session-type blob, parity fixture, type baseline, Rust trees, and generated JS/WASM hashes are captured before edits and compared after. Fresh build-before-type order remains mandatory, and type acceptance permits only the exact inherited diagnostics reproduced on the accepted base. The full Bun suite may retain only the exact inherited red identities; C7 may not add, rename, or hide a failure.

### 10. Evidence follows execution and every capability is swept both ways

No task is checked and no scenario is called verified by planning alone. RED, focused GREEN, negative-control, Host runtime, graph, regression, review, ship, integration, spec-sync, and archive records are distinct artifacts with commands, exit codes, timestamps, base/tree, build markers, digests, and exact totals.

Final verification performs a two-way sweep over all fourteen pre-C7 main capabilities plus the new `headless-editing` delta: identify every existing assertion the product/tooling diff could make false, and map every new scenario to executed evidence. Main-spec sync happens only after integration acceptance. Ship and archive are separate leaves: product implementation/review remain Sol; a Luna-xhigh shipper may create only the verified local child commit, and a different Luna-xhigh archive leaf runs only after integration and spec sync.

## Expected Write Set and Serial Overlap

Expected product write groups (exact filenames may be narrowed during RED, but expansion requires attribution):

- `apps/web/src/editor/session/`: isolated headless export/implementation, shared migration gate, existing full-session call-site adjustment, focused tests.
- `apps/web/src/editor/persistence/` and `apps/web/src/editor/ports/in-memory/`: tests or minimal React-free support only; no public store contract change.
- `apps/vite-example/`: dedicated headless entry/config/harness and emitted-graph producer changes, plus tests.
- `apps/web/src/app/` and `apps/web/next.config.ts`: dedicated headless adapter and proof-only graph instrumentation where needed; no ordinary page behavior change.
- `script/`, `script/__tests__/`, and `script/fixtures/`: exact per-entry collectors/checker/evaluator, React and integrity controls, harness orchestration.
- repository scripts and architecture/provenance records only when required to expose reproducible C7 gates; no new runtime dependency is expected.

Protected/no-write groups unless a separately evidenced contradiction is escalated:

- public `apps/web/src/editor/ports` types and `session/session-types.ts`;
- protected parity and type-baseline fixtures;
- Rust source, generated JS/WASM, SBOM/license sources, and wasm API surfaces;
- ordinary production Host role selection and C5 browser-store topology;
- Elftia, E1, S03-S05, and unrelated portfolio children.

C7 is serial after the integrated C6 base. Within implementation, shared headless/migration work precedes Host adapters; Vite and Next adapters may be implemented independently only after the shared RED/GREEN contract is stable. Graph checker semantics precede both clean claims. Review precedes Luna-xhigh ship; LEAD integration precedes spec sync and the separate Luna-xhigh archive leaf.

## Risks / Trade-offs

- **[Risk] A clean graph is vacuous because dependency IDs were filtered away.** → Require exact entry identity, emitted-chunk membership, a non-empty set, named required modules, canonical digests, and a real React-import negative build on each Host.
- **[Risk] Next framework bootstrap contains React even though the headless application closure does not.** → Measure the emitted dependency closure rooted at the application module, not the whole route/bootstrap union; prove the root and every included module were emitted, and prove a React edge from that root is detected.
- **[Risk] Build instrumentation proves a custom compiler mode but ordinary Next regresses.** → Keep the proof-only instrumented build and the fresh default Next production/Host regression build as separate mandatory gates.
- **[Risk] A headless API accidentally becomes S03's public editing contract.** → Keep it on an isolated provider-private import path, expose only load/save/dispose for one Host project, and forbid commands/revisions/drafts/idempotency/public schema changes.
- **[Risk] Extracting migration logic changes full-session behavior.** → Characterize current event/error/concurrency/retry behavior in RED tests, share one implementation, and run full/full plus cross-factory matrices.
- **[Risk] Disposal races an accepted save or destroys durable data.** → Close admission first, await the serialized tail, destroy only coordinator caches/listeners, reopen with a second owner, and verify the store/attachment remain.
- **[Risk] Dedicated headless builds mask ordinary Vite/Next or browser-storage regressions.** → Rerun independent ordinary production builds and C3-C6 Host/storage/runtime/disposal gates.
- **[Risk] Old build output or copied Host JSON passes.** → Use unique validated output directories/markers, recompute file/module digests, encode Host identity, reject cross-Host markers/artifacts, and rebuild the accepted clean artifact after controls.
- **[Trade-off] Two proof builds plus two ordinary Host builds cost time and disk.** → Use validated C7-only output roots with owned cleanup, but do not weaken freshness or reuse negative output.

## Migration Plan

1. Reproduce the exact base, protected identities, current migration semantics, inherited reds, and the known graph-measurement RED.
2. Add focused failing tests for the isolated headless contract, cross-factory migration, durable reopen, browser-global exclusion, per-entry graph anti-vacuity, and React sensitivity.
3. Extract the shared migration gate and implement the headless owner over `SessionPersistenceCoordinator`; make focused Node tests green.
4. Implement the dedicated Vite and Next adapters, exact emitted-closure producers, shared checker/evaluator, and all negative controls.
5. Produce fresh clean runtime/graph evidence for both Hosts, then run ordinary Host, C3-C6, type, parity, provenance, and full-suite gates.
6. Obtain independent Sol review and clean re-review, then hand the verified child to the separate Luna-xhigh local ship leaf.
7. LEAD integrates the child onto the portfolio base, reruns conflict-sensitive evidence, syncs the new main spec, and assigns a different Luna-xhigh archive leaf.

Rollback is additive: remove the isolated headless entry, proof adapters/tooling, and shared-helper extraction while restoring the characterized full-session migration implementation. No persistent provider schema, Rust/WASM ABI, or user data migration is introduced.

## Open Questions

None are left for product semantics. During RED the implementer may choose the narrowest Next compilation hook that can emit an exact per-entry closure, but the acceptance properties above (emitted membership, required roots, React injection sensitivity, fresh attribution, and ordinary default-Next regression) are fixed and cannot be traded away.
