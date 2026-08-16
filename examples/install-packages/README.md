# install-packages

The first thing an adopter does with the SDK: install the packages from freshly
packed tarballs and verify what landed — the declared React-free entries
resolve, the resolved versions match the pins, the shipped `surface.json` and
policy README read as the data they are, and `@opencut/editor-classic`'s
installed metadata is sane **without importing its runtime**.

This example is deliberately React-free: classic's React peer is left
unsatisfied (`node_modules/react` does not exist after install), proving the
React-free entries stand on their own. The React-bearing surface belongs to
the `embed-surface` example.

## Run it

Through the repo's runner (packs the tarballs, resolves the `@opencut/*` pins
to them, installs, controls, executes — see `script/run-published-examples.mjs`):

```sh
node script/run-published-examples.mjs            # all examples
OPENCUT_EXAMPLES=install-packages node script/run-published-examples.mjs
```

The committed manifest records the expected mixed package versions
(`editor-ports`/`editor-classic` `0.2.0`, `editor-contracts` `0.3.0`). The
supported runner resolves those pins to freshly packed local tarballs before
installing them:

```sh
npm install --legacy-peer-deps   # classic's React peer stays unsatisfied here
npx tsc --noEmit                 # the example's own typecheck
bun run.ts                       # the verification script
```

## Consumed surface

Every `@opencut/*` specifier this example imports, its class, and why that
class is right for this use:

| Specifier | Class | Why |
| --- | --- | --- |
| `@opencut/editor-ports` (`.`) | frozen | `PORT_ROLES` — the port vocabulary, the most stable thing the SDK ships |
| `@opencut/editor-ports/in-memory` | frozen | the reference implementation, used here only to prove the entry resolves and constructs |
| `@opencut/editor-contracts` (`.`) | frozen | the transaction store + `OPERATION_KINDS`/`INITIAL_REVISION` contract constants |
| `@opencut/editor-contracts/vectors` | frozen | the vector schema constant |
| `@opencut/editor-contracts/vectors/corpus` | frozen | the published corpus bytes + the frozen contract surface as data |

Read as data, never imported: `@opencut/editor-classic`'s `package.json`
(version pin, export-map shape, React peer declaration) and its `surface.json`
— the metadata an adopter inspects before committing to the runtime.

Labels here mirror the shipped `surface.json` for humans; nothing in this
example reads `surface.json` to decide runtime behavior (the P5 rule).
