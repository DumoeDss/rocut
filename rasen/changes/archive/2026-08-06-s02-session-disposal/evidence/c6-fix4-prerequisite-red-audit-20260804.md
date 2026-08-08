# C6 Fix-round 4 provenance and prerequisite/RED audit (2026-08-04)

## Scope and immutable identity

This is a post-implementation truth audit. It does not manufacture pre-edit chronology from the
current working tree and does not treat later GREEN evidence as an initial RED. The product
worktree remains:

- worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`
- HEAD: `d6ed4166b5ffb13257d1924851f2fa57d73d349f`
- HEAD tree: `3875074383b41f622e5f32942091468cf8959b61`
- reachable C5 product commit: `0bfcf0457385b55de815c75ec712e9b9d69da242`

Product source, tests, and scripts were frozen throughout this tail. The only product-worktree
writes were the attributable `PATCHES.md` rows and the official deterministic SBOM regeneration.
No build, browser run, cleanup, deletion, commit, ship, integration, spec sync, or archive was
performed.

## Historical prerequisite and RED task truth

The audit inspected the existing durable files, including `phase1-baseline.md`,
`planning-audit.md`, `phase1-build-before-type.log`, the phase-1 Bun/type logs, and the later C6
remediation evidence. Read-only current-tree success was not used to backfill a missing pre-edit
event.

| Task | Verdict | Durable basis |
| --- | --- | --- |
| 1.1 | **Checked.** | `phase1-baseline.md` names this exact worktree, HEAD and tree and records verbatim that `git status --short` was empty before implementation. |
| 1.4 | **Left unchecked.** | No preserved pre-edit execution records the complete `git diff --name-status` output and an attribution for every returned path. The empty-status statement supports 1.1 but is not the command-and-attribution evidence demanded by 1.4. |
| 1.5 | **Left unchecked.** | Later successful Bun, Node, browser, build, Rust/WASM and port/process checks exist, but no single durable pre-edit prerequisite audit covers that complete set plus disk space. |
| 1.6 | **Left unchecked.** | `phase1-build-before-type.log` records a build-before-type attempt that compiled and then exited 1 for eight missing environment values. No durable clean dependency/bootstrap execution precedes it. |
| 1.11 | **Left unchecked.** | Later lifecycle matrices are GREEN, but there is no saved initial failing command and attributable excerpt covering the complete concurrent-dispose/resume/repeated-transition/stale-Host matrix. |
| 1.12 | **Left unchecked.** | Later resource matrices are GREEN, but there is no saved initial failing command and attributable excerpt covering the complete delayed/rejected/reverse/exhaustive/aggregate/repeated-outcome matrix. |
| 1.13 | **Left unchecked.** | Later ordinary and negative browser controls exist, but no durable initial RED command proves both all-five `created > 0` enforcement and deliberate platform-leak sensitivity before the implementation. |
| 1.14 | **Left unchecked.** | Because 1.11-1.13 lack complete preserved initial RED executions, their commands, exit codes and attributable failure excerpts cannot now be reconstructed truthfully. |

This advances only task 1.1. Exact-base read-only reconstruction can prove present content, but it
cannot prove when an unrecorded command ran or turn later GREEN tests into historical RED evidence.

## Task 9.7 contract decision

The main `upstream-provenance` contract requires the derived modified-file inventory to be
regenerated **after the commit that changes it**. The associated reproducibility scenario also
requires the generator's enumerated set to include tracked and untracked non-ignored source. The
official `script/generate-source-inventory.mjs` hashes the upstream pin correctly, but its drift
section uses `git diff --name-status`; the script itself notes that untracked additions are
invisible before their first commit.

A no-write execution of the current official script was made by evaluating the script verbatim
with only its two `writeFileSync` calls stubbed and `REPO_ROOT` fixed to this worktree. It exited 0:

```text
inventory: 1069 files, 7.15 MB, rollup 8ce81cbd563de44ca6d99857fa9959feaeae4eb0992656deb1c4a10b7ba168bf
drift vs pin: 186 modified, 97 added
```

The committed derived inventory still reports 169 modified and 97 added. The 17 newly modified
tracked paths it would add are:

```text
apps/web/src/core/managers/audio-manager.ts
apps/web/src/export/index.ts
apps/web/src/hooks/use-raf-loop.ts
apps/web/src/media/audio.ts
apps/web/src/media/mediabunny.ts
apps/web/src/media/types.ts
apps/web/src/media/upload-toast.ts
apps/web/src/retime/audio-stretch.ts
apps/web/src/selection/hooks/use-box-select.ts
apps/web/src/selection/selectable-surface.tsx
apps/web/src/services/video-cache/service.ts
apps/web/src/services/waveform-cache/service.ts
apps/web/src/timeline/components/audio-waveform.tsx
apps/web/src/timeline/controllers/zoom-controller.ts
apps/web/src/timeline/hooks/use-edge-auto-scroll.ts
apps/web/src/timeline/hooks/use-scroll-position.ts
apps/web/src/utils/browser.ts
```

It would nevertheless omit these 14 untracked, non-ignored files in the inventoried areas:

```text
apps/web/src/app/c6-disposal/page.tsx
apps/web/src/editor/session/__tests__/c6-test-audio-context.ts
apps/web/src/editor/session/__tests__/disposal-oracle.test.ts
apps/web/src/editor/session/__tests__/independent-timer-ledger.test.ts
apps/web/src/editor/session/__tests__/session-disposal-c6.test.ts
apps/web/src/editor/session/__tests__/session-timer-matrix.test.ts
apps/web/src/editor/session/c6-disposal-harness.tsx
apps/web/src/editor/session/disposal-oracle.ts
apps/web/src/editor/session/independent-timer-ledger.ts
apps/web/src/media/__tests__/audio-resource-lifecycle.test.ts
apps/web/src/services/renderer/__tests__/effect-preview-ownership.test.ts
apps/web/src/services/video-cache/__tests__/service-ownership.test.ts
apps/web/src/services/waveform-cache/__tests__/service-ownership.test.ts
apps/web/src/utils/__tests__/browser-resource-lifecycle.test.ts
```

Writing that partial pre-commit drift set would violate both timing and enumeration requirements.
Therefore task 9.7 remains unchecked, and the derived files were not manually edited. Their
unchanged hashes are:

- `SOURCE_INVENTORY.md`: `96fc58d3edda0a5470f6d53740c1ef040042ce273dbbda687a306dbd3acfc9be`
- `SOURCE_INVENTORY.json`: `2f46765725866df895ddb157548b0a7c1b836c43ce14812d1ff222dcd8ab781d`

The post-commit owner must run the official generator twice, require identical second-run bytes,
and verify that the committed additions are present before checking 9.7.

## PATCHES.md coverage

Against the frozen C6 base, excluding the two provenance documents themselves, the tracked product
delta contains 67 paths: 48 existed at upstream pin
`cf5e79e919144200294fb9fed22a222592a0aeea` and 19 are fork-owned. The 21 intentional untracked C6
source/gate additions (14 inventoried-area files plus 7 `script/` files) are also fork-owned. Per
the `PATCHES.md` contract, new fork files are not patch rows.

Rows P-225 through P-272 cover the 48 inherited C6 paths exactly once. The mechanical audit found:

```text
all patch rows: 261
unique patch IDs: 261
maximum patch ID: 272
C6 rows: 48
C6 unique paths: 48
inherited C6 paths: 48
missing C6 rows: none
extra C6 rows: none
```

Each C6 row contains the inherited path, a distinct behavioral change, the forcing C6 task/acceptance
rationale, and the verifying test or gate. `PATCHES.md` SHA-256 after the update is
`6536dfe0b1333b51ddf9f4a4ebf0e79632dfcba22c9275c6d7d46db97077addd`.

## SBOM, license, reference, and WASM provenance gates

`node script/generate-sbom.mjs` exited 0 with 1,359 npm packages and 80 Rust/WASM crates. D-1
through D-4 remain recorded/present and D-5 remains repaired/absent. The first deterministic run
added only the already-present `apps/web/public/workers` directory to the runtime-asset rollup; a
second official run left the file byte-identical:

```text
SBOM.md sha256 before second run: d29e6b20caefee855dd2321ff47d457b7c238009093a177db6cddee4d10c6b6d
SBOM.md sha256 after second run:  d29e6b20caefee855dd2321ff47d457b7c238009093a177db6cddee4d10c6b6d
```

Additional current-source gates:

- `node script/check-session-resource-boundary.mjs --verify-provenance`: exit 0; anchored closure provenance passes with Vite 2,890 modules / 591 web-source IDs and Next 82 route files / 78 maps / 2,557 module IDs / 596 source IDs; closure digest `6ce54c5109bf886e8bb5537b980fe7f4e09f0c55e253a7e360d26cde7b4f55e4`.
- `node script/check-reference-boundary.mjs`: exit 0; 4,832 of 14,278 tracked/uncommitted files scanned; OpenChatCut path, Remotion dependency, and AGPL header checks all pass.
- `bun run check:wasm`: exit 0; generated source, path, API, license and gate-wiring checks pass (38 JS exports, 58 binary exports, 609 imports).
- `node script/run-wasm-api-contract.mjs`: exit 0.
- Raw-byte comparison against upstream pin `cf5e79e919144200294fb9fed22a222592a0aeea`: upstream `LICENSE`, root `LICENSE`, and `rust/wasm/LICENSE` are each 1,067 bytes with SHA-256 `8117f9bb64534f7530fc6139b014fd1c1465f7981f93d1871789150fa3f59d3d`; both equality checks are true.

## Final task truth

The checklist is **113 checked / 24 unchecked / 137 total**. The exact unchecked IDs are:

```text
1.4, 1.5, 1.6, 1.11, 1.12, 1.13, 1.14, 9.7, 11.10, 12.13,
13.1, 13.2, 13.3, 13.4, 13.5, 13.6,
14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8
```

Final static verification completed without changing product source: product and planning
`git diff --check` exited 0 (the product command emitted only Windows line-ending warnings), and
`rasen validate s02-session-disposal --project rocut --strict --json` reported one valid change
with zero errors.
