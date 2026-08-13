## Why

S03+S04 froze two contracts — the Host-neutral transaction automation API and the embeddable React
Surface — and proved them against the **runtime execution graph, not an extracted package graph**.
`package.json` already declares `workspaces: ["apps/*", "packages/*"]`, and `packages/` does not
exist. `apps/vite-example` reaches the editor through a path alias into `apps/web/src`, and
`BOUNDARIES.md` §2 says so outright: *"This is not a published API. There is no `exports` map, no
entry point and no stability promise."*

S05's claim is that an outside developer can consume `0.x` packages and run conformance against an
adapter they wrote themselves. That claim rests on a boundary that does not exist yet. This change
declares and **mechanically freezes** it before P1 moves a single file — the same
freeze-before-consume discipline S02's C1 and S03+S04's T0/R0 established, for the same reason: a
boundary discovered during a large move is a boundary negotiated under pressure.

## What Changes

- **A three-package split is declared and settled** inside B4's ruled layered shape, with each
  package's public entry points written as an `exports` map:
  - `@opencut/editor-ports` — the surface a Host author implements. Zero dependencies, no React,
    no DOM.
  - `@opencut/editor-contracts` — domain, operations, transactions, draft sessions, the engine and
    the four conformance suites plus the vector corpus. Depends only on `@opencut/editor-ports`.
    No React, no DOM.
  - `@opencut/editor-classic` — the OpenCut Classic provider and its React editor, including the
    embeddable Surface. Depends on both packages above.
- **A source-ownership declaration** (`packages/boundary.json`) assigns every existing module under
  `apps/web/src` to exactly one package or to the Host application, at directory granularity with
  file-level overrides where the boundary genuinely runs through a directory. This is the map P1
  executes; it is not an aspiration.
- **A new committed checker, `script/check-package-boundary.mjs`**, joining the existing nineteen
  static checkers and matching their idiom, enforcing five rules:
  1. `acyclic-direction` — every cross-package edge points down the declared layer order.
  2. `public-entry-only` — a consumer reaches a package only through a subpath its `exports` map
     declares; no deep import into internals.
  3. `no-internal-reexport` — no package's public entry re-exports a module owned by another
     package's internals.
  4. `no-elftia-import` — no package, Host or example imports an Elftia package, protocol
     identifier or runtime object, and no Elftia package appears in the resolved dependency graph
     (decision **B3**). **There is no exception for `adapter-elftia`**; it is Elftia-side work and
     never lives in this repository, which makes the rule permanent rather than a hole a later
     Slice punches.
  5. `react-free-base` — `@opencut/editor-ports` and `@opencut/editor-contracts` declare no React,
     no editor-UI and no DOM dependency, which is the mechanical form of spec §3.5.
- **A negative control** (`--negative-control`) and a **converse control** (`--converse-control`),
  as `check-surface-portal-boundary.mjs` and `check-port-boundary.mjs` already do: each rule is
  demonstrated to fire on a synthetic violation and to stay silent on a synthetic legal case.
- **`BOUNDARIES.md` gains a package-boundary section** recording the split, the measured evidence
  that forced it, and — explicitly — what this change does **not** cover.

**No source is moved and no consumer is written.** `packages/` gains manifests, an ownership
declaration and documentation; it gains no source modules. Every existing checker stays green,
including `check-distributable-boundary.mjs`'s `no-desktop-app` rule, which survives untouched.

## Capabilities

### New Capabilities

- `sdk-package-boundary`: the declared package split, its public export surface, the acyclic
  dependency direction between packages, the Elftia-absence import rule, and the mechanical check
  that enforces all of them with controls.

### Modified Capabilities

*(none — no existing requirement changes. No public signature frozen by S03+S04 is touched: the
split was chosen to survive them, and the one place where the ownership map is load-bearing for a
frozen surface — `EditorHostNavigation` re-exported from `@/editor/ports` as `NavigationHost` — is
preserved by assigning `editor/host/editor-host.ts` to the ports package rather than by editing the
re-export.)*

## Impact

**Added**

- `packages/editor-ports/package.json`, `packages/editor-contracts/package.json`,
  `packages/editor-classic/package.json` — manifests with `exports`, `files`, `0.1.0` versions and
  no source.
- `packages/boundary.json` — the ownership declaration and layer order the checker reads.
- `packages/README.md` — what each package is for and what the `0.x` freeze promises.
- `script/check-package-boundary.mjs` — the checker, with `--negative-control` and
  `--converse-control`.

**Modified**

- `BOUNDARIES.md` — new section for the package boundary and its non-coverage statement.
- `package.json` — a `check:packages` script entry, alongside the existing `check:wasm`.

**Untouched, deliberately**

- Every module under `apps/web/src`, `apps/vite-example` and `apps/desktop`. P0 moves nothing.
- All nineteen existing checkers, including the `no-desktop-app` rule.
- The root manifest's known quirks (`"opencut": "."`, app-level `next`/`better-auth`), recorded as
  SBOM defects D-1/D-2 and deliberately not repaired.

**Not covered by this change, stated so silence is not read as coverage**

- The "delete `adapter-elftia` and both Hosts still work" removal test. It needs a build that
  contains the adapter; this repository has none and will have none. That test belongs to
  **Elftia-side integration CI in the E5/S07 era, owned by the Elftia line, not by rocut** (spec
  §3.4, decision B3).
- Runtime verification that the split resolves as an installed package. P0 asserts over source and
  manifests; **P3 owns** the pack-and-install-from-tarball harness that tests resolution from
  outside the monorepo.
- Any behavioural claim. Parity is P1's oracle, not P0's.
