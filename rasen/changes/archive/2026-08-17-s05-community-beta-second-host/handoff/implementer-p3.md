# Implementer handoff — s05-conformance-for-third-parties (P3) → remaining children (P5 versioning, P6 examples, P7 provenance/closure)

Written at retirement (review loop closed CLEAN in one round, 0 Blocker / 1 Major /
3 Minor, all four findings fixed in one batch). Dual-seed the next implementer with this
document plus the child's own change artifacts. Cross-change-transferable knowledge only;
P3-internal narrative lives in the child's `evidence/implementation-report.md` and
`evidence/review-report.md`.

## 1. Conventions that held, and what changed

**Held from P2:** one `feat(<change>):` commit per tasks.md group, explicit pathspecs only,
the `.rasen/` staging guard in a variable (`grep -c` exits 1 on zero), LF-in-worktree
(`tr -d '\r'` + `tr -dc '\r' | wc -c` = 0 after every write), local commits only — the
portfolio delivers once at the parent. Evidence naming, per-group report sections, one
review-round section per round, every headline log self-logging `REAL_EXIT_CODE`.

**Changed / new this child:**

- **The change-artifact tracking split.** Under `rasen/changes/<child>/`: `evidence/` and
  `tasks.md` are committed progressively; `proposal.md`, `design.md`, `specs/`,
  `.openspec.yaml` stay **untracked until archive** (the archive flow commits them). So a
  review-round spec amendment lives in the working tree — validate and archive read it from
  disk; do not "fix" the untracked status by staging it.
- **The fix-batch review loop closed in one round.** The flow that did it: read the review
  report first, reproduce every finding before touching anything, fix all four in ONE batch
  commit, give every finding a disposition in the report's review-round section (what / why /
  the guard applied), re-run whatever the fix touches (tests, validate), stand down.

## 2. The scratch-conformance harness P6 reuses (its shape is the deliverable)

Two modules under `script/`. **P6 must import `packSdkTarballs`/`SDK_PACKAGES` from
`pack-sdk-tarballs.mjs` — never re-implement packing** (BOUNDARIES.md §13 records this as a
reuse seam). `run-scratch-conformance.mjs` owns the whole scratch lifecycle in one foreground
process: resolve root → assert location → wipe/recreate with marker → pack (or copy
prepacked) → install → controls → materialize adapter → run suites under bun → self-log
every exit.

- **Six env seams** (the CI-readiness clause is now implemented, not claimed):
  `OPENCUT_SCRATCH_ROOT` (scratch root; asserted outside the repo tree AND outside every
  Temp path, every run), `OPENCUT_BUN` (bun invocation; default `npx --yes bun@1.2.18`),
  `OPENCUT_PREPACKED_DIR` (skip packing, copy pre-packed tarballs), `OPENCUT_TARBALL_OUT_DIR`
  (packing output; default the gitignored `<repo>/dist-sdk-tarballs`), `OPENCUT_ADAPTER_TEMPLATE`
  and `OPENCUT_VARIANT_TEMPLATE` (materialization sources; defaults the committed fixtures).
  P6's CI leg **invokes the runner with env** — no forking, no re-implementing; it inherits
  the no-linking controls and the exactness gate unchanged.
- **The fourth tarball + the override (2026-08-15 LEAD ruling).** `SDK_PACKAGES` includes
  `rust/wasm/pkg` (packs as `opencut-wasm-0.2.10.tgz`); the scratch manifest's `overrides`
  map `opencut-wasm` → that tarball, because classic's in-repo `file:../../rust/wasm/pkg`
  spec is dead from `node_modules`. The override IS the control that makes classic's declared
  wasm dependency resolve honestly. Install runs `npm install --legacy-peer-deps` — react
  (classic's peer) is deliberately never auto-installed; npm's "added 5 packages" = 4 tarballs
  + culori from the public registry, which the ruling explicitly blesses. **No registry
  publish exists anywhere; none may be added.**
- **No-linking controls, mechanics:** 1a/1b location (fail-closed `isInside` checks vs the
  repo root and every Temp root; foreign roots without the marker file are refused, never
  reused); control 2 asserts every installed package — all four, scoped under `@opencut/`
  and the flat `opencut-wasm` — is a real directory by `lstatSync` (not symlink) AND the
  lockfile records `file:` resolutions with no `workspace:` protocol and no `link: true`;
  control 3 **removes** the installed `@opencut/editor-ports` and re-runs the adapter's own
  runner (adapter-shaped re-proof: its first import is the removed package, so the whole
  consumer surface must collapse) gated through a resolution-failure regex. Plus
  `CONTROL-react-free`: `node_modules/react` must not exist after install.
- **The variant exactness gate** is executable, not a log note: `--variant-nonconforming`
  must fail, must name the four attributable cases, and the count of `case:`-shaped failure
  lines must equal exactly four — fails closed in both directions (a fifth failing case is an
  over-constrained suite and a finding, not a pass).
- **Pack determinism discipline:** every tarball packed twice from the same tree, sha256
  compared, fail-closed on divergence; tarballs never committed — the committed record is
  `evidence/tarball-manifest.json` (npm shasum + integrity + per-file SHA-256 inventory per
  tarball).
- **The manifest-truth obligation (durable finding, P5/P6 inherit).** Workspace resolution
  HIDES undeclared dependencies — they resolve through the monorepo and every in-repo gate
  stays green; only the tarball harness catches them (P1 shipped classic with a manifest
  understating its runtime closure; culori was a phantom dep invisible in-repo). Rule:
  **any new runtime-closure import added to an `@opencut` package must be declared in that
  package's `package.json` in the same commit**, and the scratch harness is the gate that
  proves it. Run it before claiming done whenever a package's imports change.

## 3. The wasm-init Direction-level constraint (decide it in the PLAN, not the apply)

Classic's migration chain — the `./storage/migrations` closure reaching `src/wasm` →
`media-time` → `opencut-wasm` — dies at wasm **initialization** in any plain TS consumer:
`wasm.__wbindgen_start is not a function`, **identical in-repo and from installed tarballs**
(byte-identical decisive line both ways). This is P1's disclosed pre-existing crash-masked
wasm error, a runtime failure class — NOT a packaging defect (the installed artifact is a
real, byte-inventoried copy at the moment it fails) and NOT fixable from a consumer. The
LEAD carries it Direction-level; do not attempt to fix it from a child.

The only working init path is classic's published mock entry
`@opencut/editor-classic/evidence/wasm-test-mock` (the same mechanism classic's own storage
tests use) — the adapter's walker test validates the real 31-step chain through it.
**P6's custom-storage example must choose up front, in its plan: validate migration through
the mock entry (the honest-pair shape: production runner records the finding and skips the
leg distinctly; walker validated against the real chain via the mock), or scope the example
around migration entirely.** Discovering this mid-apply is the exact failure the planning
step exists to prevent.

## 4. Tooling traps beyond P2's set

- **`rasen validate` needs the item name.** Bare `rasen validate --strict --project rocut`
  prints "Nothing to validate" and exits 1; `--changes` sweeps EVERY active change and flags
  the not-yet-started children's placeholder dirs red (no-delta errors) — that is not your
  signal. The meaningful invocation is
  `rasen validate <change-name> --strict --project rocut --json` → `valid: true, issues: []`
  (the reviewer's exact form).
- **Evidence-log freshness guard (reviewer durable finding 1).** Before committing a log
  beside new code, grep the log for a string **only the new code prints** — absence means the
  log predates the code and is stale. F1 was exactly this class: a log committed in the same
  commit as the wording change it didn't contain. Same class: doc strings inside fixtures
  ("Group 5 does not yet exist" after it exists) and any string naming the old form of
  something the ruling changed.
- **Report arithmetic comes from the log's own lines** (durable finding 3):
  `grep -o 'EXIT\[[^]]*\]:[0-9]*' <log> | grep -c ':0$'`. "23 zero / 6 nonzero" of 27 was
  impossible on its face; census and prose counts are regression tests — derive, never recall.
- **Scratch trees never under %TEMP%** — AV interception hangs link creation; a hanging
  junction IS the signature. E:-drive path outside Temp; the runner asserts this every run
  anyway, so a violation fails loudly, not mysteriously.
- **`npm pack` filenames need a name map.** Scope-stripped basenames
  (`opencut-editor-ports` → `@opencut/editor-ports`) come from a committed map; an unmapped
  tarball fails closed. A fifth package means extending the map AND `SDK_PACKAGES` together.
- **GNU tar on Windows reads an absolute path as `host:path`** ("Cannot connect to E:") —
  extract with a relative tarball path from `cwd` inside the extract dir (the pack module
  already encodes this; keep it if you touch inventorying).
- **`spawnSync` with an args array + `shell: true` trips DEP0190** — pass a single command
  string on Windows (both harness scripts encode this pattern).
- **bun is the TS consumer because tarballs ship `./src`, no `dist/`.** Any consumer run
  inside the scratch project goes through bun, not node.

## 5. The spec-delta delivery audit (the F2 class — run it before every archive)

Archive syncs delta text **verbatim** into the main specs, so an unmet THEN clause outlives
the honest disclosure that lives only in the implementation report. The pre-archive pass that
closes the class: **pair every ADDED/MODIFIED scenario clause with the evidence log line that
satisfies it**; any clause the delivery does not meet gets amended to the shape the evidence
actually shows (or explicitly LEAD-waived) BEFORE archive. F2 was exactly this: a propose-time
"with migration exercised" clause that neither scratch leg could meet, amended at review
round 1 to the two-mode truth (in-repo walker validation via the published mock; from-tarballs
suites green with the skip recorded and named), scenario heading verbatim, ruling attribution
in `design.md` — never in the spec text.

## 6. Dead ends and eliminated hypotheses

- **Fixing wasm from packaging (gate-fork option 3): ruled out empirically.** With resolution
  made honest (culori installed, opencut-wasm a real installed copy, react absent) the chain
  still died identically — a runtime class, not a packaging defect. Do not re-attempt from a
  consumer; it is Direction-level and LEAD-owned.
- **React-free closure through the `./storage` barrel: impossible.** The barrel's react entry
  is `use-storage-persistence` (a `"use client"` hook). The attributed `./storage/migrations`
  sub-entry is the react-free surface (closure audited file by file); do not widen it back.
- **Editing `boundary.json` for a new exports entry: unnecessary by construction.** The
  boundary checker derives declared entries from the packages' own exports maps at load time
  (BLOCKER-2's dynamic manifest list) — a new entry self-registers and `public-entry-only`
  passes over it. Don't hand-edit what the checker computes; do record the entry in
  BOUNDARIES.md's table with its forcing module.
- **The package-side runner-core export (design E7's named fallback): not taken.** The
  replication walker conforms against the published `migrations` + `CURRENT_PROJECT_VERSION`.
  Only propose the export if a THIRD non-browser store appears — P2's condition, still true.
- **bun as the install mechanism for the `workspace:*` gate: measured, not chosen.** npm
  `file:` deps + `overrides` won at the gate; bun is the documented fallback. Hard-code
  nothing the gate did not prove.
- **Re-running the full scratch sequence to "refresh" logs after a comment-only edit:
  unnecessary — but only with proof.** Default-env output must be shown byte-identical first
  (this round's materialize labels print repo-relative paths that render exactly as the old
  hardcoded strings). Without that diff, regenerate; a stale log reads as current evidence.

## 7. The gate-ruling pattern (it worked — use it again)

When a change hits a decision that belongs to the contract rather than the child, the shape
that worked here: **measure first** (the gate packed and installed the real tarballs before
any harness was built on the resolution mechanism, so the ruling ruled on evidence, not
expectation), **present options with root causes** (the culori phantom-dep fork laid out three
options, each with its mechanism and consequence, none silently preferred), **escalate to the
LEAD with the evidence file** (`gate-1-tarball-resolution.md` carried the measurements and
later the verbatim ruling under "## LEAD ruling" — the ruling then landed as executable
sub-decisions: manifest truth, the attributed entry, the fourth tarball, the proof
obligations), and **resolve any named fork empirically by attempt** (branch (b) landed with
its decisive log line on record). One round to CLEAN review; zero Blockers. The pattern is
cheaper than any alternative that guesses.

## Remaining

(empty — P3 retired between children; nothing is in flight)
