# `packages/` — the SDK packages

The three publishable packages the `sdk-package-boundary` capability declared, now real:
P1 (`s05-package-extraction`) moved the sources here, and each package ships its
TypeScript source directly through its manifest's `exports` map — the same modules
`apps/web` and `apps/vite-example` import, no build step in between.
`packages/boundary.json` remains the ownership map, and
`script/check-package-boundary.mjs` asserts the source graph obeys it;
`script/pack-sdk-tarballs.mjs` packs all four tarballs (the three editors plus
`opencut-wasm`).

## The three packages, and why the order looks backwards

```
0  @opencut/editor-ports        no dependencies at all
1  @opencut/editor-contracts    depends on editor-ports
2  @opencut/editor-classic      depends on editor-ports and editor-contracts
—  apps/web, apps/vite-example, and later Hosts — consumers, not packages
```

The intuitive reading of "contracts / ports" puts contracts underneath. The measured import graph
says otherwise: 8 production edges run `editor/contracts → editor/ports` and 0 run the other way
— `contracts/engine` and `contracts/draft/immutable.ts` consume `IdGenerator` and `DiagnosticsPort`
from ports. **Ports sit at the bottom because nothing in ports needs a domain type.** See
`rasen/changes/s05-package-boundary-freeze/design.md` D1/D2 for the full measurement.

| package | role |
| --- | --- |
| `@opencut/editor-ports` | The Host port contract a Host author implements. Zero dependencies, no React, no DOM. Includes `editor/host/editor-host.ts` — see design D3 for why that file, not the rest of `editor/host/`, travels with ports. |
| `@opencut/editor-contracts` | Domain, operations, transactions, draft sessions, the engine, and the conformance suites plus the vector corpus. Depends only on `@opencut/editor-ports`. No React, no DOM. |
| `@opencut/editor-classic` | The OpenCut Classic provider and its React editor, including the embeddable Surface. Depends on both packages above. |

## What `0.x` freezes, and how each entry is labeled

Each manifest's `exports` map is the package's entire public surface — nothing else is reachable
from outside, and nothing outside this boundary may deep-import a subpath the map does not
declare. Within the `0.x` range:

- a declared entry may **not** be removed, renamed, or repointed at a different module;
- adding a new entry **is** permitted.

**Monotone growth is the freeze.** It is not a claim that today's surface is final.

Since P5 (`s05-versioning-and-experimental-labeling`) every entry also carries a stability class —
`frozen` (additive-only), `provider` (may change within a minor), `experimental` (may change or be
removed within a minor) — recorded in each package's shipped `surface.json`, echoed as
`@opencutSurface` markers in non-frozen entry sources, and enforced by
`script/check-sdk-surface-labels.mjs`. The per-package `README.md` (ports, contracts, classic) is
the **consumer-facing policy statement**: the class promises, the `0.MINOR.PATCH` reading, and the
"this policy is the only stability claim" sentence. Read the package's README for what a version
number promises; read its `surface.json` for which class an entry is in.

## Current figures

Method: `node script/check-package-boundary.mjs` census lines, and
`script/pack-sdk-tarballs.mjs` inventories, both run at `3cb78fbc` (2026-08-15):

- boundary census: 989 package-graph files, 362 cross-package edges (all pointing to a strictly
  lower layer), 361 `@opencut/*` specifiers (all resolving to declared entries), 870 files scanned
  for no-internal-reexport, 74 files scanned for the react-free base (ports + contracts), 1109
  repo files in scope — all five rules PASS;
- pack inventories at `0.2.0`: editor-ports 23 files, editor-contracts 61, editor-classic 805,
  opencut-wasm 7 (wasm at its own `0.2.10`), each including `surface.json` and the policy
  `README.md`;
- label census: 36 classified entries — frozen 17, provider 13, experimental 6
  (`node script/check-sdk-surface-labels.mjs`), plus 1 recorded dangling-entry finding escalated
  to the contract owner (`@opencut/editor-contracts` `./vectors/drivers`).

## Source of truth

`packages/boundary.json` is what `script/check-package-boundary.mjs` reads to resolve ownership;
each package's `surface.json` is what `script/check-sdk-surface-labels.mjs` reads to resolve
stability class. Treat those files as authoritative over this README if the two ever disagree;
this file explains, they decide.

## Not covered here

- No registry publish. `private: true` on all three manifests makes that structurally impossible;
  `npm pack` still works, which is what the tarball-install harness needs.
- No build step is declared. `exports` points at TypeScript source directly, matching how
  `apps/web` and `apps/vite-example` consume this code today.
- LICENSE / NOTICE / SBOM are P7's; the manifests' `files` entries for them are placeholders until
  then. The wasm-init constraint on `editor-classic`'s migration surface is stated in that
  package's README as current-surface truth — a fix is tracked at Direction level, not in the
  package. Release automation and CI are out of scope here; P6 decides CI.
