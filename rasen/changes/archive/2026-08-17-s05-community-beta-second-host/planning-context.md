# Planning context — S05 `05-community-beta-second-host` portfolio

> Written by the LEAD at portfolio activation, 2026-08-13. Read this FIRST, then research only
> what is missing. Append durable findings (decisions, discovered constraints) at the bottom
> after each propose; do not append chatter.

## User intent (verbatim)

> `auto-decompose 阅读交接文档：rasen\handoff\rocut-s0304-delivered-s05-projected.md 继续推进S05的开发，implementer、ship、archive使用sonnet，其他使用opus。开始吧`

Translation: run the `auto-decompose` pipeline, read the named handoff, and **continue advancing
S05 development**. That sentence IS the human activation authorization the S05 spec §9 required.

## Where everything lives (two repositories — they are easy to confuse)

| repo | path | role |
| --- | --- | --- |
| **rocut** | `_others/rocut` (`github.com/DumoeDss/rocut`) | **all implementation.** Every child of this portfolio lands here. |
| **elftia** | `elftia/elftia` (`github.com/elftia/elftia`) | **governance only** — the Slice spec/plan/result under `rasen/work/opencut-agent-editor-sdk/`. No Elftia code change belongs to S05; that is S06. |

- rocut work branch: **`feat/s05-community-beta`**, created off `origin/main` = `8e1f18ac`
  (PR #1 merge, carries every S01–S04 commit). The **only** registered rocut worktree is
  `_others/rocut` — **never create another**.
- Local rocut `main` ref is stale at `88547d38`. Use `origin/main`, not `main`.
- `feat/session-runtime-host-ports@d84d9d50` is fully contained in `main` and is **retired**.
- elftia governance worktree for this Slice: `elftia/elftia-wt-s05gov` on `dev/0.2.7`.
  Activation committed there as `af37965ee`. The **main elftia worktree is on another line
  (`chore/orphan-tinyelf-tree-cleanup`) with a concurrent session's WIP — never switch its branch
  and never commit into it.**

## Authoritative documents (and a trap)

Read the Slice spec and plan from **`dev/0.2.7`**, not from the main elftia worktree:

```
git -C <elftia> show dev/0.2.7:rasen/work/opencut-agent-editor-sdk/slices/05-community-beta-second-host/spec.md
```

…or just read them in `elftia/elftia-wt-s05gov/rasen/work/opencut-agent-editor-sdk/slices/05-community-beta-second-host/`.

**Trap the LEAD already fell into:** the copy of `plan.md`/`spec.md` in the *main* elftia worktree
is stale — it still shows eight children including `P4` and lists decision B3 as *open*. That is
pre-`ae424486e`. The real state is **seven children, fully serial, all four decisions ruled.**

## The four ruled decisions (do not silently reverse)

- **B1 — narrow reading of "published `0.x`". No npm/registry publish.** "Published" = committed,
  versioned, digest-manifested, consumable from a checkout. Because that removes the only thing
  testing *distribution*, S05 adds a **pack → install tarballs into a scratch project OUTSIDE the
  monorepo, no workspace linking** harness (owned by P3, reused by P6). Registry-specific behaviour
  (publish-time transforms, provenance/signature checks, scoped auth, cold-cache install) is
  excluded and claimed nowhere.
- **B2 — the second Host is Electron + Vite.** Reason (Target State §6): it exercises desktop
  packaging, filesystem-backed storage and WASM/Worker constraints under a narrow CSP. A headless
  Node Host was declined — it would prove port substitutability only and largely repeat S02's C7.
- **B3 — Roadmap M5's two `adapter-elftia` bullets are STRUCK, not reinterpreted.** They describe
  removing something this repository never contains. **Child P4 was deleted**, taking the
  portfolio's only concurrent edge. The surviving content is **one import rule inside P0's boundary
  checker**. The "delete the adapter and both Hosts still work" test belongs to Elftia-side
  integration CI (E5/S07 era) and is out of scope here — say so explicitly rather than let silence
  read as coverage.
- **B4 — layered package split: contracts / ports / surface, Classic provider separable.** Forced
  by spec §3.5, not chosen on taste: a third-party adapter author must implement ports and run
  conformance **without pulling React or the editor UI**. P0 settles the exact package count and
  the provider seam *within* this shape; it does not reopen the shape.

## The child DAG — seven children, FULLY SERIAL

```text
P0 s05-package-boundary-freeze      (incl. the Elftia-import rule)
 ▼ P1 s05-package-extraction
 ▼ P2 s05-second-host
 ▼ P3 s05-conformance-for-third-parties
 ▼ P5 s05-versioning-and-experimental-labeling
 ▼ P6 s05-published-examples
 ▼ P7 s05-provenance-and-beta-closure
```

Ids P0–P3 and P5–P7 are kept un-renumbered on purpose so plan and commit history name the same
children. **No parallel edge is proposed and none should be invented**: `P2 ∥ P3 ∥ P5` is tempting
and explicitly rejected — all three consume the extracted packages and P5 changes the public
surface the other two consume. S02 withdrew its `C0b ∥ C1` edge for exactly this shape.

## Measured starting state in rocut (verified 2026-08-13)

- `package.json` declares `workspaces: ["apps/*", "packages/*"]` and **`packages/` does not exist.**
  The monorepo is pre-wired for extraction; nothing has been extracted.
- All editor source lives under `apps/web/src/`. `apps/vite-example` consumes it through a **path
  alias into `apps/web/src`**, not a package boundary.
- `apps/` contains exactly: `desktop`, `vite-example`, `web`.
- **Five conformance suites already exist** — `editor/ports/conformance`,
  `editor/contracts/conformance`, `editor/contracts/draft/conformance`,
  `editor/contracts/engine/conformance`, plus the `editor/contracts/vectors` corpus with its
  Host-neutral runner and two Node drivers. **P3 does not author conformance from nothing**; it
  makes what exists consumable and its failures legible from outside.
- Nine ports are frozen under `editor/ports/` with `DECISIONS.md` and in-memory implementations.
- Provenance assets exist: `SOURCE_INVENTORY.{md,json}`, `PATCHES.md`, `rust/wasm/LICENSE`,
  `script/generate-sbom.mjs`.
- **All 19 static checkers are green** as of `53292ae0` — true for the first time in this
  workstream. Keep them green; a new checker joins that family.
- **`apps/desktop` is NOT the second Host.** It is the donor's Rust/GPUI experiment and
  `check-distributable-boundary.mjs` carries an explicit `no-desktop-app` rule. That rule must
  survive this Slice; do not promote the GPUI experiment to save work.
- **`adapter-elftia` does not exist here and never will.** See B3.

## Hard constraints inherited from the predecessor session

- Children ship **local (commit only)**. The portfolio delivers **once**, at the parent, after all
  seven complete. **Never push a partial portfolio.**
- **Serialize every rocut-mutating worker.** One writer at a time in `_others/rocut`.
- Frozen S03+S04 public signatures may **not** change during extraction. Pressure to change one is
  a finding that returns to the contract, not a private patch — and it is a `failed` condition for
  the Slice, not a quiet edit.
- The **parity fixture is the oracle** for P1. Extraction is a refactor: any semantic movement is a
  defect, not an accepted update. The type baseline may not grow, and every change is attributed.

## Gotchas that will bite (measured, not theoretical)

- **`.rasen/` is NOT gitignored in rocut.** Stage explicit pathspecs and assert
  `git diff --cached --name-only | grep -c '^\.rasen/'` is `0` before every commit.
- **rocut has no git hooks at all** (`.husky` absent, no `lint-staged`) — `--no-verify` is a no-op
  there; do not pass it reflexively.
- **The Elftia-import rule must match import specifiers and dependency names, NOT raw substrings.**
  This checkout sits under a path containing `elftia`, so a substring scan reports ~105 false hits
  from absolute paths in generated artifacts.
- **Editing tooling flips files to CRLF.** Run `git ls-files --eol $(git diff --name-only)` after
  every edit batch. rocut is LF in the worktree; elftia normalises LF-in-index / CRLF-on-checkout.
- **`cmd | tail; echo $?` does not verify a push** — `$?` is the last pipeline element. Use
  `${PIPESTATUS[0]}` and re-verify with `git rev-list --left-right --count origin/<b>...HEAD`.
- **`rasen archive` refuses a change-authored `## Archive` heading** — the transaction appends its
  own section to the ship log.
- **The archive preview prints `specSync.mode: "no-deltas"` and `specActions: []` even when it will
  sync.** Verify by counting `^### Requirement` in the main spec before and after.
- Three stale active change directories predate this portfolio in `rasen/changes/`
  (`s02-session-runtime-host-ports`, `s0304-transaction-api-and-react-surface`,
  `s0304-transaction-contract-freeze`). They are not ours; leave them alone.

## Commands that mattered in the predecessor session

```
npx --yes bun@1.2.18 test <paths>
PARITY_SPEC=agent|parity PARITY_HOST=vite|next npx --yes bun@1.2.18 x playwright test --config playwright.surface.config.ts
node script/check-*.mjs [--negative-control|--converse-control]
rasen validate <change> --strict --project rocut --json     # read items[0].valid
```

Timings on this machine are better than older documents imply: Vite build ~45 s, Next build ~40 s,
whole dual-Host cycle well under 15 minutes.

## Acceptance warning the spec states outright

> **Completion of every projected child is not acceptance.** A `packages/` directory that builds, a
> second Host that launches, and a green CI leg are not evidence that an outside developer can adopt
> this. **§3.5 and §3.7 are the ones that actually test that claim, and they are the ones most
> easily faked by writing documentation instead of running it.**

---

## Durable findings appended by planners

_(append below; newest last)_

### From P0's propose (planner, 2026-08-13) — measured over 948 source files

**1. The layer order is the REVERSE of the intuitive one: ports sit BELOW contracts.**
8 production edges run `editor/contracts → editor/ports`; **0** run the other way.
`contracts/engine` and `draft/immutable.ts` consume `IdGenerator` / `DiagnosticsPort`. Any child
that writes "contracts is the base" contradicts the source.
Corollary, load-bearing: **`editor/host/editor-host.ts` must be owned by the *ports* package.**
`ports/index.ts` re-exports `EditorHostNavigation` from it as the frozen `NavigationHost`, while
that file imports `@/editor/ports`. Splitting them turns a benign type-only module cycle into a
package cycle; the only alternatives were editing a frozen re-export (a spec §3.9 `failed`
condition) or shipping a cyclic graph.

**2. No further seam inside the implementation is reachable by extraction. Raise at Direction
level BEFORE P1 or P2 trips on it.** Every candidate cut above contracts is bidirectional in
*production* source: provider↔UI 228/293, UI↔session-runtime 95/17, session-runtime↔provider
64/31, `editor/surface`↔UI 19/16, surface↔provider 5/1. Target State §4 draws
`provider-opencut-classic` and `react-editor` as siblings; reaching that needs **dependency
inversion — a rewrite**, whereas P1 is a refactor whose oracle is the parity fixture. Recommended
against Roadmap M9/S09, not against this Slice.
The one cheap seam that *does* exist, for a later Slice: `surface-portal` /
`surface-drag-coordinator` / `surface-focus` / `surface-lifecycle` are consumed by
`components/ui/*` and sit *below* the UI, while `surface/editor-root.tsx` sits *above* it — that
directory is two layers wearing one name.

**3. Two matcher traps that make a checker look right while being wrong.**
(a) **The Elftia-substring warning in this document was off by one.** The ~105 false hits all live
in `dist/module-graph.json`, `tests/parity-artifacts/**` and `apps/web/.next/**`, which are
**gitignored** — the house idiom `git ls-files --cached --others --exclude-standard` already
excludes them, and only a checker walking the filesystem directly would ever see them. The *real*
trap is tracked **prose**: exactly 8 tracked files contain `elftia`, every occurrence explaining
*why the ports are Elftia-neutral* (`ports/DECISIONS.md` ×5 among them). A substring rule flags the
documents that record the boundary, and the obvious "fix" deletes the reasoning.
(b) A React-free / DOM-free check must be **identifier-level**: `editor/contracts/draft` and
`editor/contracts/engine` name a local variable `document`, so scanning for `document.` produces
~20 false hits inside the exact package the rule protects.

**4. P1 inherits a verified map and a closed list of debts.** Under P0's declared ownership the
current graph has **zero** upward package edges, production and test. P1 owes:
- `@/editor/ports/project-store` (4 uses) and `@/editor/ports/gpu-resources` (3 uses) rewritten to
  the package root, which already exports every symbol they take;
- four test files relocated to their subject: `contracts/vectors/__tests__/agent-opencut-projection.test.ts`
  → classic; `editor/host/__tests__/{branding-assets,production-composition}.test.ts` and
  `services/storage/__tests__/c5-storage-red-controls.test.ts` → `apps/web`.
- `@/editor/contracts/engine/invariant` is **NOT** a rewrite — `engine/index.ts` does not re-export
  it and production code consumes `validateTransactionDocument`, so it becomes a declared public
  entry instead.
- `apps/web/src/feedback/` is the one directory the boundary runs *through*: `{index,queries}.ts`
  import `@/db` and are shell; `components/feedback-popover.tsx` is editor chrome and imports
  `../types`, not the index. Split by file, no code change. **Left undeclared it is the single
  production edge that makes the package graph reach the Next shell.**

**5. rocut CI does NOT run the static checkers.** `.github/workflows/bun-ci.yml` runs only the
three wasm checks plus the Next build; the other ~22 `script/check-*.mjs` are **local-only**. So
"all 19 checkers are green" is a *locally-measured* claim, not a CI-enforced one. Any child that
needs a checker enforced on push must add the CI step itself — **relevant before P3 and P6 assume
a CI leg exists** for the tarball harness and the executed examples.

### P0 `s05-package-boundary-freeze` — planner, 2026-08-13

**Settled: three packages.** `@opencut/editor-ports` (L0) → `@opencut/editor-contracts` (L1) →
`@opencut/editor-classic` (L2). Manifests, `packages/boundary.json` ownership map, and
`script/check-package-boundary.mjs` with five rules and two controls. `validate --strict` = valid.

1. **The layer order is the reverse of the intuitive one: ports sit BELOW contracts.** Measured over
   948 files: 8 production edges run `editor/contracts → editor/ports` and **0** run the other way.
   `contracts/engine` and `contracts/draft/immutable.ts` consume `IdGenerator` / `DiagnosticsPort`.
   Any later child that writes "contracts is the base layer" is writing something the source
   contradicts. `editor/ports` has **zero** outgoing edges to anything above it, and neither package
   imports React, a DOM global, or a single npm runtime dependency — spec §3.5's install is real, not
   aspirational.
2. **`apps/web/src/editor/host/editor-host.ts` belongs to the ports package, and this is load-bearing
   rather than tidy.** `ports/index.ts` re-exports `EditorHostNavigation` from `../host/editor-host`
   as the frozen name `NavigationHost` while `editor-host.ts` imports `@/editor/ports` — a live
   type-only module cycle that becomes a **package** cycle if the two land in different packages. The
   only alternatives were editing a frozen re-export (a §3.9 `failed` condition) or shipping a cyclic
   graph. The rest of `editor/host/` does not follow it: `browser-runtime.ts` and the two `.tsx`
   files go to `editor-classic`; `next-editor-host.ts` and `c4-next-runtime-probe.tsx` stay in
   `apps/web`.
3. **No further seam inside the implementation is reachable by extraction — this is a Direction
   finding, not a P0 shortcut.** Every candidate cut above the contracts is bidirectional in
   *production* source: provider↔UI 228/293, UI↔session-runtime 95/17, session-runtime↔provider
   64/31, `editor/surface`↔UI 19/16, `editor/surface`↔provider 5/1. Target State §4 draws
   `provider-opencut-classic` and `react-editor` as siblings; reaching that needs dependency
   inversion, i.e. a rewrite, and P1 is a refactor whose oracle is the parity fixture. **Recommend
   raising it against Roadmap M9/S09 rather than letting P1 or P2 discover it.** The one cheap seam
   that does exist, if a later Slice wants it: `surface-portal` / `surface-drag-coordinator` /
   `surface-focus` / `surface-lifecycle` are consumed by `components/ui/*` and sit *below* the UI,
   while `surface/editor-root.tsx` sits *above* it — the directory is two layers wearing one name.
4. **P1 inherits a verified map and a closed list of rewrites.** With the declared ownership the
   current graph has **zero** upward package edges, in production and in tests. What P1 owes:
   `@/editor/ports/project-store` (4 uses) and `@/editor/ports/gpu-resources` (3 uses) rewritten to
   the package root, which already exports every symbol they take; and four test files relocated to
   their subject (`contracts/vectors/__tests__/agent-opencut-projection.test.ts` → classic;
   `editor/host/__tests__/{branding-assets,production-composition}.test.ts` and
   `services/storage/__tests__/c5-storage-red-controls.test.ts` → `apps/web`). `@/editor/contracts/engine/invariant`
   is **not** a rewrite — `engine/index.ts` does not re-export it and production code consumes
   `validateTransactionDocument`, so it is a declared public entry.
5. **`apps/web/src/feedback/` is the one directory the package boundary runs THROUGH.**
   `feedback/{index,queries}.ts` import `@/db` and are reached only from `app/api/feedback/route.ts`
   (shell); `feedback/components/feedback-popover.tsx` is editor chrome imported by
   `editor-header.tsx`, and it imports `../types`, not the index. Split by file, no code change. Left
   undeclared it is the single production edge that makes the package graph reach the Next shell.
6. **The Elftia-substring warning is off by one, and the correction matters.** The ~105 false hits
   live in `dist/module-graph.json`, `tests/parity-artifacts/**` and `apps/web/.next/**` — all
   **gitignored**, so the house idiom `git ls-files --cached --others --exclude-standard` already
   excludes them; only a checker that walks the filesystem directly would ever see them. The real
   trap is **tracked prose**: exactly 8 tracked files contain `elftia`, every occurrence explaining
   *why the ports are Elftia-neutral* (`ports/DECISIONS.md` ×5, `vite-example/README.md` ×2,
   `session/resources.ts` ×2, and four more). A substring rule flags the documents that record the
   boundary, and the obvious "fix" deletes the reasoning.
7. **A DOM check must be identifier-level, not `document.`-textual.** `editor/contracts/draft` and
   `editor/contracts/engine` name a local variable `document` (the draft document), so a text scan
   for `document.` produces ~20 false hits inside the exact package the React-free rule protects.
8. **rocut CI does not run the static checkers.** `.github/workflows/bun-ci.yml` runs only the three
   wasm checks plus the Next build; the other ~22 `script/check-*.mjs` are local-only. "All 19 are
   green" is a locally-measured claim. Any child that wants a checker enforced on push has to add the
   CI step itself — worth knowing before P3/P6 assume a CI leg exists.


### From P0's review round 1 (reviewer, 2026-08-13) — 16 adversarial probes, all reproduced in a sandbox replica

**P1 MUST READ FINDING 1.** The reviewer flagged that this deferral was recorded only in
`BOUNDARIES.md` and P0's `design.md`, not here — which is the file P1's planner reads first. So:

**1. Consumer-scope enforcement — SUPERSEDED, read the corrected version.** This entry originally
said P1 must widen the scan set. **P0 fixed it instead** (Blocker B1, commit `bea59790`, confirmed
resolved by non-author reproduction). Current true state:
- `public-entry-only` is **LIVE**, scanning 949 files across `packages/*/src/**`, `apps/web/src/**`
  and `apps/vite-example/**`. It scans by **path**, deliberately NOT gated on `ownerOfPath()`
  consumer identity — an ownership-filtered scan would have missed the motivating case, because
  `apps/web/src/editor/surface/consumer.ts` is owned by *editor-classic (layer 2)*, not by the
  `apps/web` consumer entity. Do not "simplify" it back to an ownership filter.
- `no-internal-reexport` remains **honestly dormant** (0 files) until P1 puts source in `packages/`.
  That one really is P1's to bring to life.
- It currently PASSes trivially: **zero `@opencut/*` specifiers exist in the tree today.** P1 writes
  the first ones. So P1 is the moment this rule stops being vacuous — verify it actually fires on a
  real deep import as part of P1's own acceptance, rather than inheriting a green light.

**2. `react-free-base` is a floor, not a proof.** Anyone citing it as evidence for spec §3.5 must
cite these limits alongside it:
- ~22% of layer-0/1 files are DOM-exempt via the file-wide `document` heuristic (being tightened,
  but the heuristic remains a heuristic);
- layer-0/1 source may import **any bare npm package unchecked** — today only `node:*` and
  `bun:test` are actually used, but nothing enforces that;
- `globalThis.document` was invisible to it (fixed in round 1).
"Contracts and ports are React-free" is therefore an *enforced floor plus an observed fact*, not a
mechanically closed proof. State it that way in P3/P5/P7 claims.

**3. rocut CI runs plain `bun install`, NOT `--frozen-lockfile`, and does not run the static
checkers.** Two consequences: a stale `bun.lock` breaks nothing today (so P0's stale lock is not a
defect), and `check:packages` is **local-only**. **P3 and P6 must add the CI leg themselves** before
assuming one exists for the tarball harness and the executed examples.

**4. Bookkeeping correction.** P0's `tasks.md` truth is **29 boxes across 6 groups, 27 ticked** —
neither the planner's reported 25 nor the implementer's reported 20. The 2 unticked are ship boxes,
unbickable by construction at propose/apply time. Do not carry a wrong count forward.

### From P0's archive (LEAD, 2026-08-13) — a preventable failure P1–P7 will otherwise repeat

**The archive ESTALE race is caused by a parked worker's heartbeat, and it is PREVENTABLE — do not
treat it as a race to wait out.**

P0's archive failed three times with
`{"operation":"source-inventory","code":"ESTALE","message":"Active archive source changed after
planning."}`. Root cause: the P0 implementer was still parked in `rasen agent wait`, and its
keepalive heartbeat lives at `<changeRoot>/signals/.state/<role>.json` — **inside the very directory
being archived**. Every beat mutates the change directory, so the archive engine's source inventory
goes stale against its frozen saved-plan baseline.

Two consequences worth knowing precisely:
- **A bare retry can never succeed.** The engine compares against the *frozen* plan baseline, not a
  rolling one. Once the heartbeat has ticked since the plan was saved, that token is permanently
  dead. One attempt did a fresh dry-run and applied within ~1 second and *still* ESTALE'd.
- **The archiver inferred the heartbeat stopped because "an orphaned process finished on its own."
  That is WRONG, and the correct causation is the actionable one:** the LEAD wrote a `standDown`
  signal, the parked implementer consumed it and cleaned up its own heartbeat, and the LEAD
  separately closed the stale task-board entry. Both observed events were LEAD actions, not an
  autonomous process completing.

**So the rule for every remaining child is:** write `{"kind":"standDown"}` to
`<changeRoot>/signals/<role>.json` for every parked worker **the moment the review loop goes clean**,
confirm `signals/.state/` is empty, and only then plan the archive. The beat cap (12 beats ≈ 54 min)
is a stop-loss backstop, not the intended way a park ends. The LEAD forgot this on P0 and it cost
three failed archive attempts.

Corollary for handoff documents: a `retired-between-children` distillate must be written to the
**parent** change directory (`rasen/changes/s05-community-beta-second-host/handoff/`), NOT into the
child being archived — writing into the child restarts the same ESTALE churn, and cross-child
knowledge should outlive the child's archive anyway.

**Also confirmed at P0's archive** (useful, non-obvious):
- The archive preview's `specSync.mode: "no-deltas"` / `specActions: []` is unreliable as predicted —
  the real sync created `rasen/specs/sdk-package-boundary` at **8 requirements** from absent. Always
  verify by counting `^### Requirement` before and after.
- `--apply-plan` **conflicts with `--project`/`--store`**; the token carries its own scope, so pass
  neither.
- The ephemera cleaner discards `auto-run.json` on a successful apply, but **preserves it with reason
  `invalid-state` if it is malformed JSON**. Validate run-state JSON after every edit — a silently
  broken run-state defeats the purpose of keeping one.

### From P1's propose (planner, 2026-08-13) — sizing measured against `8437084b`

**Sizing, so no later child re-derives it:** 863 files move — 18 to `editor-ports`, 54 to
`editor-contracts`, **791** to `editor-classic`; `apps/web/src` keeps 54 shell files. 2,179 `@/`
specifier occurrences across 544 files. Consumers reach **96 distinct** package modules
(`apps/web` 53 / 103 edges, `apps/vite-example` 43 / 59 edges) plus 7 into ports and 1 into
contracts. Pre-move checker baseline to compare against: **341 cross-package edges**, `PARITY.md`
**9 differences / 0 semantic / 195 leaf values**.

**1. There is a whole CLASS of oracle that is scoped to `apps/web/src` and goes quiet when source
leaves it — and the two instances fail in opposite directions.** `check-package-boundary.mjs`'s
`ownerOfPath()` answers only for `apps/web/src/**` and `apps/vite-example/**`, so post-move package
files are *unowned*: `acyclic-direction` **fails open** (its `filesScanned` stays non-zero because
the shell and example remain, so the empty-scan guard never trips, while `edgesExamined` collapses
from 341 toward zero and it prints `PASS`), whereas `react-free-base` **fails closed** (its counter
only increments for `apps/web/src` base-layer files, hits 0, and the guard exits 2). The same bug
is latent in `check-type-baseline.mjs`, which runs `tsc -p tsconfig.json` with `cwd: apps/web`
against a fixture captured from the upstream pin — remove 863 files from that program and no *new*
diagnostic can appear, so "the baseline may not grow" is satisfied while the oracle watches a
fraction of what it was written to watch. **P2 adds a third consumer and inherits this exactly:
when the Electron Host lands, re-ask of every checker "does its scan set include the new Host?"
before trusting a green run.** The census numbers (`edgesExamined`, files-type-checked) are the
regression tests; treat a collapsed census as a failure even when the rule says PASS.

**2. The 14 declared `editor-classic` entries are sufficient — the work is barrel width, not entry
count.** All 96 consumer-reached modules map onto the existing entries (`./ui` takes the
`components/ui/*` atoms plus icons/theme-toggle/mobile-gate/editor-provider, `./evidence` takes all
seven harnesses, `./storage` takes the probes and migrations, and `.` takes `core` + `utils/*` +
`wasm` + `background/color` + `canvas/sizes` + `fps/defaults`). **`./media` is declared and
currently unconsumed — P2's Electron Host is its likely first consumer.** Adding an entry is legal
under P0's monotone-growth rule but must name the module that forced it; a quietly growing map is
how a 14-entry public surface becomes a 96-entry mirror of the internals. Separately, 12 modules
are reached *only* by the shell (`env/web`, `changelog/utils`, eight `components/ui/*` atoms, two
dialogs) — candidates for ownership correction, but correcting one to dodge authoring a barrel is
the anti-pattern to watch for in review.

**3. The packages ship TypeScript from `./src` with NO build step** — every `exports` target is a
`.ts` file. Three consequences that outlive P1: (a) no alias can ever be resolved away at build
time, which is why `@/` cannot survive inside `packages/` and why the replacement must be declared
by the package itself (Node `imports`, `"#/*": "./src/*"`) rather than by a Host's bundler config;
(b) **P3's tarballs will contain TypeScript**, so the scratch project outside the monorepo needs a
TS-capable consumer, and **P6's examples compile package source rather than consuming built JS** —
neither should assume a `dist/`; (c) **P7 inherits 863 `git mv` renames**, and
`SOURCE_INVENTORY.{md,json}` derives fork additions from `git diff --name-status` against the
upstream pin, so its output after P1 bears no resemblance to its output before.

### From P1's propose (planner, 2026-08-13) — measured against 8437084b

**Scale:** 863 files move (18 ports / 54 contracts / 791 classic); `apps/web/src` keeps 54 shell
files; **2,179 `@/` specifier occurrences across 544 files**; consumers reach **96 distinct** package
modules (apps/web 53 targets / 103 edges; vite-example 43 / 59) plus 7 into ports, 1 into contracts.

**1. A CLASS of oracle is scoped to `apps/web/src`, and its instances fail in OPPOSITE directions.
Every later child must re-ask this.**
- `acyclic-direction` **fails OPEN**: `filesScanned` stays non-zero (shell + example remain) so the
  empty-scan guard never trips, while `edgesExamined` collapses from **341** toward zero and the rule
  prints **PASS**. A green run would mean nothing.
- `react-free-base` **fails CLOSED**: its counter only increments for `apps/web/src` base-layer
  files, hits 0, and the guard exits 2.
- `check-type-baseline.mjs` has the same latent bug: it runs `tsc -p tsconfig.json` with
  `cwd: apps/web` against a fixture captured from the upstream pin, so removing 863 files from that
  program **cannot produce a NEW diagnostic**. "The baseline may not grow" stays technically
  satisfied while the oracle watches a fraction of what it was written to watch.
- **P2 adds a THIRD consumer (the Electron Host) and inherits this exactly.** When it lands, re-ask
  of every checker whether its scan set includes the new Host before trusting a green run.
  **The census numbers (341 edges, file counts, specifier counts) ARE the regression tests** — a
  collapsed census is a scope regression even when the rule prints PASS.

**2. The packages ship TypeScript from `./src` with NO build step.** Three consequences outlive P1:
- No alias can ever be resolved away at build time. `@/` cannot survive inside `packages/` because
  the manifests point `exports` at `./src/*.ts`; a surviving alias would break first in **P3's
  scratch project**, not here. Its replacement must be declared by the package itself, not by a
  Host's bundler config.
- **P3's tarballs will contain TypeScript** — the scratch project needs a TS-capable consumer.
- **P6's examples compile package source rather than consuming built JS.** Neither P3 nor P6 should
  assume a `dist/`.
- **P7 inherits 863 `git mv` renames**, which restate `SOURCE_INVENTORY.{md,json}` wholesale, since
  its generator derives fork additions from `git diff --name-status` against the upstream pin.

**3. The 14 declared `editor-classic` entries are SUFFICIENT — the work is barrel width, not entry
count.** All 96 consumer-reached modules map onto existing entries. **`./media` is declared and
currently unconsumed; P2's Electron Host is its likely first consumer.** Adding an entry stays legal
under monotone growth but must name the module that forced it. Separately, 12 modules are reached
*only* by the shell (`env/web`, `changelog/utils`, eight `components/ui/*` atoms, two dialogs) —
they are ownership-correction candidates, and **correcting one to dodge authoring a barrel is the
anti-pattern review should test for.**

**4. `rasen validate --strict` has two rules worth knowing before P2–P7 waste a cycle on them:**
a MODIFIED spec block must keep the original scenario heading **verbatim**, and an ADDED requirement
needs SHALL/MUST in its **opening sentence**, not merely somewhere in the paragraph.

**5. Decision procedure for `DOMAIN_DOCUMENT_MEMBERS` additions (flagged by the planner rather than
left to reflex).** Add a member only when the flagged `document` identifier traces to a binding whose
declared type is a `*Document` from `@opencut/editor-contracts`; commit it with the member name, the
file that forced it, and the type that proves it. **An identifier whose type cannot be named is a DOM
leak, and the fix is renaming the binding, not widening the allowlist.**

### From P1 Stage C (implementer, 2026-08-13) — a git blind spot every file-moving child will hit

**`git status` / `git diff` can report a file CLEAN while its bytes have diverged from the index.**
Measured during P1: 12 files under `packages/editor-contracts/src/**` had confirmed byte-level
divergence (different `wc -c`, different md5sum, `git hash-object` != `git ls-tree HEAD` blob hash)
while `git status --porcelain`, `git diff`, `git diff --stat` and even
`git update-index --really-refresh` all reported clean.

Mechanism: racy-git stat-cache trust. When a file's cached mtime/size in the index look unchanged,
git skips re-hashing and trusts the cached "clean" verdict. `git update-index --refresh` (note: NOT
`--really-refresh`) is git's own diagnostic here — it printed `needs update` for all 11 remaining
files.

**Two practical consequences, both measured, both counter-intuitive:**

1. **`git checkout HEAD -- <path>` is NOT a reliable repair in this state.** A batched checkout
   across all 12 paths silently fixed only the 1 file whose stat had been perturbed earlier (real
   mismatch → real write) and **silently no-op'd on the other 11**, reporting no error. Its own
   skip-if-unchanged fast path is fooled by the same stale stat.
   **The only method that reliably worked: `git show HEAD:path > path`** — a plain shell redirect
   with no git-side "is this needed" check at all.
2. **Verify by content hash, never by `git status`.** Use
   `git hash-object <path>` vs `git ls-tree HEAD <path>`, and `tr -dc '\r' < f | wc -c` for CR
   counts. And to check what is actually COMMITTED — as opposed to what is on disk — read the blob:
   `git show <sha>:path`, not a working-tree read. The LEAD made exactly this mistake, reading the
   worktree and concluding a *commit* was corrupt; it was not.

**Also from Stage C:** the `@/` → relative rewrite touched **1863 specifiers across 464 files**, and
the CRLF corruption was baked into **579 of the ~817 staged blobs** by the move/rewrite tooling
itself. Every later child that moves or generates files should assume the same and verify by hash.

### From P1's decisive experiment (implementer, 2026-08-13)

**P3 READ THIS FIRST — `%TEMP%` is unusable for scratch projects on this machine.** During P1 a
scratch extraction placed on the `%TEMP%` drive caused **both `ln -s` and `mklink /J` to hang
indefinitely** — consistent with the documented domestic-AV-intercepts-`%TEMP%`-staging pattern that
has bitten this project before. Relocating to a **same-drive (E:) sibling directory outside any Temp
path** made junction creation succeed instantly.

This is not incidental to P3: **P3's entire pack-and-install harness requires a scratch project
outside the monorepo with no workspace linking**, which is exactly this operation. Place it on E:
outside Temp from the start, and treat a hanging link/junction as the AV signature rather than a
tooling bug.

**Method note worth reusing:** the pre-move comparison was done with a `git archive` snapshot rather
than a second worktree — deliberately, to honour the "never create another rocut worktree"
constraint. The trade-off is that a plain snapshot has no `.git`, so any test that shells out to
real `git` fails there with `fatal: not a git repository`. Three tests did (`C5 storage RED controls
run in an isolated process`, `corpus isolation` x2) and are **methodology artifacts, not signal** —
they pass in the real repo both before and after the move. If a later child repeats this technique,
expect that class and exclude it explicitly rather than counting it.

**Test-suite verdict for P1, established by a 4-way matched comparison** (pre-move `8437084b` vs
HEAD, each with and without a wasm-mock `--preload`), matched 1:1 by test title:
- Pre-existing, crash-masked: 3 wasm `__wbindgen_start` errors, 5 of 6 `resolveTrackPlacement` TDZ
  failures (`Cannot access 'ZERO_MEDIA_TIME' before initialization`), 2x mask snapping, 1x custom
  mask point insertion. **Identical signatures in both worlds — not move-related. Disclosed, not
  fixed.**
- `resolveTrackPlacement > batch time spans reject tracks when any span overlaps` — pre-existing and
  independent of the wasm crash (survives the preload in both worlds). Disclosed, not fixed.
- **Move-introduced and in scope:** a hardcoded-literal-path class appearing ONLY post-move with
  zero pre-move analog — `public Surface composition` x5, `Surface drag integrations` x4, `Surface
  portal ownership` x1, `routing-registry` x1. Root cause: `readFileSync`/`Bun.Glob` calls on
  string-literal `apps/web/src/...` paths. **The specifier-rewriting codemod only rewrites
  `import`/`require` specifiers, never arbitrary fs-call string arguments** — every later child that
  moves files inherits this blind spot.
- `check-editor-singleton.mjs`'s own `OWNER`/`SESSION_FACTORY`/`commandDirectory` constants were
  hardcoded to pre-move paths (move-introduced, fixed). Its test's stale
  `.toContain("39 command module(s)")` assertion is a **separate pre-existing red dating to
  2026-08-10** — left failing deliberately, because fixing it would be out of scope and would hide
  that it was already red.

### From P1's review round 1 (reviewer, 2026-08-14) — three rules P2–P7 should adopt

**1. After ANY path-moving commit, run the executable sweep — this is a mandated step, not advice.**

```sh
git grep -n "<old-path-prefix>" -- ':!*.md'
```

**Require a stated reason for every surviving hit.** Not "fix the ones you notice" — enumerate all of
them and justify each one that stays.

Why it is mandated rather than suggested: P1 accumulated **nine instances** of one pattern (fix an
instance, leave its sibling), wrote the lesson down after the first four, and then produced three
more — two of them *inside its own documentation of the pattern*. The reviewer found all three with
this single command, before reading any of the child's reasoning.

The diagnosis is the useful part: **"sweep for sibling assumptions" is a rule about *intent*, and the
actor in the moment is the person least able to audit their own intent.** The grep is its executable
form. Run it; do not rely on remembering to.

Corollary from P1's own C6 regression (`BOUNDARIES.md` §11): a uniform sweep is also wrong. Some
siblings must update **together** (matched fixture pairs tied by a shared id), and some are
**deliberately anchored** (a `provenance.baseCommit` pinned to the last reviewed audit, not to the
latest regen). Classify before editing — updating all three uniformly took that checker from 1
failure to 5.

**2. The gate set has a blind spot with a KNOWN SHAPE: anything requiring a live server, a capture
run, or a browser.** Concretely: the C7 headless react-control proof, the Playwright storage probes,
`check-asset-manifest.mjs`, and both headless checkers. Nothing static covers that region.

P1's Blocker was caught only because parity happened to exercise the vite Host. Its MAJOR-1 sits in
the same region with **no oracle over it at all** — a react-vs-neutral proof whose two arms had
silently become identical, while the build that ran it logged "44 modules transformed cleanly."

**P2 adds a third Host and inherits this region wholesale. Treat it as UNVERIFIED until P2 runs
those programs itself** — a green static gate says nothing about it.

**3. An acceptance line may be amended ONLY when the looser reading is independently attested in a
source that predates the result, with the original wording quoted verbatim.**

Both conditions held for P1's task 8.1 and the amendment was upheld on independent review. The
discriminator, in the reviewer's words: the strict bar was *"a fossil of a measurement taken before
the thing being measured existed, not a standard someone found inconvenient."* §E8 recorded
"9 differences, 0 semantic, 195 leaf values" accurately on 2026-08-04 — six days before
`__opencutTransaction` landed and added 80 leaf values. A genuine bar-moving move has **no
pre-existing source** for the looser reading; here the looser reading was authoritative in two
places (spec §3.2 and `design.md` Goals).

**Inherit the test, not the precedent.** What makes it sound is the external corroboration, not the
fact that a LEAD authorized it. Two proposals to edit the parity classifier were refused under the
same test, and correctly — neither had a predating source for the looser reading.

### P1 CLOSED (2026-08-14) — archived at `2026-08-14-s05-package-extraction`

41 commits, all local. Spec synced: `sdk-package-extraction` absent -> **7 requirements** (new
capability); `sdk-package-boundary` **8 -> 8** (MODIFIED updates content in place, so the count is
unchanged by design — verify MODIFIED deltas by content, not by count).

**Rule activation, the child's central claim — TWO activated, THREE preserved:**

| rule | P0 baseline | after P1 | outcome |
|---|---|---|---|
| `public-entry-only` | 949 files, **0 specifiers** | 964 files, **328 specifiers** | **activated** |
| `no-internal-reexport` | **0 files** (dormant) | **863 files** | **activated** |
| `acyclic-direction` | 949 files, 341 edges | 964 files, 329 edges | preserved |
| `no-elftia-import` | 1031 files | 1048 files | preserved |
| `react-free-base` | 68 files | 68 files | preserved |

The preservation half is easy to undersell because **a preserved oracle looks like nothing
happening.** Un-widened, `acyclic-direction` would have watched its edge census collapse toward zero
across an 863-file move and **still printed PASS** (it fails open); `react-free-base` would have hit
0 and exited 2 (it fails closed). Holding those numbers steady IS the evidence Group 1 worked.

**CORRECTION to a finding the archiver reported — do not act on it.** It suggested "~19 remaining
hardcoded-path checkers are out of P1's scope, worth confirming which child owns triaging those."
That is a misreading of the ORIGINAL round-1 finding, not the final state. All 26/27 checkers were
triaged (`BOUNDARIES.md` §9, `evidence/group-2-checker-scope-audit.md`) and **swept green by task
8.5's "run every runnable static checker, confirm all green."** There is no backlog of 19 stale
checkers. P2 should not go looking for one.

**Genuinely open and deliberately unowned:** **255 errors / 21 warnings of pre-existing lint debt**
in `packages/*/src`, made visible when the N-1 fix took lint coverage from **59 files to 921**. It
predates P1 and was never checked before. It is **not P2's by proximity** — P2 builds an Electron
Host, and 255 lint fixes across the extracted editor is unrelated work. Assigning it is a human
decision.

**Accepted-known with its stated remedy** (not "revisit later"): the violation-scan test in
`c5-storage-red-controls.test.ts` still omits `packages/*/src`. Verified to hide no live violations
today. **P2's cheap correct action is to add the same fail-closed
`expect(files.length).toBeGreaterThan(0)` non-vacuity assertion that `8389be4e` gave the scope guard
it fixed — NOT to widen the scope.**

**The pattern that defined this child, stated once for whoever reads this next.** Nine instances of
"fix the instance, leave the sibling" — and the two rules that actually catch it:
1. `git grep -oE '<old-prefix>/[A-Za-z0-9_./-]+'` piped through an **`existsSync` filter**. Grep alone
   under-delivers because the majority bucket is "still-live path" and a dead target hides inside a
   live prefix; the filter cut 300 raw hits to 60 real candidates and caught a `package.json` miss
   the hand triage had filed under "fine".
2. **Classify before sweeping**: some siblings must move *together* (matched fixture pairs tied by a
   shared id), some are *deliberately anchored* (a `provenance.baseCommit` pinned to the last
   reviewed audit). A uniform sweep took one checker from 1 failure to 5.

### From P2's propose (planner, 2026-08-15) — artifacts complete, `validate --strict` valid

`s05-second-host` proposed: new capability `sdk-desktop-reference-host` (6 requirements);
`sdk-package-boundary` modified (acyclic-direction + public-entry-only gain declared-consumer scan
roots; 1 ADDED "Consumer roots are declared, derived, and visible"). tasks.md = **48 boxes across
10 groups**. Key measured facts the next children should not re-derive:

**1. The parity harness has TWO hardcoded host assumptions, and only one was designed away.**
`host-profile.ts` is the designed seam ("the only host-specific part" — extending `HostName` is the
intended move). But `readPersisted` in `tests/parity/snapshot.ts` reads IndexedDB by **literal
database names** (`video-editor-projects`, `video-editor-media-<id>`); any non-IndexedDB store is
invisible to it. P2 adds a host-scoped reader seam whose electron branch reads through the page's
own store bridge — preserving the fixture spec's "no purpose-built export path" rule. **P3's
scratch project and any future store-bearing host inherit the same seam.**

**2. The boundary checker's consumer scan set is three literal code sites, not the declared
consumer list.** `ownerOfPath()`, `packageAndConsumerSourceFiles()` and the consumer↔consumer edge
exclusion all match `apps/web/src` / `apps/vite-example` **prefixes hardcoded in the script**;
`boundary.json`'s `consumers` array exists but nothing derives scan roots from it. Meanwhile
`no-elftia-import` auto-covers new apps because `collectRepoFiles()` enumerates the whole repo.
This asymmetry — some rules auto-cover, some silently don't — is why **every child that adds a
consumer or a directory must re-run the per-checker audit**, not just the boundary checker. P2
makes `consumers` the single source of scan roots (oracle-first, with a no-files control run).

**3. Provider-private round-trip is ALREADY a named conformance case — do not author a bespoke
one.** `runPortConformance`'s store suite carries an opaque-payload case whose own doc cites Target
State §5.6 ("losing them is a Slice stop condition"); the `"portable"` profile exists precisely
for non-browser stores, and `exerciseMigration` is opt-in and **destructive by design** (disposable
fixtures only). A second store proves provider-private round-trip by running this suite over a
fixture — P3's worked adapter should do the same rather than write its own round-trip test.

**4. The published migration surface transfers to any store; the browser migration probes do
not.** `runStorageMigrations` + the 31 transformers + `CURRENT_PROJECT_VERSION` (=31) are exported
from `@opencut/editor-classic/storage` and operate on `ProjectRecord` **data**, not on IndexedDB —
a filesystem store delegates to them wholesale. The C5 browser probes
(`runBrowserProjectStoreMigrationProbes`, `c5-migration.html`) are IndexedDB-mechanical and are
stated non-coverage for any non-browser store.

**5. `createBrowserRuntimePorts`' asset classes are scheme-agnostic by their own contract.**
`BrowserAssetResolver.resolve` output is "opaque to the editor — a relative, absolute, or
custom-scheme URL are all conforming", and the loader takes an injectable fetch. A custom-protocol
host reuses them with a scheme base; what the Host owns is the serving, the allowlist copy, and the
manifest. **P3/P6 consequence: the runtime-asset allowlist lives in app build tooling
(`apps/vite-example/build/editor-assets.ts`), NOT in a package** — P2 imports it cross-app to keep
it single-source; if P3's tarball harness needs the allowlist outside an app build, moving it
becomes a decision P3 owns.

**6. Worker construction is the one port frozen specifically for non-HTTP origins — and on a
standard+secure custom scheme it needs no escape hatch.** `runtime-resources.ts`'s header records
E0's `app://bundle` SecurityError and blesses URL-rewriting and `blob:` construction as conforming.
P2's design serves the renderer itself from `opencut://app/`, making scheme worker URLs same-origin
by construction; `blob:` is fallback only. The transcription worker (nested ONNX sidecar) is NOT
exercised by the parity/agent/disposal scenarios — stated non-coverage, not implied coverage.

**7. The evidence harnesses are already Host-parameterized — a third host mounts them without
touching harness code.** `C6DisposalHarness` takes `createHost`/`isDurableBrowserStore` (a
predicate — an fs store passes an `instanceof` check)/`buildMarker`; the agent scenario runs
through the shared surface-evidence entry with `?scenario=agent`, selected per-Host by
`ENTRY`. Reuse, not re-invention, is mechanically easy; the work is composition and launch plumbing
(`_electron.launch` page acquisition instead of `webServer`+`baseURL`).

**8. Constraint on shared-spec edits (for P2's implementer and reviewer):** the parity spec files
(`parity.pw.ts`, `agent.pw.ts`, `snapshot.ts`) are shared by all hosts — edits must be confined to
page acquisition, entry selection, and the persisted reader, with **both existing hosts re-run
afterward** to prove no behaviour moved (P2 tasks 7.6). The diff tool's host pair must be verified
before use; if hardcoded, pair selection is an argument change, never a classifier change.

### From P3's propose (planner, 2026-08-15) — artifacts complete, `validate --strict` valid

`s05-conformance-for-third-parties` proposed: new capability `sdk-third-party-conformance`
(6 requirements); `transaction-automation-api` MODIFIED once (corpus publication — stale path fix
+ installed-consumption scenario). tasks.md = **29 boxes across 8 groups**.

**1. The five suites are already outside-shaped; the measured gaps are data-reachability and
requirement-naming, not suite design.** Every published surface takes text/data, never paths
(`loadTransactionVectorCorpus({manifestText, files, contract})`,
`parseContractSurface({operations, transaction, engineTypes})`,
`runTransactionVectors({corpus, contract, open})`) — but the file-READING layer is test-only
(`vectors/__tests__/corpus-fixture.ts`, unreachable from a declared entry), so an installed
consumer can reach the runner and not the data it runs. And `ContractSurface` is just three
string arrays — publishable as static data with an in-repo deep-equal drift guard against
`parseContractSurface(readContractSources())`.
**The JSON-static-import trap: a static `import corpus.json` re-stringifies to different bytes and
breaks the manifest's corpus digest — the corpus entry must return exact file bytes (fs-read
relative to `import.meta.url`, viable because `files: ["src",...]]` ships the corpus JSONs).**

**2. `workspace:*` in packed tarballs is P3's load-bearing unknown, gated first.** `npm pack`
keeps `@opencut/editor-ports: workspace:*` verbatim in `editor-contracts`' manifest —
unresolvable outside a workspace. Candidate mechanisms (npm `overrides` with `file:` tarball
mappings; bun equivalents) are measured at gate-1 before the harness is built. **Post-pack
manifest rewriting is rejected on principle: the tarball under test must be the artifact npm pack
produced.** Also measured: `npm pack` works fine on `private: true` packages and emits shasum +
integrity natively (contracts: 55 files, 580.3 kB unpacked) — the B1 "digest-manifested" evidence
is free from npm itself.

**3. `transaction-automation-api` spec carries SIX stale `apps/web/src/editor/contracts/...` path
references** (requirement/scenario text at lines 13, 171, 213, 603, 756, 886 as measured at this
propose) — P1's archive updated the boundary/extraction specs but not this one. P3 modifies only
the corpus-publication requirement (its own surface); the remaining five are recorded here for
the LEAD as a spec-hygiene decision, deliberately not swept into P3.

**4. Validator precision note for P5–P7's proposes:** the SHALL/MUST-in-opening-sentence rule is
stricter than "SHALL appears in the first paragraph" — two requirements whose subject phrase ran
long with em-dashes BEFORE the SHALL failed validation (`spec_delta_requirement_keyword_missing`)
even though SHALL sat inside the first sentence. Keep the normative verb within a short
subject–verb opening; elaborate after the period.

**Ruling (LEAD, 2026-08-14):** the `transaction-automation-api` stale-path refresh is IN SCOPE for
P3 — the delta now carries all six requirement blocks (corpus + five path-only refreshes, scenario
headings verbatim), attributed in design.md as a bounded P1-move spec-hygiene rider, with an
apply-time grep-must-be-zero task box.

### From P3's apply (LEAD, 2026-08-15) — one Direction-level finding carried, one obligation recorded

**1. The wasm-init class is Direction-level and lands on P6's doorstep next.** With packaging
fully honest (culori a real dep installing from the registry; `opencut-wasm` a real byte-inventoried
copy from a fourth local tarball via override), classic's published migration chain STILL dies at
initialization — `wasm.__wbindgen_start is not a function` — identically in-repo and from installed
tarballs. This is P1's disclosed pre-existing crash-masked wasm error, not a P3 defect and not
fixable by packaging. P3's migration leg therefore ships as the honest pair (runner records and
skips distinctly; the walker validated green against the real 31-step chain via classic's published
`./evidence/wasm-test-mock` entry — the same mechanism classic's own tests use). **P6's
custom-storage example drives migrations from installed tarballs in CI and will hit exactly this
wall**; its plan must choose mock-entry or scope around it explicitly. A real fix is wasm-pkg
shape/version work owned by no child in this portfolio — recommend raising at Direction level
against the next Slice rather than patching inside a child.

**2. The manifest-truth obligation now binds P5 and P6.** P3 caught classic declaring zero runtime
deps while its closure imports culori/react/opencut-wasm — invisible under workspace resolution,
caught only by the tarball harness. Fixed for those three (culori `dependencies`, react
`peerDependencies ^18.3.1`, opencut-wasm declared + packed as a fourth tarball with an override).
Any later change that adds an import to a package's runtime closure must declare it in the same
commit — and note `boundary.json`'s declared entries DERIVE from the packages' exports maps at load
time, so a new exports entry self-registers (no boundary.json edit needed; do not hand-add one).

### From P5's propose (planner, 2026-08-15) — artifacts complete, `validate --strict` valid

`s05-versioning-and-experimental-labeling` proposed: new capability `sdk-versioning-and-labeling`
(6 requirements, no modifications). tasks.md = **20 boxes across 7 groups**. Durable facts:

**1. The labeling-vs-freeze reconciliation is P5's load-bearing design move, and it binds P7
too.** In-source `@opencutSurface` markers are required ONLY for `provider`/`experimental`
entries; `frozen` classifications live in the shipped `surface.json` manifest alone — because
the four S03+S04 frozen surfaces must stay BYTE-identical (the P2/P3 `git show <base>|cmp`
control), and a marker requirement on frozen files would create frozen-signature pressure by
accident. Rule for P6/P7: **nothing may edit the four frozen files** — P7's provenance/SBOM work
included; any "frozen file needs an edit" moment is escalation to the contract, not a patch.

**2. Measured baseline + the mechanism P6 should expect to consume.** 36 classifiable export
entries (6 ports / 11 contracts / 19 classic, `./package.json` excluded); all packages at
`0.1.0`; every manifest's `files` lists README.md/LICENSE/NOTICE and **NONE of those files
exist** (tarballs today ship no policy text at all — P5 creates the READMEs, P7 owns
LICENSE/NOTICE); `packages/README.md` is stale since P1 ("packages/*/src is empty"). P6's
examples read labels from: per-package shipped `surface.json` + `@opencutSurface` markers in
non-frozen entry source + the policy READMEs (which state the wasm-init constraint on
`./storage/migrations` as policy truth). Labels change no import behavior.

**3. The em-dash-before-SHALL validator rule is now confirmed across three proposes (P3 ×2,
P5 ×2 rejections).** The effective rule: SHALL/MUST must appear within the first
subject–verb clause of an ADDED requirement's opening; a long appositive (em-dash) ahead of the
verb fails even when SHALL is inside the first sentence. P6/P7: draft requirement openings as
`<short subject> SHALL <verb>...`, elaborate after the period.

### From P6's propose (planner, 2026-08-15) — artifacts complete, `validate --strict` valid

`s05-published-examples` proposed: new capability `sdk-published-examples` (6 requirements, no
modifications). tasks.md = **21 boxes across 7 groups**. Durable facts:

**1. The template-materialization stance is now a reusable pattern.** Examples live at top-level
`examples/` — OUTSIDE the workspace globs by construction (an example resolving through the
monorepo is exactly the §3.7 failure) — declared as a `boundary.json` consumer so the derived
scan roots cover their `@opencut/*` imports. Corollary that will bite anyone extending this:
**committed templates cannot carry relative imports into `apps/`** — they break the moment the
harness copies them out; the embed example therefore carries its own minimal committed asset set
with a README pointer to the canonical allowlist, and "move the allowlist out of app build
tooling" is recorded as a named future decision, not pre-empted.

**2. The wasm-init in-plan decision (P6's owed choice): mock-entry honest-pair, with the label
consequence as a README obligation.** Production path runs and records its skip distinctly; the
31-step chain validates through the experimental-labeled `./evidence/wasm-test-mock`. General
rule worth keeping: **an example that depends on an experimental-labeled entry MUST state the
inherited instability in its README** — label consequences are documentation obligations, never
runtime machinery (no example reads surface.json at runtime; P5's rule holds).

**3. CI-leg geometry, measured.** The leg drives the runner purely through env seams; P3's
outside-Temp assertion means CI's scratch root MUST come from env into a non-Temp, non-repo path
(`$HOME`-style — `runner.temp` would be refused by design). The leg claims only the four
examples + the promoted consumer view; the 28 local checkers stay local by named decision.
Where evidence can only land post-delivery (the first true CI push), scenario clauses are
authored to pair with the LOCAL run's log lines and say so — the F2 delivery-audit rule's CI
corollary.

### From P7's propose (planner, 2026-08-15) — the LAST child; artifacts complete, `validate --strict` valid

`s05-provenance-and-beta-closure` proposed: new capability `sdk-provenance-beta-closure`
(6 requirements, no modifications — `upstream-provenance`'s regen requirement is path-neutral and
is EXECUTED, not amended). tasks.md = **20 boxes across 8 groups**, with Group 7 as the two-phase
regeneration spine. Durable facts:

**1. The delta-commit shape IS the accuracy evidence for any derived-artifact regeneration.**
Phase B regenerates (inventory + SBOM + reconciliations) at the code-complete HEAD and commits
the set as ONE commit whose `git show --name-only` lists generated artifacts ONLY — the content
derives from a named revision, nothing executable moved after it, and the second-run
byte-stability proof (the existing spec's own scenario) closes it. Self-certifying logs at Phase
B carry `HEAD: <sha>, tree: clean` with the `+worktree` half gone BY CONSTRUCTION. This generalizes
S03+S04's deferred-8.7 into a reusable sequencing pattern for any future Slice shipping derived
artifacts.

**2. The inventory's staleness is structural, not incidental**: the generator's `AREAS` constant
is the pre-P1 `["apps/web/src", "rust", "apps/web/public"]` while the code lives in packages/,
examples/ and two newer apps; `SOURCE_INVENTORY.md` still says "205 inherited file(s) modified"
against pre-P1 paths. P7 widens the areas (derived from the boundary map/workspace globs, not a
hand-list) and fixes patch-row gaps in Phase A so Phase B's delta is regeneration, not
row-authoring. The pin (`cf5e79e9…`), the root-MIT-preservation requirement, and the SBOM's
disposition assertions are fixed inputs the regen must satisfy, not rewrite.

**3. The documented-latent register is the mechanism that turns a snapshot finding into a standing
gate.** P6's probe (zustand's `immer`/`use-sync-external-store`, latent-only by subpath
reachability) becomes the closure checker's register: entries carry their reachability reason,
re-derived every run, and BECOMING-reachable fails naming the row. The pattern generalizes: any
"known-clean-today" exception belongs in a machine-re-verified register, never in prose or an
allowlist comment. Also noted for the portfolio close: the em-dash-before-SHALL rule caught its
sixth instance (P7 ×1 after P3 ×2, P5 ×2, P6 ×0) — the drafting rule holds.
