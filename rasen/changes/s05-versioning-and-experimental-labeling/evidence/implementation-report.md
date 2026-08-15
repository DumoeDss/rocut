# Implementation report — s05-versioning-and-experimental-labeling (P5)

Written as work proceeds; every headline number derived from the log lines cited beside it.
Base commit for all before/after comparisons: `5aae75ec` (the branch HEAD at apply start,
which is P3's archive commit — the frozen surfaces there are byte-identical to P3's own base
`8248a115` by P3's close-out control).

## Group 1 — Baseline (tasks 1.1, 1.2)

**1.1 — the before-half.**

*Export-map inventory (method: the three `packages/*/package.json` `exports` maps read
directly at `5aae75ec`; `./package.json` entries excluded as mechanical):*

| package | entries | frozen | provider | experimental |
| --- | ---: | ---: | ---: | ---: |
| `@opencut/editor-ports` | 6 | 5 | 0 | 1 |
| `@opencut/editor-contracts` | 11 | 10 | 0 | 1 |
| `@opencut/editor-classic` | 19 | 2 | 13 | 4 |
| **total** | **36** | **17** | **13** | **6** |

The count reconciles with the propose-time measurement (36 = 6/11/19); the per-class split
is this change's classification table, adjudicated at task time (see Group 3).

*Checker census at base* (`evidence/logs/group1-baseline-boundary.log`,
`REAL_EXIT_CODE:0`): 1107 repo files scanned, 989 package-graph files, 362 cross-package
edges, 361 `@opencut/*` specifiers, 870 `no-internal-reexport` files, 74
`react-free-base` files — all five rules PASS. These are the regression numbers the
labeling work must not move (labeling adds data files and comments only).

*Frozen byte-control at base* (`evidence/logs/group1-frozen-byte-control.log`):
`git show 5aae75ec:<path> > tmp; cmp -s tmp <path>` — the stat-cache-immune P2/P3 method —
over the four S03+S04 frozen surfaces:

- `packages/editor-classic/src/editor/transactions/opencut/index.ts` — IDENTICAL
- `packages/editor-contracts/src/engine/engine.ts` — IDENTICAL
- `packages/editor-ports/src/index.ts` — IDENTICAL
- `packages/editor-classic/src/editor/surface/embedding/types.ts` — IDENTICAL

**1.2 — the policy draft, reviewed against spec §3.6 before any file landed.** §3.6 names
three evidence clauses: *the version and policy statement*, *the labeling as it appears to
a consumer*, and *a check that an unlabeled experimental export fails*. The drafted policy
(Slice spec read verbatim from `dev/0.2.7:rasen/work/opencut-agent-editor-sdk/slices/05-community-beta-second-host/spec.md`
§3.6) covers each: `0.MINOR.PATCH` with the three classes and their `0.x` promises (frozen
additive-only; provider may change in a minor; experimental may change or be removed in a
minor), patches fix defects without surface change, "this policy is the only stability
claim" (no `1.0`/GA/production-readiness claim anywhere), and — Classic's README only — the
wasm-init constraint on `./storage/migrations` stated as current-surface truth ("a fix is
tracked at Direction level, not in this package"), matching §3.6's second bullet and the
spec's own "as a constraint of the current `0.x` surface rather than as a fix commitment"
scenario wording.

## Group 2 — Policy ships (tasks 2.1–2.3)

**2.1** — `packages/editor-ports/README.md`, `packages/editor-contracts/README.md`,
`packages/editor-classic/README.md` created, each carrying the shared policy statement
plus the package's role and its class summary with the measurement method inline ("this
manifest's `exports` map read at `0.2.0`, `./package.json` excluded"). The manifests'
existing `files` entries name READMEs that now exist. LICENSE/NOTICE remain absent —
P7's by the artifacts (proposal Impact, "Not covered": LICENSE/NOTICE/SBOM = P7), so the
manifests' `files` entries for those stay placeholders P7 makes real.

**2.2** — all three manifests bumped `0.1.0 → 0.2.0` (design E4's decision; the
hold-`0.1.0` alternative was available and not ruled by review, so the artifacts' own
decision governs). Verified: in-repo consumers resolve `workspace:*` (no literal version
resolve anywhere — the only version fields are the three manifests'); P3's harness maps
tarball filenames structurally — `nameOfTarball` in `script/run-scratch-conformance.mjs`
strips `-\d+\.\d+\.\d+[^.]*\.tgz` before its `TARBALL_BASENAME_TO_NAME` lookup, so
`opencut-editor-ports-0.2.0.tgz` maps identically to `0.1.0` filenames; no harness edit
needed or made.

**2.3 — the early pack gate** (`evidence/logs/group2-early-pack.log` +
`group2-early-pack-manifest.json`, `REAL_EXIT_CODE[pack]:0`, determinism control
"reproduced (4 tarball(s) packed twice)"):

- `@opencut/editor-ports@0.2.0` — 22 files, `README.md` SHIPPED (2523 bytes)
- `@opencut/editor-contracts@0.2.0` — 60 files, `README.md` SHIPPED (2754 bytes)
- `@opencut/editor-classic@0.2.0` — 804 files, `README.md` SHIPPED (3648 bytes)
- (`opencut-wasm@0.2.10` — the fourth tarball, version untouched: the rust artifact's
  own version, not P5's to bump.)

Version is `0.x` in every packed manifest and the policy text ships — the version/policy
half proven from the pack path before any labeling landed on top.

## Group 3 — Surface manifests and in-source markers (tasks 3.1–3.3)

**3.1 — the classification table (the reviewable core).** Three `surface.json` manifests
authored (ports 6 / contracts 11 / classic 19 = 36 rows, `./package.json` excluded), every
row `{ class, reason }`; `surface.json` added to each manifest's `files` (it now ships).
Adjudications, all with reasons recorded in the files themselves:

- ports: frozen 5 (barrel, host, in-memory ×2, conformance suite), experimental 1
  (`./conformance/requirements` — P3's legibility layer).
- contracts: frozen 10 (domain, draft ×2, engine ×3, vectors ×3, transaction conformance
  suite), experimental 1 (`./conformance/requirements`).
- classic: frozen 2 (`./surface`, `./surface.css` — the S03+S04 embedding contract),
  provider 13 (root barrel, session/runtime/browser/storage ×3/project/timeline/renderer/
  media/fonts/ui — Classic's own machinery), experimental 4 (`./evidence` ×4 — the
  evidence/test-infrastructure entries, unstable by intent).
- `./storage/conformance` adjudicated **provider**, not experimental: it is Classic's own
  published test rig (the task's "provider where they are Classic's own machinery" arm).
- **Measured task-time finding (design E2's "known mixed case" settled):** classic's root
  `.` does NOT genuinely mix at this tree — its full re-export closure (core → `EditorCore`
  only; utils/ui, date, id, string; wasm → media-time; background/color, canvas/sizes,
  fps/defaults, feedback/types) carries zero frozen-classified symbols; the frozen
  transaction barrel and Surface embedding types are not re-exported from the root. So the
  production manifests carry **no symbol overrides** — exactly the design's Open Question
  outcome ("only genuinely mixed symbols"; none are). The override mechanism exists and is
  enforced (checker rule 3, exercised by its negative control's dangling-override case).

**3.2 — 19 markers, zero frozen files touched.** `@opencutSurface <class> — <reason>`
inserted as the first doc-comment block of every provider (13) and experimental (6) entry
target across the three packages — 19 marker blocks: ports 1 + contracts 1 + classic 17.
Controls run IMMEDIATELY after the batch
(`evidence/logs/group3-post-marker-controls.log`): the four frozen surfaces still
IDENTICAL at base `5aae75ec`; all 25 touched/new files LF (`tr -dc '\r' | wc -c` = 0 each;
`git ls-files --eol` over the diff set: 22 files `i/lf w/lf`). No frozen-CLASSIFIED entry
file carries a marker either — frozen rows are manifest-only by design.

**3.3 — misclassification control.** Deferred to the Group 4 commit boundary as the task
itself orders it ("the checker from Group 4 must fire on it"): planted, fired, reverted —
recorded in the Group 4 section below.

## Group 4 — The checker joins the family (tasks 4.1–4.3)

**4.1** — `script/check-sdk-surface-labels.mjs` authored per design E3: completeness in
both directions (unclassified entry AND undeclared row both fail), class-vocabulary
enforcement (`frozen | provider | experimental` exactly), marker agreement (non-frozen
rows require a matching `@opencutSurface <class>` in the entry target; frozen rows
require NONE — the forbidden-edit guard), symbol-override validity resolved through the
boundary checker's source-scan extraction idiom (export statements + transitive relative
resolution, no parser), empty-scan refusal (exit 2 on zero packages or zero entries), and
census lines every run. Wired into root `package.json` as `check:surface-labels` beside
`check:packages` (one-line diff). First live run
(`evidence/logs/group4-checker-first-run.log`, `REAL_EXIT_CODE:0`): 3 packages, 36
entries — frozen 17, provider 13, experimental 6, exactly the Group 1 inventory.

**4.2 — controls** (`evidence/logs/group4-controls.log`, both `EXIT:0`):
`--negative-control` plants six worlds and each FIRED under its rule — the spec's named
pair (an unlabeled experimental export: row without marker; an export entry with no row)
plus an unknown-class row, a dangling symbol override, a marker on a frozen-classified
file, and a row naming an undeclared entry. `--converse-control`: correctly labeled rows,
frozen rows without markers (the designed state), a RESOLVING override (`Widget`, really
exported through the fixture barrel), and prose mentioning a class name — all silent.

**3.3 (closed at this boundary) + 4.3 — family sweep**
(`evidence/logs/group3-misclassification-control.log`,
`evidence/logs/group4-family-sweep.log`):
- Task 3.3's real-source plant: classic's `./timeline` manifest row flipped
  provider→experimental while the source marker still said provider → checker FAILed
  `marker-agreement` naming the entry and the found class (`EXIT[planted]:1`); reverted
  by `git show HEAD:path > path` with blob-hash verification
  (`f30e33d3…` both sides — the python re-serialize had escaped em-dashes, so only the
  committed bytes were restored); re-run clean (`EXIT[reverted]:0`).
- Family sweep: **28 checkers, 22 zero / 6 nonzero** — P3's group7 pattern (27 / 21/6)
  plus `check-sdk-surface-labels:0`. The nonzero set is IDENTICAL to P3's
  (`asset-manifest:2, emitted-runtime-assets:1, headless-graph:2,
  headless-semantic-result:2, resolution-equivalence:1, type-baseline:1` — the known
  pre-existing / capture-run-needing set, unchanged by this change).
- Boundary checker untouched and green over its own census; `boundary.json` unedited
  (entries derive from export maps at load time — P3's standing finding). Census
  movement fully attributed: 1107 → 1109 repo files (+2 = the new checker and the
  consumer-view evidence module, both `.mjs` outside every package graph); every rule
  count unchanged (989 package-graph files, 362 edges, 361 specifiers, 870 / 74 scanned).
  BOUNDARIES.md's table row recorded in Group 6.

## Group 5 — The consumer view, from the tarballs (tasks 5.1, 5.2)

**5.1** — `evidence/consumer-view-from-tarballs.mjs` (imports `packSdkTarballs` from
`script/pack-sdk-tarballs.mjs` — the P3 module, never re-implemented; Windows ESM notes:
`pathToFileURL` for the import, relative tarball path + `cwd` for GNU tar). It packs at
the current revision, extracts every `@opencut/*` tarball under
`dist-sdk-tarballs/.consumer-view/`, and verifies what a consumer receives — never the
workspace (`evidence/logs/group5-consumer-view.log`,
`REAL_EXIT_CODE[consumer-view]:0`):

- every packed manifest version is `0.x` (all three `0.2.0`, read from the EXTRACTED
  `package.json`, not the workspace);
- every tarball's inventory lists `README.md`, and the extracted README contains the
  policy statement (matched on `Compatibility policy (\`0.x\`)`, printed only by the new
  READMEs);
- every tarball's inventory lists `surface.json`, and its entries classify EXACTLY the
  packed export map (set-equal both directions: 6 / 11 / 19, reconciling line-for-line
  with 4.1's census — frozen 17, provider 13, experimental 6);
- markers verified in the EXTRACTED source for all 19 non-frozen entries (the task's
  clause is "at least one"; the verifier checks every one), and no frozen entry's file
  carries a marker — 17 frozen files checked marker-free from the tarballs.

**The finding this proof caught (escalated, not patched).** The first full run FAILED
with ENOENT reading `src/vectors/drivers/index.ts` from the extracted contracts tarball.
Investigation: `@opencut/editor-contracts`'s `./vectors/drivers` export entry — declared
by S05 P0's boundary-freeze commit `5e3fc7cb`, present in the map at base `5aae75ec` —
points at a file that was **never authored in any commit** (`git log --all` over the path
is empty; the directory holds only `durable.ts` and `in-memory.ts`, both consumed via
relative imports; zero in-repo consumers import the entry by specifier). It is a dangling
export-map entry: a consumer importing `@opencut/editor-contracts/vectors/drivers`
receives a module-not-found from the shipped package. Every workspace-side gate is blind
to it — the boundary checker never validates target existence, `tsc` never resolves an
entry nothing imports, and this change's labels checker originally read a missing frozen
target as marker-free (a vacuous pass). The from-tarballs proof caught it precisely
because it reads the packed artifact. **Disposition:** NOT repaired here. Authoring the
missing `index.ts` means choosing what a frozen-classified entry exports; removing the
entry means removing frozen-classified surface — both are contract adjudication, which
labeling does not do. Instead both tools were hardened to carry the truth:

- `check-sdk-surface-labels.mjs`: a declared target absent from disk now FAILs for
  provider/experimental rows (the marker cannot live in a missing file) and is reported
  as a `dangling-export-entries` census finding for frozen rows — the live census prints
  `dangling-export-entries: 1` naming `./vectors/drivers` every run, so the defect is
  machine-visible until adjudicated. Negative control gained the non-frozen absent-target
  world (fires `marker-agreement`); converse control gained the frozen absent-target
  world (exactly one dangling finding, zero violations). All three modes re-run green.
- `consumer-view-from-tarballs.mjs`: the same split — FAIL for non-frozen, reported
  finding for frozen — logged as
  `finding dangling-export-entry @opencut/editor-contracts ./vectors/drivers -> ...`.

**5.2 — manifest truth** (`evidence/logs/group5-manifest-truth.log`, `REAL_EXIT_CODE:0`):
all three packages' dependency blocks are byte-identical to base `5aae75ec`; the only
top-level manifest keys changed are `version` (0.1.0 → 0.2.0) and `files`
(+`surface.json`). Labeling added NO runtime-closure import, so P3's scratch-harness
obligation is not triggered (the rule: run `run-scratch-conformance.mjs` only if an
import was added — none was).

## Group 6 — The no-stability sweep and documentation (tasks 6.1–6.3)

**6.1 — the semantic sweep** (`evidence/no-stability-sweep.py`, log
`evidence/logs/group6-no-stability-sweep.log`, `REAL_EXIT_CODE[no-stability-sweep]:0`).
Universe: 891 files — everything the tarballs ship (the three packages' tracked `src/**`
plus each `README.md` / `surface.json` / `package.json`; the G2/G5 pack inventories confirm
no `dist/` files ship) plus `packages/README.md` and `BOUNDARIES.md`; the only DECISIONS doc
(`packages/editor-ports/src/DECISIONS.md`) is inside ports' `src` and counted once. Five
terms: `1.0`, `stable`, `production-ready`, `semver`, `GA`. Mechanical noise is classified by
context, not counted raw: 111 SVG-path-coordinate matches (icon `d="M…"` data), 10
longer-decimal substrings, 3 version-string substrings (the task's own `0.1.0` trap — and the
restated README's `0.2.0`/`0.2.10`, same class). All 70 remaining candidates were READ and
dispositioned, keyed `path:line` in the tool itself (fail-closed: an undispositioned candidate
OR a stale disposition exits 1):

- `stable` ×48 — every one the ordinary English word (stable identity, stable refs, stable
  order, module-stable), none a release-stability claim;
- `1.0` ×13 — 7 standalone numeric literals (migration-fixture seconds, a graph-editor Y-axis
  fallback, a one-second video-cache threshold, snap-math in a comment), 3 the policy READMEs'
  own negation sentence, 3 this change's own narration of the term list;
- `GA` ×7 — the READMEs' negation sentence ×3, Gabon's ISO 3166 code in sticker country data
  ×1, narration ×3;
- `production-ready` ×1 and `semver` ×1 — both in the narration.

Zero hits make a `1.0`/GA/production-readiness claim. Methodological note recorded in the
tool and the log: §14 of BOUNDARIES.md is inside the sweep's own universe, so its narration
of the terms is self-referentially dispositioned — which is why §14's prose points at the
committed log's census as authoritative instead of embedding totals its own text would
change (the fixed-point trap, hit twice and closed during implementation).

**6.2 — `packages/README.md` restated.** The P0-era text ("a declaration, not yet a move:
`packages/*/src` is empty", "No source has moved. P1 owns the move") has been false since P1;
replaced with the current tree: the packages are real, ship source through their `exports`
maps, pack via `script/pack-sdk-tarballs.mjs`; the layer-order rationale and roles table
kept (still accurate, still measured); the `0.x` freeze section now carries the labeling
layer on top (three classes, `surface.json`, markers, checker) and points to the per-package
policy READMEs as the consumer-facing statement. Current figures with method + measurement
point inline (`3cb78fbc`, 2026-08-15): boundary census 989 package-graph files / 362 edges /
361 specifiers / 870 / 74 / 1109 repo files, all PASS; pack inventories at `0.2.0` 23 / 61 /
805 / 7 (wasm at its own `0.2.10`); label census 36 entries (17/13/6) plus the one recorded
dangling-entry finding. Non-coverage updated: LICENSE/NOTICE/SBOM = P7, wasm-init fix =
Direction-level, CI = P6's decision.

**6.3 — `BOUNDARIES.md`.** New §14 "Surface stability labeling" (taxonomy table with the
marker column, the mechanism and the frozen-files-untouched rule with all four byte-identical
paths named, the classification summary table 36 = 17/13/6 with the adjudications worth a
reader's attention, the checker's rules/controls/census, the escalated dangling-entry
finding, the from-tarballs consumer-view record, the sweep narration, census movement
1107→1109 with full attribution, and the deliberate non-coverage). §9's checker-scope audit
updated: the as-of count line now reads "26 at task 2.4, 27 at task 8.5, 28 at P5", and the
new checker is recorded as a dated row at the table's foot (bucket A — generic package
discovery, no `apps/web/src` literal, born after the move).

## Group 7 — Delivery audit and ship (tasks 7.1–7.4)

**7.1 — the F2 delivery audit** (`evidence/delivery-audit.md`): every scenario clause of the
spec delta — 6 requirements, 15 scenarios, headings verbatim — paired with the evidence line
that satisfies it (final-controls citations from the ship-revision re-run; group-time
citations from their own committed logs). NO clause required amendment: every clause is met
as written. The task-time rulings are attributed in `design.md`'s new "Task-time rulings"
subsection (version ruled `0.2.0`; classic root ruled override-free — closure traced, zero
frozen symbols; the dangling-entry scope ruling: repair/removal is contract adjudication,
labeling labels the declared surface), never in the spec text.

**7.2 — final controls** (`evidence/logs/group7-final-controls.log`, run at the shipping
tree):

- frozen byte-control vs base `5aae75ec`: four surfaces **IDENTICAL** (stat-cache-immune
  `git show > tmp; cmp` method);
- label checker live: 3 packages / 36 entries, all three rules PASS, census 17/13/6 +
  `dangling-export-entries: 1`; negative control 7/7 FIRED; converse control silent with the
  frozen-dangling assertion; **both empty-scan refusals evidenced** — a new
  `OPENCUT_LABELS_ROOT` seam (P3's precedent: implemented rather than claimed) lets the
  checker scan fixture roots under `evidence/fixtures/empty-scan/`: no-packages → exit 2,
  zero-entries → exit 2;
- boundary checker: all five rules PASS (989 package-graph files, 362 edges, 361
  specifiers, 870 / 74 scanned; repo files 1109 → 1110, +1 = the zero-entries fixture's
  `package.json`, outside every package graph — attributed);
- consumer view re-run at ship revision: `REAL_EXIT_CODE[consumer-view]:0`, same findings
  tally (1 escalated dangling entry);
- no-stability sweep re-run: `REAL_EXIT_CODE[no-stability-sweep]:0`;
- full checker family: **28 checkers, 22 exit-zero / 6 nonzero**, the nonzero set IDENTICAL
  to P3's known set (`asset-manifest:2, emitted-runtime-assets:1, headless-graph:2,
  headless-semantic-result:2, resolution-equivalence:1, type-baseline:1`);
- `rasen validate s05-versioning-and-experimental-labeling --strict --project rocut --json` →
  `"valid": true, "issues": []`, `EXIT[validate]:0`.

**7.3 — discipline**: LF verified per stage (`tr -dc '\r' | wc -c` = 0 on every staged
file; two logs caught CRLF and stripped before staging); explicit pathspecs only;
`git diff --cached --name-only | grep -c '^\.rasen/'` captured in a variable and = 0 before
every commit; one `feat(s05-versioning):` commit per group (G1 `5387926d`, G2 `ba6c7ae4`,
G3 `f239d81b`, G4 `ab23ccc4`, G5 `3cb78fbc`, G6 `e7243283`, G7 this commit); **local only —
nothing pushed** (the portfolio delivers once at the parent).

**7.4 — standDown**: N-A by structure — this worker is a leaf (no subagents, no parked
workers); the change directory has no `signals/` directory at all, so there is no
`signals/.state/` to confirm empty and no standDown to send.

## Group 8 — LEAD-ruling completion pass (the escalated ./vectors/drivers finding)

On 2026-08-15 the LEAD ruled on the finding Group 5 escalated (report §Group 5; census
`dangling-export-entries: 1`): **REMOVE the entry.** The reasoning, quoted for the record:
the entry's target was never authored in any commit — it never worked; zero importers exist,
so removal breaks nobody (a consumer today gets module-not-found either way, and removal
makes the manifest honest); the four frozen S03+S04 surfaces are code signatures,
byte-identical and untouched — the exports map is S05-authored manifest surface, so
correcting it is not a frozen-surface change; authoring the index now would invent surface
with no forcing consumer (monotone-growth cuts against inventing barrels); a future child
that needs drivers exported re-adds the entry WITH the forcing module named.

Executed:

- `packages/editor-contracts/package.json` — the `./vectors/drivers` line removed from the
  exports map; `packages/editor-contracts/surface.json` — its row removed in the same edit
  (completeness-both-ways stays satisfied; census 36 → 35, frozen 17 → 16).
- `script/check-sdk-surface-labels.mjs` — fourth rule `target-existence`: a declared entry
  whose target is absent fails at ANY class (the pre-ruling checker read a missing frozen
  target as a marker-free pass; the finding proved that vacuous). Negative control extended
  to eight worlds (world 8: a frozen entry with an absent target); converse control now
  asserts zero dangling.
- `evidence/consumer-view-from-tarballs.mjs` — the dangling branch fails closed from the
  packed tarball at any class, mirroring the checker (was: non-frozen FAIL / frozen
  escalated finding); the closing line reports the dangling census.
- Controls re-proven (`evidence/logs/group8-completion-ruling.log`): labels live — 35
  entries, 16/13/6, `dangling-export-entries: 0`, four rules PASS, EXIT 0; negative control
  8/8 FIRED; converse silent; boundary five rules PASS (989/362/361/870/74 unchanged);
  consumer view from tarballs — contracts 10 declared = 10 classified set-equal,
  `./vectors/drivers` absent, 0 failures, `REAL_EXIT_CODE[consumer-view]:0`; frozen
  byte-control vs `5aae75ec` re-proven IDENTICAL ×4 (fourth time).
- Docs: BOUNDARIES §14 (ruling + attribution + figures), `packages/README.md` figures,
  `design.md` task-time-rulings bullet, this section, `delivery-audit.md` addendum;
  no-stability sweep re-run over the edited docs
  (`evidence/logs/group8-no-stability-sweep.log`).

Attribution of record: P0 declared ./vectors/drivers in 5e3fc7cb; target never authored;
zero importers; removed by P5 under LEAD ruling 2026-08-15; re-add only with a named forcing
module.

Discipline: unchanged (explicit pathspecs, LF verified, `.rasen/` guard = 0, local only —
nothing pushed).
