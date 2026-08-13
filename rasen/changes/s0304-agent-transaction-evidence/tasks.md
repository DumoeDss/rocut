## 1. Corpus schema, loader, and load-time refusals

- [x] 1.1 Create `apps/web/src/editor/contracts/vectors/**` with the corpus schema types, the `transaction-vectors/v1` schema identifier, and the two declared families (document vectors with an explicit initial document, scenario vectors with an ordered relative step plan)
- [x] 1.2 Implement a loader that validates every vector against the schema and rejects a non-integer tick value, a non-finite number, an unknown operation kind, an unknown error code, a duplicate vector id, or a vector whose expectation set is empty
- [x] 1.3 Implement the manifest generator recording every corpus file, its SHA-256, the declared vector count, and the corpus digest; make the loader reject bytes that do not match the manifest and reject a declared count that differs from the files present
- [x] 1.4 Author the first corpus: document vectors for read/apply/atomicity/conflict/error-code/watch/clone cases and for each placement issue code; scenario vectors for the keyed-replay and same-key-reuse idempotency cases, which need two applies against one target and so cannot be expressed as a single-batch document vector; plus the scenario-family vector the Agent executes
- [x] 1.5 Add loader tests for every refusal path, each asserting the structured failure names the offending vector id and field, and prove no refusal path can return a skipped-or-passing vector

## 2. Coverage derived from the frozen contract

- [x] 2.1 Implement coverage by intersecting the parsed corpus with the contract's exported `OPERATION_KINDS`, exported `TransactionErrorCode` members, and exported `TransactionEngineIssueCode` members, reporting the covering vector ids per member
- [x] 2.2 Fail the corpus gate on any exported member with no covering vector, naming the member; do not require exact-count equality, so redundant vectors remain permitted
- [x] 2.3 Add the negative control: a fixture corpus with every vector for one operation kind removed must fail the gate naming that kind
- [x] 2.4 Add the converse control proving the gate reads the contract — a control whose exported constant set carries one synthetic extra member must fail for that member — and a control proving a redundant extra vector does not fail the gate
- [x] 2.5 Assert the published corpus advertises all twelve operation kinds, so the canonical twelfth-operation Agent-evidence scenario is satisfied by measurement rather than by prose

## 3. The published runner and its control matrix

- [x] 3.1 Implement `runTransactionVectors({ corpus, open, filter? })` as a plain async function with no React, Electron, Host-port, test-framework, or file-system dependency, returning per-vector status, per-vector executed-comparison count, and the coverage report
- [x] 3.2 Implement the fail-closed rules: empty corpus or empty filter match is a refused scan; executed count below declared count is drift; a vector that performed zero comparisons is a failure; a non-seedable target reports its whole family `unsupported` and cannot yield a `passed` family verdict
- [x] 3.3 Run the runner green against `createInMemoryTransactionStore` and against a durable engine opened over S02's in-memory `ProjectStore` with T1's native adapter, recording executed counts and comparisons
- [x] 3.4 Build the mutation matrix — stale-revision, non-atomic-batch, idempotency-ignoring, watcher-on-rejection, uncloned-read, and placement-waiving wrappers — and assert each fails exactly its declared set of vector ids, neither fewer nor more
- [x] 3.5 Build the conforming-variant converse control — different `changedIds` ordering, extra optional fields, different internal storage — and require every vector to pass, so the corpus is proven not to over-constrain implementations
- [x] 3.6 Add runner tests for the filter-matching-one case, the drift case, the zero-comparison case, and the unsupported-family case, each asserting the reported verdict rather than only the exit status

## 4. Boundary enforcement over published vector data

- [x] 4.1 Extend `script/check-transaction-boundary.mjs` to enumerate the corpus `.json` files alongside contract `.ts`/`.tsx` modules, and report both counts in its scan line
- [x] 4.2 Add data rules rejecting donor schema field names, command-class names, editor state-store and Zustand identifiers, IndexedDB/OPFS identifiers, provider-namespaced keys, and physical storage paths in any vector key or value
- [x] 4.3 Add one negative fixture per new rule, each violating exactly one rule, and assert each is caught by its own rule
- [x] 4.4 Add converse fixtures containing `track`, `clip`, `asset`, `marker`, `project`, and a video-kind asset, and assert no rule fires on the contract's public vocabulary
- [x] 4.5 Make the extended check exit non-zero when it matched zero corpus files, mirroring the existing zero-module refusal, and prove that refusal with a control

## 5. The Host-neutral Agent scenario and its Node drivers

- [x] 5.1 Author one Host-neutral Agent scenario definition: create tracks, create assets, create clips, move, trim, split, one typed `update-project` patch, keyed replay, same-key/different-payload reuse, and one stale `expectedRevision`
- [x] 5.2 Constrain the scenario to the public typed surface — no donor schema import, no command class, no direct persistence save, no provider-private invocation — and assert that constraint mechanically over the scenario module's imports
- [x] 5.3 Define the ledger schema: declared step plan plus, per step, id, base revision, result revision, revision delta, apply count, durable-save count, watcher count, assertion count, and verdict
- [x] 5.4 Implement the Node driver over the in-memory transaction store and the Node driver over the durable engine, both emitting the ledger and both running without React, Electron, or a browser
- [x] 5.5 Assert per-step outcomes: accepted steps advance revision by exactly one and read back their created/changed entities field by field; rejected steps produce zero revision delta, zero durable save, and zero watcher notifications
- [x] 5.6 Add the accounting controls: a zero-assertion step fails the run, an executed step count differing from the declared plan fails the run, and a missing ledger fails the run

## 6. Dual-Host browser evidence through the shared harness

- [x] 6.1 Add a scenario parameter inside the shared evidence harness that selects the agent scenario, leaving the default Surface-evidence path behaviourally unchanged, and change no Host page, Host composition root, or Vite entry list
- [x] 6.2 Drive the browser scenario through `editorForSession(session).transactions` — the same canonical facade T3 routes UI commits through — over each Host's real project store, opening no sibling engine
- [x] 6.3 Emit the agent ledger from the harness into its own `data-testid` output so the driver reads asserted state rather than console text or screenshots
- [x] 6.4 Add one Playwright spec beside the existing parity/surface specs that runs the scenario on both production Hosts, writes per-Host ledgers and results, and fails when either Host did not execute
- [x] 6.5 Prove the browser run creates asset catalog metadata only, and record explicitly that no attachment-byte atomicity is claimed

## 7. Durability across save and reopen, with controls

- [x] 7.1 After the apply phase, record the committed revision and every created identity, perform a full page reload, and open a fresh session over the same durable store
- [x] 7.2 Assert the reopened engine reports the exact recorded revision and that every committed track, clip, asset, marker, and patched Project field is present with its committed value
- [x] 7.3 Add the stale-reopen negative control: asserting against a revision one lower than committed must fail the reopen step
- [x] 7.4 Add the injected-durable-failure control: a declared step whose save rejects must leave revision, reads, and watcher count unchanged, must be reported failed rather than skipped, and must not prevent a later step from committing
- [x] 7.5 Add the delayed-store converse control: the same scenario against a deliberately delayed save must reach the same verdicts, proving the driver waits on observable committed state rather than on fixed delays

## 8. Verification, falsification, and scope gates

- [x] 8.1 Run the focused Bun suites for the loader, coverage gate, runner, mutation matrix, converse control, scenario definition, and Node drivers; require non-zero executed counts and zero failures
- [x] 8.2 Run `node script/check-transaction-boundary.mjs` and `--negative-control`, including every new corpus rule with its negative and converse fixtures
- [x] 8.3 Run `node script/check-type-baseline.mjs` and hold at or below the pinned ceiling of 3 without regenerating the fixture; run changed-file ESLint
- [x] 8.4 Build `apps/web` and `apps/vite-example`, run `check-distributable-boundary.mjs` with its ten rules intact, and confirm no editor module imports the corpus so it does not enter the distributable graph
- [x] 8.5 Re-run the R2-pinned React-singleton, Surface CSS, portal, and private-drag checks as controls proving the harness parameter disturbed nothing
- [x] 8.6 Run the established normalized editing parity scenario on both Hosts and require the snapshot unchanged; T4 changes no editing behaviour, so any movement is a defect rather than an accepted update
- [ ] 8.7 Regenerate `SOURCE_INVENTORY.{md,json}` with the committed generator rather than by hand
- [x] 8.8 Sweep every canonical `rasen/specs/*/spec.md` present at verification time for falsified SHALL/MUST assertions, reconciling `headless-editing` (no transaction or revision API on the headless surface), `developer-reproducibility` (export inventory and documented path), `next-free-distributable-boundary`, `editing-parity-fixture`, and the complete updated `transaction-automation-api` explicitly
- [x] 8.9 Hash the product, check, corpus, and harness set before the builds and again after the browser runs, and require equality; record build markers, owned ports, server identity, commands, ledgers, results, and artifact SHA-256 values
- [x] 8.10 Audit the T4 diff for declared scope: no T0/T1/T2/T3 contract, engine, Draft, router, command, or persistence change; no `ProjectStore` widening; no Host composition root, Host page, Surface component, Rust/WASM, package-boundary, parity-oracle, or type-baseline fixture change
- [x] 8.11 Run `rasen validate s0304-agent-transaction-evidence --strict --project rocut --json` and resolve every artifact and spec issue before implementation is reported ready
