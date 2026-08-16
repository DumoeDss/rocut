# G close-out — no-regression sweep + final gates (2026-08-17)

## Checker family (final tree)
- `check:packages` exit 0 — census 1146 repo files (+8 over the 1138 baseline,
  the change's new source files); all five rules green.
- `check:surface-labels` exit 0 — census 36 entries (frozen 16 / provider 13
  / experimental 7), dangling 0. Baseline was 35/16/13/6.
- `check-session-resource-boundary.mjs` (C6) exit 0 — all 7 rules 0 violations.
- `check-wasm-source` + `check-wasm-paths` green (unchanged from baseline;
  `check-wasm-api-surface` remains the pre-existing environment-bound red —
  baseline record, wasm session's territory).

## Frozen bytes
`git diff 661d7ac8 --stat` over the seven guarded surfaces (the five
S03/S04-frozen files + in-memory + host): **empty** (RC 0, .g4.log).

## bun test
- Full suite (post-Group-C tree): 780 tests / 123 files, exit 1 with 14
  fails = the 6 deterministic baseline failures + 8 ~5s-timeout-signature
  members of the machine-bound isolated-process wrapper family (every extra
  failure a `[5031..1078]ms` wrapper; the family is cross-proven
  environmental on the unchanged eco worktree — baseline addendum). No new
  deterministic failure.
- Final targeted sweep over the change's whole surface (post guard-final +
  deinstrumentation): `bun test apps/electron-host packages/editor-ports` —
  **88 tests / 426 expects / 0 fail / 4.34s / exit 0**.

## Parity (both hosts)
- vite full suite with markers: **4/4 green** (1.0m) — parity scenario,
  agent evidence, surface matrix, disposal oracle.
- electron editing parity scenario: **green** (1.8m).
- Snapshot diff vite↔electron: 24 differences (19 semantic — all
  `__opencutTransaction.idempotency` uuid/fingerprint run-nondeterminism;
  5 incidental one-frame/viewstate) — structurally identical to the
  archived 2026-08-15 baseline (25/20/5). Electron surface-matrix: the two
  pre-existing unevidenced steps, unchanged from baseline (unclaimed ground).

## Typecheck / lint
- `apps/electron-host` typecheck: exit 0 (after every guard iteration).
- eslint config does not cover apps/electron-host (repo scope:
  apps/web/src + packages/*); the packages/* files this change touched are
  editor-ports only — Group A ran eslint clean on them at delivery.

## The five deliverables, terminal state
1. Audit — design.md Part 1 (F1–F7) + additive-experimental resolution.
2. FFmpeg adapter — real E2E (d1 evidence: h264+aac, exact duration,
   decodable), negative leg, kept deliverable
   `rocut-export-scratch/kept-outputs/dense100-real-gpu-export.mp4`.
3. Job lifecycle — unit 8/8 + mutation pairs (A/B closeout logs); real-app:
   progress (both phases), cancel (18ms settle, no leaks), recovery
   (3 green runs incl. clean-build 20.1s, ffprobe-verified); one documented
   intermittent.
4. Perf baseline — perf-baseline-20260816.md (dense-2000 partial + crash
   signatures; swiftshader 5s→18.9s/frame environment spread; real-GPU legs
   ≈25× faster end-to-end at dense-100; honest no-gate framing).
5. Legal review — docs/export-legal-review-2026-08.md (36 citations).
