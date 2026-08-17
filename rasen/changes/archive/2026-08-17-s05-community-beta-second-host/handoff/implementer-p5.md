# Implementer handoff — s05-versioning-and-experimental-labeling (P5) → remaining children (P6 examples, P7 provenance/closure)

Written at retirement (review loop closed CLEAN in one round, 0 Blocker / 1 Major /
4 Minor / 1 Trivial, all six fixed in one batch, commit 6f99336d; shipped and archiving
as b17d3ca5 per the lead). Dual-seed the next implementer with this document plus the
child's own change artifacts. Cross-change-transferable knowledge only; P5-internal
narrative lives in the child's `evidence/implementation-report.md` (Groups 1–9) and
`evidence/review-report.md`.

## 1. Conventions that held, and what changed

**Held from P2/P3:** one `feat(<change>):` commit per tasks.md group (fix batches take
`fix(<change>):`), explicit pathspecs only, the `.rasen/` staging guard in a variable,
LF-in-worktree verified after every write, local commits only, per-group report sections,
one review-round dispositions section per round, every headline log self-logging
`REAL_EXIT_CODE`. The change-artifact tracking split (evidence/ + tasks.md committed;
proposal/design/specs untracked until archive) held unchanged.

**Changed / new this child:**

- **Contract adjudication can arrive mid-child and redirect the census.** The dangling
  `./vectors/drivers` finding (P0's mis-declaration) was escalated, LEAD-ruled REMOVE the
  same day (2026-08-15), and executed as a completion pass INSIDE the child (commit
  0fa1e6db): census 36 → 35, frozen 17 → 16, plus a new fail-closed checker rule. When a
  ruling lands mid-flight, execute it as its own group with its own log, update every doc
  that states the old figures, and re-run the full battery — see the sweep guard in §5.
- **The review round now has a round-1 dispositions table** appended to review-report.md
  (finding / severity / disposition rows). Keep that shape.

## 2. The labeled surface, as P6 consumes it

- **What exists now:** every `exports` entry of the three packages (except the mechanical
  `./package.json`) is classified in a per-package `surface.json` that ships in the tarball
  beside the README — census 35 total: ports 6 (frozen 5 / experimental 1), contracts 10
  (frozen 9 / experimental 1), classic 19 (frozen 2 / provider 13 / experimental 4). All
  three manifests are at `0.2.0` (wasm stays at its own `0.2.10`).
- **Labels change NO import behavior.** `surface.json` and the markers are declarative
  metadata; resolution reads the exports maps only. P6's examples import by specifier
  exactly as P3's harness already does — nothing about install, bundling, or typing moves.
  Do not build any example machinery that reads surface.json at runtime; it is for humans
  and checkers.
- **Frozen classification lives in surface.json ALONE** — frozen entry files deliberately
  carry no marker, which is what keeps the four S03+S04 frozen surfaces byte-identical
  (re-proved 5×, still IDENTICAL vs `5aae75ec`). Never add a marker to a frozen file.
- **Non-frozen entries carry exactly one `@opencutSurface <class> — <reason>` marker** as
  the entry file's first doc-comment line (exactness is enforced — a stale marker beside
  the current one FAILs).
- **The three per-package READMEs are the consumer-facing policy statement** (the `0.x`
  class promises, the "this policy is the only stability claim" sentence). Classic's also
  carries the Known-constraint section on `./storage/migrations` (see §4).
- **Removal semantics:** a declared entry may not be removed, renamed, or repointed —
  EXCEPT a declared-but-never-authored target (a manifest correction, not a surface
  removal; the `./vectors/drivers` precedent, attributed in BOUNDARIES.md §14).
  Re-adding that entry requires naming the forcing module. If P6's examples need an
  export that does not exist, the move is a proposal with the forcing consumer named —
  not a barrel invented for symmetry.

## 3. The checker family P6 inherits, and census discipline for new files

- **The labels checker** (`script/check-sdk-surface-labels.mjs`, wired as
  `check:surface-labels`): four rules — completeness both directions + class vocabulary +
  non-empty reason; marker agreement (exactness: one marker, exactly the row's class;
  frozen files carry none); override validity; target existence (plain-string targets
  that exist on disk; non-string conditional targets and absent targets both fail closed
  at any class). Census lines print every run and are regression tests: live figures are
  "35 entries — frozen 16, provider 13, experimental 6, dangling 0". Negative control =
  ten in-memory worlds (10/10 must FIRE); converse control proves the designed silences;
  empty scans refuse with exit 2 (`OPENCUT_LABELS_ROOT` env seam points it at fixture
  roots).
- **If P6 adds an exports entry** (it should not need to, but if an example forces one):
  classify it at birth — the surface.json row, the in-source marker (non-frozen), and a
  plain-string target that exists must land in the SAME commit, or the checker fails the
  run. A fifth package self-registers via `packages/*/package.json` discovery.
- **Census arithmetic uses the checker's own filter.** The boundary walk
  (`check-package-boundary.mjs`) counts code files only
  (.ts/.tsx/.js/.jsx/.mjs/.cjs/package.json/bun.lock) from
  `git ls-files --cached --others --exclude-standard` — markdown, logs, and .py are
  invisible to it. Current figures: 1110 repo files in scope, 989 package-graph files,
  362 edges, 361 specifiers, 870/74. Expect +1 repo file per CODE file P6 adds anywhere
  (examples included — no-elftia-import scans repo-wide); the package-graph counts move
  only if packages/ itself changes. Do not do this arithmetic from prose — read
  `collectRepoFiles`'s filter and the checker's own printed census.
- **Family baseline:** 28 checkers, 22 exit-zero / 6 nonzero, the nonzero set exactly
  `{asset-manifest:2, emitted-runtime-assets:1, headless-graph:2,
  headless-semantic-result:2, resolution-equivalence:1, type-baseline:1}` — all known
  pre-existing / capture-run-needing. Any OTHER checker turning red is P6's finding.

## 4. The from-tarballs oracle — P6's to generalize

`consumer-view-from-tarballs.mjs` (in P5's evidence, archive-bound) is the only gate that
catches packed-artifact-level defects: it packs via P3's `packSdkTarballs` (import, never
re-implement), extracts every tarball, and verifies from the artifacts — 0.x versions,
README policy anchor, surface.json set-equality against the export map, and markers in
EXTRACTED source; dangling declared-but-absent entries fail closed at any class. It
caught `./vectors/drivers` while every workspace-side gate was blind (the boundary
checker never validates target existence; `tsc` never resolves an entry nothing imports;
file-reading checkers pass vacuously when a missing file satisfies a negative assertion
like frozen-carries-no-marker). **P6 runs its examples against INSTALLED TARDBALLS (P3's
scratch harness + its env seams, P3 §2) and owns generalizing the consumer view into a CI
leg** — the durable lesson is that the from-tarballs read must survive as a standing gate,
not one-child evidence. The four clauses above are the port surface; keep the
fail-closed dangling branch.

## 5. The wasm-init decision P6 must make in the PLAN

Classic's published migration chain (`./storage/migrations` → `src/wasm` → `media-time` →
`opencut-wasm`) dies at wasm INITIALIZATION in plain-TS consumers:
`wasm.__wbindgen_start is not a function`, identical in-repo and from installed tarballs.
Runtime failure class, Direction-level, not fixable from a child (P3 §3 has the full
mechanics). New since P3: the tension is now machine-visible — the only working init path
is classic's own mock entry `@opencut/editor-classic/evidence/wasm-test-mock`, which P5
classified **experimental** while the chain requiring it is **provider**; that
provider-chain→experimental-entry dependency is recorded verbatim in both the surface.json
reason and classic's README Known-constraint section. P6's custom-storage example decides
up front, in the plan — not mid-apply:

- **mock-entry shape:** validate migration through the published mock (the honest pair —
  production runner records the finding and skips the leg distinctly; walker validated
  against the real 31-step chain via the mock, exactly as classic's own storage tests and
  P3's adapter do). Note the label consequence: an example depending on an experimental
  entry inherits its instability, and the example should say so.
- **scope-around shape:** exclude migration from the example's scope entirely and state
  the exclusion in the example's own README.

The planner picks; both mechanics are proven working (P3's walker ran the real chain
through the mock from installed tarballs).

## 6. Tooling traps new beyond P3's set

- **An uncommitted in-flight tree reads as "not landed" to anyone inspecting mid-pass.**
  The lead's snapshot raced my completion commit and reported the ruling unexecuted
  (their grep matched the pre-commit working tree exactly). Consequences: return DONE only
  with the commit hash already in hand; keep the uncommitted window per-group small; and
  when ANYONE reports your landed work missing, re-verify at blob level first
  (`git show HEAD:<path> | grep`, stat-cache-immune) — re-executing already-landed work
  double-commits. Also expect your own DONE to arrive after their inspection; answer with
  the re-verification evidence, not a re-run.
- **The cross-cutting-correction sweep guard (review R1's durable lesson):** after any
  correction that removes/renames a declared thing, `git grep -n "<identifier>" --
  ':!rasen/changes/archive'` and disposition EVERY surviving hit by class (ruling
  narration / committed evidence / checker provenance / references to still-existing
  files that merely share the path). Classify, never uniform-sweep — archived children's
  historical records are excluded deliberately. Run at completion, it caught R1+R2 as a
  pair (shipped README figures + a checker's mirror map) that no checker covers: figure
  accuracy of shipped docs is not checker territory.
- **The self-referential sweep fixed-point:** prose inside the sweep universe that
  narrates the sweep's own terms changes the counts when edited — totals live in
  committed logs, never embedded in swept prose. The DISPOSITIONS table is keyed
  `path:line`, so ANY edit above a dispositioned line shifts keys; a stale key is a lie
  and fails closed (exit 1). Re-run the sweep after every edit inside its universe and
  re-fix keys before committing.
- **Windows python (and some bash prints) emit CRLF into redirected logs** — the sweep
  logs picked up CR=78/CR=9 twice this cycle. `sed -i 's/\r$//'` before staging; the
  standing `tr -dc '\r' | wc -c` = 0 check applies to tool OUTPUT files, not just Write
  tool files.
- **Evidence-log freshness (P3's rule, new instance):** a checker's rule descriptions
  changed by a review fix must appear verbatim in the re-run log committed beside it —
  the log must contain a string only the new code prints.

## 7. Dead ends and eliminated hypotheses

- **Authoring the missing `vectors/drivers` index: ruled out by the LEAD.** It would
  invent surface with no forcing consumer; monotone growth cuts against inventing
  barrels. Re-add only with a named forcing module.
- **Keeping a finding/FAIL split for dangling entries after adjudication: retired.**
  Pre-ruling, frozen-class dangling was a reported "finding" (adjudication boundary);
  post-ruling both classes FAIL closed under `target-existence` in the checker AND the
  consumer view. Do not reintroduce an escalated-finding branch for a settled class.
- **Membership-based marker agreement: eliminated (review R4).** A stale marker beside
  the current one must fail, not pass with the wrong label shipped.
- **Vacuous passes over absent/unrepresentable targets: eliminated (the finding, then
  R3).** A missing file satisfying a negative assertion (frozen-carries-no-marker) and a
  non-string conditional target both now fail closed. When adding a rule to any checker,
  ask what shape of input makes it skip silently — that shape is the next finding.
- **Symbol-level overrides on classic's root barrel: traced, unnecessary.** The root's
  full re-export closure carries zero frozen-classified symbols; the mechanism exists,
  control-proven, unused. Only add overrides if a barrel actually mixes classes at symbol
  level — don't add speculatively.
- **A figure-accuracy checker for shipped READMEs: rejected as a class.** Figures are
  prose measurements; the control that works is the correction sweep guard (§6), not a
  new checker parsing English. Don't build it in P6/P7.
- **Uniform-sweeping an identifier including archived children: rejected.** Archived
  evidence is frozen history; the guard excludes `rasen/changes/archive` and classifies
  the rest.

## Remaining

(empty — P5 retired between children; nothing is in flight)
