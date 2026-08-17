# Handoff: s0304-transaction-api-and-react-surface — LEAD #7

## Read this before lead-6

**`lead-6.md` is stale and partly misattributed. Prefer this document for rocut state.**

- lead-6 records the rocut code state as "unchanged from lead-5 — R2 apply is at
  Vite-matrix-green, Next matrix not yet run", marker `-s`, 61-path manifest, receipt
  `c168a38a…`. All of that was already superseded when it was written.
- lead-6 lists three code changes under "Done since lead-5" (the probe `consoleErrors`
  docblock, removing the vacuous assertion, the `inspect()` docblock). **Those were made
  by the lead-5→7 session**, not by lead-6; lead-6 appears to have read them out of the
  shared worktree at 18:29 and recorded them as its own.
- lead-6's **strategic** content (post-rocut roadmap, S05 ∥ Elftia-foundation, the
  missing Elftia platform foundation, design-doc review readiness) is genuinely new,
  is in a different scope, and is untouched by this session. Keep it.

Two sessions were live in this repository simultaneously. Nothing of this session's work
was clobbered — the source hash chain verified 64/64 at every checkpoint — but treat
concurrent sessions in one worktree as a hazard, especially around staging and commits.

## Position

- Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut` (the ONLY
  registered rocut worktree — do not create another)
- Branch `recovery/s0304-ui-commit-routing-final`
- HEAD `8c8e5839` (was `cdfae229` at lead-5). Three new commits, **local only, never pushed**:
  - `05befb57` feat(surface): R2 product, checks, tests, planning, evidence
  - `fd805714` docs(rasen): R2 ship log
  - `8c8e5839` chore(rasen): archive R2 + sync `embeddable-react-surface` spec (now 23 requirements)
- Portfolio: **8 / 9 children archived.** Only **T4 `s0304-agent-transaction-evidence`**
  remains, then one parent-level delivery.
- Worktree is clean apart from untracked `.rasen/` (run-state — deliberately never committed;
  it is NOT gitignored, so `git add -A` from the repo root would sweep ~87 files of it).

## R2 is done — what it cost and what it found

R2 shipped after **ten** rebuild-and-rerun cycles (`-t` … `-aa`). Every cycle was
invalidated by a real fix, never by relaxing a gate. Full detail in
`rasen/changes/archive/2026-08-12-s0304-surface-css-react-a11y/evidence/`
(`implementation-report.md`, `ship-log.md`, `parity-nondeterminism-control.md`,
`spec-falsification-sweep.md`).

Defects found *after* lead-5 declared the gates green:

1. **Blocker — runtime crash on a live route.** `EditorRoot` had become hard-dependent on
   `SurfaceDragProvider`; the C4 forced-none harness supplied neither it nor the portal
   owner, so the Timeline subtree threw. **No R2 gate covered that suite.** Reproduced,
   fixed, and `playwright.c5-storage.config.ts` is now part of the gate set (5/5).
2. **Two editor drags were never migrated** — timeline scrub (`playhead-controller.ts`) and
   box-select — while the spec scenario names "scrub" explicitly. Two checker defects made
   it unfindable: the private-drag scan covered 24 files in one directory and matched only
   `document.`, never `window.`. Now 749 files, both targets, Host/product-shell excluded.
3. **Two vacuous evidence holes**: `staleFinish: 0` was a literal, and the unmount
   assertions read counters destroyed by unmount. Both closed with observables that outlive
   the Surface.
4. **A gate carried a whole-file exemption** and a fallback list was a blanket path skip.
   Both are now conditional, with negative *and* converse controls.
5. **EOL corruption recurred three times** (`tooltip.tsx`, `.gitignore`, then three
   round-2 files: 1,821 reported lines for 79 real). The whitespace gate now compares every
   changed file's worktree EOL against its HEAD blob.

## Lessons that will save the next session time

- **The independent reviewer earned its cost several times over.** It found the blocker, and
  it twice caught defects in *my own* work — an EOL flip I introduced while fixing that exact
  class, and an anti-drift test I wrote that could not detect drift. Budget for a real
  non-author reviewer on T4; do not self-review.
- **Beware over-correcting a vacuous assertion.** After the reviewer showed the original
  unmount check could not fail, my replacement failed three cycles running for reasons that
  were *mine*, not the product's: (a) Playwright's `.click()` emits a real bubbling `mouseup`
  that legitimately finishes a live mouse drag before React sees the click — use
  `HTMLElement.click()` when you need to act without mouse events; (b) I read DOM attributes
  in the return block, which runs after the render-failure step tears those nodes down.
- **Parity counts move on their own.** The semantic total ran 20, 19, 20, 19, 19 across
  pairings with no source change. Argue from the *movement* plus the same-host control
  (18/18/0), never from equality with R1's 28/19/9 — that equality is a coincidence.
- **`rasen archive` did NOT hit the Windows EPERM source-removal failure** this time; it
  removed the source dir cleanly. The CLI does not self-commit — do a pathspec commit after.
- Archive needs `--yes` when tasks are intentionally left open (R2 shipped 47/49).
- The change directory is listed in `.git/info/exclude` (machine-local) along with every other
  in-progress child. `git add -f` past it; R1 did the same.

## Remaining work

### 0. T4 status as of this handoff

**Planned, strict-validated, both open questions ruled by LEAD. Apply in progress.**

Artifacts on disk at `rasen/changes/s0304-agent-transaction-evidence/`: proposal, design,
tasks (48 in 8 groups), delta spec (6 ADDED requirements / 27 scenarios).
`rasen validate --strict --project rocut` passes with zero issues.

*Note on that command's JSON:* rasen 0.1.7 has **no top-level `valid` field**. Top-level keys
are `items`, `summary`, `version`, `root`; the verdict lives at `items[0].valid` / `.issues`.
Read the item, not the root.

**LEAD rulings (binding, recorded in `design.md`):**
- **No Draft lifecycle in T4's Agent scenario.** The T4 brief names no Draft step and Draft
  semantics are T2's (`s0304-draft-editing-sessions`, archived). A Draft-walking Agent run is
  a deliberate addition owned by the dogfood slice, not a T4 omission.
- **No build-artifact emission or export path.** "Published" = committed, versioned,
  digest-manifested, consumable from a checkout. The planner cited "Slice §5" for this
  exclusion; **that document is not reachable from the rocut worktree, so the citation is
  unverified** and the ruling rests on the scope argument alone.

**The plan's own unverified claim, which apply must prove rather than inherit:** the browser
drivers are supposed to need *no* Host page / composition-root / Vite-entry change, achieved by
a scenario parameter selected inside the shared evidence harness. The planner derived that from
reading both Host entries' props and **did not compile it**. If it turns out a Host entry must
change, that is a real scope finding, not a detail.

Worth keeping: the planner rejected running the Agent through the headless entry because
`rasen/specs/headless-editing/spec.md` requires the headless surface to expose no transaction,
revision, idempotency, draft, conflict or autosave API. Using it would falsify a frozen
requirement. That rejection is spec-backed, not stylistic.

### 1. T4 `s0304-agent-transaction-evidence` — the only open child

Scope (`planning-context.md:87`): *"Agent script (create tracks/assets/clips, move/trim/split,
verify revisions) + published conformance vectors."* Depends on T2 + T3, both archived.
Currently only `rasen/changes/s0304-agent-transaction-evidence/README.md` exists — it needs
the full pipeline: propose → apply → review-cycle → local ship → archive.

Hard constraints inherited from the parent (`planning-context.md:91-95`): no OpenCut
schema / command-class / Zustand-store / IndexedDB-name in any public contract, enforced by a
check script **with a negative control**; both Hosts stay green; the parity fixture is the
oracle.

### 2. Parent portfolio delivery — user-gated

One parent-level action after all nine children archive. **Never push a partial portfolio.**
Product line and archive spine both need reconciling as S02 did. This is explicitly a
user decision, not a LEAD one.

## Standing user directives (carried from lead-4/5, reconfirmed this session)

- All workers Claude Code Opus, 250k context. **Never Codex.**
- Never create another worktree.
- Serialize every rocut-mutating worker.
- Children ship **local-only**. Never push a partial portfolio.
- This session's additional ruling: independent non-author review before ship (the user chose
  "spawn independent Claude reviewer" over self-review when asked).

## Next action

Plan T4. Read `rasen/changes/s0304-transaction-api-and-react-surface/{proposal,design,planning-context}.md`
for the frozen T0 contract surface, then the archived T2/T3 evidence for what the transaction
engine and UI commit routing already prove, so T4's conformance vectors do not restate them.

**Generation note:** LEAD generation 7. Supersedes lead-6 for rocut state; lead-6 remains the
reference for post-rocut strategy.
