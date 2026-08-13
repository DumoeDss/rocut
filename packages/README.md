# `packages/` — the SDK package boundary

This directory declares the three publishable packages the `sdk-package-boundary` capability
freezes. It is a **declaration**, not yet a move: `packages/*/src` is empty. Every module still
lives under `apps/web/src`; `packages/boundary.json` is the map of where each one belongs, and
`script/check-package-boundary.mjs` asserts that the current source graph already obeys it.

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

## What `0.x` freezes

Each manifest's `exports` map is the package's entire public surface — nothing else is reachable
from outside, and nothing outside this boundary may deep-import a subpath the map does not
declare. Within the `0.x` range:

- a declared entry may **not** be removed, renamed, or repointed at a different module;
- adding a new entry **is** permitted, and is expected as P1 and P2 land — the declared entries
  today cover every production reach-in `apps/vite-example` makes, but a later Host may
  legitimately need more.

**Monotone growth is the freeze.** It is not a claim that today's surface is final.

## Source of truth

`packages/boundary.json` is what `script/check-package-boundary.mjs` reads to resolve ownership.
It assigns every module under `apps/web/src` to exactly one package or to a consumer application,
by longest-prefix path match with file-level overrides where the boundary genuinely runs through a
directory (`apps/web/src/feedback/`, and four test files whose subject is not their directory — see
`boundary.json`'s own `why` fields, and design D4). Treat `boundary.json` as authoritative over this
README if the two ever disagree; this file explains, `boundary.json` decides.

## Not covered here

- No source has moved. P1 (`s05-package-extraction`) owns the move; this change only proves the
  target graph is already acyclic under the declared map.
- No build step is declared. `exports` points at TypeScript source directly, matching how
  `apps/web` and `apps/vite-example` already consume this code today.
- `@opencut/editor-classic`'s manifest deliberately omits a `react`/`react-dom` dependency entry.
  Whether that becomes a `peerDependencies` or a `dependencies` entry is P1's call, informed by the
  resolution evidence P1 will have and S02's D2 (shared React 18) — see design's Open Questions.
- No registry publish. `private: true` on all three manifests makes that structurally impossible;
  `npm pack` still works, which is what `s05-conformance-for-third-parties`' tarball-install harness
  needs. See `BOUNDARIES.md`'s package-boundary section for the full non-coverage statement.
