## Why

P0 declared and froze a boundary that nothing has crossed yet. `packages/` holds three manifests, an
ownership map and a checker; it holds **no source**. `apps/vite-example` still reaches the editor
through a path alias into `apps/web/src`, which is the arrangement `BOUNDARIES.md` §2 has always
described as *"not a published API."*

Everything S05 claims downstream depends on this child. P2's second Host implements ports against
packages; P3 packs tarballs of packages; P6 runs examples from those tarballs. None of it exists
until the source moves.

There is also a sharper reason to do it carefully rather than quickly. **Two of the checker's five
rules are currently vacuous, and P1 is what makes them real.** `public-entry-only` reports `0
@opencut/* specifier(s) examined` because there are no such specifiers in the tree;
`no-internal-reexport` reports `0 files scanned` because `packages/**/src` is empty. A child that
moves 863 files and inherits both green lights would be trusting two rules that have never once
fired in anger.

## What Changes

- **863 files move out of `apps/web/src` into the frozen layout**: 18 to
  `packages/editor-ports/src`, 54 to `packages/editor-contracts/src`, 791 to
  `packages/editor-classic/src`. `apps/web/src` keeps 54 shell files.
- **`apps/web` and `apps/vite-example` are rewired off the `@/`-into-`apps/web/src` alias** onto
  `@opencut/*` package specifiers: 103 + 59 edges reaching 96 distinct target modules, all of which
  must land on one of the 14 declared `editor-classic` entries, plus 9 + 8 edges into
  `editor-ports` and 0 + 1 into `editor-contracts`.
- **~11 public barrel files are authored** at the paths the frozen export maps already name
  (`src/surface/index.ts`, `src/session/index.ts`, `src/runtime/index.ts`, `src/browser/index.ts`,
  `src/storage/index.ts`, `src/renderer/index.ts`, `src/ui/index.ts`, `src/evidence/index.ts`,
  `src/project/index.ts`, `src/media/index.ts`, `src/fonts/index.ts`), and `surface.css` moves to
  the path `./surface.css` already points at. **No declared entry is added, removed, renamed or
  repointed** — the measurement says the existing 14 suffice.
- **The `@/` alias is eliminated from package source.** Packages ship TypeScript from `./src` with
  no build step, so `@/` — which only exists as an `apps/web` tsconfig/Vite convention — would be
  unresolvable the moment P3 installs a tarball. 2,179 specifier occurrences across 544 files are
  rewritten to a package-local form.
- **BREAKING (internal, intentional):** `apps/vite-example`'s `@` → `../web/src` Vite and tsconfig
  alias is deleted. That alias *is* the thing §3.2 asks to see gone from the diff.
- **The checker's ownership model follows the source into `packages/`.** Today `ownerOfPath()`
  answers only for `apps/web/src/**` and `apps/vite-example/**`; after the move that leaves
  `acyclic-direction` judging a fraction of the edges it judges now, and `react-free-base` scanning
  zero base-layer files. This is a scope change to a frozen contract's *enforcement*, so it is
  proposed as a spec modification rather than made quietly.
- **The type-baseline oracle is re-scoped to the same union.** `check-type-baseline.mjs` runs
  `tsc -p tsconfig.json` inside `apps/web`; removing 863 files from that program cannot produce new
  diagnostics, so an unmodified baseline check would pass while watching a small fraction of the
  code it was written to watch.
- **Two deliberate violation-and-revert probes** are run and recorded, one for `public-entry-only`
  and one for `no-internal-reexport`, proving each fires on real post-move source rather than only
  on the in-memory control fixtures.

## Capabilities

### New Capabilities

- `sdk-package-extraction`: the move itself — the layout the source lands in, the alias elimination,
  the consumer rewire, the barrels that realise the frozen entries, and the evidence that behaviour
  did not move (parity fixture, type baseline, all static checkers).

### Modified Capabilities

- `sdk-package-boundary`: two requirements change at the spec level because the source they govern
  changes location.
  - *Acyclic dependency direction, mechanically asserted* — the assertion must resolve ownership for
    files under `packages/*/src` and must resolve `@opencut/*` specifiers through the declared export
    maps. Without this the rule keeps reporting `PASS` while its edge census collapses.
  - *Public entry points and no deep imports* — both `public-entry-only` and `no-internal-reexport`
    become live over real package source, and the clause deferring coverage to "the change's recorded
    list of specifier rewrites owed by the extraction child" is discharged: there is no longer a
    later child to owe it to.

## Impact

**Moved** (no content change beyond specifier rewriting)

- `apps/web/src/editor/ports/**` and `apps/web/src/editor/host/editor-host.ts` →
  `packages/editor-ports/src/**` (18 files).
- `apps/web/src/editor/contracts/**` → `packages/editor-contracts/src/**` (54 files).
- The remaining 791 editor-owned files → `packages/editor-classic/src/**`.

**Modified**

- `apps/web/src` shell files (54) and `apps/vite-example/**`: specifier rewrites only.
- `apps/vite-example/vite.config.ts`, `apps/vite-example/tsconfig.json`: alias removal.
- `apps/web/next.config.ts`: package transpilation for source-shipped workspace dependencies.
- `apps/web/tsconfig.json`: the moved sources must remain inside a type-checked program.
- `script/check-package-boundary.mjs`: ownership and specifier resolution follow the source.
- `script/check-type-baseline.mjs`: program scope follows the source.
- Every other static checker whose scope is written as `apps/web/src` — audited individually; each
  either follows the source or is recorded as deliberately Host-scoped.
- `BOUNDARIES.md`, `PARITY.md`: the alias is gone; the tables that describe it are restated.

**Untouched, deliberately**

- `packages/boundary.json`'s layer order and the three export maps. Ownership entries may be
  corrected only where a module is provably shell-only, as a recorded diff with a reason — 12
  candidates are named in the design, and correcting one to dodge authoring a barrel is not a
  legitimate use.
- `apps/desktop`, and `check-distributable-boundary.mjs`'s `no-desktop-app` rule.
- Every public signature S03+S04 froze. **If extraction appears to require changing one, that is a
  `failed` condition for the Slice and a finding that returns to the contract** — it is not a private
  patch, and this proposal claims no licence to make one.
- The parity harness's semantic/incidental classification, inherited and documented.

**Not covered by this change**

- Installed-tarball resolution. P1 proves the graph is correct in a workspace; **P3** owns proving it
  resolves from outside the monorepo, and that is the control that would catch a package which only
  works because of workspace symlinks.
- Versions and labeling (**P5**), notices and SBOM inside the tarballs (**P7**), and any CI leg —
  rocut CI runs only the wasm checks and the Next build, so every claim here is locally enforced.
