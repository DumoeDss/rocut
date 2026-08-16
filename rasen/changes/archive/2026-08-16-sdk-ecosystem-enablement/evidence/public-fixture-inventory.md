# Adapter-author fake and fixture inventory

Date: 2026-08-16

Baseline: `661d7ac87c3d324839d51bf30470bbf81764b694`

The inventory is scoped to fakes, controls, conformance fixtures, and helper
assembly that an adapter author could reasonably reuse. Production domain and
engine functions are included only where the existing fixture assembly relies
on them.

## `@opencut/editor-ports`

All reusable ports fixtures are already on declared entries. No ports export is
promoted by this change.

| entry/module | fake or fixture | classification | disposition |
| --- | --- | --- | --- |
| `./conformance` | `ProjectStoreConformanceControl`, `ProjectStoreConformanceFixture`, disposable migration fixture shapes | already public, frozen | Keep public unchanged. Authors pass their own fixture to the ports suite. |
| `./in-memory` | `InMemoryProjectStoreControl`, `InMemoryProjectStore`, `createInMemoryProjectStoreFixture` | already public, frozen | Keep public unchanged; reference store and failure/scheduling controls. |
| `./in-memory` | `InMemoryAssetResolver`, `InMemoryRuntimeAssetLoader`, `InMemoryWorkerHandle`, `InMemoryRuntimeResourceHost` | already public, frozen | Keep public unchanged; individual reference port implementations. |
| `./in-memory` | `UnsupportedExportProvider`, `RecordingDiagnostics`, `DeterministicIdGenerator`, `StaticEnvironmentCapabilities` | already public, frozen | Keep public unchanged; individual reference port implementations. |
| `./in-memory` | `createInMemoryPorts` | already public, frozen | Keep public unchanged; reference role composition, not a substitute for an author's ports acceptance run. |
| `./in-memory/host` | `createInMemoryHost` | already public, frozen | Keep public unchanged; complete reference Host composition. |
| ports tests | normalizing/aliasing/broken `ProjectStore` subclasses and mutation controls | internal test fixtures | Keep internal. They falsify individual suite rules and are not author setup. |

## `@opencut/editor-contracts`

| entry/module | fake or fixture | classification | disposition |
| --- | --- | --- | --- |
| `.` / `src/in-memory` | `createInMemoryTransactionStore`, `InMemoryTransactionStore` | already public, frozen | Keep public unchanged. It is the transaction-suite reference target. Do not create a parallel wrapper. |
| `./draft` / `src/draft/retention.ts` | `createInMemoryDraftResourceRetentionPolicy` and its types | already public, frozen | Keep public unchanged. The new assembly uses it internally but does not re-export it. |
| `./engine` / `src/engine/native-adapter.ts` | native document adapter and native project seed | already public, frozen production utilities | Keep public unchanged. The new assembly hides their fixture-specific invocation. |
| `src/engine/engine.ts` | `bindNativeCommittedTransactionStateCapture` | undeclared private engine binder | Keep internal. It is a native implementation detail and one of the mechanics the new module must hide. |
| `src/engine/__tests__/engine.test.ts` | ProjectStore-backed `createFactory`, placement composer, save/fail/pause/reopen observation | internal test fixture | Keep the focused engine test fixture internal; promote only the generalized assembly described below. |
| `src/draft/__tests__/draft.test.ts` | ProjectStore-backed `createFactory`, engine proxy, counters, retention setup | internal test fixture | Keep the focused draft test fixture internal; promote only the generalized assembly described below. |
| `src/conformance/requirements/__tests__/requirements-index.test.ts` | duplicated `createEngineFactory` and `createDraftFactory` | internal guard fixture, forcing consumer | Replace with the selected public assembly so the drift guard exercises the author-facing setup. |
| `src/vectors/drivers/in-memory.ts` | in-memory and non-seedable vector target factories | undeclared internal driver | Keep internal. Re-exporting it would restore the unforced `./vectors/drivers` surface removed in P5. |
| `src/vectors/drivers/durable.ts` | durable ProjectStore and durable vector target factories | undeclared internal driver | Keep internal. The new assembly implements only the existing `VectorTargetFactory` shape over an author store. |
| `src/vectors/__tests__/mutation-targets.ts` and corpus fixtures | deliberately broken target wrappers and filesystem corpus adapters | internal falsification fixtures | Keep internal. They are suite-maintainer controls, not adapter-author infrastructure. |

## Selected promotion

One entry is promoted: `@opencut/editor-contracts/conformance/fakes`.

Its only constructor is:

```ts
createProjectStoreConformanceFactories({
  createStore: () => ProjectStore | Promise<ProjectStore>
})
```

It returns only the existing frozen `TransactionEngineConformanceFactory`,
`DraftEditingConformanceFactory`, and `VectorTargetFactory` shapes (plus the
minimum named aggregate type). It does not export vector drivers, private
capture, ports fakes, transaction-store fakes, clocks, paths, or control
overrides.

The concrete forcing consumers are:

1. `templates/adapter-project/`, which must run engine, draft, and vectors over
   each author's own `ProjectStore` without copying rocut's internal fixture
   mechanics.
2. The requirement-index drift guard, which currently duplicates engine and
   draft assembly and will consume the same public helper.
3. `docs/adapter-authors/README.md`, whose supported path needs one declared
   import rather than directions through undeclared test modules.

This is the only missing public seam identified by the inventory. Ports and
transaction already have adequate public fakes; all other candidates are
implementation-specific falsifiers or shallow driver internals.
