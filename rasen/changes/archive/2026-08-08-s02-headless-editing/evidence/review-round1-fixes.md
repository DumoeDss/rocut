# C7 Sol review round-1 remediation

Date: 2026-08-05 (Asia/Shanghai)

Accepted base: `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf` / tree
`885d307814260b77397c2c2677b9361fdfc5f5e2`. This is an uncommitted Sol fix round; no ship,
integration, spec sync, or archive occurred.

## Focused RED/GREEN fixes

- R1 RED accepted an entrypoint filename when the exact Next root owned zero chunks. GREEN now
  requires non-empty actual chunk-graph membership on the root or concatenated owner and intersects
  it with the named entrypoint. Zero-root, concatenated-owner, wrong-entrypoint-owner and truncated-
  byte cases pass `4/4`.
- R2 RED accepted copied Vite JS/map output with no executable HTML. GREEN collects final
  `headless.html` bytes during `writeBundle`; the checker re-reads its digest/scripts and requires a
  module script to an exact entry chunk. Missing HTML, altered bytes and wrong-script controls join
  the prior graph controls; the graph suite passes `19/19`.
- R3 RED accepted literal zero-resource claims without provenance. GREEN installs the runtime probe
  before dynamic subject load and requires ordered events, exact Host/store binding, platform and
  Host resource observations, React markers/mutations, final resource counts and compositor/GPU
  observations. The production Vite run first exposed that `constructor.name` is minified; that
  failed run is retained at `raw/vite-headless-runtime-r1-clean-20260805.json`. The identity check
  now uses runtime `instanceof InMemoryProjectStore` plus object identity. Focused probe/evaluator/
  fixture coverage passes `19/19` after that correction.

## R4 accepted-base isolation and protected parity

The current tree and the exact accepted-base control worktree were built with the same marker
`c7-r4-base-isolation-20260805`, root base, and accepted commit identity. Their WebGPU jobs failed at
the same unchanged assertion, `tests/c3/session-capacity.pw.ts:88`: the migration completed before
Playwright observed `data-migrating=true`. The base run was on owned port `41921`; the current run
was on `41922`. This establishes an inherited oracle timing race rather than a C7 regression. The
current WebGL job passed on `41923`.

The protected Vite editing-parity scenario passed `1/1` in `39.9s`. The first Next attempt used a
previous ordinary artifact whose recorded base path was `/c7-next-ordinary-regression`; the fixed
root-path driver therefore received 404s for all prefixed Next assets and that setup result is not a
product verdict. A fresh root-base Next 16.1.3 Turbopack build generated `19/19` routes; its protected
Next editing-parity scenario then passed `1/1` in `38.7s`. Next's automatic `tsconfig.json` edit was
restored through `apply_patch` to SHA-256
`a9b6b3497121f1da40ac2108721d3d213b5e00fb6ed2bf8f39a5867e9646c135`. All owned ports were released.

## Fresh post-fix proof artifacts

- Vite React control attempt 2:
  `apps/vite-example/dist-c7-r1-headless-react-control-20260805-2`; build succeeds, exact facade and
  roots pass integrity, and the checker exits `1` for five `forbidden.react-family` identities.
  Raw graph SHA-256 `1034e9f9924196190da905dacc7bc5441b861e10d2d42eb009b4e30712361acf`.
- Vite clean attempt 2: `apps/vite-example/dist-c7-r1-headless-clean-20260805-2`; checker exits `0`
  with `14` modules / `5` files, module set
  `7a6b1b3143f62e2d869704a47b5f15bdee24ba459e2d0abc189e7396f8f58b24`, file set
  `28f24629d0f029b71d8bf11358c55b8928061a49c4ede80307855ec4e5c6338e`, and raw graph
  `37e15816416b7720ca36613841d43ac8d2a95c7088e905d2ea7ffdba0fa0174c`. Browser execution at
  `raw/vite-headless-runtime-r1-clean2-20260805.json` passes with full probe provenance, all resource/
  React/GPU counts zero, no errors and complete owned cleanup.
- Next React control attempt 1:
  `apps/web/.next-c7-r1-headless-react-control-20260805-1`; Next 16.1.3 Webpack build and all `19/19`
  static units succeed, then the checker exits `1` solely for the injected vendored React identity.
  It contains `18` modules / `26` files; raw graph SHA-256
  `d70cd8a2f20e6a18c97e142bb0f9da3a9ec48ef6660ae6d8ba3d491439ce82ff`.

## Authorized generated-cache reclamation

The valid Next React-control output measured `1,163,968,328` bytes. Its exact generated cache
`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\web\.next-c7-r1-headless-react-control-20260805-1\cache`
measured `1,091,465,931` bytes, and zero graph output/chunk references equal or begin with `cache/`.
The graph, manifests, referenced server/static files and all non-cache paths must remain. Under the
standing LEAD authorization for exact C7 cache reclamation, only this validated direct-child cache
is eligible for deletion before the clean Next build; completion is recorded below after verification.

Status: the exact cache was validated as a non-reparse-point `cache` directory directly below the
named control output, deleted with `Directory.Delete(exactPath, true)`, and verified absent. The
output and `c7-headless-graph.json` remain; E: free space after deletion was `1,464,205,312` bytes.
The generated cache is not recoverable from Git.

## Next clean and cross-Host acceptance

- Next clean attempt 1: `apps/web/.next-c7-r1-headless-clean-20260805-1`; Next 16.1.3 explicit
  Webpack build and all `19/19` static units succeed. The checker exits `0` with `15` modules / `2`
  exact closure files, module set
  `222f23ee598144eb64f2897e04b520353c34dec9ba6f9a979b3149f803d942a4`, file set
  `92607e0bb175511c65f0de848be5189531ff3454b76fb588fd3acc09a3e3e072`, and raw graph
  `306f17cdf33243bc3d8f598305421af337ba021f05faee590ab0d73fff897099`.
- The compiler-emitted WASM at
  `server/chunks/static/wasm/8258348ae71b98bc.wasm` and runtime mirror at
  `server/static/wasm/8258348ae71b98bc.wasm` both independently hash to
  `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`.
- Server execution at `raw/next-headless-runtime-r1-clean-20260805.json` returns HTTP `200`
  `application/json`; the same actual probe observations and semantic edit/reopen/opaque/attachment
  result pass with zero resources/mounts/fallback/errors and complete owned cleanup.
- The independent cross-Host evaluator accepts the two fresh reports and binds Vite graph
  `37e15816...` to Next graph `306f17cd...`. Report-file SHA-256 values are
  `bd26f621c6ce41ad01e56ae08bfdfb7b6c0f672680655c4a69c5301fa42ef8e9` (Vite) and
  `c37242add78c7e0588e35761ae6383ef07a0d282ba2d3573fbfec12a8e1a0423` (Next).
- Both Next builds' automatic `tsconfig.json` edits were restored through `apply_patch`; the file is
  back at the pre-build SHA-256 `a9b6b3497121f1da40ac2108721d3d213b5e00fb6ed2bf8f39a5867e9646c135`.

The valid Next clean output measured `1,164,007,365` bytes. Its exact generated `cache` child
measured `1,091,510,896` bytes and has zero graph output/chunk references. Under the same standing
authorization, only that validated cache is eligible for deletion; the graph, both WASM copies,
manifests, runtime files and other referenced output remain. Status: the exact non-reparse-point
cache was deleted and verified absent; the graph and both WASM paths were rechecked present. E: free
space after deletion was `1,390,096,384` bytes. The generated cache is not recoverable from Git.

Operational port audit: the only observed listener among the checked C7/validation ports was `4174`,
PID `44516`, an orphaned Vite preview rooted in the accepted-base `rocut-wt-s02` control worktree.
LEAD confirmed it predates this C7 run and is not owned by this leaf, so it was preserved. Every
port allocated by the R1 Vite/Next proof helpers was released by their recorded `finally` cleanup.

## Post-format final proof sequence

The repository formatter changed C7 source/source-map bytes after the first post-fix artifacts.
Those artifacts remain truthful but are superseded. No product/tool source changed after the
following final sequence began:

- Final Vite React control: `dist-c7-r1-headless-react-control-20260805-3`; build `0`, checker `1`
  for five React identities; `19` modules / `5` files; raw graph
  `6c6bff36576ae89ccaab7b17b433209e540b7e63ba34a56b3b2774aa61f5097d`, module set
  `be6c9bd7c8e3d516c0df8cfc2348b47e1a465945fe8688cef7f2a69770b06cbe`, file set
  `8ec7fb8a9a7f911776e34ae696d2d90e49c612902c294f7a272eb5ce169edc81`.
- Final Vite clean: `dist-c7-r1-headless-clean-20260805-3`; checker `0`; `14` modules / `5` files;
  raw graph `eeda71ecf1217b0f287765333a16d78f757b60bb910ce4b2f8a39bb7810d8932`, module set
  `e350c199c5d210efde3f670c10a22f2ae40f3f8baa2a4a86fe901abf23c951d4`, file set
  `1bd1cb6537f02324fe392a4645805db2c75e91151966a1eb5120717255f1fabe`. Browser execution at
  `raw/vite-headless-runtime-r1-final-20260805.json` passes with zero observations and complete
  cleanup.
- Final Next React control: `.next-c7-r1-headless-react-control-20260805-2`; build and `19/19`
  static units `0`, checker `1` solely for the injected vendored React identity; `18` modules / `26`
  files; raw graph `c2332f859bddeec7e0c81ba9f9eb433d89ea80b4bacef821aaa3055494765a01`, module set
  `c840e36c0808ea1e7ef2a1a12e93c205af466b7a7748027ddb409944d55d83e2`, file set
  `09cc746e03a574ef3f432010c86b63bc89067c711962f60814e9420c74fe126c`.

The final Next control measured `1,164,102,486` bytes; its exact `cache` child measured
`1,091,596,359` bytes with zero graph references. E: free space was `222,089,216` bytes, so only
that validated cache is eligible for immediate reclamation before the final clean build. Status:
the exact direct-child, non-reparse-point cache was deleted and verified absent. The control graph
remains, E: free space rose to `1,313,693,696` bytes, and the generated cache is not recoverable
from Git.

- Final Next clean: `.next-c7-r1-headless-clean-20260805-2`; Next 16.1.3 explicit Webpack build
  and `19/19` static units succeed. The strict checker exits `0` with `15` modules / `2` exact
  closure files, checker graph digest
  `05e3c327cb422378bddbf95db0ee922e5e086ff64bff18241a353fa1f759a2de`, raw graph-file SHA-256
  `b32ac37ff3f9c9139eafec67b730e89a23fed2ba171579bfbe39364a19b9040c`, module set
  `222f23ee598144eb64f2897e04b520353c34dec9ba6f9a979b3149f803d942a4`, file set
  `fc34f66a61f4fa20df695bdec442cd7177423809c1a2920bcb38f1801915af2`, and build identity
  `next-webpack:c405e64dd0c5ae11`.
- Its compiler-emitted `server/chunks/static/wasm/8258348ae71b98bc.wasm` and runtime mirror
  `server/static/wasm/8258348ae71b98bc.wasm` both exist and independently hash to the graph-recorded
  `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`.
- The final clean output measured `1,200,375,003` bytes; its exact `cache` child measured
  `1,127,872,387` bytes with zero graph references. E: free space was `110,682,112` bytes, so only
  this validated generated cache is eligible for immediate reclamation. Status: pending exact
  deletion verification; graph, manifests, both WASM copies, and other non-cache output must remain.

  Completion: the exact direct-child, non-reparse-point cache was deleted and verified absent. The
  graph and both WASM paths were rechecked present; E: free space rose to `1,238,401,024` bytes.
  The generated cache is not recoverable from Git.

- Final Next server execution at `raw/next-headless-runtime-r1-final-20260805.json` returns HTTP
  `200` `application/json` and passes the full five-event runtime probe, semantic edit/reopen,
  opaque-data and attachment checks with zero resources, React mounts, navigation attempts,
  fallback or errors. Its owned server PID `13476` and port `63318` were stopped/released.
- The final cross-Host evaluator accepts the independent reports and binds Vite raw graph
  `eeda71ec...` to Next raw graph `b32ac37f...`. Final report-file SHA-256 values are
  `c607648ea0be0828d187af0a2183a4c85d33c6ab328d7ee05f7700c69ef128db` (Vite) and
  `2cfd51488ad308c7bb348cedbd5f512b8f572361fb5e526d51890a4829740d4e` (Next).
- Next's automatic `tsconfig.json` edit was again restored through `apply_patch`; the file is back
  at SHA-256 `a9b6b3497121f1da40ac2108721d3d213b5e00fb6ed2bf8f39a5867e9646c135`.

## Final regression and boundary replay

- Final focused command: `52 pass / 0 fail / 81 expectations` across the five headless session
  files, Next producer test, graph suite, and semantic evaluator suite.
- Final unfiltered `bun test`: `442 pass / 8 fail / 2 loader errors / 1,375 expectations / 450
  tests / 83 files / 62.84s`. The earlier identity was `430/8/2/1,358`; all `12` new tests and
  `17` new expectations pass. The six named `resolveTrackPlacement`/`ZERO_MEDIA_TIME` cases plus
  the two accepted loader-error identities are unchanged.
- Vite typecheck exits `0`. `check-type-baseline` exits `0` with no diagnostic outside the exact
  three inherited identities. `git diff --check` exits `0` (line-ending notices only).
- Targeted ESLint exits `0`; four build/config paths are explicitly ignored by repository config,
  producing warnings but no errors.
- Final static boundaries all pass: session state `10/10` and `52` classified imperative modules;
  session resources `721` source / `266` frozen with all seven rules zero; port `52`; storage
  `737`; Host composition `2` roots / `734` production modules; runtime assets `736`; reference
  `5,701/10,263` applicable/enumerated files; Next imports `807` source / `25` allowlisted shell
  importers and zero editor-graph imports.
- `bun run check:wasm` exits `0`: self-built source resolution, 44-input freshness, license/wiring,
  path/privacy negatives, and exact `38` JS exports / `58` binary exports / `609` imports pass.
  `CARGO_TARGET_DIR=C:/Users/Sayo/cargo-target cargo test --manifest-path rust/wasm/Cargo.toml`
  passes `12/12` plus doc tests.
- Protected paths produce `git diff --quiet` exit `0`; all editor ports, session types, parity/type,
  Rust/WASM, GPU/compositor trees and generated JS/WASM SHA identities exactly equal the cold
  baseline.

## R5 provenance and completion records

- `PATCHES.md` P-273 records the proof-only conditional Next Webpack/async-WASM collector and real
  WASM mirror while preserving the ordinary Turbopack path.
- `BOUNDARIES.md` records the observed isolated headless boundary, shared migration gate, executable
  Vite facade, exact Next root/chunk membership, and pre-load probe. These are observed facts, not
  intended-history claims.
- Official SBOM regeneration reports `1,359` npm packages / `80` wasm crates, all D-1..D-5
  dispositions valid. `check-reference-boundary` passes and `git diff --exit-code -- SBOM.md`
  exits `0`; final SBOM SHA-256 is
  `d29e6b20caefee855dd2321ff47d457b7c238009093a177db6cddee4d10c6b6d`.
- Official `SOURCE_INVENTORY.md` regeneration is deliberately deferred to the Luna-xhigh ship leaf
  after commit: its generator reads Git status and would omit the currently untracked C7 additions.
- Final authored scope is `30` files (`7` tracked modifications / `23` untracked additions), with
  sorted `path + NUL + raw bytes + NUL` SHA-256
  `072b5fdf40f3d983c7407aae9d90e0bcd7a588803d07d21ff7785438cee65470`.
  Generated build outputs are excluded.
- `scenario-realization-map.md` contains `62` unique scenario rows across all `14` requirements;
  four later review/delivery scenarios remain explicitly pending.
- Rasen strict validation passes after evidence/task updates: child `1/1` and main specs `14/14`,
  zero issues.

Task 12.5 is complete. Tasks 12.6-12.8 remain open for a fresh non-author Sol re-review and final
acceptance; no commit, push, PR, integration, spec sync, source-inventory regeneration, or archive
occurred.
