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

- a declared entry may **not** be removed, renamed, or repointed at a different module —
  except a declared-but-never-authored target, whose removal is a manifest correction, not
  a surface removal (the `./vectors/drivers` case, LEAD ruling 2026-08-15; see
  BOUNDARIES.md §14 for the dangling-correction nuance — the monotone rule above governs
  working surface);
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
`script/check-sdk-consumer-view.mjs` packed inventories, run on the
`sdk-ecosystem-enablement` working tree based on `661d7ac8`:

- boundary census: 1,013 package-graph files, 419 cross-package edges (all pointing to a strictly
  lower layer), 418 `@opencut/*` specifiers (all resolving to declared entries), 872 files scanned
  for no-internal-reexport, 76 files scanned for the React-free base (ports + contracts), and
  1,156 repo files in scope — all five rules PASS;
- mixed package versions and pack inventories: editor-ports `0.2.0` / 25 files,
  editor-contracts `0.3.0` / 65 files, editor-classic `0.2.0` / 807 files, and opencut-wasm
  `0.2.10` / 7 files. Each editor package includes `surface.json` and its policy `README.md`;
- label census: 36 classified entries — frozen 16, provider 13, experimental 7
  (`node script/check-sdk-surface-labels.mjs`), dangling-export-entries 0. Contracts contributes
  11 entries (9 frozen / 2 experimental), including the new attributed experimental
  `./conformance/fakes` author helper. Ports remains 6 entries (5 / 0 / 1) and Classic remains
  19 (2 / 13 / 4).

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
- LICENSE and NOTICE ship in every editor tarball; the provenance/SBOM closure is recorded in
  BOUNDARIES.md §16. The wasm-init constraint on `editor-classic`'s migration surface is stated
  in that package's README as current-surface truth — a fix is tracked at Direction level, not
  in the package. The `sdk-examples` CI job executes both published examples and the adapter
  scaffold from packed tarballs, but performs no release or registry action.
