# C7 Sol fix round 2 -> third fresh Sol-xhigh reviewer

Date: 2026-08-05 (Asia/Shanghai)

## Identity and authority

- Worktree/branch: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c7` /
  `feat/s02-headless-editing`.
- Accepted base: HEAD `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf`, tree
  `885d307814260b77397c2c2677b9361fdfc5f5e2`.
- This leaf fixed only round-2 R1 Blocker and R3 Major. R2/R4/R5 were not reopened.
- No commit, ship, integration, spec sync, archive or Luna product work occurred. Tasks 12.6-12.8
  remain unchecked and reviewer-owned.

## Candidate fixes to review

### R1: resolved identity is mandatory

`apps/web/build/headless-webpack-graph-plugin.ts` now establishes the exact root only from
normalized, query/hash-stripped `module.resource`. `rawRequest`, `userRequest`, `request` and
`identifier()` remain raw provenance and cannot create root identity. Concatenated-owner chunk
membership is retained, and `entry.observed` is the actual resolved resource.

The RED/GREEN seam is a complete producer-to-checker envelope in
`apps/web/build/__tests__/headless-webpack-graph-plugin.test.ts`: it has no `resource`, an exact
alias-only request, real named entrypoint/chunks/emitted bytes and all required roots. It changed
from 4 pass / 1 fail to final 5/5. Review the full-envelope rejection, not only the helper predicate.

### R3: field-complete runtime sensitivity

`headless-runtime-probe.ts` now records exact ordered hook provenance and separate counts for
timeouts, intervals, RAF, Worker, AudioContext/webkitAudioContext, object URLs, WebGPU adapter,
both WebAssembly instantiate APIs, four Host calls, React DOM/server-no-DOM evidence and the
derived compositor/GPU aggregate. The evaluator validates each zero independently, rejects
unpatchable hooks and installed-but-unexercised controls, and checks aggregate consistency.

The active trigger lives outside product source at
`script/fixtures/c7-headless-runtime-sensitivity-control.ts`. The semantic fixture receives it as a
proof-only callable. This placement was forced by a real affected-gate RED: both session port and
resource acquisition boundaries reject direct global allocations inside product/session source.
No exemption or boundary rule was weakened.

Vite's injected browser control statically imports React/ReactDOM, mounts through a real
`createRoot` + `flushSync`, and disposes after the probe finishes. Next's separate server control
imports React and records explicit no-DOM absence. The Host runner accepts a control only when the
graph fails solely `forbidden.react-family`, then requires the full runtime sensitivity result.

## Final post-boundary artifacts

| Host/control | Output | Raw graph SHA-256 | Report file and SHA-256 |
| --- | --- | --- | --- |
| Vite React sensitivity | `apps/vite-example/dist-c7-r2-headless-react-control-20260805-10` | `1a7cf5bcd6a426179078db94273df827c31d019e1767bfc6a5eb516fb449c65a` | `evidence/raw/vite-r2-react-sensitivity-boundary-final2-20260805.json`; `d66942ea5910dfd6f11dc46dc6f244e60333b22f7f56d13afe2b143e4720d9b4` |
| Vite clean | `apps/vite-example/dist-c7-r2-headless-clean-20260805-3` | `6eaf3a78e5ef8a01b0b2fd3d46f6892637e9ee058bfe65ff3c266d19f1e6338c` | `evidence/raw/vite-r2-headless-clean-boundary-final-20260805.json`; `b5081b0a9d6445e25330732284959a1a8973a6fcb7a6d6f08e4b19cb4d232732` |
| Next React sensitivity | `apps/web/.next-c7-r2-headless-react-control-20260805-5` | `69187000e14d9500d78b85bd85c003df72ebf9e9bf5beedb60a81c76609c6845` | `evidence/raw/next-r2-react-sensitivity-boundary-final-20260805.json`; `00ed06adf5c086ec8300d51d56e5fc54f03260edb943bed0851dd876b5a74ce1` |
| Next clean | `apps/web/.next-c7-r2-headless-clean-20260805-3` | `078b16dd9d9358f27c7f2651bda83e9cb6e11c77a719d094d86a95df7ecac45a` | `evidence/raw/next-r2-headless-clean-boundary-final-20260805.json`; `9b0bbdff678dfc6c2dd56b5012700ddd0fc0e0b12a330d54eaf4cd67a0540002` |

The Vite control is rejected for exactly 19 React-family issues and then passes browser sensitivity;
the Next control is rejected for exactly one injected React-family issue and then passes server
sensitivity. Both clean runs pass with every observed field zero. The independent cross-Host
evaluator binds graphs `6eaf3a78...` / `078b16dd...` to the same actual edit/reopen/opaque/
attachment result. All helper PIDs/ports/profiles are cleaned. Next's automatic `tsconfig.json`
edit is restored to SHA-256
`a9b6b3497121f1da40ac2108721d3d213b5e00fb6ed2bf8f39a5867e9646c135`.

One runner invocation preceded its Vite build and truthfully failed because output 9 did not exist;
the raw record is `vite-r2-react-sensitivity-boundary-final-20260805.json`. No output-9 directory
was ever created or promoted.

## Final gates

- Focused eight-file C7 suite: `90 pass / 0 fail / 123 expectations`.
- Unfiltered Bun: `480 pass / 8 inherited fail / 2 inherited loader errors / 1,417 expectations /
  488 tests / 83 files / 43.45s`. Relative to round 1 this is exactly +38 passing tests and +42
  expectations; the six `resolveTrackPlacement`/`ZERO_MEDIA_TIME` and two loader identities are
  unchanged.
- Static boundaries: session state, session resources, port, storage, Host composition,
  runtime assets, reference and Next imports all pass.
- Vite typecheck and pinned type baseline pass; only the exact three inherited diagnostics remain.
  Targeted ESLint has zero errors, Prettier and `git diff --check` pass.
- `bun run check:wasm` passes source/freshness/license/privacy/wiring and exact `38/58/609`.
  Rust passes `12/12` plus doc tests.
- Protected ports/session types/parity/type fixture/Rust/WASM/GPU/compositor objects and generated
  JS/WASM hashes exactly match the cold baseline; protected diff/status are clean.
- Rasen strict validation: change `1/1`; main specs `14/14`; zero issues.
- Protected port `4174` is still owned by untouched PID `44516`.

## Authored set and disk record

The final authored set is 32 files (`7` tracked modifications + `25` untracked additions), excluding
generated output directories. Ordinal-sorted `path + NUL + raw bytes + NUL` SHA-256 is
`e35913a746813342a7380a2fcfc00ea1df8aa4ec92234526f07fe058152ca657`; the exact list is in the
round-2 supplement to `evidence/final-manifest.md`.

Under LEAD's explicit disk authorization, 17 initial/round-1 generated output directories were
deleted only after exact all-file directory identities, byte/file totals, historical results and
superseding roles were durably written to `evidence/review-round2-fixes.md`. Total reclaimed:
`931,758,015` bytes / `7,705` files; deletion is not recoverable from Git. All current round-2,
retained ordinary/parity, source/test/raw evidence and other-worktree state remain.

## Third-review checklist

1. Re-read `review-round2.md`, `verification-round2.md`, and `reviewer-round2.md` before judging
   this delta; do not treat fixer wording as closure.
2. Attack the R1 producer-to-checker boundary with absent/non-file/aliased resources, query/hash
   normalization, concatenated owners and named-entrypoint chunk intersection.
3. Attack each R3 field independently: provenance order/status, installed-but-zero, absent-but-
   nonzero, aggregate mismatch, fabricated React marker/mutation and copied Host results.
4. Inspect the four final graph envelopes and runtime JSON above, then rerun any affected control
   needed for independent confidence.
5. Only a clean fresh verdict may complete tasks 12.6-12.8 and release the later Luna-xhigh ship
   leaf. Any accepted product/tool fix returns to a Sol implementer first.

Primary evidence: `evidence/review-round2-fixes.md`, `evidence/review-cycle-report.md`,
`evidence/scenario-realization-map.md`, and `evidence/final-manifest.md`.
