# Handoff: s0304-transaction-api-and-react-surface — LEAD #3

## Original intent

用户要求阅读既有交接后，“继续按照 rasen-auto auto-decompose 推进”，并在额度恢复后继续完整组合流水线。运行时约束始终是 **Codex only**；不得调用 Claude Code/runtime。当前用户明确要求：等待在途 subagent 返回，编写 `rasen-handoff`，然后暂停。

## Position

- Repository: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`
- Branch: `recovery/s0304-ui-commit-routing-final`
- Project selector: `--project rocut` on all Rasen change/spec/pipeline commands
- Parent pipeline: `auto-decompose`, Tier A restored, gate policy `off (global)`
- Parent run-state: `.rasen/changes/s0304-transaction-api-and-react-surface/ephemera/portfolio-run.json`
- Current child: `s0304-surface-mount-focus-lifecycle` (R1), child pipeline `small-feature`
- Current stage: `review-loop`, **Round 2 fixes complete; independent Round 2 delta re-review is pending**
- Child run-state: `.rasen/changes/s0304-surface-mount-focus-lifecycle/ephemera/auto-run.json`
- No worker is in flight. Native agent handles from this session must be treated as dead in a successor session.

Parent portfolio status: 6/9 children are done. R1 is in progress; R2 `s0304-surface-css-react-a11y` depends on R1; T4 `s0304-agent-transaction-evidence` is dependency-ready but the portfolio guardrail requires every rocut-mutating worker to run serially.

## Done / Remaining

Done:

- Archived children: T0 `s0304-transaction-contract-freeze`, T1 `s0304-transaction-engine`, T2 `s0304-draft-editing-sessions`, C1 `s0304-project-settings-transaction-operation`, T3 `s0304-ui-commit-routing`, R0 `s0304-surface-embedding-contract-freeze`.
- R1 planning is strict-valid: 50 tasks, 6 requirements, 32 scenarios.
- R1 apply is 50/50. Product Surface, root focus/input ownership, lifecycle controller, private transaction adapter, Next/Vite Host composition, boundary checkers, and dual-Host evidence are present.
- Initial independent verify found 7 findings: 3 Blocker, 2 Major, 2 Minor.
- Round 1 fixed all seven, but non-author re-review closed only S1 and S3. It left P1/P2 Blocker, S2/P3 Major, S4 Minor open. Canonical reports are `rasen/changes/s0304-surface-mount-focus-lifecycle/evidence/review-report.md` and `review-cycle-report.md`.
- Round 2 implementer reports fixes/evidence ready for all five remaining findings. Final implementation-owned receipts:
  - 44-path worktree fingerprint: `2984b222baf7de5670c88209ff63296729af0d372c1c7fda4348a983dc16cf95`
  - implementation report SHA-256: `4d7931eda8d55cdfd76317bd331429fb89c1e0fb4872eb9e6500af644ca92d46`
  - manifest SHA-256: `5fcc164278edd57388c9b70cb8eff6e52d8ba94611d07f30e20f25da19299b51`
  - manifest 26/26; PNG 14/14; strict validation 1/1; `git diff --check` pass
  - distributable graph: 2,931 modules / 630 Web modules / 10 of 10 exclusions
- All workers are quiescent. The mistakenly spawned leaf child `/root/r1_implementer_2/s0304_evidence_fixer` was immediately interrupted; the implementer found no durable child delta and personally reran the reported closure gates. This violation is recorded in R1 run-state; do not revive or trust that child.

Remaining:

1. Dispatch a **fresh non-author reviewer** for Round 2 delta re-review of P1, P2, S2, P3, S4. It must update only `review-report.md` and `review-cycle-report.md`, with exact proof per finding. Do not mark findings resolved from implementer self-report.
2. Explicitly inspect the retained note that `spec-falsification-sweep.md:55` still describes an earlier 25/16 parity run while `implementation-report.md` records final 28/19/9. Resolve it or record it as accepted-known; do not silently drop it.
3. If Round 2 is clean: mark R1 review-loop done/open findings empty in child run-state, then dispatch local-only ship and archive. If findings remain: Round 3 is the final normal loop round; after its cap use the material-change strategy ladder, never silently pass.
4. After R1 archive, continue strictly serial: R2 `s0304-surface-css-react-a11y`, then T4 `s0304-agent-transaction-evidence`.
5. After all nine children complete, perform exactly one parent portfolio delivery. Never push a partial portfolio.

## Key decisions (and why)

- `EditorSurface` renders React in the caller's tree; `session.mount()` binds only the actual root handle. No nested `createRoot`.
- Shortcut/pointer/wheel/Tab ownership is Surface-root scoped; explicit null `targetRef` never falls back to `document`.
- DOM listener locality is insufficient by itself. Action registry selection and synchronous nested dispatch carry the owning Surface/session scope; legacy no-provider dispatch stays in a distinct unscoped bucket.
- Cleanup synchronously calls `session.unmount()` before async settlement and never auto-disposes. Hidden delegates only to `session.suspend()`; visible delegates through `session.resume()`.
- R0's public opaque commit signature remains frozen. Private binding reuses `editorForSession(session).transactions`; no sibling engine and no double T3 submission.
- Opaque transaction input must validate the closed T0 operation union and minimally required payload shapes before `apply`.
- Next/Vite chrome, picker, mobile gate, project loading, and product-shell ownership remain Host-owned. CSS namespace, portals, a11y, resize, and shared React 18 remain R2.
- Browser PASS is delivery evidence only when target/server ownership matches and the artifacts are bound to final source/build bytes. Manifest integrity alone does not prove source attribution.
- All rocut-mutating workers remain serialized because independence in the shared dirty worktree cannot be proven safely.

## Dead ends & gotchas

- `rasen status` on the parent looks artifact-incomplete because the parent is a portfolio planning container. The authoritative parent view is `rasen pipeline resume s0304-transaction-api-and-react-surface --project rocut --json` plus `portfolio-run.json`; never restart parent proposal generation.
- HEAD is still the pre-R1 archive commit `c5a139662c8411b99570e15b22c7c30662e7864e`. `git rev-parse HEAD^{tree}` therefore does not identify uncommitted R1 bytes; require the reproducible worktree fingerprint in evidence.
- Initial Next evidence targeted inherited `:3000` while starting `:3017`; S1 corrected it to owned `127.0.0.1:3017` with server reuse disabled. Round 2 regenerated final evidence; the new reviewer must confirm attribution.
- The first P1 browser artifacts predated final registry source. Round 2 reports regenerated Vite/Next Surface and parity after final bytes; verify timestamps/fingerprint rather than trusting the report prose.
- Checking `session.state === suspended` only after settlement missed the in-flight suspend/remount race. Round 2 claims session-owned reconciliation now covers it; re-run/read the deterministic regression.
- Active project presence is earlier than full project-load completion. Round 2 claims the C4 gate now includes full loading state and regenerated Worker/forced-none evidence; independently confirm.
- The design fixer once hung in a long browser command. LEAD interrupted and revived the same handle; no relay was charged. Do not infer failure from old Node/Chrome leftovers.
- The Round 2 implementer violated the flat-leaf rule once by spawning `s0304_evidence_fixer`, immediately interrupted it, and disclosed no durable delta. Treat every Round 2 claim as requiring non-author confirmation.
- Preserve unrelated `.rasen/` material. Never use `git add -A`, `git clean`, force worktree removal, `git reset --hard`, partial push, or partial PR.

## Eliminated hypotheses

- “Root-scoped key listener alone isolates multiple editors” — ruled out because the old module-global action registry broadcast the same action to every mounted session handler. Current design scopes registry dispatch itself.
- “Manifest hashes prove the browser run exercised final code” — ruled out by Round 1 timestamps showing artifacts older than final source. Exact source/worktree identity and post-source runs are required.
- “A non-null active project means EditorProvider loading is complete” — ruled out because `ProjectManager.loadProject` publishes active state before the final loading phase.
- “Visible remount is safe when the session is not yet suspended” — ruled out by the in-flight suspend diagnostic ending suspended with zero resume.
- “Object presence is sufficient T0 payload validation” — ruled out when empty create-entity payload objects reached `apply`.
- Current best hypothesis: Round 2 implementation and regenerated evidence close all five findings, but only the pending fresh reviewer may confirm that.

## Working set

Primary product areas:

- `apps/web/src/actions/{registry.ts,action-scope.tsx,use-action-handler.ts,use-keybindings.ts,index.ts}` and direct action callers under assets/preview/timeline.
- `apps/web/src/editor/surface/embedding/**` and `apps/web/src/editor/surface/embedding/__tests__/**`.
- `apps/web/src/editor/host/{c4-next-runtime-probe.tsx,c4-project-load.ts}`.
- Next Host page/provider and Vite Host entry/config/browser harness.
- `apps/vite-example/tests/parity/{surface.pw.ts,c4-next.runtime.ts,driver.ts}` and `playwright.surface.config.ts`.
- `BOUNDARIES.md`, `PATCHES.md`, `script/check-surface-boundary.mjs`.

Evidence / truth sources:

- `rasen/changes/s0304-surface-mount-focus-lifecycle/evidence/implementation-report.md`
- `rasen/changes/s0304-surface-mount-focus-lifecycle/evidence/spec-falsification-sweep.md`
- `rasen/changes/s0304-surface-mount-focus-lifecycle/evidence/artifact-hashes.sha256`
- `rasen/changes/s0304-surface-mount-focus-lifecycle/evidence/review-report.md`
- `rasen/changes/s0304-surface-mount-focus-lifecycle/evidence/review-cycle-report.md`
- `.rasen/changes/s0304-surface-mount-focus-lifecycle/ephemera/auto-run.json`
- `.rasen/changes/s0304-transaction-api-and-react-surface/ephemera/portfolio-run.json`

Useful resume/check commands:

```powershell
rasen pipeline resume s0304-transaction-api-and-react-surface --project rocut --json
rasen pipeline resume s0304-surface-mount-focus-lifecycle --project rocut --json
node script/check-distributable-boundary.mjs
rasen validate s0304-surface-mount-focus-lifecycle --strict --project rocut --json
git diff --check
```

For exact Round 2 browser/test commands and non-secret Next placeholder environment, read `implementation-report.md`; do not reconstruct them from memory or expose secrets.

## Next action

Read this document, then run:

```powershell
rasen pipeline resume s0304-transaction-api-and-react-surface --project rocut --json
rasen pipeline resume s0304-surface-mount-focus-lifecycle --project rocut --json
```

Next, spawn a fresh Codex reviewer (report-only, no subagents) for **Round 2 delta re-review**. Seed it with the two reviewer reports, the five open findings, the Round 2 implementation report/manifest, and the final fingerprint `2984b222baf7de5670c88209ff63296729af0d372c1c7fda4348a983dc16cf95`. It must independently confirm or reject each finding and update the two canonical reviewer reports before any ship action.
