# F2 delivery audit — s05-versioning-and-experimental-labeling (task 7.1)

Every scenario clause of the spec delta paired with the evidence line that satisfies it.
Scenario headings are verbatim from `specs/sdk-versioning-and-labeling/spec.md`. Final-controls
citations are from `evidence/logs/group7-final-controls.log`, re-run at the shipping tree;
group-time citations name their own logs (each carries its `REAL_EXIT`/`EXIT` line). No clause
required amendment — every clause is met as written; the one judgment call (the pre-existing
dangling export entry) is a finding escalated to the contract owner, not a spec gap, because no
scenario clause of THIS change requires repairing an entry declared before it (see the note
under "The consumer view is proven from the tarball").

## Requirement: Packages carry 0.x versions with a stated compatibility policy

#### Scenario: The version and policy ship with the package

- WHEN a package tarball is packed and its contents are inspected —
  `group7-final-controls.log`: "consumer-view-from-tarballs: packing at e7243283 (reads the
  tarballs, never the workspace)" + four `[pack] inventory:` lines (23 / 61 / 805 / 7 files).
- THEN its manifest version is a `0.x` version — per tarball:
  "ok packed manifest version is 0.x (found 0.2.0)" ×3 (also in
  `group5-consumer-view.log` at `ab23ccc4`).
- AND its shipped README contains the compatibility policy statement naming the three surface
  classes and their `0.x` promises — "ok README contains the policy statement
  (\"Compatibility policy (`0.x`\")\")" ×3; the anchor names the section
  `## Compatibility policy (`0.x`)` present in all three READMEs
  (`packages/editor-ports/README.md:9`, `packages/editor-contracts/README.md:8`,
  `packages/editor-classic/README.md:10`), whose bodies carry the three-class table
  (frozen additive-only / provider may change in a minor / experimental may change or be
  removed in a minor) and the "this policy is the **only** stability claim" sentence.

#### Scenario: The policy states known surface constraints

- WHEN the Classic package's policy README is read —
  `packages/editor-classic/README.md` §"Known constraint on `./storage/migrations`".
- THEN it states the known wasm-initialization constraint on the published migration surface,
  as a constraint of the current `0.x` surface rather than as a fix commitment — the section's
  own words: "This is stated as a constraint of the current `0.x` surface, not a fix
  commitment: a fix is tracked at Direction level, not in this package" (lines 56–62;
  the `wasm.__wbindgen_start is not a function` failure mode named verbatim, with the
  "identical in-repo and from installed tarballs" provenance from P3's install harness).

## Requirement: Every public export entry is classified

#### Scenario: The manifest is complete over the export maps

- WHEN the surface manifest is compared with each package's export map — the checker runs
  this comparison live, every run.
- THEN every declared entry has exactly one classification with a non-empty reason, AND no
  manifest row names an undeclared entry — `group7-final-controls.log`:
  "PASS completeness: every export entry is classified in surface.json with a known class and
  a non-empty reason, and every row names a declared entry" over census "36 export entries
  across 3 package(s)"; from the tarballs: "surface.json classifies exactly the export-map
  entries (6 declared = 6 classified, set-equal)" (+11, +19) ×3.

#### Scenario: A new entry is classified at birth

- WHEN an export entry is added to a package's export map — the negative control materializes
  exactly this world against the pure `scan()`.
- THEN the surface-label check fails until the new entry carries a manifest classification,
  AND the failure names the unclassified entry — `group4-controls.log` (re-run in
  `group7-final-controls.log`): "FIRED unclassified export entry (no row): 1 completeness
  violation(s), e.g. @fixture/pkg-a: export entry \"./orphan\" has no surface.json
  classification — classify it at birth (spec: the failure names the unclassified entry)".

#### Scenario: Symbol overrides resolve to real exports

- WHEN a manifest row carries symbol-level overrides — the controls materialize both a
  dangling and a resolving override.
- THEN every overridden name is a symbol the entry actually exports, AND a dangling override
  fails the check — `group4-controls.log`: "FIRED dangling symbol override: 1
  override-validity violation(s) … overrides symbol \"doesNotExist\" which the entry does not
  export (extracted exports: CORE_VERSION, Widget, helper)"; converse: a RESOLVING override
  (`Widget`) stays silent. Live tree: "PASS override-validity" (zero production overrides —
  the mechanism is enforced and control-proven, unused; measured at Group 3).

## Requirement: Non-frozen surface is labeled in the shipped source

#### Scenario: Non-frozen entries carry in-source markers

- WHEN the source files of provider- and experimental-classified entries are read —
  THEN each carries a surface-class marker naming its class: "PASS marker-agreement" over 19
  non-frozen rows (13 provider + 6 experimental).
- AND the marker is present in the source as packed in the tarball, not only in the
  repository — `group5-consumer-view.log` / `group7-final-controls.log`: "markers verified in
  extracted source: 17 non-frozen entries" (classic) + 1 + 1 (ports, contracts), every entry
  an "ok … carries @opencutSurface <class> in extracted source" line read from the EXTRACTED
  tarball tree.

#### Scenario: Frozen files are untouched by labeling

- WHEN the four S03+S04 frozen surfaces are compared byte-for-byte with their state before
  this change — the stat-cache-immune control (`git show 5aae75ec:<path> > tmp; cmp`),
  run at Group 1, after the Group 3 marker batch, and re-run at close-out.
- THEN they are identical — `group7-final-controls.log`: "IDENTICAL" ×4
  (`editor-classic/src/editor/transactions/opencut/index.ts`,
  `editor-contracts/src/engine/engine.ts`, `editor-ports/src/index.ts`,
  `editor-classic/src/editor/surface/embedding/types.ts`).
- AND no frozen-classified file was edited to carry a surface marker — the checker's
  frozen-rows-carry-NONE guard: "PASS marker-agreement" (frozen rows carry none) + census
  "frozen 17" rows verified marker-free from the extracted tarballs ×17 "ok frozen entry …
  carries no marker in extracted source"; the negative control proves a misplaced marker on a
  frozen-classified file FIRES ("FIRED marker on a frozen-classified file").

#### Scenario: Marker and manifest agree

- WHEN the check compares each non-frozen manifest row with its entry file's marker —
- THEN the classes agree, AND a reclassification that updates the manifest without the
  marker, or vice versa, fails — the real-source misclassification control
  (`group3-misclassification-control.log`): classic's `./timeline` row flipped
  provider→experimental while the source marker still said provider → "FAIL marker-agreement"
  naming the entry and the found class (`EXIT[planted]:1`); reverted with blob-hash
  verification (`f30e33d3` both sides); re-run clean (`EXIT[reverted]:0`).

## Requirement: An unlabeled experimental export fails the check

#### Scenario: An unlabeled experimental export fails

- WHEN the negative control materializes an experimental export without its in-source marker,
  and an export entry without any manifest row —
- THEN the check reports both under its rules and exits non-zero — `group4-controls.log`:
  "FIRED unlabeled experimental export (row without marker): 1 marker-agreement violation(s)"
  + "FIRED unclassified export entry (no row): 1 completeness violation(s)"; the control
  exits non-zero on any MISS (its own fail-closed direction), and the check's non-zero exit
  on real violations is proven on real source by the Group 3 control (`EXIT[planted]:1`).

#### Scenario: Correct labels stay silent

- WHEN the converse control runs over properly classified and labeled surface —
- THEN no rule fires — `group7-final-controls.log`: "converse control: silence over correctly
  labeled rows…" `EXIT[converse]:0`.
- AND a frozen row without a marker is not a violation, because that is its designed state —
  the same converse world carries `./contract` frozen and marker-less, and stays silent
  (plus: an absent frozen target is reported as exactly one dangling finding, not a
  violation — the strengthened converse assertion).

#### Scenario: The census is reported and non-vacuous

- WHEN the check runs at the ship commit —
- THEN it reports per-package entry counts and per-class counts reconciling with the export
  maps — `group7-final-controls.log`: census 6/11/19 per package, total 36 — frozen 17,
  provider 13, experimental 6 (reconciling with the Group 1 inventory and the tarball
  set-equality lines).
- AND a run whose scanned set is empty refuses to pass — `group7-final-controls.log`:
  `OPENCUT_LABELS_ROOT` pointed at `evidence/fixtures/empty-scan/no-packages` → "no packages
  discovered under … — refusing to pass over an empty scan" `EXIT[empty-no-packages]:2`;
  at `…/zero-entries` → "zero export entries scanned — refusing to pass over an empty scan"
  `EXIT[empty-zero-entries]:2`.

## Requirement: No stability claim beyond the stated policy

#### Scenario: The sweep covers shipped and repo-level material with dispositions

- WHEN the no-stability sweep runs over the tarball-shipped files and the repository-level
  package documentation — universe 891 files: the three packages' tracked `src/**` + each
  README/surface.json/package.json (the pack inventories confirm no `dist/` ships), plus
  `packages/README.md` and `BOUNDARIES.md`.
- THEN every candidate hit carries a recorded disposition —
  `group6-no-stability-sweep.log` (re-run in `group7-final-controls.log`):
  "census REAL: 70" / "every candidate dispositioned" `REAL_EXIT_CODE[no-stability-sweep]:0`;
  the dispositions live keyed `path:line` in `evidence/no-stability-sweep.py`, and the tool
  exits 1 on an undispositioned candidate OR a stale disposition (fail-closed both ways).
- AND no surviving text claims stability beyond the policy — the same log: "none makes a
  1.0/GA/production-readiness claim" (composition: 48 ordinary-English "stable", 13 `1.0` —
  7 numeric literals + the READMEs' negation sentence + this change's own narration, 7 `GA`
  — negation sentence + Gabon's ISO code + narration, 1+1 narration terms).

#### Scenario: Repository documentation describes the current tree

- WHEN the repository-level `packages/README.md` is read after this change —
- THEN it no longer states that `packages/*/src` is empty or that modules live under
  `apps/web/src` — `grep -n "src is empty\|apps/web/src" packages/README.md` → no matches
  (exit 1).
- AND the figures it states carry their counting method and measurement point — the "Current
  figures" section: "Method: `node script/check-package-boundary.mjs` census lines, and
  `script/pack-sdk-tarballs.mjs` inventories, both run at `3cb78fbc` (2026-08-15)" followed
  by the census and inventory figures.

## Requirement: Versions, policy and labels are verified from the packed tarballs

#### Scenario: The consumer view is proven from the tarball

- WHEN the packages are packed and the tarball contents are inspected and extracted — the
  verifier imports P3's `packSdkTarballs` (never re-implements) and extracts each `@opencut/*`
  tarball.
- THEN each tarball's version is `0.x`, its README carries the policy, its surface manifest
  classifies exactly its export-map entries, and a non-frozen entry's source marker is present
  in the extracted file — `group5-consumer-view.log` (first full proof, `ab23ccc4`) and
  `group7-final-controls.log` (ship re-run): the per-tarball "ok" lines for all four clauses.
- AND the verification reads the tarballs rather than the working tree — the log's own
  header: "packing at e7243283 (reads the tarballs, never the workspace)"; every read goes
  through the extract directory.

  Note for the contract owner (not a spec amendment): the first full run surfaced
  `@opencut/editor-contracts` `./vectors/drivers` as a dangling export entry — declared by
  P0, target never authored, pre-existing at base. No clause of this delta requires
  repairing it; the verifier reports it as a finding (non-frozen dangling would FAIL), the
  checker census carries it every run, and repair/removal is escalated as contract
  adjudication (implementation report, Group 5). RESOLVED 2026-08-15: the LEAD ruled REMOVE
  and the group-8 completion pass executed it — see the dated addendum at the end of this
  file and `group8-completion-ruling.log` for the re-proven clauses.

#### Scenario: Manifest truth holds

- WHEN the packages' dependency blocks are compared with their state before this change —
- THEN nothing changed except the version fields, because labeling adds no runtime-closure
  import — `group5-manifest-truth.log` (`REAL_EXIT_CODE:0`): "dependency blocks identical:
  True" ×3; "top-level keys changed: ['files', 'version']" per package (`files` gained
  `surface.json`; versions 0.1.0 → 0.2.0).
- OR any import added is declared in the same commit with the scratch harness run recorded —
  the OR-branch is not taken: no import was added, so the scratch-harness obligation is not
  triggered (P3's rule, recorded in the implementation report, Group 5 §5.2).

---

## Addendum (2026-08-15): the LEAD ruling on the escalated finding, executed

The dangling-entry note above was adjudicated the same day it was escalated. LEAD ruling
2026-08-15: REMOVE `./vectors/drivers`. Reasoning, quoted: the entry's target was never
authored in any commit — it never worked; zero importers exist, so removal breaks nobody (a
consumer today gets module-not-found either way, and removal makes the manifest honest); the
four frozen S03+S04 surfaces are code signatures, byte-identical and untouched — the exports
map is S05-authored manifest surface, so correcting it is not a frozen-surface change;
authoring the index now would invent surface with no forcing consumer (monotone-growth cuts
against inventing barrels); a future child that needs drivers exported re-adds the entry
WITH the forcing module named.

Effect on this audit's citations (all re-proven in
`evidence/logs/group8-completion-ruling.log`, EXIT 0 on every leg):

- The consumer-view scenario above now reads, at the completion tree: contracts 10 declared =
  10 classified set-equal, `./vectors/drivers` absent from the export map, 0 failures,
  `REAL_EXIT_CODE[consumer-view]:0`. The dangling branch of the verifier now fails closed at
  any class, mirroring the checker's new fourth rule `target-existence`.
- The label-checker citations that read 36 entries / frozen 17 / `dangling-export-entries: 1`
  were accurate at their commits (G4/G5/G7 logs stand as history); the completion census is
  35 entries — frozen 16, provider 13, experimental 6 — `dangling-export-entries: 0`, four
  rules PASS (the fourth, `target-existence`, new under the ruling), negative control 8/8
  FIRED, converse silent with zero dangling.
- The manifest-truth scenario is unaffected (dependency blocks untouched by the removal);
  the boundary census is unchanged on every package-graph rule (989/362/361/870/74), and the
  frozen surfaces re-proved IDENTICAL vs `5aae75ec` for the fourth time.
- Attribution of record: P0 declared ./vectors/drivers in 5e3fc7cb; target never authored;
  zero importers; removed by P5 under LEAD ruling 2026-08-15; re-add only with a named
  forcing module.
