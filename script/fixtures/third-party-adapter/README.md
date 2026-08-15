# The alien adapter

A worked third-party adapter for the OpenCut editor contract packages
(`@opencut/editor-ports`, `@opencut/editor-contracts`), built to prove the
published surfaces are implementable from outside the repository — no
reference implementation is imported, only the packages' own declared
entries.

## What it is

- **`src/alien-store.ts`** — a `ProjectStore` whose durable state is ONE flat
  `Map<string, string>`: every project record, summary, attachment, and
  library entry lives as a JSON string keyed by a JSON tuple. Reads are
  parses; writes are serializes; opaque payload crosses through a typed wire
  codec (`src/alien-codec.ts`) that represents Date/Map/Set/ArrayBuffer as
  single-key marker objects and rejects functions, symbols, and class
  instances as `corrupt` — the same subset `structuredClone` accepts.
- **`src/alien-control.ts`** — the fault/scheduling control the store suites
  drive: injected inspection, fail-next, pause-next, all funneled through one
  `beforeCommit` hook on the single commit path.
- **`src/roles.ts`** — the remaining host roles (asset resolver, byte loader,
  worker/runtime handles, exporter, diagnostics, ids, environment) in the
  same deliberately alien spirit.
- **`src/transaction.ts`** — the adapter's own transaction target: semantics
  verbatim from the published contract (idempotency before revision,
  collisions before validation, atomic batches, cascades), representation
  entirely its own — JSON text per entity.
- **`src/factories.ts`** — the conformance-suite seams: the published engine
  opened over the alien store, an adapter-built committed-state capture for
  the Draft suite, and a vectors target factory.
- **`src/migrate.ts`** — migration by replication: walks the published
  classic migration chain over the alien store's own records, fail-closed.
- **`run.ts`** — executes every published suite (ports, transaction, engine,
  draft, vectors) plus the migration demonstration, and prints failures
  through the published requirement formatters so a failure names the frozen
  requirement before the mechanism.

## Running it

From a scratch install root that has the packed tarballs installed:

```
bun adapter/run.ts
```

Exit code 0 means every exercised surface passed and the migration leg was
green (or absent because `@opencut/editor-classic/storage` could not resolve
in that environment — printed as a finding, never silently skipped).

Inside the repository, the same runner works against workspace resolution;
`script/run-scratch-conformance.mjs` copies this directory into each scratch
root and invokes it there.
