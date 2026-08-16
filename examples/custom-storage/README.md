# custom-storage

Bring your own storage. This example's adapter keeps project records in a
**deliberately alien representation** (`src/alien-store.ts` — its own codec,
its own on-disk shape) and implements the `ProjectStore` port over it, then
runs every published conformance surface against that implementation: the
ports suite (portable profile), the transaction suite, the engine suite, the
draft suite and the vectors suite — all from the installed tarballs, none of
them touching a reference implementation.

## The two migration legs

1. **The production path** (`run.ts`) loads the published migration chain
   straight from the installed tarballs — no mock anywhere in the process —
   and exercises migration for real: the chain reports its 31 steps and target
   version, a seeded legacy record migrates with monotone progress,
   `not-needed` on the second call, and a declining transform fails closed.
2. **The validated chain** (`run-mock.ts`) installs classic's own published
   wasm test mock first, then walks the same **real published chain** over the
   alien store. It remains as the demonstration that the published
   experimental entry does what it claims, and as the leg that keeps working
   in a runtime that cannot initialize the wasm at all.

> **This used to be an "honest pair".** Until 2026-08-16 the production leg
> could not load the chain: `wasm.__wbindgen_start is not a function`, recorded
> as a Direction-level defect demonstrated but not repaired, with the migration
> leg skipped distinctly. That defect is fixed — it was a runtime capability gap
> (bun resolved the artifact's `.wasm` import to an asset rather than instance
> exports), not a defect in the chain or in the binary. See `BOUNDARIES.md` §17.
> `run.ts`'s distinct-skip branch is **kept**, as the fail-closed path for any
> future runtime that cannot load the chain: a leg that cannot run still says so
> by name and never passes silently.

### Experimental inheritance

`run-mock.ts` depends on the experimental-labeled entry
`@opencut/editor-classic/evidence/wasm-test-mock`; **that leg therefore depends
on an experimental-labeled entry and inherits its instability.** A breaking
change to that entry is a documented, labeled consequence of keeping it — the
alternative (validating against a fake chain, or dropping the migration
behavior an adopter most needs to see) was rejected in the change's design.
Note that the production leg above no longer needs that entry at all.

## Run it

Through the repo's runner (see `script/run-published-examples.mjs`):

```sh
OPENCUT_EXAMPLES=custom-storage node script/run-published-examples.mjs
```

Standalone, once the packages are on a registry:

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
