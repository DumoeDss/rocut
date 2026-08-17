# Handoff: s0304-transaction-api-and-react-surface — LEAD #1

## Original intent
Drive the composite Direction Slice **S03+S04 `03-transaction-api-and-react-surface`** (workstream
`opencut-agent-editor-sdk`) end-to-end via `/rasen-auto auto-decompose`. It bundles Roadmap S03
(M3 Transaction Automation API) and S04 (M4 Embeddable React Surface) into one active Slice with a
two-line portfolio of 8 children. The user's words: "auto-decompose 开始推进吧！" — run the autopilot,
fan out, push forward.

## Position
Pipeline: `auto-decompose` (parent) → children on `small-feature`. **Decompose done.** First cohort
**T0 + R0 shipped local.** 6 children remain. Paused 2026-08-09 at the user's request ("ship返回后先暂停")
after R0 shipped.

## Done / Remaining
**Done — first cohort (both shipped LOCAL, no push):**
- **T0 `s0304-transaction-contract-freeze`** — propose✅ apply✅ (`6d603adb` on `feat/s0304-transaction-contract-freeze`, base `d84d9d50`) verify✅ CLEAN (0 Blocker/0 Major/**1 Minor**/3 Trivial) review-loop⏭(skip) ship✅ local. Archive **deferred**.
- **R0 `s0304-surface-embedding-contract-freeze`** — propose✅ apply✅ (`fab202d4` on `feat/s0304-surface-embedding-contract-freeze`, base `d84d9d50`) verify✅ CLEAN (0/0/0/0) review-loop⏭ ship✅ local. Archive **deferred**.

**Remaining:**
- **Archive T0 + R0** (deferred): fix T0's accepted-known Minor first (see Dead ends), then archive both — syncs their spec deltas (`transaction-automation-api`, `embeddable-react-surface`) to `rasen/specs/`.
- **T1 `s0304-transaction-engine`** (dep T0✓) — pending. **Runnable now.**
- **T2 `s0304-draft-editing-sessions`** (dep T1) — pending.
- **T3 `s0304-ui-commit-routing`** (dep T1) — pending. **Shared seam** (the Surface line consumes it).
- **R1 `s0304-surface-mount-focus-lifecycle`** (dep R0✓ + T0✓) — pending. **Runnable now.**
- **R2 `s0304-surface-css-react-a11y`** (dep R1) — pending.
- **T4 `s0304-agent-transaction-evidence`** (dep T2 + T3) — pending.
- **Portfolio delivery** — ONCE at the parent after all 8 children: resolve mode (pr/push/local) with the user; never push a partial portfolio.

## Key decisions (and why) — do NOT re-litigate
- **A1 = (a)**: the Surface↔transaction commit binding is consumed by R1 against T0's frozen types, not frozen in R0. T0∥R0 was the *only* proven concurrency edge (plan §5). R0's contract carries an opaque `commit({ edit: unknown })` seam; T0 owns all transaction/domain types.
- **A2 = shared React 18** (ruled 2026-08-08): isolated React 19 throws React #321 at the router-context seam; shared-18 runs end-to-end. R2 implements/proves shared-18.
- **Baseline = `feat/session-runtime-host-ports@d84d9d50`** (S02 product tip; `main@88547d38` carries specs only, NOT the code). All children branch from `d84d9d50`.
- **All rasen commands use `--project rocut`.** Direction artifacts live in the elftia repo (`rasen/work/opencut-agent-editor-sdk/slices/03-transaction-api-and-react-surface/{spec,plan}.md`); implementation lives in `rocut`.

## Dead ends & gotchas
- **CRITICAL — SERIALIZE all rocut-mutating workers.** `rasen-apply-change` (and review) operate via the **single shared rocut checkout**; they do NOT mint per-child worktrees under concurrent invocation. Running two implementers concurrently raced the checkout: T0's commit (`c0160d02`) landed on R0's branch instead of its own. A fixer worker re-created T0's commit as `6d603adb` on the correct branch and reset R0 to `fab202d4` (verified single-child clean). **Lesson: the T0∥R0 "concurrency" is nominal — execute every rocut stage one worker at a time.** This matches the known hazard in memory (`feedback_concurrent_edit_reverts_shared_file`).
- **T0's deferred Minor:** `rasen/changes/s0304-transaction-contract-freeze/specs/transaction-automation-api/spec.md` has a mathematically wrong `FrameRate` rejection example — it claims NTSC `30000/1001` is rejected, but `120000*1001/30000 = 4004` (integer), so the code correctly ACCEPTS it. The validation logic is sound; only the spec *example* is wrong. Fix = replace the example with a rate that actually fails (e.g. `90/1` → 1333.33). Do this before archiving T0.
- **`apps/web` build has a PRE-EXISTING failure** (`/api/sounds/search` rejects undefined — missing `FREESOUND_CLIENT_ID`/`FREESOUND_API_KEY` env, no `.env` exists). NOT a regression for any child. `apps/vite-example` builds green and is the reliable gate.
- **Type baseline ceiling = 3** (`node script/check-type-baseline.mjs`); each child must keep it ≤ 3.
- **Branch surgery left the main checkout on `feat/s0304-surface-embedding-contract-freeze` at `fab202d4`.** T0's in-memory-fake/conformance had transient type errors during the race; the final `6d603adb` is clean (verify passed).
- Working tree has untracked rasen artifacts (`.rasen/`, the other children's change dirs, specs, config) — these are normal runtime/planning files; do not `git clean` them.

## Working set
- **Run-state (authoritative):** `rocut/.rasen/changes/s0304-transaction-api-and-react-surface/ephemera/portfolio-run.json` (all 8 children: status/stage/commits/dependsOn + delivery pending + decisions A1/A2 + guardrails). Each child's `ephemera/auto-run.json` tracks its stage workers.
- **Planner seed + durable findings:** `rocut/rasen/changes/s0304-transaction-api-and-react-surface/planning-context.md` — carries T0 findings (donor naming: Clip=`TimelineElement`/Marker=`Bookmark`/Track=`TimelineTrack`; `MediaTime` standalone not `@/wasm`; `EditorCore` has 15 members, 9 subscribable) and R0 findings (no existing focus machinery; Radix portals break CSS containment → R2; `session.suspend()` already drains preview → R1 delegates). **Read this FIRST when proposing T1/R1.**
- **Branches:** `feat/s0304-transaction-contract-freeze`@`6d603adb`, `feat/s0304-surface-embedding-contract-freeze`@`fab202d4`. Read-only S02 measurement worktree: `_others/rocut-wt-s02`@`be9cfc4e`.
- **Resume command:** `rasen pipeline resume s0304-transaction-api-and-react-surface --project rocut --json`.

## Next action
1. **Archive the cohort** (serial, one worker): fix T0's FrameRate spec example (`90/1`), then `rasen archive` T0 and R0 (`--project rocut`) to sync their specs. (R0 needs no fix.)
2. **Run T1 `s0304-transaction-engine`** (propose→apply→verify→ship→archive), strictly serial, via `/rasen-auto` or manual resume. Its planner reads `planning-context.md` (T0's findings) + the elftia Direction plan §4 T1 entry.
3. After T1 ships, the DAG unblocks T2/T3/R1 — continue one at a time. **Never run two rocut-mutating workers concurrently.**
4. After all 8 children ship+archive: **portfolio delivery once at the parent** — ask the user for mode (pr/push/local).
