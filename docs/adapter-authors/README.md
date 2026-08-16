# Build an OpenCut adapter from packed SDK tarballs

This is the supported adapter-author path for the current `0.x` SDK. It packs
the four local artifacts, copies the template to a marker-owned project outside
the repository and every Temp directory, rewrites exact version expectations
to `file:` tarballs, installs real directory copies, and runs every check. It
does not publish to or test a registry, and it never accepts a workspace link.

## Prerequisites and install diagnostics

The repository-side runner requires `node`, `npm`, `npx`, and `bun` on `PATH`.
The materialized project's npm scripts invoke that installed Bun directly. The
recorded local path used Node `24.14.0`, npm `11.9.0`, and Bun `1.2.2`; CI uses
the Node toolchain supplied by `ubuntu-latest` and explicitly installs Bun
`1.2.18`. These are the exercised toolchains, not a claim that untested
Node/npm/Bun versions are compatible.

CI builds the self-sourced wasm artifact before invoking the author runner. A
local checkout must likewise contain the repository's current
`rust/wasm/pkg`; rebuilding it requires Rust's `wasm32-unknown-unknown` target
and `wasm-pack`. The author runner packs and verifies that prepared artifact but
does not compile Rust itself.

`npm install` can print audit findings from third-party dependencies. A runner
exit of zero proves installation, package identity, copy-not-link controls,
typechecking, and the executed suites; it does not claim that `npm audit` is
clean. Apply your project's security policy to audit findings separately.

## Run the supported path

Run this from the repository root. The successful materialized project is left
at the path printed on the final line.

<!-- opencut-command-id: author/materialize -->

```sh
node script/run-adapter-author-template.mjs
```

Set `OPENCUT_SCRATCH_ROOT` when you need a specific repository-external root.
The root must be outside Temp and below no ancestor containing `node_modules`.
If it already exists, the runner replaces it only when its OpenCut marker proves
ownership; a foreign directory is refused.

The runner owns the pack, install, and control phases. It stages exactly these
artifacts: `@opencut/editor-ports`, `@opencut/editor-contracts`,
`@opencut/editor-classic`, and `opencut-wasm`. The template's committed exact
versions are intent data (`0.2.0`, `0.3.0`, `0.2.0` respectively); the
materialized manifest replaces them with local `file:tarballs/*.tgz` specs and
the wasm override. Installed paths must be real directories, and the lockfile's
actual resolutions must have `workspace` and link populations of zero.

The following four commands are also useful inside the printed materialized
project. The author runner executes the same commands and records their real
exit codes; they are documented separately so a later edit cannot become
prose-only behavior.

<!-- opencut-command-id: author/typecheck -->

```sh
npm run typecheck
```

<!-- opencut-command-id: author/conformance -->

```sh
npm run run
```

<!-- opencut-command-id: author/migration -->

```sh
npm run run:mock
```

<!-- opencut-command-id: author/failure-demo -->

```sh
npm run failure-demo
```

## What you own

The adapter must supply the seams in the middle column. A passing OpenCut
reference fake is useful infrastructure, but is not evidence that your adapter
conforms.

| conformance surface | adapter-owned input                                                                          | SDK-owned runner/factory                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ports               | `ProjectStore`, the remaining Host port roles, and optional disposable migration fixture     | `runPortConformance` from the frozen ports conformance entry                                                               |
| transaction         | `TransactionRead` + `TransactionApply` + `TransactionGetContext` + `TransactionWatch` target | `runTransactionConformance` from the frozen contracts conformance entry                                                    |
| engine              | a fresh `ProjectStore` from `createAdapterProjectStore()`                                    | frozen `runTransactionEngineConformance`; experimental `createProjectStoreConformanceFactories` only assembles its fixture |
| draft               | a fresh `ProjectStore` from the same function                                                | frozen `runDraftEditingConformance`; the experimental helper assembles engine, capture, retention, and counters            |
| vectors             | a fresh `ProjectStore` for every seeded or relative open                                     | frozen corpus and vector runner; the experimental helper returns the existing `VectorTargetFactory` shape                  |

The template deliberately uses a flat JSON-tuple map and its own transaction
target. Consequently ports and transaction run directly against author-owned
implementations. Engine, draft, and vectors use the published implementation
over stores created by the template; every factory/open requests a new store,
while one engine fixture's `reopen()` stays on that fixture's original store.

## Customize the template

Work in the materialized project or copy it to your own repository. Replace
modules in this order so failures remain attributable:

1. Replace `src/alien-codec.ts` with the conversion between your persisted
   representation and the port's detached values.
2. Replace `src/alien-store.ts` and, if useful, `src/alien-control.ts`. Preserve
   typed `ProjectStoreError` ownership and ensure reads return detached values.
3. Replace the Host roles in `src/roles.ts`.
4. Replace `src/transaction.ts` with your transaction target.
5. Change only `createAdapterProjectStore()` in `src/factories.ts` to return a
   fresh disposable instance. Do not import vector drivers or private committed
   state capture; the declared `conformance/fakes` entry hides those mechanics.
6. Adapt `src/migrate.ts` if your store has Classic legacy data, or leave the
   migration capability absent when it genuinely has none.
7. Re-run typecheck, five-suite conformance, the migration leg, and the failure
   demonstration after each vertical slice.

`template.json` is the machine-readable source inventory and ownership map.
The repository drift guard requires 0 extra files, byte-checks the alien seed,
checks every import against a package export map, exercises the opaque
round-trip, and requires non-zero populations from all five suites. That
repository-only gate runs as its own CI step before materialization and prints
its sub-check populations there; it is not one of the materialized project's
four commands, so those drift-only lines are not expected inside the author
runner transcript.

## Read failures requirement first

Suite failures are contract reports, not package stack traces. Read each block
in this order:

1. `[requirement]` — the frozen behavior your implementation must satisfy.
2. `case:` — the concrete scenario that falsified it.
3. `detail:` — the observed mismatch at your adapter seam.

The committed failure demonstration deliberately reports a stale revision. It
freezes six attributable failures in exactly requirement → case → detail order
and rejects any internal stack frame. Fix the adapter behavior named in the
detail, then run the suite again; do not diagnose conformance from internal SDK
files.

## Understand the `0.x` classes

| class          | consequence for an adapter author                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `frozen`       | additive-only contract surface. Existing entries and signatures cannot be changed, renamed, repointed, or removed at any `0.x` version. |
| `provider`     | Classic convenience. It may change in a minor release, but is not silently removed within that minor.                                   |
| `experimental` | unstable infrastructure. It may change or be removed in a later minor without a deprecation window.                                     |

The fakes entry and requirement-first formatters used by the template are
experimental; their frozen factory/report inputs remain contract truth. The
mock-installed migration leg also imports Classic's experimental wasm test
mock, so that leg inherits experimental instability. Pin exact mixed package
versions and rerun the tarball workflow when adopting a new minor.

## Migration coverage

The production leg loads the published Classic chain through the routed wasm
entry and validates the real 31-step `0.2.0` chain with no mock in the process.
It covers migration progress, the `not-needed` repeat, a declining transform
that fails closed, and the ports migration case. The supported Bun path must
report `classic chain: loaded` and `migration/by-replication: green`; the
distinct-skip branch remains only as fail-closed behavior for a runtime that
cannot load the chain.

The second leg installs Classic's published wasm test mock before importing the
same chain. It is now a compatibility check for that experimental entry, not a
substitute for production migration coverage, and therefore still inherits the
mock entry's experimental instability.
