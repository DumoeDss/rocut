# Upstream provenance

## Source

| Field | Value |
| --- | --- |
| Upstream project | OpenCut Classic (archived) |
| Upstream URL | https://github.com/OpenCut-app/opencut-classic |
| Pin | `cf5e79e919144200294fb9fed22a222592a0aeea` |
| Pin authored | 2026-05-17 (`docs: readme`) |
| Upstream licence | MIT (`Copyright 2025-2026 OpenCut`) |
| This fork | https://github.com/DumoeDss/rocut |

Every claim in this file is reproducible from the repository. Content hashes of the inherited source
are in [`SOURCE_INVENTORY.md`](SOURCE_INVENTORY.md); the dependency inventory is in
[`SBOM.md`](SBOM.md); local modifications are in [`PATCHES.md`](PATCHES.md); the AGPL
reference-source boundary is in [`REFERENCE_SOURCES.md`](REFERENCE_SOURCES.md).

## Licence integrity

The root `LICENSE` is byte-identical to the upstream file at the pin.

| File | sha256 |
| --- | --- |
| `LICENSE` (working tree) | `8117f9bb64534f7530fc6139b014fd1c1465f7981f93d1871789150fa3f59d3d` |
| `LICENSE` at `cf5e79e9` | `8117f9bb64534f7530fc6139b014fd1c1465f7981f93d1871789150fa3f59d3d` |

Reproduce with:

```
sha256sum LICENSE
git show cf5e79e919144200294fb9fed22a222592a0aeea:LICENSE | sha256sum
```

The MIT copyright line is unmodified. MIT attribution is satisfied by retaining this file verbatim.

## Extraction method

**In-place fork with an aliased Vite host.** The editor source is *not* copied into a separate
package. `apps/vite-example` is a second workspace member whose Vite config aliases `@` to
`apps/web/src`, so exactly one implementation of the editor exists and the Next app remains a live
regression check against it (design D1).

The alternative — physically extracting the editor into `packages/editor` — was rejected because it
would fork the very files this work exists to compare against, making the patch log ambiguous
(upstream diff versus copy drift) and inflating the change by roughly 685 files.

Consequence: "what is in the distributable graph" is not answerable by directory layout. It is
answered mechanically, by asserting over the emitted Rollup module-id set of a production build.

## Retained areas

| Area | Role |
| --- | --- |
| `apps/web/src/core`, `editor/`, `timeline/`, `preview/`, `project/`, `media/`, `scenes/`, `actions/` | The editor domain engine and its UI. |
| `apps/web/src/components/editor/**`, `components/providers/editor-provider.tsx`, `components/ui/**` | Editor chrome and shared primitives. |
| `apps/web/src/services/**` | Storage (IndexedDB/OPFS), renderer, transcription. |
| `apps/web/src/wasm/**`, `fonts/**`, `stickers/**`, `guides/**`, `sounds/**`, `feedback/**` | Editor-adjacent feature modules. |
| `apps/web/public/{fonts,flags,effects,logos}` | Runtime assets fetched by absolute path. |
| `rust/` (7 crates) | Source of the published `opencut-wasm@0.2.10`. |

## Removed / excluded areas

Excluded from the distributable graph. Nothing is deleted from `apps/web` — the Next app must keep
building, because it is the parity reference. "Excluded" means asserted absent from the Vite
production bundle's module graph.

| Area | Why excluded |
| --- | --- |
| `apps/desktop` | A near-empty GPUI (Rust/Zed) experiment. Not a second Host and not a portability target. Cargo workspace member only — it has no `package.json`. |
| `apps/web/src/app/**` | Next routes, layout, and API handlers — the product shell. |
| `apps/web/src/site`, `src/blog` | Marketing and content surfaces. |
| `apps/web/src/db`, `src/auth` | Database and authentication. Neither is reachable from the editor graph. |
| `apps/web/src/components/landing` | Landing page. |
| `apps/web/src/changelog/components/changelog-notification.tsx` | Transitively imports `content-collections`, a **Next-build-time generated virtual module** rather than an npm package. No Vite build that retains it can resolve it. It is a product-shell announcement with zero editor behaviour, so it is excluded rather than stubbed — a stub would hide the coupling this work exists to measure. |

## Toolchain

| Tool | Required | Observed on the development machine | Note |
| --- | --- | --- | --- |
| bun | `bun@1.2.18` (pinned via `packageManager`) | **`bun 1.2.2`** | **Discrepancy — recorded, not silently accepted.** The installed bun is *older* than the pin. `bun install` resolved the committed `bun.lock` without modifying it (`git diff bun.lock` is empty), and the Next production build succeeds, so the older bun reproduces the pinned dependency set. Anyone reproducing this work should prefer 1.2.18; if a resolution difference ever appears, this discrepancy is the first thing to check. |
| Node.js | Any version Vite 7 supports | `v24.14.0` | Used for the Vite build and the check scripts. |
| Rust / cargo | 1.88+ (the wasm crate is edition 2024) | `cargo 1.88.0 (873a06493 2025-05-10)` | Only needed for the optional wasm rebuild check. |
| `wasm32-unknown-unknown` target | Required for the wasm rebuild check only | See "WASM rebuild correspondence" below | Not required to build or run the editor. |
| `wasm-pack` | Required for the wasm rebuild check only | See "WASM rebuild correspondence" below | Not required to build or run the editor. |

The editor consumes the **published npm `opencut-wasm@0.2.10`**, not a locally built artifact. That
is deliberate: it keeps the parity baseline free of toolchain variables. Building from `rust/` does
not become the canonical path in this Slice.

## WASM rebuild correspondence

**Verified.** The `rust/` sources in this repository at pin `cf5e79e9` were rebuilt locally with
`bun run build:wasm` (`wasm-pack build rust/wasm --target bundler --out-dir pkg`) and compared
against the published npm package `opencut-wasm@0.2.10`.

Per design decision D11 the correspondence criterion is **API-surface equality plus version
equality, not `.wasm` binary hash equality** — wasm-pack output is not reproducible across toolchain
versions, so a binary difference is expected and is not a correspondence failure. Stating this in
advance is what prevents a false stop condition.

**Result: the local source corresponds to the published package**, and the comparison came out
stronger than D11 requires — three of the five emitted files are byte-identical, not merely
API-equivalent.

| Artifact | Published `opencut-wasm@0.2.10` | Built from `rust/` | Result |
| --- | --- | --- | --- |
| `package.json` (whole file, 499 B) | `version` `0.2.10` | `version` `0.2.10` | **byte-identical** |
| `opencut_wasm.d.ts` | sha256 `07e195eb…` | sha256 `07e195eb…` | **byte-identical** — 48 of 48 exported declarations match |
| `opencut_wasm.js` (entry glue) | sha256 `81bbfdfe…` | sha256 `81bbfdfe…` | **byte-identical** |
| `opencut_wasm_bg.js` | sha256 `a6830997…` | sha256 `b0b80cb3…` | 34 differing lines in 3 hunks, **all** internal wasm-bindgen closure-trampoline hashes and shim indices. Verified mechanically: zero differing lines touch an `export`, and the sorted lists of **638 exported symbols are identical**. |
| `opencut_wasm_bg.wasm` | 3,037,899 B / sha256 `e7720e0d…` | 3,258,041 B / sha256 `32aaffd7…` | **Differs, as expected — not a criterion.** ~7% larger. Pre-`wasm-opt` the local artifact was 4,272,865 B, so `wasm-opt` did run; the residual delta is a binaryen version difference. |

The published size also matches the ≈3.04 MB figure recorded independently during planning,
confirming the artifact under comparison is the right one.

**Toolchain used.** `wasm-bindgen-cli 0.2.116` exactly matches the `wasm-bindgen = "0.2.116"` pin in
`rust/wasm/Cargo.toml`.

| Component | Version | How obtained |
| --- | --- | --- |
| rustc / cargo | `1.88.0` | already present; edition 2024 needs ≥ 1.85 |
| rustup | `1.28.2` | already present |
| `wasm32-unknown-unknown` | installed during this check | `rustup target add wasm32-unknown-unknown` |
| `wasm-pack` | `0.13.1` | **official prebuilt release tarball**, extracted to `~/.cargo/bin/` |
| `wasm-bindgen-cli` | `0.2.116` | auto-installed by wasm-pack, out-of-tree |

**Build cost, for anyone reproducing it.** ~15 minutes cold on a machine with no Rust wasm
toolchain: ~4 minutes of **completely silent** workspace-wide Cargo resolution (the Cargo workspace
includes `apps/desktop` with `gpui`, so resolution covers crates that are never compiled — the
silence is not a hang), 3 min 01 s compiling the wasm crate graph, 3 min 17 s building
`wasm-bindgen-cli` from source, then `wasm-opt`. Prefer the prebuilt `wasm-pack` tarball over
`cargo install wasm-pack`, which builds from source and adds several minutes.

Zero compile errors. This check adds provenance assurance only: **published npm
`opencut-wasm@0.2.10` remains this Slice's parity source regardless of the outcome**, and nothing in
the extraction work depends on it. Full evidence, including every command run, is in
`work/evidence/wasm-correspondence.md`.

## Known upstream defects

Recorded, **not repaired**. Repairing them would be an unlogged behavioural change to the baseline
that this work exists to compare against.

Five metadata defects are documented in [`SBOM.md` §4](SBOM.md), where a generator probe verifies
each is still present.

Four were known before this work began: the root `package.json` self-dependency `"opencut": "."`;
the root-level `next` and `better-auth` entries; the `rust/wasm/Cargo.toml` `repository` field
pointing at a nonexistent repository; and the published `opencut-wasm` `sideEffects` reference to a
nonexistent `./snippets/*`.

A fifth was **discovered during this Slice** and is recorded separately: `rust/wasm/Cargo.toml`
declares `license = "MIT"` but neither the crate directory nor the published npm package ships a
LICENSE file. It has no effect on this Slice's distributable graph, since the published package is
what is consumed and the repository-root MIT `LICENSE` covers the source — but it becomes a real
release-gate defect once building the wasm from source becomes canonical.

### The storage migration runner silently migrates nothing

**Discovered by running the parity scenario, and confirmed at runtime in both hosts.** This is the
first of the positional-argument type defects above shown to have a real consequence, rather than
being "only" a type error.

`services/storage/migrations/runner.ts` opens its projects database with

```ts
const projectsAdapter = new IndexedDBAdapter<ProjectRecord>(
    "video-editor-projects",
    "projects",
    1,
);
```

`IndexedDBAdapter`'s constructor takes a single options object (`{ dbName, storeName, version }`).
Destructuring a **string** does not throw — it yields `dbName: undefined` and
`storeName: undefined`. `indexedDB.open(undefined)` then coerces to the literal name `"undefined"`,
which succeeds, so `getAll()` returns an empty list and the runner concludes there is nothing to
migrate. No error is raised, no dialog appears, and `MigrationProgress` never reports work.

**Observed evidence.** After the parity run, both hosts' profiles contain a database literally named
`undefined`, with a store named `undefined` and zero rows, alongside the real
`video-editor-projects` (1 project) and `video-editor-media-<projectId>` (4 assets). The inventory is
recorded per host in `ledger-<host>.json` → `persistedDatabases`.

**Scope of the consequence.** The parity scenario creates fresh projects at the current version, so
nothing needs migrating and the scenario is unaffected — which is exactly why this defect is silent.
A user carrying a project written by an older version would not be migrated and would not be told.

**Not repaired**, per the same rule as everything else here: the migration path is upstream
behaviour at the pin, it is identical in both hosts, and repairing it would silently mend the
baseline this Slice compares against. It is a Slice finding and an input to whoever owns storage
next.

### The pinned baseline does not type-check

Discovered while establishing the production Next baseline. **`next build` at the pin fails**, and
it fails for reasons unrelated to this work:

| Location | Error |
| --- | --- |
| `next.config.ts:54` | `NextConfig` type identity clash between `node_modules/next` (16.2.4) and `apps/web/node_modules/next` (16.1.3). Caused directly by upstream defect D-2: the root `package.json`'s stray `next: ^16.1.3` floats to a different minor than `apps/web`'s exact `16.1.3` pin, so `bun.lock` resolves and installs both. |
| `src/actions/keybindings/persistence.ts` | Imports `isShortcutKey` from `@/actions/keybinding` and `isActionWithOptionalArgs` from `@/actions`. **Neither symbol is defined anywhere in the repository.** Two further errors follow from the resulting `unknown` types. |
| `src/services/storage/migrations/{runner,v1-to-v2}.ts` | Five call sites passing 2–3 positional arguments to functions that take a single options object — call sites missed when the codebase converted to the options-object convention. |
| `src/stickers/providers/index.ts:22` | Same: 2 positional arguments to a 1-argument function. |
| `src/timeline/**/__tests__/*.ts` | Raw `number` passed where the branded `MediaTime` type is required. |

Verified under `apps/web`'s own TypeScript 5.9.3, so this is not a toolchain artifact. The
**compilation** phase succeeds (`✓ Compiled successfully in 23.3s`) — only the post-compile type
gate fails, and types never reach the emitted bundle.

Upstream CI does not catch this: `.github/workflows/bun-ci.yml` runs `bun install` and `bun run
build` with `working-directory: apps/web`, but no `apps/web/bun.lock` exists, so bun walks up to the
root workspace and produces the same duplicated `next` — meaning CI at this pin was red.

**Handling:** patch **P-001** sets `typescript: { ignoreBuildErrors: true }` in
`apps/web/next.config.ts`. This restores the production build required as the parity reference
without editing a single line of editor source. Fixing the five defect sites instead would silently
repair the baseline being compared against, which is the more damaging option. See
[`PATCHES.md`](PATCHES.md).

## Verified baseline build

| Step | Result |
| --- | --- |
| `bun install` (repository root) | 966 packages, 381 s, on bun 1.2.2. `bun.lock` unmodified. Measured against the **pinned** workspace, before `apps/vite-example` joined it; a root install of this branch now resolves **994** packages (patch P-015). |
| `bun run build` in `apps/web` (with P-001, CI placeholder env) | **Succeeds.** Compiled in 26.7 s; 18 static pages generated; 21 routes emitted including the dynamic `/editor/[project_id]`. |

Environment variables use the placeholder values from `.github/workflows/bun-ci.yml`.
