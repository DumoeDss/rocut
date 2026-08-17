# Handoff: s05-community-beta-second-host — implementer-p0 #1

Reason: `retired-between-children`. P0 (`s05-package-boundary-freeze`) is finished, shipped
(LOCAL commits on `feat/s05-community-beta`, not pushed) and archived to
`rasen/changes/archive/2026-08-13-s05-package-boundary-freeze/`. There is nothing left to
complete on P0 — this document carries forward what P1's implementer needs to know that
`planning-context.md` and P1's own artifacts do not already say.

## Original intent

P0's job was to freeze a *source-level* package boundary — three layers
(`@opencut/editor-ports` L0, `@opencut/editor-contracts` L1, `@opencut/editor-classic` L2) declared
in `packages/boundary.json`, with every module still living under `apps/web/src` assigned to exactly
one layer or to a consumer app — and prove with a standalone checker
(`script/check-package-boundary.mjs`) that the CURRENT source graph already obeys that shape, before
P1 moves a single file into `packages/`. P0 does not move any source; P1 is the child that actually
relocates code into `packages/*/src`.

## Position

Pipeline: `small-feature` (P0's own pipeline). Portfolio: `s05-community-beta-second-host`, fully
serial, P0 → P1 → P2 → P3 → P5 → P6 → P7. P0 is `done`; P1 (`s05-package-extraction`) is next.

## Done / Remaining

Done: all of P0 — `packages/boundary.json`, `script/check-package-boundary.mjs` (5 rules, 14
negative fixtures, 12 converse fixtures), `rasen/specs/sdk-package-boundary` (0 → 8 requirements),
4 review rounds closing 2 Blockers / 3 Majors / multiple Minors and Trivials with zero open
Blockers or Majors at ship. Commits on `feat/s05-community-beta` (local, unpushed):
`5e3fc7cb, bea59790, 95779c07, 2782d1a3, 2a6c889d, 333b2952, 1085d87a, 4f72dcef, 8437084b`.

Remaining: **none.** P0 is complete; nothing here is a task for P1 to finish on P0's behalf. Everything
below is knowledge, not a backlog.

## Key decisions (and why)

### 1. Checker conventions — read before adding or changing a rule

`script/check-package-boundary.mjs` follows the same house idiom as the existing `check-*.mjs`
family (`check-port-boundary.mjs`, `check-surface-boundary.mjs`, etc.), and P1 will almost certainly
touch it (the first real files land under `packages/*/src`, which is exactly what two of its rules
have been waiting for — see the next section).

- **Structure**: shebang, `REPO_ROOT`/`fileURLToPath`, source enumerated via
  `git ls-files -z --cached --others --exclude-standard` (never a raw filesystem walk — the P0 design
  doc's D7 measured why: gitignored build output already contains the string `elftia` and a raw walk
  would hit it, the git-based idiom does not). A `RULES` array of `{ id, description, why }`, where
  `description` is either a plain string or a `(boundary) => string` function (see `react-free-base`'s
  entry, `reactFreeBaseDescription` — added in review round 3 so a renamed/added layer shows up in the
  printed line automatically instead of needing a hand edit).
- **No `main()` function** — the bottom of the file is a bare
  `if (process.argv.includes("--negative-control")) … else if (--converse-control) … else runCheck();`.
  Round 3's Blocker (D-8) was an evidence file that claimed a `main()` gated both control modes; it
  doesn't exist. If you write anything that describes this file's control flow, verify against the
  actual bottom-of-file dispatch, not against what "usually" exists in a CLI script.
- **Fixtures**: `NEGATIVE_FIXTURES` (each entry needs ≥1 rule hit — `.some()`) and `CONVERSE_FIXTURES`
  (each entry needs exactly 0 hits — `!.some()`) are arrays keyed by `rule: "<RULES[].id>"`. Every fix
  to a rule gets BOTH a negative fixture (proves the hole is now closed) and a converse fixture
  (proves the fix didn't introduce a new false positive) — this pairing is not optional style, it's
  how round 2 and round 3 caught two different real regressions before ship.
- **Fixture boundary/manifest constants are EXTENDED, never mutated.** `FIXTURE_BOUNDARY` /
  `FIXTURE_MANIFESTS` (the baseline 3-layer fixture shape) stay exactly as they are so every existing
  fixture keeps asserting against the unmodified shape. When a fixture needs a DIFFERENT boundary
  shape (a 4th package, a renamed layer, …), spread a NEW constant off the baseline instead —
  `FOURTH_PACKAGE_BOUNDARY = { ...FIXTURE_BOUNDARY, layers: [...FIXTURE_BOUNDARY.layers, "@opencut/editor-extra"] }`
  and `RENAMED_DIR_BOUNDARY` are the two examples in the file today (`script/check-package-boundary.mjs`
  around line 1112–1163). If P1 needs a fixture boundary shape neither of these covers, add a third
  constant the same way — do not repurpose or mutate either existing one, or every fixture built on it
  silently starts asserting against a different shape than its comment claims.
- **Accretive header-comment convention.** The top-of-file JSDoc narrates every review round's fixes
  in place, in order, never overwritten — "Review round 2 (the delta after `bea59790`) closed five
  further findings…", "Review round 3 (the delta after `95779c07`) closed…", "D-12 (review round
  4)…". A future round adds its OWN paragraph after the last one, citing the exact commit its delta is
  against and the exact finding IDs it closes — it does not rewrite or compress earlier paragraphs.
  This is deliberate: the header is a durable audit trail, not a changelog that gets trimmed.
- **Fail-closed idiom**: an empty scan on any LIVE rule is `exit 2`, never a silent `PASS` — matches
  `check-surface-portal-boundary.mjs` / `check-next-imports.mjs`. The two dormant-until-P1 rules
  (next section) report `0 files scanned` honestly instead.

### 2. What P1 will trip on first

`public-entry-only` and `no-internal-reexport` are both **effectively vacuous today.** Zero
`@opencut/*` specifiers exist anywhere in the repo (0 files import a package specifier), and
`packages/*/src` holds no source at all — so `public-entry-only` passes by scanning 949 files and
finding 0 specifiers to examine, and `no-internal-reexport` reports `0 files scanned` outright
(it's the one rule still explicitly marked dormant in the header doc, D6). **P1 writes the first real
`@opencut/*` import anywhere in the tree and the first real package entry file — P1 is the first
genuine exercise of both rules, not a continuation of an already-tested path.**

What to expect:
- A **real violation** looks like: a specifier that resolves outside the manifest's declared `exports`
  subpaths (`public-entry-only`), or a declared entry file re-exporting something from another
  package's undeclared internal path (`no-internal-reexport`). Both print the offending file, line,
  and (for `public-entry-only`) the resolved path that didn't match a declared subpath.
- A **false alarm** would look like: the checker firing on a specifier that P1 believes SHOULD be
  covered by a declared `exports` entry — in that case the fix is almost always to ADD the subpath to
  the package's `package.json` `exports` map (which `0.x` permits monotonically — see the debt-list
  item below on frozen entries) and to `packages/boundary.json` if ownership needs adjusting, not to
  weaken the rule itself. Only weaken the rule if you can show the CURRENT declared shape is simply
  wrong, the same bar review rounds 1–4 held every fix to.
- Run `--negative-control` and `--converse-control` after P1's first real package-entry commit, even
  though nothing about the fixtures needs to change for it to matter — it's the first time either rule
  runs with `scanned` counts other than 0/949, and it's worth eyeballing that the live numbers move the
  way you expect (specifier count > 0, file count > 0) rather than assuming a clean exit code alone
  proves the rule engaged with real content.

### 3. `DOMAIN_DOCUMENT_MEMBERS` is seven names and WILL need an eighth

`script/check-package-boundary.mjs:343`:
```
const DOMAIN_DOCUMENT_MEMBERS = ["revision", "tracks", "clips", "assets", "markers", "idempotency", "project"];
```
This is round 3's (D-7) inversion of a DOM-member denylist to a domain-member allowlist for the
`react-free-base` rule: `document.<member>` is flagged whenever `<member>` is NOT on this list, DOM or
not. The seven names are exactly what P0's own source reads off a local `document` value across all
68 layer-0/1 files scanned today — **not** a complete enumeration of every domain field that will ever
exist. Round 4's reviewer independently probed ten plausible domain reads that currently fail the
build: `id`, `title`, `projectId`, `schema`, `summary`, `scenes`, `version`, `duration`, `name`,
`metadata` — several of these are already declared on `*Document` types in layer 0/1 without
currently being read through a binding literally named `document`, so the eighth (and ninth, tenth…)
member is one ordinary P1 commit away, not hypothetical.

**When P1 hits this**: add the member's exact string to the `DOMAIN_DOCUMENT_MEMBERS` array at line
343 — nowhere else needs editing; the `DOM_DOCUMENT_MEMBER_PATTERN` regex and the violation message
(round 4's D-12 fix) both derive from this one array. Before adding, distinguish the two cases the
error message itself now names (D-12 reworded exactly this): if the flagged line is a real DOM access
(`document.createElement`, `document.hasFocus()`, …) — do NOT add it, that's the rule catching a real
leak, layer 0/1 must not touch the DOM. If it's a genuine domain-document field read (the local
document/session object, not the browser global) — add it to the array and re-run
`--negative-control`/`--converse-control` to confirm the counts are unchanged in shape (only the
matched/unmatched status of the specific line changes).

## Dead ends & gotchas

- **MSYS `/tmp` `cp` silently reintroduces CRLF.** Restoring a probe/scratch file via a plain `cp`
  through `/tmp` (rather than `git checkout --`) applies MSYS's text-mode translation on the mount,
  which a raw byte-for-byte `cp` does not survive — the file comes back CRLF even though the original
  was LF. `git ls-files --eol` caught this once during P0 (`i/lf w/crlf` where every sibling read
  `i/lf w/lf`) before it was committed. **Use `git checkout -- <path>` to revert any temporary in-place
  probe on a tracked file — never a manual backup/restore through `/tmp`.**
- **The Write tool itself emits CRLF inconsistently.** A scratch file written via the Write tool during
  P0's review came back with CRLF line endings unprompted (310 lines, 310 CR bytes — an exact 1:1, not
  a coincidence). It was caught and stripped with `tr -d '\r'` before being read by anyone else. Treat
  every file the Write tool produces as suspect until verified — don't assume LF just because the
  source content you passed in was LF.
- **`grep -c $'\r'` is actively unreliable for CRLF detection — do not use it, not even as a quick
  check.** It returned `873` on a file with **zero** CR bytes during P0 (independently confirmed via
  both `git ls-files --eol` and a raw byte scan). The durable replacement, used throughout P0 from
  round 2 onward: verify with **two independent non-grep methods** —
  `tr -dc '\r' < file | wc -c` (want `0`) **and** `git ls-files --eol -- file` (want `i/lf w/lf`).
  Never trust either alone; they've disagreed with grep, not yet with each other.
- **`grep -c` exits non-zero when the count is 0 — this silently truncates `&&` chains.** P0's own
  `.rasen/`-exclusion gate checks use exactly this shape
  (`git diff --cached --name-only | grep -c '^\.rasen/'` expected to be `0`, tasks.md:123 /
  review-report.md:65) — and because `grep -c` treats "found nothing" as failure (exit 1), chaining
  `check-command && grep -c pattern file && next-command` means `next-command` NEVER runs on the
  passing case (0 matches), only on the failing one. If you write a verification gate this shape,
  either capture the count into a variable and compare it explicitly, or accept that grep's own exit
  code is inverted from what "0 is good" intuitively suggests.

## Working set

- `script/check-package-boundary.mjs` — the checker; read the full header JSDoc first, it is the
  living design record for every rule.
- `packages/boundary.json` — the ownership map; `$comment` at the top points back to
  `rasen/changes/s05-package-boundary-freeze/design.md` D2/D3/D4 (now archived, see below) for the
  measurements behind it.
- `rasen/changes/archive/2026-08-13-s05-package-boundary-freeze/` — P0's full archived change
  (design.md, proposal.md, specs/sdk-package-boundary/spec.md, tasks.md, evidence/*). **Read-only for
  P1** — P0 is closed; do not edit anything under this path. This document exists precisely so P1
  rarely needs to open it, but the measurements (edge counts, deep-import lists, the D5 exports-map
  table) live there in full if this summary isn't enough.
- The debt list P1 inherits, in the archived design.md's own words (D5, `design.md:216-225`):
  three deep imports the current source uses that P1 must rewrite to package-root specifiers —
  `@/editor/ports/project-store` (4 uses) and `@/editor/ports/gpu-resources` (3 uses), both of which
  fetch symbols (`ProjectStore`, `ProjectStoreError`, `UNIMPLEMENTED_RUNTIME_GPU`) the package root
  already exports, so those two are pure specifier rewrites. The third,
  `@/editor/contracts/engine/invariant` (2 uses), is **not** a rewrite candidate — `engine/index.ts`
  does not re-export `invariant`, and `surface/embedding/surface-transaction-binding.ts` consumes
  `validateTransactionDocument` from it in production, so `./engine/invariant` is declared as its own
  public `exports` subpath instead of forcing an edit to a frozen barrel. Also inherited: **four test
  files** relocated by subject rather than by directory (`boundary.json`'s ownership overrides) —
  `agent-opencut-projection.test.ts` → `@opencut/editor-classic` (tests the Classic projection, not
  the contract), and three Next-Host composition tests (`branding-assets.test.ts`,
  `production-composition.test.ts`, `c5-storage-red-controls.test.ts`) → `apps/web` — the general
  principle being ownership follows the SUBJECT under test, not the directory the test file happens to
  sit in. And: `apps/web/src/feedback/` is split — `index.ts` and `queries.ts` stay `apps/web` because
  they import `@/db` (Drizzle + Postgres) and are reached only from `app/api/feedback/route.ts`, while
  `types.ts` and `components/` are `@opencut/editor-classic` because `feedback-popover.tsx` (editor
  chrome) imports them directly. **If this split were left undeclared**, the whole directory would fall
  under the `apps/web/src` catch-all into `@opencut/editor-classic`, and `feedback/index.ts`'s
  production import of `@/db` would become a real edge from the portable `editor-classic` package into
  the Next-only Postgres/Drizzle layer — the single production edge that reaches the Next shell if this
  override is ever dropped or a similar new file isn't given the same treatment.

## Next action

Read `rasen/changes/s05-community-beta-second-host/planning-context.md` (already the standard seed
for every planner in this portfolio) alongside this document, then proceed into P1
(`s05-package-extraction`)'s own `apply` — read its proposal/design/specs/tasks the normal way and
start moving source into `packages/*/src`. The first concrete trip-wire to watch for is in section 2
above: the moment the first file lands under `packages/*/src` with a real `@opencut/*` import
anywhere in the tree, `public-entry-only` and `no-internal-reexport` go from dormant/vacuous to
actually exercised for the first time — run the checker (plain, `--negative-control`,
`--converse-control`) after that first move and read the scan counts, not just the exit code.

---

## One thing in my own words: the pattern to avoid across four review rounds

Every round after the first found the SAME shape of bug at a DIFFERENT level of abstraction, not a
different bug. Round 2's D-1 found `PACKAGE_SPECIFIER_PATTERN` hardcoded to the three original package
NAMES — fixed by deriving it from `boundary.layers`. Round 3's D-6 found the exact same class of
assumption one layer deeper: not names this time, but ARITY — `boundary.layers[2]` as a literal index,
silently assuming exactly three layers would ever exist. Fixing the name-level instance did nothing
to catch the index-level instance; they looked unrelated until you named the shared assumption
("this structure has exactly the shape I see today") underneath both.

The same thing happened again with the DOM check: D-7 (round 3) inverted a denylist to an allowlist —
a real, load-bearing structural fix — but round 4's D-12 found the fix's DOWNSTREAM surface (the
printed violation MESSAGE) still assumed the old denylist's meaning, so it told an author to hunt a
nonexistent DOM access when the real fix was a one-word allowlist addition. And D-8, the one Blocker,
was a different flavor of the same root cause: an evidence file's PROSE claimed a proof covered two
code paths (`--negative-control`/`--converse-control`) that the actual code structure (no `main()`)
never let it touch.

**What I'd tell P1's implementer to do differently**: when you fix a hardcoded-assumption bug, do not
stop at "the specific broken line is now correct." Explicitly ask, once, in the same sitting: *what
else in this file assumes the SAME fact I just proved false* — at every level (a literal name, a
literal index/count, a printed message, a doc-comment claim, an evidence-file sentence describing what
the code does). Each of those is a separate surface that silently drifts out of sync with a core fix
unless someone deliberately re-reads it against the new invariant. Grep for the OLD assumption's
signature (a hardcoded number, a specific name, a stale count) across the whole file and its
neighboring evidence/design prose before calling a fix done, not just at the one call site the finding
named.
