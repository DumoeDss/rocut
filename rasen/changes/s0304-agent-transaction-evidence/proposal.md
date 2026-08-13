## Why

T0 froze the transaction contract, T1 made it durable, T2 added Drafts and T3 routed the UI commit path through the same engine — but every proof of those semantics is a TypeScript module inside this repository, runnable only by whoever can build this tree. Target State §5.1 requires the public contract to ship "versioned wire-safe schemas and conformance vectors", and Slice §3.5 requires an Agent run with per-step revision assertions plus save/reopen confirmation. Neither exists. T4 is the last child of the transaction line: without it, M3's automation claim rests on in-repo unit evidence and no third party can decide whether their implementation conforms.

## What Changes

- Publish a versioned, wire-safe JSON **conformance-vector corpus** under the contract tree, with a self-describing manifest, per-file and corpus digests, and a schema that admits only wire-safe values (integer `MediaTime` ticks, closed operation kinds, closed error codes — no branded or TypeScript-only construct at rest).
- Split the corpus into two declared families: **document vectors** (an explicit initial document plus one batch and its expected result or structured rejection) and **scenario vectors** (an ordered step plan starting from whatever document the target already holds, asserting relative outcomes — revision deltas, created/changed identities, error codes).
- Derive corpus **coverage mechanically from the contract's own exported constants** (`OPERATION_KINDS`, the `TransactionErrorCode` union, the engine issue-code union) rather than from a duplicated literal list, and fail the corpus when a kind or code the contract exports has no vector.
- Ship `runTransactionVectors` as a plain async function with no React, Electron, Host-port or test-runner dependency, returning per-vector pass/fail/skip plus a coverage report. An empty or fully filtered corpus, an executed count below the declared count, or a vector that performed no comparison is a **failure**, never a pass; a target that cannot accept a seeded document reports its whole family `unsupported` rather than partially passing.
- Add a mutation-control matrix: deliberately non-conforming target wrappers must fail an exactly declared set of vector ids, and a conforming-but-differently-shaped implementation must pass every vector, so the corpus is proven both sensitive and not over-constraining.
- Extend `script/check-transaction-boundary.mjs` to scan published vector JSON as well as `.ts`/`.tsx`, with negative fixtures per rule and converse fixtures proving the new rules do not fire indiscriminately.
- Add one Host-neutral **Agent scenario definition** — create tracks/assets/clips, move/trim/split, one typed `update-project` patch, keyed replay, same-key/different-payload rejection, expected-revision conflict — executed by three drivers from the same definition: Node against the in-memory fake, Node against the durable engine, and the browser against the real session engine facade on both production Hosts.
- Run the browser drivers through the **existing shared evidence entry**, selected by a scenario parameter inside the shared harness component, so neither Host composition root, Host page, nor Vite entry list changes.
- Prove durability by a full page reload and a fresh session over the same durable store observing the exact committed revision and the scenario's own entities, with declared negative controls (injected durable failure, stale reopen) that must fail their named step.
- Record a machine-readable per-step ledger — base revision, result revision, apply/save/watch counts, assertion count — and fail the run when a step asserted nothing, when executed steps differ from the declared plan, or when either Host did not execute.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `transaction-automation-api`: require a published versioned wire-safe vector corpus with mechanically derived coverage, a repository-independent vector runner with proven sensitivity and specificity, provider-identity exclusion over published vector data, and a dual-Host Agent scenario whose durability evidence survives save and reopen and cannot pass vacuously.

## Impact

- Product touch set: new `apps/web/src/editor/contracts/vectors/**` (schema, loader, runner, coverage) and its committed JSON corpus; new Host-neutral Agent scenario module and its Node drivers; a scenario switch plus agent ledger inside the existing shared evidence harness under `apps/web/src/editor/surface/evidence/**`; one new Playwright spec beside `apps/vite-example/tests/parity/**`; `script/check-transaction-boundary.mjs` and its control fixtures.
- No change to T0's contract types, T1's engine, T2's Draft surface, T3's donor router/commands/persistence, S02's Host ports or session factory, either Host composition root, the React Surface line, Rust/WASM, or package boundaries. The corpus is data no editor module imports, so the distributable module graph gains the runner only if a Host chooses to use it.
- The Agent scenario writes project-record asset **metadata** through typed operations; it makes no claim that attachment bytes committed in the same save.
- Verification must preserve both Host builds, the normalized editing parity oracle, the transaction-boundary negative control, the type-baseline ceiling of 3, the regenerated source inventory, and every current capability-spec assertion — including `headless-editing`'s requirement that the headless surface expose no transaction or revision API.
