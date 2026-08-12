# R2 ship log — local only

## Delivery

| item | value |
| --- | --- |
| Mode | **local commit only** — no push, no PR, no remote of any kind |
| Branch | `recovery/s0304-ui-commit-routing-final` |
| Base | `cdfae229` |
| Ship commit | `05befb57` — `feat(surface): scope editor CSS, own portals and drags, share React 18` |
| Files | 108 staged (product, checks, tests, dependency metadata, planning, evidence) |
| Final build marker | `r2-final-source-20260812-aa`, both Hosts |

## What was deliberately NOT committed

Staging was explicit (`git add -- apps script .gitignore bun.lock package.json`
plus a forced add of the change directory), never `git add -A` from the repo root.

- **`.rasen/`** — run-state and ephemera. It is *not* covered by `.gitignore`, so a
  root-level `git add -A` would have swept **87** files of pipeline state into the
  commit. Task 8.10 forbids exactly that.
- **`apps/vite-example/dist-surface-css/`** — the emitted distributable stylesheet. It
  is the one manifest path not committed, by design: it is generated output,
  reproducible with `bun run --cwd apps/vite-example build --config vite.surface-css.config.ts`,
  and `check-surface-css-boundary.mjs` reads it from disk rather than from git. Newly
  ignored by this change, along with a stray root-level copy left by an abandoned
  wrapper approach, which was deleted.
- Build output (`dist/`, `.next/`), parity artifacts and Playwright output dirs — all
  already ignored; `.pw-output-c5-storage/` was added to the ignore list here because
  the newly-added c5-storage gate leaves output behind.

The change directory sits in `.git/info/exclude`, a machine-local list that also
carries every other in-progress change in this portfolio. R1 force-added past it for
the same reason, so this follows the established convention rather than inventing one.

## Gate state at ship

| gate | result |
| --- | --- |
| Focused Bun Surface suites | 48 pass / 0 fail / 259 expectations / 10 files |
| Type baseline | 3 diagnostics, 0 outside the pin at `cf5e79e9` |
| Vite typecheck | PASS |
| Changed-file ESLint | 8 errors + 1 warning, every one proven present on the pristine HEAD blob |
| Checkers | 24 invocations clean, with 9 negative and 5 converse controls firing |
| Emitted distributable graph | 2,934 modules, 10/10 exclusions |
| Vite Surface matrix | 2/2 — 10 steps, 16 assertions, 0 step errors |
| Next Surface matrix | 2/2 — 10 steps, 16 assertions, 0 step errors |
| axe WCAG2A/AA both Hosts | 15 + 14 rules, 0 violations |
| S02 disposal oracle both Hosts | `clean: true` |
| Full parity both Hosts | 1/1 each — 28 / 19 / 9 |
| c5-storage (incl. C4 forced-none) | 5/5 |
| Source hash manifest | 64 / 64 equal before builds and after all browser runs |
| Artifact manifest | 27 / 27 verify |
| `rasen validate --strict --project rocut` | `valid: true`, 1/1, 0 issues |
| `tasks.md` | 47 / 49, with both open items explained in the file |

## Independent review

A non-author Claude reviewer ran three rounds, read-only, and did not accept the
author's framing:

1. **FAIL** — 1 blocker, 7 major, 8 minor.
2. **PASS WITH FINDINGS** — all round-1 items verified fixed; 3 new majors, 5 minors.
3. **PASS** — explicitly "shippable local-only"; 2 minor documentation findings, both
   applied before this commit.

The blocker was real and load-bearing: `EditorRoot` had become hard-dependent on
`SurfaceDragProvider`, and the C4 forced-none harness supplied neither that nor the
portal owner, so the Timeline subtree threw on a live route that **no R2 gate
covered**. Reproduced before the fix (`data-status="error"`, 4 page errors) and
verified after (c5-storage 5/5). The c5-storage suite is now part of the gate set.

## Things the reader should not over-read

- **Parity 28/19/9 equals R1's authoritative count, and that equality is not the
  evidence.** Across five cross-host pairings this session the semantic total ran
  20, 19, 20, 19, 19 with no source, build or host change explaining the movement, and
  a same-host control produced 18/18/0 comparing a Host against itself. The argument
  is the movement plus the control, not the coincidence. See
  `evidence/parity-nondeterminism-control.md`, which also records the earlier draft's
  overstated mechanism and the fingerprint-truncation blind spot that remains open.
- **Ten rebuild-and-rerun cycles were consumed.** Each was invalidated by a real fix,
  never by relaxing a gate. Three of the last four failures were defects in the
  author's own *evidence changes*, not in the product — recorded in the implementation
  report rather than smoothed over.
- **`useLayoutEffect` in `SurfaceDragProvider` is spec-driven, not failure-driven.** It
  was introduced on a diagnosis that turned out to be wrong; it is retained because the
  spec requires synchronous listener removal on unmount and a passive effect cannot
  provide it. No observed run produced the stale delivery it guards against.
- Bounded accessibility claim, React-boundary scope, the inherited parity-classifier
  blind spots, inherited lint debt, browser portal evidence covering only a Dialog,
  single-drag-per-Surface concurrency, and the absent physical no-rasterizer
  environment all remain as stated limitations in `evidence/implementation-report.md`.

## Not authorized by this log

No push, no PR, no publication, and no parent-level portfolio delivery. The portfolio
must not be pushed partially; delivery is one user-approved parent action after all
nine children are archived.

## Archive
**Date:** 2026-08-12T12:58:51.135Z
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\changes\archive\2026-08-12-s0304-surface-css-react-a11y
**Transaction:** 2eeeb4b6-c46a-4586-bcc0-4d515ef9e07c
