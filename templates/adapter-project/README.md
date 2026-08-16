# OpenCut adapter project template

This is a standalone, copyable adapter project. Its deliberately alien store
keeps every value as a JSON string in one flat tuple-keyed map, so a green run
cannot be mistaken for the SDK's reference in-memory implementation.

The supported repository runner copies this directory outside the repository,
rewrites its exact package-version expectations to freshly packed `file:`
tarballs, installs real directory copies, type-checks, and executes every leg.
There is no workspace-link or registry workflow.

The committed manifest intentionally records the current mixed SDK versions:

| package                     | expected version | surface used here                                                 |
| --------------------------- | ---------------- | ----------------------------------------------------------------- |
| `@opencut/editor-ports`     | `0.2.0`          | frozen ports/conformance plus experimental requirement formatting |
| `@opencut/editor-contracts` | `0.3.0`          | frozen suites plus experimental `./conformance/fakes`             |
| `@opencut/editor-classic`   | `0.2.0`          | provider migration chain plus experimental wasm test mock         |

The runner checks these expectations against the packed manifests before
rewriting them to `file:` specs; the numbers are not registry coordinates.

## What you replace

Start with these author-owned modules:

1. `src/alien-codec.ts` — map your storage representation to the port values.
2. `src/alien-store.ts` and `src/alien-control.ts` — implement `ProjectStore`
   and optional disposable conformance controls.
3. `src/roles.ts` — implement the remaining Host ports.
4. `src/transaction.ts` — supply the transaction target used by the transaction
   suite.
5. `src/factories.ts` — make `createAdapterProjectStore()` return a fresh
   instance of your store. The public contracts helper then assembles engine,
   draft, and vector factories over that instance.
6. `src/migrate.ts` — adapt the optional Classic migration bridge if your store
   has legacy data.

`run.ts`, `run-mock.ts`, and `failure-demo.ts` are executable demonstrations;
keep their exit rules while replacing the implementation modules. The exact
ownership and file inventory is machine-readable in `template.json`.

## What each suite proves

| suite       | implementation under test                                                        |
| ----------- | -------------------------------------------------------------------------------- |
| ports       | `createAlienPorts()` and this template's `AlienProjectStore`                     |
| transaction | this template's `createAlienTransactionTarget()`                                 |
| engine      | the published engine opened over fresh stores from `createAdapterProjectStore()` |
| draft       | the published draft manager and engine over fresh stores from the same function  |
| vectors     | the published vector corpus over fresh stores from the same function             |

The engine/draft/vector helper is experimental. Its returned suite factory
types remain the existing frozen types, but the convenience assembly itself
may change or be removed in a later `0.x` minor.

## Migration coverage

`run.ts` uses the production import, loads the real 31-step Classic `0.2.0`
migration chain from the installed tarballs, and exercises migration with no
mock in the process. Its distinct-skip branch remains fail-closed behavior for
any runtime that still cannot load the chain; the supported Bun path must not
take that branch.

`run-mock.ts` validates the same chain after installing Classic's published
experimental wasm test mock. That compatibility leg proves the mock entry does
what it claims, and it remains useful for runtimes without the routed wasm
loader. Depending on the mock inherits its experimental instability.

## Commands

From a materialized project created by the supported author runner:

```sh
npm run typecheck
npm run run
npm run run:mock
npm run failure-demo
```

See `docs/adapter-authors/README.md` in the SDK repository for the executed
tarball-only path and for requirement-first failure interpretation.
