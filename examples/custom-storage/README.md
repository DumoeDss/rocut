# custom-storage

Bring your own storage. This example's adapter keeps project records in a
**deliberately alien representation** (`src/alien-store.ts` — its own codec,
its own on-disk shape) and implements the `ProjectStore` port over it, then
runs every published conformance surface against that implementation: the
ports suite (portable profile), the transaction suite, the engine suite, the
draft suite and the vectors suite — all from the installed tarballs, none of
them touching a reference implementation.

## The migration honest pair

The wasm-initialization defect (a Direction-level defect, demonstrated here
but not repaired) means the published migration chain — reachable through
`@opencut/editor-classic/storage/migrations` — cannot initialize in a plain
TS consumer. This example handles that honestly, in two legs:

1. **The production path** (`run.ts`) runs and records its skip distinctly:
   the chain fails to load, the finding is printed with the observed reason,
   the migration leg is skipped — never silently — and every other surface
   still runs.
2. **The validated chain** (`run-mock.ts`) installs classic's own published
   wasm test mock first, then walks the **real published chain** (31 steps at
   0.2.0) over the alien store: migrated with monotone progress, `not-needed`
   on the second call, a declining transform failing closed, and the ports
   suite's migration case exercised.

### Experimental inheritance

This example's migration validation depends on the experimental-labeled entry
`@opencut/editor-classic/evidence/wasm-test-mock`; **the example therefore
depends on an experimental-labeled entry and inherits its instability.** A
breaking change to that entry is a documented, labeled consequence of this
pair — the alternative (validating against a fake chain, or dropping the
migration behavior an adopter most needs to see) was rejected in the change's
design.

## Run it

Through the repo's runner (see `script/run-published-examples.mjs`):

```sh
OPENCUT_EXAMPLES=custom-storage node script/run-published-examples.mjs
```

After the runner materializes this example from tarballs, the printed project
can be rerun directly:

```sh
npm install --legacy-peer-deps
npx tsc --noEmit
bun run.ts       # the production leg (records the skip distinctly)
bun run-mock.ts  # the mock-installed leg (validates the real chain)
```

## Consumed surface

| Specifier | Class | Why |
| --- | --- | --- |
| `@opencut/editor-ports` (`.`) | frozen | the port types the alien store implements |
| `@opencut/editor-ports/conformance` | frozen | `runPortConformance` over the alien ports |
| `@opencut/editor-ports/conformance/requirements` | experimental | the published failure formatter (reporting only) |
| `@opencut/editor-contracts` (`.`) | frozen | domain values + branded-id constructors the adapter builds with |
| `@opencut/editor-contracts/conformance` | frozen | `runTransactionConformance` against the alien transaction target |
| `@opencut/editor-contracts/conformance/requirements` | experimental | the published failure formatter (reporting only) |
| `@opencut/editor-contracts/engine` | frozen | the engine + adapter/seed factories the alien engine factory opens |
| `@opencut/editor-contracts/draft` | frozen | `runDraftEditingConformance` against the alien draft factory |
| `@opencut/editor-contracts/vectors` | frozen | `runTransactionVectors` + the corpus loader |
| `@opencut/editor-contracts/vectors/corpus` | frozen | the published corpus bytes + frozen contract surface |
| `@opencut/editor-classic` → `./storage/migrations` | provider | the published migration chain (dynamic import, production leg) |
| `@opencut/editor-classic` → `./evidence/wasm-test-mock` | experimental | the wasm mock the validated-chain leg installs first — **the inherited instability named above** |

Nothing reads `surface.json` at runtime; the table above is documentation
mirroring the shipped labels (the P5 rule).
