# Ship Log: s05-package-boundary-freeze

**Date:** 2026-08-13T14:36:29Z
**Mode:** local
**Branch:** feat/s05-community-beta
**Commit:** 333b2952 (ship commit; carries five prior commits below)
**Tree:** 46ad8a129731b2085822e336dffc0bd1b003d592
**Status:** Committed (delivery deferred to portfolio level)

## Why local, and why now

`s05-package-boundary-freeze` is child P0 of the seven-child S05 portfolio
(`slices/05-community-beta-second-host`). All seven children accumulate
commits on this one working tree (`feat/s05-community-beta`); the portfolio
delivers **once**, at the parent, after P0–P7 all complete. Pushing this
child alone would put a partial portfolio on the remote, which the portfolio
plan forbids. **No push. No PR.**

## Commits delivered by this ship (six total)

| commit | subject |
| --- | --- |
| `5e3fc7cb` | feat(sdk): freeze the package boundary |
| `bea59790` | fix: review round 1 (2 Blockers, 3 Majors) |
| `95779c07` | fix: review round 2 (D-1..D-5, MINOR-4) |
| `2782d1a3` | fix: review round 3 (Blocker D-8, D-6/D-7/D-9/D-10/D-11) |
| `2a6c889d` | fix: review round 4 (D-12 message) |
| `333b2952` | chore(rasen): ship — append round-4 reviewer's confirmation note (D-12 resolved) to `review-report.md` |

The review loop closed **CLEAN**: zero open Blockers, zero open Majors,
confirmed by a non-author reviewer across four rounds plus a round-4 fast
confirm appended in the ship commit.

## Pre-Flight Results

- Verification: pass — `evidence/review-report.md` (4 rounds + round-4
  confirm), plus `checker-family-regression.md`, `inverted-import-proof.md`,
  `load-time-guard-proof.md`, `negative-and-converse-control.md`,
  `normal-run.md`, `npm-pack-dry-run.md`.
- Tasks: `tasks.md` sections 1–5 all complete (`[x]`) before this ship;
  section 6 ("Ship") items 6.1 and 6.2 completed by this ship run.

## Test Gate — re-run and measured by the shipper, not copied

Required scope: the change's own boundary checker plus the pre-existing
static-checker regression sweep (task group 4's scope) — a localized change
to `script/check-package-boundary.mjs` and `packages/*/package.json`, no
shared runtime, build, or CI config touched.

All commands below were executed fresh in this ship, from
`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut`, against tree
`46ad8a129731b2085822e336dffc0bd1b003d592`:

**`node --check script/check-package-boundary.mjs`** → `SYNTAX_OK`

**`node script/check-package-boundary.mjs`** → exit `0`
```
check-package-boundary: scanned 1031 repo file(s) (tracked + uncommitted)
  PASS  acyclic-direction: every cross-package edge points to a strictly lower declared layer (949 file(s) scanned, 341 cross-package edge(s) examined)
  PASS  public-entry-only: a specifier crossing into a package resolves only to a declared exports subpath (949 file(s) scanned, 0 @opencut/* specifier(s) examined)
  ....  no-internal-reexport: 0 files scanned — packages/ holds no source yet (no package's declared entry re-exports a module owned by another package's undeclared internals)
  PASS  no-elftia-import: no package, Host or example imports an Elftia package, protocol identifier or runtime object (1031 file(s) scanned)
  PASS  react-free-base: editor-ports and editor-contracts import no React, no DOM global, and no editor-classic module (68 file(s) scanned)
clean
```

**`node script/check-package-boundary.mjs --negative-control`** → exit `0`,
**14/14** fixtures caught (every rule proven able to fire, including the
BLOCKER-1/MAJOR-1/MAJOR-2/D-1/D-6/D-2/D-4/D-7 regression-guard fixtures
accumulated across the four review rounds).

**`node script/check-package-boundary.mjs --converse-control`** → exit `0`,
**12/12** fixtures silent (every rule proven not to misfire on a legal case).

All five figures (949/341, 949/0, dormant-0, 1031, 68) and both control
counts (14/14, 12/12) match the numbers already recorded in the change's
evidence files — re-measured, not assumed.

**Pre-existing static checkers (task 4.4 scope), all 25 run standalone:**
`22 exit 0`. The 3 that cannot run standalone, confirmed by re-running each
and reading its own stated reason — not inferred:
- `check-asset-manifest.mjs` → `no preview server at http://127.0.0.1:4173/ — fetch failed` (needs a live preview server)
- `check-headless-graph.mjs` → prints its own `usage:` line (needs `--host --producer --entry --marker --head --tree` pointing at real headless-capture-run output)
- `check-headless-semantic-result.mjs` → prints its own `usage:` line (needs `--vite`/`--next` report JSON)

`check-distributable-boundary.mjs` re-run and confirmed still carrying
`no-desktop-app` unmodified: `PASS  no-desktop-app — no apps/desktop source`.

**CRLF sweep:** every file in the six-commit diff (`git diff --name-only
8e1f18ac..2a6c889d`) checked with `tr -dc '\r' | wc -c` — all `0`. The
review-report.md addition in the ship commit itself was also `0` before
staging.

**Diff scan (step 3e):** `git diff 8e1f18ac..2a6c889d` scanned for debug
output, secrets, broken logic, leftover TODOs. The only `console.log` hits
are the checker script's own intended CLI reporting output; the only
`secret`-matching strings are the negative-control fixtures' deliberately
fake `/internal/secret` test paths. No `TODO`/`FIXME`/credential-shaped
strings found.

## Accepted-known findings — recorded, not dropped

- **D-13** (Minor): `normal-run.md` and `inverted-import-proof.md` carry a
  `public-entry-only` census line reading `(949 file(s) scanned)` without the
  specifier-count clause added by `95779c07` (D-3). Confirmed by diffing each
  recorded block against today's live output. **This is staleness, not
  fabrication** — each transcript is an honest dated record of a real run at
  its own earlier commit; `load-time-guard-proof.md` was rewritten this round
  and is current.
- **D-14** (Trivial): `document?.createElement(...)` (optional chaining) is
  silent — the DOM-member pattern requires a literal `.` after `document`.
  Same class of gap as the already-documented computed-access miss
  (`document["createElement"]`), just not yet written into the same comment.
- **D-15** (Trivial): the D-9 throw inside `scan()` surfaces as exit `1`
  (uncaught), colliding with the file's own convention that `1` means
  "violations found" and `2` means "configuration error." Practically
  unreachable; the fix (catch at the `runCheck` boundary, re-raise as
  `process.exit(2)`) is cheap but not done here.
- Round-1 remainder, still open and accepted: **MINOR-1** (trailing-comment
  false positive), **MINOR-2** (`SELF_PATH` excludes the checker from all
  five rules, not just the one it needs), **MINOR-5** (layer 0/1 may import
  any bare npm package, including React-dependent ones), **MINOR-6**
  (`guardUnownedFiles` is unreachable under the catch-all, so its scenario is
  satisfied only vacuously), **MINOR-8** (task-count mismatch: the artifact
  reads 29 boxes / 27 ticked), **MINOR-9** (`bun.lock` not regenerated for
  the three new workspace members), **TRIVIAL-1** (`apps/desktop` still named
  in `boundary.json` prose), **TRIVIAL-2** (a `*`-leading continuation line
  hides an import specifier from the naive reading).
- **Not accepted-known — flagged for P1 instead:** **D-12** (the DOM-global
  violation message; resolved in `2a6c889d`, behaviour-preservation confirmed
  by differential run in the round-4 note) and **MINOR-7**
  (`planning-context.md` still describes `public-entry-only` as dormant,
  which has been false since `bea59790`) are both recommended **fixed before
  P1** rather than carried as accepted debt, since P1's planner is the next
  reader who could be misled by either.

## Two honest limitations — not overstated

1. **`no-internal-reexport` is dormant.** It has never fired on real source
   and cannot: `packages/` holds only manifests today (`0 files scanned`,
   reported as explicit output, not a silent PASS). It becomes live only
   when P1 moves source under `packages/`.
2. **`public-entry-only` currently PASSes trivially.** There are zero
   `@opencut/*` specifiers anywhere in the tree today, so the rule has
   nothing to catch yet. P1 writes the tree's first such specifiers, which is
   where this rule stops being vacuous.
3. **`react-free-base` is an enforced floor plus an observed fact, not a
   mechanically closed proof.** Layer-0/1 source may import any bare npm
   package unchecked (MINOR-5, accepted above), and the DOM-global detection
   is a seven-member allowlist (`DOMAIN_DOCUMENT_MEMBERS`'s inverse), not an
   exhaustive enumeration of every possible DOM surface.

## Spec-falsification sweep (`slices/05-community-beta-second-host/spec.md` §3)

Read directly from
`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\elftia\elftia-wt-s05gov\rasen\work\opencut-agent-editor-sdk\slices\05-community-beta-second-host\spec.md`.

**Advanced by this child:**
- **§3.1** ("Package boundaries are declared, frozen, and enforced before
  anything consumes them") — `boundary.json`'s ownership declaration and the
  three package manifests with their export maps are the *declared* and
  *frozen* halves; the boundary checker with its negative and converse
  controls is the *enforced* half. Not fully closed by this child alone: per
  the two honest limitations above, two of the five live rules
  (`public-entry-only`, `no-internal-reexport`) have nothing real to enforce
  against until P1 moves source into `packages/`. The layered
  contracts/ports/classic split (B4) that §3.1 calls out as "P0's own first
  task" is settled in `boundary.json`'s three-package layer order.
- **§3.4** ("Elftia-absence is enforced by a mechanism, not by an absence")
  — closed as the spec itself prescribes: "enforced as one more rule inside
  the package-boundary checker P0 already builds, with the same negative
  control" (spec line 119-120). `no-elftia-import` matches specifiers,
  dependency names, protocol literals and runtime identifiers exactly per
  the spec's two matching notes, and today's baseline is clean (locks a door
  rather than repairing one, exactly as the spec frames it).

**Left untouched by this child (owned by later portfolio children):**
- **§3.2** (both Hosts consume packages; parity fixture; type-baseline
  ledger) — P1's job; `apps/web` and `apps/vite-example` still consume
  `apps/web/src` through a path alias, unchanged by this child.
- **§3.3** (second non-Elftia Host, Electron + Vite) — P2's job; no second
  Host exists yet.
- **§3.5** (third-party conformance from installed tarballs outside the
  monorepo) — P3's job. This child's `npm pack --dry-run` (task 2.5,
  `evidence/npm-pack-dry-run.md`) proves packing succeeds despite
  `"private": true`; it is *not* §3.5's install-from-scratch-project-plus-
  worked-third-party-adapter claim, and this log makes no such claim.
- **§3.6** (`0.x` versioning *and* experimental-surface labeling) — this
  child set `0.1.0` on all three manifests, but the labeling half (marking
  provider-specific/experimental exports as such) is P5's job, untouched
  here.
- **§3.7** (published installation/embedding/storage/Agent examples run
  against installed tarballs in CI) — P6's job.
- **§3.8** (legal/provenance closure: SBOM, notices, regenerated
  `SOURCE_INVENTORY`/`PATCHES.md`) — P7's job.
- **§3.9** (inherited-input closure) — not owned by any single child, but
  this child touched one strand of it as a non-regression check: task 4.4
  re-confirmed `check-distributable-boundary.mjs` still carries
  `no-desktop-app` unmodified, i.e. `apps/desktop` stays excluded. The other
  two §3.9 strands (both Hosts stay green; frozen contracts not redefined)
  were not exercised by this child, which touched no Host runtime code.

## Archive timing (not run by this ship)

`rasen status --json` resolves `archive.timing: "on-merge"` for this change,
so the in-ship archive engine (rasen-ship step 4.5) does not apply — archive
follows merge confirmation, which for this local-mode delivery means
confirmation at the *portfolio's* eventual push/PR/merge, not at this
child's commit. No archive action was taken in this ship.

## Archive
**Date:** 2026-08-13T14:54:41.837Z
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\changes\archive\2026-08-13-s05-package-boundary-freeze
**Transaction:** feed4c39-03c0-4877-98ed-269cb22f4e8a
