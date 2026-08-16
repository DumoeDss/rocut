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


> **Restated at S05 P7 (2026-08-16), because the estate changed under it.** The
> paragraph above is the S01 record and stays as history: S01's fork indeed
> aliased rather than extracted. S05 P1 (`s05-package-extraction`) then performed
> the physical extraction S01 had rejected — Stage C moved 785 files from
> `apps/web/src` into `packages/editor-classic` (beside the P1-era
> `editor-ports` and `editor-contracts`), so the three `@opencut/*` packages now
> exist exactly as directory layout. The ambiguity S01 feared is answered by the
> provenance set instead of by avoidance: `SOURCE_INVENTORY.md` classifies every
> moved file (`movedUnmodified` = byte-identical restatement, `movedModified` /
> `movedRewritten` = drift carrying a `PATCHES.md` row keyed by the upstream
> path), and the patch log's P-277..P-614 rows are the extraction record.
> "What is in the distributable graph" is now answerable by both directory
> layout and the packed-manifest closure gate.


## Retained areas

| Area | Role |
| --- | --- |
| `apps/web/src/core`, `editor/`, `timeline/`, `preview/`, `project/`, `media/`, `scenes/`, `actions/` | The editor domain engine and its UI. |
| `apps/web/src/components/editor/**`, `components/providers/editor-provider.tsx`, `components/ui/**` | Editor chrome and shared primitives. |
| `apps/web/src/services/**` | Storage (IndexedDB/OPFS), renderer, transcription. |
| `apps/web/src/wasm/**`, `fonts/**`, `stickers/**`, `guides/**`, `sounds/**`, `feedback/**` | Editor-adjacent feature modules. |
| `apps/web/public/{fonts,flags,effects,logos}` | Runtime assets fetched by absolute path. |
| `rust/` (7 crates) | Source of `opencut-wasm`. Since S02 it is built from here and the build output is what the editor consumes; it was the source of the published `0.2.10` at the pin. |


> **Restated at S05 P7: current locations.** The table above describes the S01
> tree. After the S05 P1 extraction everything under `apps/web/src/{core,editor,
> timeline,preview,project,media,scenes,actions,components,services,wasm,fonts,
> stickers,guides,sounds,feedback}` lives under
> `packages/editor-classic/src/**`; `apps/web/public/{fonts,flags,effects,logos}`
> survives in place as the Next app's asset root (with the package's own asset
> allowlist documented in `apps/vite-example/build/editor-assets.ts`), and
> `rust/` (7 crates) is unchanged as the canonical source of `opencut-wasm`.
> The old→new mapping for every moved file is derived, not recalled:
> `SOURCE_INVENTORY.json`'s `workingTreeDriftAgainstPin` carries it.


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
| Rust / cargo | 1.88+ (the wasm crate is edition 2024) | `cargo 1.88.0 (873a06493 2025-05-10)` | **Required prerequisite** since S02 — the editor's `opencut-wasm` dependency resolves to the local build output. |
| `wasm32-unknown-unknown` target | **Required** | `rustup target add wasm32-unknown-unknown` | **Required prerequisite** since S02. Without it the wasm cannot be built and `bun install` cannot resolve `opencut-wasm`. |
| `wasm-pack` | **Required** | `wasm-pack 0.13.1` | **Required prerequisite** since S02. `script/setup-rust` / `script/setup-rust.ps1` install it. |


> **Restated at S05 P7: the lock was refreshed.** At the portfolio's close a
> plain `bun install` (still under `bun 1.2.2`, so the discrepancy above stands
> unchanged) refreshed `bun.lock`'s workspace entries to the shipped manifests —
> `packages/editor-classic` had been carrying the stale pre-P5 map (version
> `0.1.0`, four dependencies, one peer). The refreshed lock is what the shipped
> SBOM describes, and the manifest-truth comparison is recorded in
> `rasen/changes/s05-provenance-and-beta-closure/evidence/logs/group5-bun-install.log`.


The editor consumes the artifact **built from this repository's `rust/` sources**. See
"Canonical wasm artifact" immediately below for what changed, when, and why.

## Canonical wasm artifact

**Since S02 (change `s02-wasm-self-built-canonical`), the canonical `opencut-wasm` is built from
`rust/`.** `opencut-wasm` is declared as `file:./rust/wasm/pkg` in the root `package.json` and as
`file:../../rust/wasm/pkg` in `apps/web/package.json`, so `bun install` resolves the specifier to
the wasm-pack output rather than to the npm registry.

**S01 decided the opposite, and that decision was correct for S01.** Its recorded position was:

> The editor consumes the **published npm `opencut-wasm@0.2.10`**, not a locally built artifact. That
> is deliberate: it keeps the parity baseline free of toolchain variables. Building from `rust/` does
> not become the canonical path in this Slice.

That statement is **superseded, not wrong-in-hindsight**, and it is quoted here rather than
overwritten. It kept S01's parity baseline free of a toolchain variable at a time when nothing needed
the fork's Rust source to be live.

**What changed.** Upstream `OpenCut-app/opencut-classic` is archived, so `opencut-wasm@0.2.10` can
never gain a function again. Slice S02 §4.1(c) measured the consequence: the module exports exactly
ten functions, a case-insensitive search for `dispose|destroy|teardown|shutdown` across
`rust/wasm/src`, `rust/crates/gpu/src` and `rust/crates/compositor/src` returns **zero** hits, and
`COMPOSITOR_RUNTIME` / `GPU_RUNTIME` are `thread_local!` singletons. Releasing them requires **new
Rust exports**, and a registry nobody can publish to can never carry them. The switch is therefore a
prerequisite of S02's disposal and handle-keyed-graphics work, not a provenance tidy-up.

**This change adds no export.** Its whole claim is that the self-built artifact *corresponds* to the
package it replaces; adding an export in the same change would make that claim unprovable. The
teardown and handle-keyed exports are a separate, later change.

**Consequences for the developer path**, recorded so they are not tribal knowledge:

- The Rust wasm toolchain is a **required prerequisite**, not an optional correspondence check. The
  ordering is `script/setup-rust` → `bun run build:wasm` → `bun install` → Host build. CI already
  used exactly that order (`.github/workflows/bun-ci.yml` builds the wasm before `bun install` on all
  three runners); that step was vestigial and is now load-bearing.
- **`bun install` must be re-run after every wasm rebuild.** Measured on bun 1.2.2: a `file:`
  dependency is installed as **hard links**, not a symlink and not a plain copy, into both
  `node_modules/opencut-wasm` and `apps/web/node_modules/opencut-wasm` (verified by inode identity).
  wasm-bindgen rewrites most emitted files **in place**, so those propagate through the hard link —
  but `wasm-opt` **replaces** `opencut_wasm_bg.wasm`, which breaks the link for that file alone.
  Observed directly: after a rebuild, the resolved `node_modules/opencut-wasm/opencut_wasm_bg.wasm`
  held the **4,272,877-byte pre-`wasm-opt` intermediate** while every other file was current, and
  nothing at runtime would have surfaced it — the intermediate is a functionally valid module, just
  ~1 MB larger. `script/check-wasm-source.mjs` exists to make this fail loudly.
- `CARGO_TARGET_DIR` should point at a volume with several GB free; see the build-cost note below.

## WASM rebuild correspondence

The correspondence criterion, restated once for both measurements below: **equality of the exported
symbol set, the emitted type declaration and the reported version.** Binary hash equality of the
`.wasm` is explicitly **not** the criterion. Every remaining difference is enumerated and attributed
to a named cause; a difference introduced by a deliberate, in-scope change in this repository is
attributed to that change rather than treated as a correspondence failure.

### S01 measurement (pin `cf5e79e9`, artifact **not** consumed)

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

Zero compile errors. **In S01 this check added provenance assurance only** — the published npm
package was that Slice's parity source regardless of the outcome, and nothing in the extraction work
depended on it. That is no longer true: since S02 the built artifact **is** what ships, so the
comparison below is a release gate rather than an assurance exercise, and there is no published
fallback. Full S01 evidence, including every command run, is in
`work/evidence/wasm-correspondence.md`.

### S02 re-measurement (baseline `49f8a88a`, artifact **actually consumed**)

Re-established rather than carried forward on S01's word, because the artifact is now the one the
editor loads. Measured **twice**, on both sides of the `rust/wasm/LICENSE` addition, so that any
manifest perturbation the licence introduces is attributed to it by construction instead of being
discovered later (design D-C).

**Result: the criterion is MET in both measurements, and every per-file verdict is identical between
them.** The licence addition changed the emitted package by exactly one added file and nothing else.

| Artifact | Published `opencut-wasm@0.2.10` | Built from `rust/` (S02) | Result |
| --- | --- | --- | --- |
| `package.json` (whole file, 499 B) | sha256 `6eab1bdb…` | sha256 `6eab1bdb…` | **byte-identical**, before *and* after the licence addition. 0 differing manifest fields. |
| `opencut_wasm.d.ts` | sha256 `07e195eb…` | sha256 `07e195eb…` | **byte-identical** — 48 of 48 exported declarations match |
| `opencut_wasm.js` (entry glue) | sha256 `81bbfdfe…` | sha256 `81bbfdfe…` | **byte-identical** |
| `opencut_wasm_bg.js` | 107,558 B / sha256 `a6830997…` | 107,558 B / sha256 `b0b80cb3…` | Differs. **638 exported symbols, sorted lists identical**; 11 differing lines, **zero** of which touch an `export`. The hash `b0b80cb3…` is the same value S01 recorded, so the glue is reproducible across build environments. |
| `opencut_wasm_bg.wasm` | 3,037,899 B / sha256 `e7720e0d…` | 3,253,931 B / sha256 `56cb9ab6…` | **Differs, as expected — not the criterion.** ~7% larger. The whole +216,032 B is accounted for section by section: code +164,500, data +51,466, function +57, elem +8, custom +12, type −9, import −2 — summing exactly to the file delta, with the **export section unchanged at 947 B**. That is what makes "recompiled, not re-specified" a measurement rather than an inference. (Before path remapping the artifact was 3,258,045 B; remapping removed 4,114 B of embedded path strings.) |
| `README.md` | 1,000 B / sha256 `94acda27…` | 1,045 B / sha256 `c7901645…` | **Differs by line endings only.** Byte-identical after CRLF→LF normalization (45 lines, 45 bytes). Attributed to `core.autocrlf=true` on the Windows checkout, not to a content change. |
| `LICENSE` | *absent* | present, sha256 `8117f9bb…` | **Added by this change** — see D-5 below. wasm-pack copies a declared licence into the out-dir. |
| `opencut_wasm_bg.wasm.d.ts` | *absent* | 2,510 B | Emitted by wasm-pack; excluded from the published tarball by the manifest's four-entry `files` allowlist. Not a divergence in the *published* sense. |
| `.gitignore` | *absent* | 1 B (`*`) | Written into the out-dir by wasm-pack on every build; never packed by npm. |

**Resolved: does wasm-pack list a copied licence in the generated manifest?** **No.** It copies
`LICENSE` into the out-dir but does **not** add it to `package.json`'s `files` array, which still
holds exactly the published four entries. This was an open question, deliberately measured rather
than assumed, and the answer is why `package.json` stays byte-identical to published `0.2.10`.

**Amendment, 2026-08-16 — `package.json` is no longer byte-identical to published `0.2.10`, by
design.** The table above records the state at baseline `49f8a88a` and stays as written. Since
`wasm-determinism-init` (BOUNDARIES §17), `script/build-wasm.mjs` post-processes the emitted
manifest: it appends `opencut_wasm_sync.js` to `files` and `sideEffects` and adds an `exports` map
routing the `bun` condition (plus an explicit `./sync` subpath) to that generated entry. wasm-pack's
own output is unchanged — the delta is exactly those three keys, and
`script/wasm-api-surface-contract.mjs` pins
the post-processed bytes. The four wasm-pack-emitted glue files, including `opencut_wasm.js`, remain
byte-for-byte what the table records. The correspondence criterion at the head of this section
(exported symbol set, emitted declarations, version) is unaffected: the added entry re-exports the
same 38 names, sliced from `opencut_wasm.js`'s own export block, and `check-wasm-api-surface`
asserts that equality on every run.

**The binary's own export table was measured too, not inferred from the glue.** Parsing the `.wasm`
export and import sections directly:

| | published `0.2.10` | self-built |
| --- | --- | --- |
| exports | 41 | 41 |
| kinds | 39 func / 1 table / 1 memory | identical |
| stably-named exports | 38 | 38 — **identical sets** |
| `wasm_bindgen__convert__closures_____invoke__h…` trampolines | 3 | 3 — **all three names differ** |
| imports | 609 | 609 — **identical** |
| export **section** size | 947 B | 947 B — same size, **not byte-identical** |

The three differing names are rustc symbol-hash suffixes on compiler-generated closure trampolines;
**stripping the hash makes the two sets identical**, and they correspond 1:1 to the 11 differing
lines in `opencut_wasm_bg.js`. That is the named cause.

**The export section is the same size; it is NOT byte-identical, and the distinction matters.** 555
byte positions within it differ, because 38 of the 41 entries carry a different function index — the
compiler laid the same functions out in a different order. The *set* of exported names, their kinds
and their count are what is unchanged; their indices are not, and no claim of byte-identity should be
made about this section. Same-size-with-different-contents is exactly the shape a careless reading
turns into "identical", so it is stated explicitly here.

The import table — a module's host contract — is unchanged. The earlier records stated only the
JS-level figures (638 glue symbols, 48 declarations); those remain correct but are the *consumed*
surface, not the binary's.

**The +164,500 B code-section growth has a named cause: the two artifacts were built by compilers six
minor versions apart.** The `producers` custom section records it directly — published:
`rustc 1.94.1 (e408947bf 2026-03-25)`, self-built: `rustc 1.88.0 (6b00bc388 2025-06-23)`. Both report
`walrus 0.26.1` and `wasm-bindgen 0.2.116`. Until now the size delta was accounted for positionally
(section by section, summing to the file delta) but not causally; the compiler version is the cause,
and it is also why binary hash equality was never the correspondence criterion.

**Path remapping: the redistributed binary must not disclose the machine that built it.** Recorded
because it is a property this Slice deliberately changed, and because the naive comparison misleads:

| | published `0.2.10` | self-built, before the fix | self-built, now |
| --- | --- | --- | --- |
| Windows absolute paths | 0 | **286** (285 `C:\Users\<name>\.cargo\registry\…` + 1 worktree path) | **0** |
| POSIX home-dir paths | **169** (`/home/heart/.cargo/registry/…`) | 0 | **0** |
| OS username disclosed | **`heart`** | **`Sayo`** | **none** |

**Upstream did not build with path trimming** — a Windows-shaped scan reports zero for it only
because `0.2.10` was built on Linux. Scanned for both platform shapes, the published artifact
discloses a home directory and a username just as the unfixed local build did. So this is not a
property the fork dropped and restored; it is one **neither** artifact had, and the fork now has it
where the package it replaces does not.

The fix is `--remap-path-prefix`, applied by `script/build-wasm.mjs`, which `bun run build:wasm`,
`bun dev:wasm` and CI all route through. Cargo's `[profile.release] trim-paths` is the obvious
alternative and does **not** work here: it is unstable in Cargo 1.88.0 and a manifest carrying it
fails to parse at all, breaking every cargo invocation. Verified after the fix by scanning for both
path shapes, with a positive control confirming the remapped `/cargo\…` and `/opencut\…` prefixes are
present rather than the strings having merely vanished.

### Reproducibility of the `.wasm` — what is proven, and what is not

Stated precisely, because a later Slice needs a hash comparison it can trust and an over-broad claim
here would be worse than none.

**Proven: byte-identity across build locations, on one toolchain.** The same sources were built twice
— once at `E:\…\rocut-wt-c0` and once at `C:\Users\Sayo\n3-second-location-build-much-longer-path\rocut`
(different drive, different path length, separate `CARGO_TARGET_DIR`, a genuine 2 m 49 s recompile).
**All five emitted files are byte-identical**, `.wasm` sha256 `56cb9ab6…` both. Remapping the
checkout root and `CARGO_HOME` to fixed prefixes is what makes this hold; before it, two checkouts
could not produce the same bytes.

**NOT proven: byte-identity across machines or toolchains — and this repository pins neither.**

- There is **no `rust-toolchain.toml`**, so `rustc` floats with whatever the developer installed.
- `wasm-bindgen = "0.2.116"` in `rust/wasm/Cargo.toml` pins the *crate*, **not** the `wasm-bindgen-cli`
  binary wasm-pack downloads, and that binary's own dependencies are not pinned by anything here.

That gap is **measured, not hypothetical**. S01's surviving artifact and this one were built from the
same sources with the *same* `rustc 1.88.0` and the *same* `wasm-bindgen 0.2.116`, yet differ — their
`producers` sections read `walrus 0.26.4` and `walrus 0.26.1` respectively. The 4-byte size difference
between them is **not** a path effect: the S01 worktree path is one character *longer*, so a
path-only explanation predicts S01 one byte larger, and it is four bytes **smaller**. The cause is the
differing `wasm-bindgen-cli` build.

**Consequence for later work.** A hash comparison is meaningful only between builds made on one
machine with one toolchain. Across machines, compare the exported surface — which is why D11 makes
binary hash equality explicitly not the correspondence criterion. Closing the gap would mean pinning
`rustc` via `rust-toolchain.toml` and pinning the `wasm-bindgen-cli` binary; neither is done here, and
neither is in this change's scope.

**S02 toolchain.** `rustc`/`cargo 1.88.0`, `wasm-pack 0.13.1`, `wasm-bindgen-cli 0.2.116` (matching
the `wasm-bindgen = "0.2.116"` pin), target `wasm32-unknown-unknown`. Cold build 4 min 49 s with a
warm Cargo registry (4 min 20 s of it compiling); the subsequent rebuild after adding the licence
took 19 s.

### C0b deliberate API delta (`s02-wasm-api-surface`)

The C0 result above remains the named before-state: the canonical local artifact corresponded to
published `opencut-wasm@0.2.10` by exported surface, emitted declaration and version, with binary
hash equality explicitly outside the criterion. C0b deliberately supersedes only the API-surface
equality. It does not rewrite that measurement or make the archived registry package a fallback.

The generated comparison is exact and is enforced by `script/check-wasm-api-surface.mjs`:

| surface | C0 before-state | C0b canonical artifact | exact attributed delta |
| --- | ---: | ---: | --- |
| public wrapper exports | 28 | 38 | `WasmRuntimeGraphicsQuery`, `WasmRuntimeGpuResourceQuery`, `createCompositor`, `resizeCompositorForHandle`, `getCompositorCanvasForHandle`, `uploadTextureForHandle`, `releaseTextureForHandle`, `renderFrameForHandle`, `disposeCompositor`, `disposeGpu` |
| top-level TypeScript declarations | 48 | 58 | The same ten names. The provider methods are exactly `selectedBackend(): "webgl" \| "webgpu" \| null`, `concurrentCompositorInstances(): number`, `unavailableReason(): string`, `liveHandles(): readonly number[]`, and `release(input: { handle: number }): void`. |
| generated glue function exports | 638 | 646 | The eight additive function exports; the two providers are classes in the glue. |
| binary exports | 41 | 58 | The eight additive functions; two provider free functions; graphics provider constructor plus three methods; GPU-resource provider constructor plus two methods. No C0 binary export was removed. |
| binary imports | 609 | 609 | **Exact set unchanged** (sorted module/name/kind signature sha256 `2da5921b…`). |
| generated files | 9 | 9 | `opencut_wasm.d.ts`, `opencut_wasm.js`, `opencut_wasm_bg.js`, `opencut_wasm_bg.wasm`, and `opencut_wasm_bg.wasm.d.ts` changed. `.gitignore`, `LICENSE`, `package.json`, and `README.md` remain byte-identical to C0. |

The declaration moved from sha256 `07e195eb…` to `e7d942d3…`. On this machine the review-clean
binary moved from 3,253,931 bytes / sha256 `56cb9ab6…` to 3,286,340 bytes / sha256 `15622cf5…`;
the final bytes include synchronous generation registration plus the initialization-generation ownership added for the C0b review blockers. As above, that binary
hash is build evidence, not a cross-toolchain correspondence oracle. The committed gate instead
freezes every JS and binary export, all 609 imports, both declaration files, the generated file set
and the four files required to remain byte-identical. Fourteen deliberate malformed controls each
exit non-zero for their own rule, including independent exact-registration controls for the root
aggregate, CI ordering and `GATED` membership.

Runtime evidence is separate from declaration evidence. The built-package browser probe observes
an honest pre-initialization `null`/`0`/non-empty-reason state, a real WebGL selection reporting
capacity one, exact live-handle enumeration, over-capacity refusal, shared-teardown refusal naming
the live handle, idempotent keyed release, reserved legacy handle `0`, and post-teardown
`null`/`0`/non-empty-reason. It also repeats concurrent initialization with a live compositor three
times, proves both zero-yield and yielded dispose-during-init cannot publish late, and coalesces a real disabled-GPU failure for
both callers. Pure Rust tests cover the WebGPU capacity-two branch, WebGL branch,
failure and teardown state, default/explicit capacity competition, exact release and checked
`u32` exhaustion, plus the generation join/cancel rules. A distinct real WebGPU run and a distinct real WebGL run remain the C3 joint-gate
obligation; C0b does not claim one browser run exercised both backends.

## Known upstream defects

**Disposition is per defect, not blanket.** Slice S01 recorded every defect here and repaired none,
because repairing one inside the Slice would have silently mended the baseline the Slice's parity
comparison was made *against*. That reasoning expired when S01 was reconciled: the change
`opencut-next-tracks-defect-repair` is deferred fork maintenance and it **repairs** the code defects
while leaving the metadata defects recorded and unrepaired. Each entry below states which it is.

A recorded **metadata** defect may be repaired only by a change whose own scope makes it a live
correctness or release gate, and only with the repair evidenced and its disposition updated here and
in [`SBOM.md` §4](SBOM.md). One has since met that bar: **D-5**, repaired at S02. The rest stand.

| defect | disposition |
| --- | --- |
| Four **metadata** defects D-1…D-4 ([`SBOM.md` §4](SBOM.md)) | **Recorded, not repaired.** Deliberately so — and one of them is the root cause of a type diagnostic that is therefore also left in place; see the type-check section. |
| Metadata defect **D-5** — `rust/wasm` declared `license = "MIT"` while shipping no LICENSE file | **Repaired** at S02 by change `s02-wasm-self-built-canonical`, in the change whose own scope made it a release gate. Evidence: `rust/wasm/LICENSE` present and byte-identical to the root `LICENSE` (sha256 `8117f9bb…`), asserted by `script/check-wasm-source.mjs`; the wasm-pack `License key is set in Cargo.toml but no LICENSE file(s) were found` warning is absent from the post-repair build log. The forcing manifest edits are patches **P-021**/**P-022**. |
| The storage migration runner silently migrates nothing | **Repaired** — patches **P-016**, **P-017**. |
| The six positional-argument call sites | **Repaired** — patches **P-016**, **P-017**, **P-018**. |
| The two dangling imports in `actions/keybindings/persistence.ts` | **Repaired** — patches **P-019**, **P-020**. |
| The `next.config.ts` dual-`next` type clash | **Recorded, not repaired.** Its root cause is a metadata defect the provenance record requires to stay unaltered. |
| The branded-`MediaTime` diagnostics in `src/timeline/**/__tests__/` | **Recorded, not repaired.** Out of scope; no Direction decision yet. |
| `MigrationDialog` can never render (**found during the repair**) | **Recorded, not repaired.** See the migration-runner section. |

Five metadata defects are documented in [`SBOM.md` §4](SBOM.md), where a generator probe asserts each
against its **declared disposition** — `recorded` defects must still be detected as present,
`repaired` ones must be detected as absent. Both directions fail the generator, so a regression of a
repaired defect is as loud as an undocumented repair.

Four were known before this work began, and all four remain `recorded`: the root `package.json`
self-dependency `"opencut": "."`; the root-level `next` and `better-auth` entries; the
`rust/wasm/Cargo.toml` `repository` field pointing at a nonexistent repository; and the published
`opencut-wasm` `sideEffects` reference to a nonexistent `./snippets/*`. **None of the four is
repaired by the S02 wasm switch**: the manifest edits touch only the `opencut-wasm` dependency
source, `Cargo.toml`'s `repository` field is untouched, and the built package's `sideEffects` array
is byte-identical to the published one.

A fifth was **discovered during S01** and is now `repaired`: `rust/wasm/Cargo.toml` declares
`license = "MIT"` but neither the crate directory nor the published npm package shipped a LICENSE
file. S01 recorded it and deliberately left it, correctly — the published package was what was
consumed and the repository-root MIT `LICENSE` covered the source. S01 also named the condition
under which that would stop holding: it "becomes a real release-gate defect once building the wasm
from source becomes canonical". S02's `s02-wasm-self-built-canonical` is the change that makes
building from source canonical, so the condition is met rather than overridden, and the same change
repairs the defect by adding `rust/wasm/LICENSE`.

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

**Not repaired in S01**, per the rule that applied then: the migration path is upstream behaviour at
the pin, it is identical in both hosts, and repairing it inside the Slice would have silently mended
the baseline that Slice compared against.

**Repaired afterwards** by the change `opencut-next-tracks-defect-repair`, as patches **P-016** (the
runner's constructor and its write-back, deliberately one patch) and **P-017** (the three legacy
reads in `v1-to-v2.ts`). Evidence, all of it runtime:

- The `undefined` database is present in both hosts' pre-repair `ledger-<host>.json` →
  `persistedDatabases` and absent from both post-repair ledgers, with the real
  `video-editor-projects` and `video-editor-media-<projectId>` entries unchanged at the same row
  counts.
- A seeded-legacy-project probe (`apps/vite-example/tests/probe/legacy-migration.pw.ts`, driven by
  `playwright.probe.config.ts`) was shown to **fail before** the repair — "Expected 31, Received 1",
  i.e. nothing migrated — and to pass after it on **both** hosts. It asserts recovered *content*, not
  the deletion of the legacy databases, because a working delete and a broken read are otherwise
  indistinguishable. A companion case asserts a project already at the current version comes out
  byte-unchanged.
- The parity fixture is **not** evidence here and is not offered as such: its scenario creates a
  project at the current version, so the runner does no work either before or after. Its snapshots
  are byte-identical across the repair on both hosts, which is the expected result and speaks only to
  editing behaviour.

**A second defect found while repairing this one, and left unrepaired.** The sentence above that
`MigrationProgress` never reports work is true at the pin for a *second, independent* reason, which
survives the repair: `MigrationDialog` — the only consumer of the progress channel, rendered on the
editor surface of both hosts — calls `useEditor()` **with no selector**, and that overload subscribes
with `subscribeNone = () => () => {}` (`src/editor/use-editor.ts`). It therefore reads
`getMigrationState()` exactly once, at mount, while `isMigrating` is still false, and never
re-renders. The runner does call `onProgress` with the source version, target version and project
name, and `ProjectManager` does store it and `notify()` — but no UI can show it. The migration is
now real and still silent. Out of scope for a positional-argument repair; recorded here as the next
owner's input, and pinned by an assertion in the probe so that fixing it fails the probe rather than
passing unnoticed.

### The pinned baseline does not type-check

Discovered while establishing the production Next baseline. **`next build` at the pin fails**, and
it fails for reasons unrelated to this work:

| Location | Error |
| --- | --- |
| `next.config.ts:54` | `NextConfig` type identity clash between `node_modules/next` (16.2.4) and `apps/web/node_modules/next` (16.1.3). Caused directly by upstream defect D-2: the root `package.json`'s stray `next: ^16.1.3` floats to a different minor than `apps/web`'s exact `16.1.3` pin, so `bun.lock` resolves and installs both. |
| `src/actions/keybindings/persistence.ts` | Imports `isShortcutKey` from `@/actions/keybinding` and `isActionWithOptionalArgs` from `@/actions`. **Neither symbol is defined anywhere in the repository.** Two further errors follow from the resulting `unknown` types. Under bun's ESM loader it is not a soft `undefined` but a hard module-load failure (`SyntaxError: Export named 'isActionWithOptionalArgs' not found`), one of the three errors in the red `bun test` baseline, which means all 9 tests in that module's committed test file never ran. **Repaired: P-019, P-020** — after which those 9 tests load and pass. |
| `src/services/storage/migrations/{runner,v1-to-v2}.ts` | Five call sites passing 2–3 positional arguments to functions that take a single options object — call sites missed when the codebase converted to the options-object convention. **Repaired: P-016, P-017.** |
| `src/stickers/providers/index.ts:22` | Same: 2 positional arguments to a 1-argument function. This is the **sixth** such site, and the one the "five call sites" figure below used to drop. **Repaired: P-018.** |
| `src/timeline/**/__tests__/*.ts` | Raw `number` passed where the branded `MediaTime` type is required. |

Verified under `apps/web`'s own TypeScript 5.9.3, so this is not a toolchain artifact. The
**compilation** phase succeeds (`✓ Compiled successfully in 23.3s`) — only the post-compile type
gate fails, and types never reach the emitted bundle.

Upstream CI does not catch this: `.github/workflows/bun-ci.yml` runs `bun install` and `bun run
build` with `working-directory: apps/web`, but no `apps/web/bun.lock` exists, so bun walks up to the
root workspace and produces the same duplicated `next` — meaning CI at this pin was red.

**Handling in S01:** patch **P-001** sets `typescript: { ignoreBuildErrors: true }` in
`apps/web/next.config.ts`. This restores the production build required as the parity reference
without editing a single line of editor source. Fixing the defect sites instead would have silently
repaired the baseline being compared against, which was the more damaging option. See
[`PATCHES.md`](PATCHES.md).

**Count correction — the earlier figure was wrong.** This section previously said "five call sites"
and "the five defect sites". **The correct number is SIX.** The figure counted the five occurrences
in `{runner,v1-to-v2}.ts` and dropped the separately-tabled
`src/stickers/providers/index.ts:22` row — the one site that is *not* on the storage migration path,
and the only one of the six with a directly user-visible consequence. The authoritative oracle is
`script/fixtures/type-baseline.json`, captured by `tsc` at the pin: its four `TS2554` entries hold
six occurrences at six call sites (three occurrences in `v1-to-v2.ts` collapse into one entry because
the fixture's comparison key is file + code + message). This table and patch P-001's own rationale
(`~6`) were already consistent with six; only the prose figure was wrong. The same wrong figure
appears in the Direction-side Slice record and is corrected there separately.

**Handling after the repair:** P-001 **stays, and stays necessary.** The repairs took the diagnostic
count from **13 to 3**, with `script/check-type-baseline.mjs` passing and enumerating exactly seven
resolved entries; `script/fixtures/type-baseline.json` is byte-identical and its recorded pin
unchanged, because the fixture is a record of the pin and regenerating it would re-emit the same 13
while destroying the resolved-entry signal. The three survivors are all out of scope: the
`next.config.ts` clash — whose root cause is upstream metadata defect D-2, which the provenance
record requires to stay unaltered, so repairing the diagnostic would mean repairing a defect that
must remain — and the two branded-`MediaTime` test diagnostics. Because three diagnostics remain, the
build's type gate is still red and `ignoreBuildErrors` was **not** removed.

## Verified baseline build

| Step | Result |
| --- | --- |
| `bun install` (repository root) | 966 packages, 381 s, on bun 1.2.2. `bun.lock` unmodified. Measured against the **pinned** workspace, before `apps/vite-example` joined it; a root install of this branch now resolves **994** packages (patch P-015). |
| `bun run build` in `apps/web` (with P-001, CI placeholder env) | **Succeeds.** Compiled in 26.7 s; 18 static pages generated; 21 routes emitted including the dynamic `/editor/[project_id]`. |

Environment variables use the placeholder values from `.github/workflows/bun-ci.yml`.

## Added-file inventory (fork additions)

Derived by `script/reconcile-provenance.mjs --write-added-inventory` from the same
drift derivation as `SOURCE_INVENTORY.json`. Fork-added files are not patches and never
appear in `PATCHES.md`.

### `apps/electron-host` (33 file(s))

- `apps/electron-host/electron/main.cjs`
- `apps/electron-host/electron/preload.cjs`
- `apps/electron-host/index.html`
- `apps/electron-host/package.json`
- `apps/electron-host/postcss.config.mjs`
- `apps/electron-host/scripts/boot-proof.mjs`
- `apps/electron-host/scripts/c6-oracle-proof.mjs`
- `apps/electron-host/scripts/desktop-composition-proof.mjs`
- `apps/electron-host/scripts/evidence-entries-proof.mjs`
- `apps/electron-host/scripts/serve-dist.mjs`
- `apps/electron-host/scripts/store-bridge-proof.mjs`
- `apps/electron-host/scripts/validate-agent-ledger.mjs`
- `apps/electron-host/src/app.tsx`
- `apps/electron-host/src/c4-worker-harness.tsx`
- `apps/electron-host/src/editor-error-boundary.tsx`
- `apps/electron-host/src/host/electron-editor-host.tsx`
- `apps/electron-host/src/host/electron-host-config.ts`
- `apps/electron-host/src/host/electron-runtime-resources.ts`
- `apps/electron-host/src/main.tsx`
- `apps/electron-host/src/project-picker.tsx`
- `apps/electron-host/src/store/__tests__/filesystem-store-conformance.test.ts`
- `apps/electron-host/src/store/__tests__/filesystem-store-migration-probes.test.ts`
- `apps/electron-host/src/store/__tests__/store-bridge-surface.test.ts`
- `apps/electron-host/src/store/filesystem-project-store.ts`
- `apps/electron-host/src/store/ipc-store-bridge.ts`
- `apps/electron-host/src/store/main-store-ipc.ts`
- `apps/electron-host/src/store/node-fs-store-bridge.ts`
- `apps/electron-host/src/store/project-store-files.ts`
- `apps/electron-host/src/styles.css`
- `apps/electron-host/src/surface-evidence-main.tsx`
- `apps/electron-host/surface-evidence.html`
- `apps/electron-host/tsconfig.json`
- `apps/electron-host/vite.config.ts`

### `apps/vite-example` (57 file(s))

- `apps/vite-example/README.md`
- `apps/vite-example/build/editor-assets.ts`
- `apps/vite-example/build/headless-module-graph.ts`
- `apps/vite-example/build/module-graph.ts`
- `apps/vite-example/c5-migration.html`
- `apps/vite-example/c5-storage.html`
- `apps/vite-example/headless.html`
- `apps/vite-example/index.html`
- `apps/vite-example/package.json`
- `apps/vite-example/playwright.c3.config.ts`
- `apps/vite-example/playwright.c5-storage.config.ts`
- `apps/vite-example/playwright.config.ts`
- `apps/vite-example/playwright.probe.config.ts`
- `apps/vite-example/playwright.surface.config.ts`
- `apps/vite-example/postcss.config.mjs`
- `apps/vite-example/src/app.tsx`
- `apps/vite-example/src/c3-session-harness.tsx`
- `apps/vite-example/src/c4-forced-none-harness.tsx`
- `apps/vite-example/src/c4-session-harness.tsx`
- `apps/vite-example/src/c4-worker-harness.tsx`
- `apps/vite-example/src/c5-migration-harness.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/src/editor-error-boundary.tsx`
- `apps/vite-example/src/headless-entry.ts`
- `apps/vite-example/src/host/vite-editor-host.tsx`
- `apps/vite-example/src/host/vite-host-config.ts`
- `apps/vite-example/src/main.tsx`
- `apps/vite-example/src/project-picker.tsx`
- `apps/vite-example/src/styles.css`
- `apps/vite-example/src/surface-evidence-main.tsx`
- `apps/vite-example/surface-evidence.html`
- `apps/vite-example/tests/c3/session-capacity.pw.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`
- `apps/vite-example/tests/c5-storage/c4-forced-none.pw.ts`
- `apps/vite-example/tests/c5-storage/migration-round1.pw.ts`
- `apps/vite-example/tests/fixtures/FIXTURES.md`
- `apps/vite-example/tests/fixtures/fixture-image.png`
- `apps/vite-example/tests/fixtures/fixture-tone-a4.wav`
- `apps/vite-example/tests/fixtures/fixture-tone-a5.wav`
- `apps/vite-example/tests/fixtures/fixture-video.mp4`
- `apps/vite-example/tests/parity/agent.pw.ts`
- `apps/vite-example/tests/parity/c4-next.runtime.ts`
- `apps/vite-example/tests/parity/driver.ts`
- `apps/vite-example/tests/parity/electron-page.ts`
- `apps/vite-example/tests/parity/evidence-path.ts`
- `apps/vite-example/tests/parity/host-profile.ts`
- `apps/vite-example/tests/parity/parity.pw.ts`
- `apps/vite-example/tests/parity/snapshot.ts`
- `apps/vite-example/tests/parity/surface-r2-evidence.ts`
- `apps/vite-example/tests/parity/surface.pw.ts`
- `apps/vite-example/tests/probe/legacy-migration.pw.ts`
- `apps/vite-example/tests/probe/seed.ts`
- `apps/vite-example/tests/probe/stickers-registry.pw.ts`
- `apps/vite-example/tsconfig.json`
- `apps/vite-example/vite.config.ts`
- `apps/vite-example/vite.headless.config.ts`
- `apps/vite-example/vite.surface-css.config.ts`

### `apps/web/public` (1 file(s))

- `apps/web/public/workers/c4-worker-fixture.js`

### `apps/web/src` (9 file(s))

- `apps/web/src/app/c6-disposal/page.tsx`
- `apps/web/src/app/c7-headless/route.ts`
- `apps/web/src/app/surface-evidence/page.tsx`
- `apps/web/src/editor/host/__tests__/branding-assets.test.ts`
- `apps/web/src/editor/host/__tests__/production-composition.test.ts`
- `apps/web/src/editor/host/c4-next-runtime-probe.tsx`
- `apps/web/src/editor/host/next-editor-host.ts`
- `apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts`
- `apps/web/src/services/storage/__tests__/fixtures/c5-v1-project.ts`

### `examples` (34 file(s))

- `examples/agent-transaction/README.md`
- `examples/agent-transaction/package.json`
- `examples/agent-transaction/run.ts`
- `examples/agent-transaction/src/own-store.ts`
- `examples/agent-transaction/tsconfig.json`
- `examples/custom-storage/README.md`
- `examples/custom-storage/package.json`
- `examples/custom-storage/run-mock.ts`
- `examples/custom-storage/run.ts`
- `examples/custom-storage/src/alien-codec.ts`
- `examples/custom-storage/src/alien-control.ts`
- `examples/custom-storage/src/alien-store.ts`
- `examples/custom-storage/src/factories.ts`
- `examples/custom-storage/src/migrate.ts`
- `examples/custom-storage/src/roles.ts`
- `examples/custom-storage/src/transaction.ts`
- `examples/custom-storage/tsconfig.json`
- `examples/custom-storage/types/culori.d.ts`
- `examples/embed-surface/README.md`
- `examples/embed-surface/index.html`
- `examples/embed-surface/package.json`
- `examples/embed-surface/postcss.config.mjs`
- `examples/embed-surface/public/fonts/font-atlas.json`
- `examples/embed-surface/public/logos/opencut/svg/logo.svg`
- `examples/embed-surface/smoke.mjs`
- `examples/embed-surface/src/host.ts`
- `examples/embed-surface/src/main.tsx`
- `examples/embed-surface/src/styles.css`
- `examples/embed-surface/tsconfig.json`
- `examples/embed-surface/vite.config.ts`
- `examples/install-packages/README.md`
- `examples/install-packages/package.json`
- `examples/install-packages/run.ts`
- `examples/install-packages/tsconfig.json`

### `packages/editor-classic` (166 file(s))

- `packages/editor-classic/LICENSE`
- `packages/editor-classic/NOTICE`
- `packages/editor-classic/README.md`
- `packages/editor-classic/package.json`
- `packages/editor-classic/src/actions/__tests__/registry.test.ts`
- `packages/editor-classic/src/actions/action-scope.tsx`
- `packages/editor-classic/src/actions/keybinding-target.ts`
- `packages/editor-classic/src/browser/index.ts`
- `packages/editor-classic/src/commands/provider-private-composite.ts`
- `packages/editor-classic/src/components/__tests__/storage-provider-operations.test.ts`
- `packages/editor-classic/src/components/storage-provider-operations.ts`
- `packages/editor-classic/src/core/managers/__tests__/media-persistence-rewire.test.ts`
- `packages/editor-classic/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts`
- `packages/editor-classic/src/core/managers/__tests__/project-persistence-rewire.test.ts`
- `packages/editor-classic/src/core/managers/__tests__/save-manager-persistence-failure.test.ts`
- `packages/editor-classic/src/core/managers/__tests__/transaction-command-routing.test.ts`
- `packages/editor-classic/src/core/managers/__tests__/transaction-persistence-coordination.test.ts`
- `packages/editor-classic/src/editor/host/__tests__/browser-runtime.test.ts`
- `packages/editor-classic/src/editor/host/browser-runtime.ts`
- `packages/editor-classic/src/editor/host/c4-project-load.ts`
- `packages/editor-classic/src/editor/host/editor-host-context.tsx`
- `packages/editor-classic/src/editor/host/host-image.tsx`
- `packages/editor-classic/src/editor/persistence/__tests__/opaque-roundtrip.test.ts`
- `packages/editor-classic/src/editor/persistence/index.ts`
- `packages/editor-classic/src/editor/persistence/opaque-value.ts`
- `packages/editor-classic/src/editor/persistence/project-codec.ts`
- `packages/editor-classic/src/editor/persistence/session-persistence-coordinator.ts`
- `packages/editor-classic/src/editor/runtime/process-bootstrap.ts`
- `packages/editor-classic/src/editor/runtime/session-core-owner.ts`
- `packages/editor-classic/src/editor/runtime/session-stores.ts`
- `packages/editor-classic/src/editor/runtime/wasm-runtime-providers.ts`
- `packages/editor-classic/src/editor/session/__tests__/c6-durable-reopen.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/c6-test-audio-context.ts`
- `packages/editor-classic/src/editor/session/__tests__/disposal-oracle.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/editor-singleton-boundary.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/headless-browser-boundary.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/headless-migration.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/headless-runtime-probe.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/headless-semantic-fixture.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/headless-session.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/independent-timer-ledger.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/session-async-store-isolation.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/session-disposal-c6.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/session-lifecycle.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/session-runtime-ownership.test.tsx`
- `packages/editor-classic/src/editor/session/__tests__/session-state-isolation.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/session-timer-matrix.test.ts`
- `packages/editor-classic/src/editor/session/__tests__/wasm-test-mock.ts`
- `packages/editor-classic/src/editor/session/c6-disposal-harness.tsx`
- `packages/editor-classic/src/editor/session/c6-durable-reopen-browser.ts`
- `packages/editor-classic/src/editor/session/c6-durable-reopen.ts`
- `packages/editor-classic/src/editor/session/create-session.ts`
- `packages/editor-classic/src/editor/session/disposal-oracle.ts`
- `packages/editor-classic/src/editor/session/editor-session-host.tsx`
- `packages/editor-classic/src/editor/session/editor-session-provider.tsx`
- `packages/editor-classic/src/editor/session/headless-proof-control-react-browser.ts`
- `packages/editor-classic/src/editor/session/headless-proof-control-react.ts`
- `packages/editor-classic/src/editor/session/headless-proof-control.ts`
- `packages/editor-classic/src/editor/session/headless-runtime-probe.ts`
- `packages/editor-classic/src/editor/session/headless-semantic-fixture.ts`
- `packages/editor-classic/src/editor/session/headless.ts`
- `packages/editor-classic/src/editor/session/independent-timer-ledger.ts`
- `packages/editor-classic/src/editor/session/index.ts`
- `packages/editor-classic/src/editor/session/migration-gate.ts`
- `packages/editor-classic/src/editor/session/resources.ts`
- `packages/editor-classic/src/editor/session/session-resources.ts`
- `packages/editor-classic/src/editor/session/session-types.ts`
- `packages/editor-classic/src/editor/surface/editor-root.tsx`
- `packages/editor-classic/src/editor/surface/embedding/__tests__/surface-composition.test.ts`
- `packages/editor-classic/src/editor/surface/embedding/__tests__/surface-drag-coordinator.test.ts`
- `packages/editor-classic/src/editor/surface/embedding/__tests__/surface-drag-integrations.test.ts`
- `packages/editor-classic/src/editor/surface/embedding/__tests__/surface-error-boundary.test.ts`
- `packages/editor-classic/src/editor/surface/embedding/__tests__/surface-focus.test.ts`
- `packages/editor-classic/src/editor/surface/embedding/__tests__/surface-keybinding-scope.test.ts`
- `packages/editor-classic/src/editor/surface/embedding/__tests__/surface-lifecycle.test.ts`
- `packages/editor-classic/src/editor/surface/embedding/__tests__/surface-portal.test.ts`
- `packages/editor-classic/src/editor/surface/embedding/__tests__/surface-react-identity-probe.test.ts`
- `packages/editor-classic/src/editor/surface/embedding/__tests__/surface-transaction-binding.test.ts`
- `packages/editor-classic/src/editor/surface/embedding/editor-surface.tsx`
- `packages/editor-classic/src/editor/surface/embedding/index.ts`
- `packages/editor-classic/src/editor/surface/embedding/session-surface-bridge.tsx`
- `packages/editor-classic/src/editor/surface/embedding/surface-commit-context.tsx`
- `packages/editor-classic/src/editor/surface/embedding/surface-contract.assertions.ts`
- `packages/editor-classic/src/editor/surface/embedding/surface-drag-coordinator.tsx`
- `packages/editor-classic/src/editor/surface/embedding/surface-error-boundary.tsx`
- `packages/editor-classic/src/editor/surface/embedding/surface-evidence-seams.tsx`
- `packages/editor-classic/src/editor/surface/embedding/surface-focus.ts`
- `packages/editor-classic/src/editor/surface/embedding/surface-lifecycle.ts`
- `packages/editor-classic/src/editor/surface/embedding/surface-portal.tsx`
- `packages/editor-classic/src/editor/surface/embedding/surface-react-identity-probe.tsx`
- `packages/editor-classic/src/editor/surface/embedding/surface-transaction-binding.ts`
- `packages/editor-classic/src/editor/surface/embedding/types.ts`
- `packages/editor-classic/src/editor/surface/evidence/agent-evidence-run.ts`
- `packages/editor-classic/src/editor/surface/evidence/surface-evidence-harness.tsx`
- `packages/editor-classic/src/editor/transactions/opencut/__tests__/adapter-router.test.ts`
- `packages/editor-classic/src/editor/transactions/opencut/__tests__/agent-opencut-projection.test.ts`
- `packages/editor-classic/src/editor/transactions/opencut/__tests__/fixture.ts`
- `packages/editor-classic/src/editor/transactions/opencut/__tests__/routing-registry.test.ts`
- `packages/editor-classic/src/editor/transactions/opencut/adapter.ts`
- `packages/editor-classic/src/editor/transactions/opencut/arbiter.ts`
- `packages/editor-classic/src/editor/transactions/opencut/draft-context.ts`
- `packages/editor-classic/src/editor/transactions/opencut/history-rebase.ts`
- `packages/editor-classic/src/editor/transactions/opencut/index.ts`
- `packages/editor-classic/src/editor/transactions/opencut/projection.ts`
- `packages/editor-classic/src/editor/transactions/opencut/router.ts`
- `packages/editor-classic/src/editor/transactions/opencut/routing.ts`
- `packages/editor-classic/src/editor/transactions/opencut/types.ts`
- `packages/editor-classic/src/editor/use-session-store.ts`
- `packages/editor-classic/src/evidence/headless.ts`
- `packages/editor-classic/src/evidence/index.ts`
- `packages/editor-classic/src/fonts/__tests__/host-font-assets.test.ts`
- `packages/editor-classic/src/fonts/index.ts`
- `packages/editor-classic/src/graphics/generated-preview.ts`
- `packages/editor-classic/src/index.ts`
- `packages/editor-classic/src/media/__tests__/audio-resource-lifecycle.test.ts`
- `packages/editor-classic/src/media/__tests__/persistence.test.ts`
- `packages/editor-classic/src/media/__tests__/processing-capacity.test.ts`
- `packages/editor-classic/src/media/index.ts`
- `packages/editor-classic/src/media/persistence.ts`
- `packages/editor-classic/src/preview/components/__tests__/timecode-playback-subscription.test.ts`
- `packages/editor-classic/src/preview/components/playback-time-subscription.ts`
- `packages/editor-classic/src/preview/components/use-playback-time.ts`
- `packages/editor-classic/src/project/index.ts`
- `packages/editor-classic/src/renderer/index.ts`
- `packages/editor-classic/src/runtime/index.ts`
- `packages/editor-classic/src/services/renderer/__tests__/effect-preview-ownership.test.ts`
- `packages/editor-classic/src/services/renderer/__tests__/host-effect-preview.test.ts`
- `packages/editor-classic/src/services/renderer/effect-preview-source.ts`
- `packages/editor-classic/src/services/renderer/nodes/sticker-cache-key.ts`
- `packages/editor-classic/src/services/storage/__tests__/browser-project-store-cascade-topology.test.ts`
- `packages/editor-classic/src/services/storage/__tests__/browser-project-store-media-topology.test.ts`
- `packages/editor-classic/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts`
- `packages/editor-classic/src/services/storage/__tests__/browser-project-store-records.test.ts`
- `packages/editor-classic/src/services/storage/__tests__/browser-project-store-topology.test.ts`
- `packages/editor-classic/src/services/storage/__tests__/migration-provider-private.test.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-cascade-manager.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-cascade-probes.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-cascade-round2-probes.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-cascade.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-conformance.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-control.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-internals.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-library-clear-bindings.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-media-ownership.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-migration-round2-probes.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-migration.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-records.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-residual-probes.ts`
- `packages/editor-classic/src/services/storage/browser-project-store-topology.ts`
- `packages/editor-classic/src/services/storage/browser-project-store.ts`
- `packages/editor-classic/src/services/storage/browser-storage-mechanisms.ts`
- `packages/editor-classic/src/services/transcription/__tests__/session-service.test.ts`
- `packages/editor-classic/src/services/video-cache/__tests__/service-ownership.test.ts`
- `packages/editor-classic/src/services/waveform-cache/__tests__/service-ownership.test.ts`
- `packages/editor-classic/src/session/index.ts`
- `packages/editor-classic/src/stickers/__tests__/host-assets.test.ts`
- `packages/editor-classic/src/storage/conformance.ts`
- `packages/editor-classic/src/storage/index.ts`
- `packages/editor-classic/src/storage/migrations.ts`
- `packages/editor-classic/src/surface/index.ts`
- `packages/editor-classic/src/surface/surface.css`
- `packages/editor-classic/src/timeline/__tests__/element-with-track-selector.test.ts`
- `packages/editor-classic/src/timeline/element-with-track-selector.ts`
- `packages/editor-classic/src/ui/index.ts`
- `packages/editor-classic/src/utils/__tests__/browser-resource-lifecycle.test.ts`
- `packages/editor-classic/surface.json`

### `packages/editor-contracts` (63 file(s))

- `packages/editor-contracts/LICENSE`
- `packages/editor-contracts/NOTICE`
- `packages/editor-contracts/README.md`
- `packages/editor-contracts/package.json`
- `packages/editor-contracts/src/conformance/index.ts`
- `packages/editor-contracts/src/conformance/requirements/__tests__/requirements-index.test.ts`
- `packages/editor-contracts/src/conformance/requirements/index.ts`
- `packages/editor-contracts/src/domain.ts`
- `packages/editor-contracts/src/draft/__tests__/draft.test.ts`
- `packages/editor-contracts/src/draft/classification.ts`
- `packages/editor-contracts/src/draft/conformance/index.ts`
- `packages/editor-contracts/src/draft/immutable.ts`
- `packages/editor-contracts/src/draft/index.ts`
- `packages/editor-contracts/src/draft/inverse.ts`
- `packages/editor-contracts/src/draft/manager.ts`
- `packages/editor-contracts/src/draft/retention.ts`
- `packages/editor-contracts/src/draft/review.ts`
- `packages/editor-contracts/src/draft/types.ts`
- `packages/editor-contracts/src/engine/__tests__/capture-boundary.types.ts`
- `packages/editor-contracts/src/engine/__tests__/engine.test.ts`
- `packages/editor-contracts/src/engine/adapter.ts`
- `packages/editor-contracts/src/engine/clone.ts`
- `packages/editor-contracts/src/engine/conformance/index.ts`
- `packages/editor-contracts/src/engine/engine.ts`
- `packages/editor-contracts/src/engine/evaluator.ts`
- `packages/editor-contracts/src/engine/index.ts`
- `packages/editor-contracts/src/engine/invariant.ts`
- `packages/editor-contracts/src/engine/native-adapter.ts`
- `packages/editor-contracts/src/engine/placement.ts`
- `packages/editor-contracts/src/engine/projection.ts`
- `packages/editor-contracts/src/engine/types.ts`
- `packages/editor-contracts/src/in-memory/__tests__/in-memory.test.ts`
- `packages/editor-contracts/src/in-memory/index.ts`
- `packages/editor-contracts/src/index.ts`
- `packages/editor-contracts/src/interfaces.ts`
- `packages/editor-contracts/src/operations.ts`
- `packages/editor-contracts/src/transaction.ts`
- `packages/editor-contracts/src/vectors/__tests__/agent-drivers.test.ts`
- `packages/editor-contracts/src/vectors/__tests__/agent-scenario.test.ts`
- `packages/editor-contracts/src/vectors/__tests__/contract-surface.test.ts`
- `packages/editor-contracts/src/vectors/__tests__/corpus-fixture.ts`
- `packages/editor-contracts/src/vectors/__tests__/corpus-isolation.test.ts`
- `packages/editor-contracts/src/vectors/__tests__/coverage.test.ts`
- `packages/editor-contracts/src/vectors/__tests__/loader.test.ts`
- `packages/editor-contracts/src/vectors/__tests__/mutation-matrix.test.ts`
- `packages/editor-contracts/src/vectors/__tests__/mutation-targets.ts`
- `packages/editor-contracts/src/vectors/__tests__/published-corpus-entry.test.ts`
- `packages/editor-contracts/src/vectors/__tests__/runner.test.ts`
- `packages/editor-contracts/src/vectors/agent-scenario.ts`
- `packages/editor-contracts/src/vectors/contract-surface.ts`
- `packages/editor-contracts/src/vectors/corpus/document-vectors.json`
- `packages/editor-contracts/src/vectors/corpus/index.ts`
- `packages/editor-contracts/src/vectors/corpus/manifest.json`
- `packages/editor-contracts/src/vectors/corpus/scenario-vectors.json`
- `packages/editor-contracts/src/vectors/coverage.ts`
- `packages/editor-contracts/src/vectors/drivers/durable.ts`
- `packages/editor-contracts/src/vectors/drivers/in-memory.ts`
- `packages/editor-contracts/src/vectors/index.ts`
- `packages/editor-contracts/src/vectors/loader.ts`
- `packages/editor-contracts/src/vectors/runner.ts`
- `packages/editor-contracts/src/vectors/schema.ts`
- `packages/editor-contracts/src/vectors/sha256.ts`
- `packages/editor-contracts/surface.json`

### `packages/editor-ports` (25 file(s))

- `packages/editor-ports/LICENSE`
- `packages/editor-ports/NOTICE`
- `packages/editor-ports/README.md`
- `packages/editor-ports/package.json`
- `packages/editor-ports/src/DECISIONS.md`
- `packages/editor-ports/src/__tests__/conformance.test.ts`
- `packages/editor-ports/src/__tests__/port-roles.compile-guard.ts`
- `packages/editor-ports/src/__tests__/runtime-graphics-query.compile-guard.ts`
- `packages/editor-ports/src/assets.ts`
- `packages/editor-ports/src/conformance/__tests__/requirements-index.test.ts`
- `packages/editor-ports/src/conformance/index.ts`
- `packages/editor-ports/src/conformance/requirements.ts`
- `packages/editor-ports/src/diagnostics.ts`
- `packages/editor-ports/src/environment.ts`
- `packages/editor-ports/src/export-provider.ts`
- `packages/editor-ports/src/gpu-resources.ts`
- `packages/editor-ports/src/host/index.ts`
- `packages/editor-ports/src/id-generator.ts`
- `packages/editor-ports/src/identity.ts`
- `packages/editor-ports/src/in-memory/host.ts`
- `packages/editor-ports/src/in-memory/index.ts`
- `packages/editor-ports/src/index.ts`
- `packages/editor-ports/src/project-store.ts`
- `packages/editor-ports/src/runtime-resources.ts`
- `packages/editor-ports/surface.json`

### `rust` (2 file(s))

- `rust/wasm/LICENSE`
- `rust/wasm/src/runtime_state.rs`

### `script` (114 file(s))

- `script/__tests__/c5-emitted-runtime-assets-red.test.mjs`
- `script/__tests__/c5-runtime-asset-boundary-red.test.mjs`
- `script/__tests__/c5-storage-boundary-red.test.mjs`
- `script/__tests__/c6-session-resource-boundary.test.mjs`
- `script/__tests__/c7-headless-graph.test.mjs`
- `script/__tests__/c7-headless-semantic-result.test.mjs`
- `script/build-wasm.mjs`
- `script/check-agent-evidence.mjs`
- `script/check-asset-manifest.mjs`
- `script/check-distributable-boundary.mjs`
- `script/check-editor-singleton.mjs`
- `script/check-emitted-runtime-assets.mjs`
- `script/check-headless-graph.mjs`
- `script/check-headless-semantic-result.mjs`
- `script/check-host-composition.mjs`
- `script/check-next-imports.mjs`
- `script/check-package-boundary.mjs`
- `script/check-packed-manifest-closure.mjs`
- `script/check-port-boundary.mjs`
- `script/check-react-singleton.mjs`
- `script/check-reference-boundary.mjs`
- `script/check-resolution-equivalence.mjs`
- `script/check-runtime-asset-boundary.mjs`
- `script/check-sdk-consumer-view.mjs`
- `script/check-sdk-surface-labels.mjs`
- `script/check-session-resource-boundary.mjs`
- `script/check-session-state-boundary.mjs`
- `script/check-storage-boundary.mjs`
- `script/check-surface-boundary.mjs`
- `script/check-surface-css-boundary.mjs`
- `script/check-surface-portal-boundary.mjs`
- `script/check-surface-private-drag.mjs`
- `script/check-transaction-boundary.mjs`
- `script/check-type-baseline.mjs`
- `script/check-wasm-api-surface.mjs`
- `script/check-wasm-paths.mjs`
- `script/check-wasm-source.mjs`
- `script/collect-next-editor-module-ids.mjs`
- `script/diff-parity-snapshots.mjs`
- `script/fixtures/c5-browser-store-conformance/browser-store-conformance.ts`
- `script/fixtures/c5-storage-boundary/direct-adapter/apps/web/src/core/consumer.ts`
- `script/fixtures/c5-storage-boundary/direct-indexeddb/apps/web/src/core/consumer.ts`
- `script/fixtures/c5-storage-boundary/direct-opfs/apps/web/src/core/consumer.ts`
- `script/fixtures/c5-storage-boundary/direct-singleton/apps/web/src/core/consumer.ts`
- `script/fixtures/c5-storage-boundary/hidden-host-storage/packages/editor-ports/src/index.ts`
- `script/fixtures/c5-storage-boundary/in-memory-fallback/apps/vite-example/src/host/vite-host-config.ts`
- `script/fixtures/c5-storage-boundary/localstorage-presets/apps/web/src/timeline/components/graph-editor/custom-presets-store.ts`
- `script/fixtures/c5-storage-boundary/localstorage-sounds/apps/web/src/sounds/sounds-store.ts`
- `script/fixtures/c5-storage-boundary/mechanism-type-leak/apps/web/src/editor/ports/project-store.ts`
- `script/fixtures/c5-storage-boundary/physical-storage-path-leak/packages/editor-ports/src/project-store.ts`
- `script/fixtures/c5-storage-boundary/private-storage-context/apps/web/src/editor/storage-context.tsx`
- `script/fixtures/c5-storage-boundary/public-command-leak/packages/editor-ports/src/project-store.ts`
- `script/fixtures/c5-storage-boundary/public-schema-leak/packages/editor-ports/src/project-store.ts`
- `script/fixtures/c5-storage-boundary/public-state-store-leak/packages/editor-ports/src/project-store.ts`
- `script/fixtures/c5-storage-boundary/public-storage-implementation-leak/packages/editor-ports/src/project-store.ts`
- `script/fixtures/c5-storage-boundary/second-media-port/apps/web/src/editor/ports/index.ts`
- `script/fixtures/c5-storage-boundary/second-storage-port/apps/web/src/editor/ports/index.ts`
- `script/fixtures/c5-storage-boundary/unlisted-verification/apps/vite-example/tests/probe/unlisted.ts`
- `script/fixtures/c6-session-resource-closure-anchor.json`
- `script/fixtures/c6-session-resource-expected-closure.json`
- `script/fixtures/c7-headless-runtime-sensitivity-control.ts`
- `script/fixtures/editor-singleton-negative/current-session-route.ts.fixture`
- `script/fixtures/editor-singleton-negative/empty-subscriber-facade.ts.fixture`
- `script/fixtures/editor-singleton-negative/empty-subscriber.ts.fixture`
- `script/fixtures/editor-singleton-negative/get-instance.ts.fixture`
- `script/fixtures/editor-singleton-negative/module-scope-construction.ts.fixture`
- `script/fixtures/editor-singleton-negative/outside-owner-construction.ts.fixture`
- `script/fixtures/editor-singleton-negative/outside-owner-wrapper.ts.fixture`
- `script/fixtures/editor-singleton-negative/reset.ts.fixture`
- `script/fixtures/editor-singleton-negative/static-instance.ts.fixture`
- `script/fixtures/editor-singleton-negative/use-editor-alias.ts.fixture`
- `script/fixtures/editor-singleton-negative/use-editor-no-selector.ts.fixture`
- `script/fixtures/editor-singleton-negative/use-editor-optional.ts.fixture`
- `script/fixtures/session-state-ownership.json`
- `script/fixtures/third-party-adapter-variant-nonconforming/README.md`
- `script/fixtures/third-party-adapter-variant-nonconforming/__tests__/migration-walker.test.ts`
- `script/fixtures/third-party-adapter-variant-nonconforming/package.json`
- `script/fixtures/third-party-adapter-variant-nonconforming/run.ts`
- `script/fixtures/third-party-adapter-variant-nonconforming/src/alien-codec.ts`
- `script/fixtures/third-party-adapter-variant-nonconforming/src/alien-control.ts`
- `script/fixtures/third-party-adapter-variant-nonconforming/src/alien-store.ts`
- `script/fixtures/third-party-adapter-variant-nonconforming/src/factories.ts`
- `script/fixtures/third-party-adapter-variant-nonconforming/src/migrate.ts`
- `script/fixtures/third-party-adapter-variant-nonconforming/src/roles.ts`
- `script/fixtures/third-party-adapter-variant-nonconforming/src/transaction.ts`
- `script/fixtures/third-party-adapter/README.md`
- `script/fixtures/third-party-adapter/__tests__/migration-walker.test.ts`
- `script/fixtures/third-party-adapter/package.json`
- `script/fixtures/third-party-adapter/run.ts`
- `script/fixtures/third-party-adapter/src/alien-codec.ts`
- `script/fixtures/third-party-adapter/src/alien-control.ts`
- `script/fixtures/third-party-adapter/src/alien-store.ts`
- `script/fixtures/third-party-adapter/src/factories.ts`
- `script/fixtures/third-party-adapter/src/migrate.ts`
- `script/fixtures/third-party-adapter/src/roles.ts`
- `script/fixtures/third-party-adapter/src/transaction.ts`
- `script/fixtures/type-baseline.json`
- `script/fixtures/wasm-runtime-contract.ts`
- `script/fixtures/wasm-runtime-failure-probe.html`
- `script/fixtures/wasm-runtime-probe.html`
- `script/generate-sbom.mjs`
- `script/generate-session-resource-closure.mjs`
- `script/generate-source-inventory.mjs`
- `script/generate-vector-manifest.mjs`
- `script/pack-sdk-tarballs.mjs`
- `script/reconcile-provenance.mjs`
- `script/run-c6-browser-oracle.mjs`
- `script/run-c7-headless-host.mjs`
- `script/run-published-examples.mjs`
- `script/run-scratch-conformance.mjs`
- `script/run-wasm-api-contract.mjs`
- `script/scratch-install-harness.mjs`
- `script/test-wasm-runtime-api.mjs`
- `script/wasm-api-surface-contract.mjs`

