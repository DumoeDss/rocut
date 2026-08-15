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
inserted as the first doc-comment block of every provider (15) and experimental (4... plus
the two requirements entries = 6 experimental total across packages: 19 marker blocks:
ports 1 + contracts 1 + classic 17). Controls run IMMEDIATELY after the batch
(`evidence/logs/group3-post-marker-controls.log`): the four frozen surfaces still
IDENTICAL at base `5aae75ec`; all 25 touched/new files LF (`tr -dc '\r' | wc -c` = 0 each;
`git ls-files --eol` over the diff set: 22 files `i/lf w/lf`). No frozen-CLASSIFIED entry
file carries a marker either — frozen rows are manifest-only by design.

**3.3 — misclassification control.** Deferred to the Group 4 commit boundary as the task
itself orders it ("the checker from Group 4 must fire on it"): planted, fired, reverted —
recorded in the Group 4 section below.
