# Pre-move baseline — raw artifacts

Review round 1 (`evidence/review-report.md`, TRIVIAL-2) noted that `tasks.md`'s
four highest-value proof tasks — 7.1-7.4 (rule activation), 8.1/8.3 (parity),
8.6 (the test flip), 8.7 (frozen-signature audit) — existed only as prose, and
suggested committing the raw comparison artifacts (baseline JUnit/console
output, pre-move parity snapshots) they were derived from. This directory is
that follow-up.

Everything here was captured **before** this Slice's Stage A/B/C move, at
commit `8437084b` (P0's last commit) — reproduced via `git archive 8437084b |
tar -x` into a scratch tree per `tasks.md` 8.1/8.6's own stated method, kept
on disk since task time, and copied here rather than re-derived, so these are
the actual bytes the report's numbers came from, not a fresh re-run that
merely claims to match them.

## Files

- **`bun-test-full-premove.log`** — full `bun test` console output at
  `8437084b`, `649 pass / 19 fail / 5 errors / 3039 expect() calls [90.68s]`,
  668 tests across 110 files. Backs task 8.6's baseline half of the
  `+9 pass / -9 fail / -2 errors` delta, and the M-3 report fix's claim that
  the seven named post-move failures ("editor singleton boundary > the
  complete runtime graph has no implicit editor owner" + six
  `resolveTrackPlacement` cases) "appear by the identical name in the
  pre-move fail list at `8437084b`" — grep this file for any of those seven
  titles to see them fail here too, under the same underlying `wasm`/`DEFAULTS`
  errors.

- **`snapshot-vite-premove.json`** / **`snapshot-next-premove.json`** — the
  two normalized parity snapshots task 8.1's pre-move comparison diffed,
  copied verbatim from
  `apps/vite-example/tests/parity-artifacts/{vite,next}/snapshot-{vite,next}.json`
  as they stood in the `8437084b` scratch tree after both Hosts ran the parity
  scenario there.

- **`parity-diff-premove.md`** — this Slice's own unmodified
  `script/diff-parity-snapshots.mjs`, re-run against the two snapshots above.
  Reproduces task 8.1's stated pre-move result exactly: **29 difference(s):
  20 semantic, 9 incidental. 275 leaf values compared** — the same 20 semantic
  rows, all inside the `__opencutTransaction.idempotency` envelope. This is a
  live re-derivation (run this session, not carried over from task time), so
  it is independent confirmation, not just an archived copy of task 8.1's own
  number.

- **`parity-playwright-next-premove.log`** / **`parity-playwright-vite-premove.log`**
  — the Playwright runner's own console output for the two runs that produced
  the snapshots above (`playwright test --config playwright.surface.config.ts`,
  one "editing parity scenario" test each, both `1 passed`). Confirms the
  snapshots came from a clean scenario run, not a run that itself failed or
  partially completed.

- **`frozen-signature-engine.diff`**, **`frozen-signature-ports-barrel.diff`**,
  **`frozen-signature-surface-embedding-types.diff`** — `diff -u` of each
  frozen surface's pre-move content (`git show 8437084b:<old path>`) against
  its current post-move file, re-run this session. Matches task 8.7's
  description of each: the engine and surface-embedding-types diffs are each
  one import-specifier rewrite (`@/editor/ports` / `@/editor/session` →
  `@opencut/editor-ports` / relative), no exported name or shape change; the
  ports-barrel diff is a doc-comment path mention plus the `NavigationHost`
  re-export's `from` path (`../host/editor-host` → `./host`, the file task
  3.1 renamed it to), same interface, byte-identical shape.

  The fourth frozen surface — the transaction contract barrel
  (`apps/web/src/editor/transactions/opencut/index.ts` →
  `packages/editor-classic/src/editor/transactions/opencut/index.ts`) — has
  **no diff file here** because `diff -u` against the `8437084b` content
  produced empty output (exit `0`): confirmed byte-identical this session,
  matching task 8.7's claim. An empty file would have looked like a missing
  capture rather than a positive "zero differences" result, so the byte-
  identical outcome is recorded here in prose instead.

## What is deliberately not duplicated here

- **7.1-7.4** (the `public-entry-only` / `no-internal-reexport` rule-activation
  probes): each probe's exact console output (including the violation lines
  and file:line) is already quoted verbatim in `tasks.md` at the task itself,
  not summarized — that block of text *is* the raw artifact. Reproducing it
  again would mean re-adding and re-reverting the same probe imports the
  original tasks did, for a byte-for-byte identical transcript already on
  record. Rule liveness itself (that these rules still fire, right now,
  against the live tree) is independently re-verified live in this review
  round's M-1 fix (`node script/check-package-boundary.mjs
  --negative-control`, 14/14 caught across all 5 rules, including
  `public-entry-only` and `no-internal-reexport`).

- **8.3** (`PARITY.md` regeneration): the regenerated file is already
  committed at the repo root (`PARITY.md`), not scratch output — it is the
  living artifact, not something to snapshot into `evidence/` separately.

## Provenance note

These files came from a full pre-move checkout at `/tmp/rocut-premove-8437084b/`
made during this Slice's original implementation work (task 8.1/8.6), which
also carried several `.scratch-*`-prefixed logs from that same session
(`.scratch-build-vite.log`, `.scratch-install.log`, `.scratch-next-build.log`)
covering the Host builds rather than the comparisons themselves — those are
build-tool output already implied by 8.4/8.5's green checker runs and are not
copied here, to keep this directory scoped to the four tasks TRIVIAL-2 named
rather than growing into a general scratch-tree dump.
