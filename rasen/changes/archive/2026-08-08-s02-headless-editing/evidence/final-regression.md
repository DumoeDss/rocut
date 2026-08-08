# C7 final regression, provenance, and scope record

Date: 2026-08-05 (Asia/Shanghai)

## Build-before-type and static gates

Fresh ordinary Vite and default Next production builds completed before the final type checks. The accepted Next ordinary build explicitly printed `Next.js 16.1.3 (Turbopack)` and generated `19/19` units.

- `bun run --cwd apps/vite-example typecheck`: exit `0`.
- `node script/check-type-baseline.mjs`: exit `0`; exactly `3` current diagnostics, all members of the pinned baseline and none new:
  - `apps/web/next.config.ts:142` `TS2345`, the accepted dual-Next `NextConfig` type-identity mismatch at `withBotId(nextConfig)`;
  - `apps/web/src/timeline/__tests__/update-pipeline.test.ts:69` `TS2769`, an inherited numeric expectation against branded `MediaTime`;
  - `apps/web/src/timeline/placement/__tests__/resolve.test.ts:646` `TS2769`, the inherited numeric `adjustedStartTime` expectation against `PlacementResult`/`MediaTime`.
- Targeted Prettier: exit `0`, all matched.
- Targeted ESLint: all configured source/test files pass. Build/config files excluded by the repository ESLint configuration were checked by TypeScript/build execution and Prettier rather than misreported as linted.
- `git diff --check`: exit `0`; only checkout line-ending notices were printed.

## Complete Bun identity

Final unfiltered `bun test`:

`430 pass / 8 fail / 2 loader errors / 1,358 expectations / 438 tests / 81 files / 39.83s`

This is the accepted integrated C6 identity (`390/8/2/1,328`) plus exactly `40` C7 passing tests and `30` counted expectations. No new red identity exists. The inherited reds remain the same six named `resolveTrackPlacement`/`ZERO_MEDIA_TIME` cases plus the two already accepted loader failures (`wasm.__wbindgen_start` and the params `DEFAULTS` initialization cycle), reported by Bun as the same aggregate `8 fail / 2 errors` shape.

## C3-C6 regression matrices and boundaries

- C7 focused: `40/40`, `64` expectations.
- Shared migration direct inner matrix: `6/6`, `16` expectations.
- C5 store/conformance/opaque/topology/migration: `67/67`, `443` expectations across eight top-level files.
- C6 lifecycle/resource/runtime/cache/persistence/Host matrix: `50/50`, `162` expectations across 18 top-level files.
- C4 Host/browser-runtime/font/sticker/transcription/conformance matrix: `49/49`, `293` expectations across six files.
- `check-port-boundary` plus called session-resource gate: PASS, `50` contract modules / `720` web source modules / frozen `266`-module attributable closure; all seven acquisition rules zero. Port and resource negative controls pass.
- Session-state gate: PASS, `10/10` store factories, `10/10` registry keys, `52` classified imperative modules; all negative controls pass. The ownership inventory now attributes `migrationRuns` to its extracted `migration-gate.ts` location without changing its shared-store classification.
- Storage boundary: PASS, `736` source modules including three exact verification fixtures, no in-memory production fallback; negative controls pass.
- Host composition, runtime-asset source, emitted runtime assets, distributable boundary, editor singleton, and reference/license policy all exit `0`.
- Real ordinary Vite and Next Chrome oracles are recorded separately in `ordinary-host-regression.md`.

The exact C6 anchored `--verify-provenance` replay could not run because its old reviewed untracked Vite artifact is absent from this fresh C7 worktree. It failed closed with `C6 anchored Vite provenance artifacts are unavailable`; this is not reported as a pass. The current source boundary, frozen closure integrity tests, independent-anchor unit cases, fresh ordinary emitted Host inventory, protected artifact identities, and negative controls all pass. Independent review should decide whether the historical C6 output must be restored solely to replay that optional anchor.

## WASM and protected identities

`bun run check:wasm` and the API negative-control matrix exit `0`:

- self-built artifact resolves from root and both Hosts;
- generated output is newer than all `44` Rust inputs;
- license equality and gate wiring pass;
- WASM path scan finds no machine identity;
- exact API surface remains `38` JS exports / `58` binary exports / `609` imports with structural compile PASS;
- every API negative control exits `1` for its intended rule.

All protected identities exactly equal the pre-edit baseline:

| Surface | Final identity |
| --- | --- |
| editor ports tree | `efe499db6bec7afb8c35ac1a2aaa5fe851fac667` |
| public session-types blob | `c67d9822a2a6c994be14f367e6980fbbaa6e454b` |
| parity fixture tree | `e1fbb55b985f4fb490c6b233d18c50c58ea14c28` |
| type fixture blob / SHA-256 | `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8` / `0f7cc855fc8f5c7edd68b2c371bae993fe8e713d2ffd4ef21956de72bd387622` |
| `rust/wasm` tree | `d782b046c0f39e85b8a5ed518b42389214c211e5` |
| GPU / compositor trees | `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2` / `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34` |
| generated JS / WASM SHA-256 | `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1` / `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1` |

`git diff --quiet` over all tracked protected surfaces exits `0`.

## Final diff and scope

Accepted base remains HEAD `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf`, tree `885d307814260b77397c2c2677b9361fdfc5f5e2`. No commit, ship, integration, spec sync, or archive has occurred.

Tracked diff: five files (`132` insertions / `184` deletions): Vite scripts/tsconfig registration, conditional Next proof config, full-factory migration extraction call site, and the moved session-state ownership attribution. Authored untracked set: exactly `20` C7 source/test/tooling files. Generated untracked set: `5,304` build/runtime files under named `dist-c7-*` and `.next-c7-*` outputs; these are evidence, not authored code.

The final path audit finds no edit to public ports/session types/store schema, parity fixture, type baseline, Rust/WASM sources or API, durable deletion behavior, E1/Elftia, S03 transaction/revision/draft semantics, S04 Surface contract, S05 packaging, or React dependency/version policy. The only shared runtime behavior change is extraction of the existing migration gate into one React-free module consumed by both factories.

## Strict artifact validation

- `rasen validate s02-headless-editing --strict --no-interactive --project rocut --json`: `1/1` valid change, zero issues.
- `rasen validate --specs --strict --no-interactive --project rocut --json`: `14/14` valid main specs, zero issues.
- Mechanical corpus: main specs `102` requirements / `324` scenarios; C7 delta `14` requirements / `62` scenarios.

Parity source/tree identity is exact, but the heavyweight protected two-Host editing-parity browser oracle was not replayed by this implementer. SBOM/source-inventory generators were also not run because they write shared repository-wide provenance documents and are post-commit/review responsibilities; no pass claim is made for those two leaves.

## Round-1 remediation regression supplement

This section supersedes only the earlier pending/count statements; the original results remain
truthful for the pre-review tree.

- Final C7 focused suite: `52 pass / 0 fail / 81 expectations` across eight files.
- Final full Bun: `442 pass / 8 fail / 2 loader errors / 1,375 expectations / 450 tests / 83
  files / 62.84s`. Relative to the earlier `430/8/2/1,358`, all `12` added tests and `17` added
  expectations pass. The six `resolveTrackPlacement`/`ZERO_MEDIA_TIME` failures plus the
  `wasm.__wbindgen_start` and params `DEFAULTS` loader identities are unchanged.
- Final Vite/Next clean graphs and runtime probes pass; both post-format React controls fail for the
  intended React rule. The final cross-Host semantic evaluator passes.
- Protected Vite editing parity passes `1/1` in `39.9s`; a fresh root-base ordinary Next 16.1.3
  Turbopack artifact passes protected editing parity `1/1` in `38.7s`.
- C3 current WebGL passes. Exact accepted-base and current WebGPU runs fail at the same unchanged
  `tests/c3/session-capacity.pw.ts:88` migration-observation assertion, proving an inherited oracle
  race rather than a C7 delta.
- `bun run check:wasm` passes source/path/license/wiring and exact `38/58/609`; Rust is `12/12`.
- SBOM regeneration now passes at `1,359` npm packages / `80` wasm crates and yields no tracked
  diff. Official source inventory alone remains deferred until the untracked authored files become
  visible to its post-commit generator.
- Vite typecheck, the exact-three pinned type gate, all final static boundaries, protected identity
  audit, child strict validation `1/1`, and main-spec strict validation `14/14` pass.

Full post-fix details and raw identities are in `review-round1-fixes.md`; reviewer disposition is
tracked separately in `review-cycle-report.md`.

## Round-2 remediation regression supplement

This is fixer evidence pending a third fresh review; it does not overwrite the round-2 reviewer
verdict.

- Final focused suite: `90 pass / 0 fail / 123 expectations` across eight files.
- Final unfiltered Bun: `480 pass / 8 inherited fail / 2 inherited loader errors / 1,417
  expectations / 488 tests / 83 files / 43.45s`. The delta from round 1 is exactly `+38` passing
  tests and `+42` expectations; no failure identity was added.
- Final post-boundary Vite control/clean graphs are `1a7cf5bc...` / `6eaf3a78...`; Next
  control/clean graphs are `69187000...` / `078b16dd...`. Both controls pass field-complete
  sensitivity after their intended React-only graph rejection, both clean runs require every
  observed field to be zero, and cross-Host evaluation passes.
- Session state/resource/port/storage/Host/runtime-asset/reference/Next-import boundaries pass.
  Vite typecheck, pinned type baseline, targeted lint/format, WASM `38/58/609`, Rust `12/12`,
  protected identities and Rasen strict `1/1 + 14/14` pass.
- Exact reports, hashes, disk reclamation and the fresh-review request are recorded in
  `review-round2-fixes.md` and `../handoff/fixer-round2.md`. Tasks 12.6-12.8 remain unchecked.
