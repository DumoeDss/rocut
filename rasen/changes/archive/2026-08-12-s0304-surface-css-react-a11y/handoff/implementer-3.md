# R2 implementer successor #3 handoff — 2026-08-11

## Receipt

- Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`
- Branch: `recovery/s0304-ui-commit-routing-final`
- HEAD remains the inherited `cdfae229ebe8ea393807cce0b7a9617083625f78`; no commit, push, PR, archive, index operation, new worktree, subagent, workflow, T4 change, or `.rasen/**` write was performed.
- Read first, in required order: implementer-2 handoff, implementer-1 handoff, planning context, proposal, design, tasks, complete delta spec, then the ordinary semantic diff.
- Verified LEAD's original 14-file unblock: initial ordinary tracked diff was 120 insertions/322 deletions and `git diff --check` was clean.
- `tasks.md` remains 0/49. No numbered task is yet fully evidenced.

## Product work completed in this relay

The relay addressed a coherent subset of the 13 draft correctness issues, but did not complete R2:

1. **CSS token omissions corrected in the draft** (`apps/web/src/editor/surface/surface.css`):
   - restored panel `--primary-foreground`, destructive foreground, and constructive foreground;
   - restored dark caution values;
   - restored the complete dark-panel override block;
   - restored text line-height theme variables;
   - restored accordion animation variables and keyframes.
2. **Next Host appearance made explicit** (`apps/web/src/app/globals.css`): Host-owned light/dark body background and foreground no longer depend on editor tokens at `:root`.
3. **Fixed portal containing block established in the draft**: the absolute portal owner now has a transform containing block, so fixed Radix/direct content resolves against the bounded owner rather than the viewport. This still requires browser bounds proof.
4. **Focus restoration suppression removed** from dialog, dropdown menu, select, and sheet. Caller handlers remain accepted through normal prop spreading; default Radix open/close autofocus is no longer deliberately prevented.
5. **Initial-open portal escape closed structurally**: `SurfacePortalProvider` mounts its owner first and does not render descendants until the owner ref exists. An initially-open portal therefore cannot render through a transient body fallback. This needs focused lifecycle/render proof.
6. **Portal host semantics simplified**: removed the label without a role; the host remains mechanically selectable by `data-editor-surface-portal` without adding an accessibility landmark/node.
7. **Error fallback IDs made instance-unique** with `useId`; dedupe was strengthened to a module `WeakSet<Error>` so a Strict-Mode-shaped boundary remount receiving the same Error identity is not re-reported. Latest callback still routes through `EditorSurface`'s existing `onErrorRef`. Focused/effectful proof remains required.
8. **Portal prop precedence corrected**: `useSurfacePortalContainer(explicit)` chooses the exact Surface owner first, then an explicit internal container only outside a Surface; wrappers spread props before assigning the resolved container, so a caller cannot overwrite the Surface owner by JSX order.
9. **Applicable tooltip portal migration drafted**: shared tooltip content now portals through the private Surface owner while retaining Radix body behavior outside a Surface.
10. **Both direct editor portals retargeted**:
    - assets draggable overlay;
    - timeline audio-volume tooltip.
    They now require a live private owner and have no `document.body` fallback beneath the Surface.
11. **Final current `git diff --check` is clean.**

## Current dirty product scope

Tracked modified:

- `apps/vite-example/src/styles.css`
- `apps/web/src/app/globals.css`
- `apps/web/src/components/editor/panels/assets/draggable-item.tsx`
- `apps/web/src/components/ui/{alert-dialog,context-menu,dialog,dropdown-menu,menubar,popover,select,sheet,tooltip}.tsx`
- `apps/web/src/editor/surface/embedding/editor-surface.tsx`
- `apps/web/src/timeline/components/audio-volume-line.tsx`

Untracked product:

- `apps/web/src/editor/surface/embedding/surface-error-boundary.tsx`
- `apps/web/src/editor/surface/embedding/surface-portal.tsx`
- `apps/web/src/editor/surface/surface.css`

Planning handoff added:

- `rasen/changes/s0304-surface-css-react-a11y/handoff/implementer-3.md`

Pre-existing untracked `.rasen/` remains untouched.

## Formatting caveat introduced by this relay

- The harness denied the scoped repo-local Prettier write command again.
- Dedicated full-file `Write` was used to normalize the two direct-portal files, leaving their ordinary semantic diffs small (assets 4/2; audio 4/1).
- `tooltip.tsx` is still shown as 82 insertions/76 deletions because its original CRLF bytes and newly written LF bytes differ across the file. Its semantic change is only the private portal wrapper. Normalize **only this file** with repo-local Prettier/EOL tooling when approved, then re-check the ordinary diff. Do not format globally or use index renormalization.
- Current overall tracked stat is 211 insertions/417 deletions; `git diff --check` passes.

## Verification status

- Ordinary diff and direct portal residual scan inspected.
- Both direct portal files now contain zero `document.body` occurrences.
- `git diff --check`: **pass** at handoff time.
- A Vite typecheck invocation was denied by command policy; it did not run.
- No focused test, lint, type baseline, checker, lock/install, build, browser, axe, parity, disposal, hash, falsification, Rasen strict-validation, encoding, or artifact-integrity gate has run.
- No task may be marked complete from this relay.

## Correctness issues still requiring implementation/proof

1. Verify exact token equivalence mechanically and inspect emitted Tailwind v4 CSS; source restoration alone is insufficient.
2. Browser-prove the transformed portal owner actually bounds fixed dialog/alert/sheet/direct overlays in Next and Vite, including clipping, positioning, and z-order.
3. Add focused initial-open/provider lifecycle tests and prove no body ownership at any render phase.
4. Add error-boundary tests for unique IDs, latest callback, same-error dedupe, distinct-error reporting, fallback semantics, provider descendant cleanup, and preservation of `EditorSurface` session lifecycle (no dispose; no extra `session.unmount`).
5. Resolve submenu behavior with Radix: `SubContent` remains nested under the owning menu portal in the current draft, but this needs DOM ownership proof or an explicit wrapper if Radix creates a separate portal.
6. Normalize `tooltip.tsx` without global formatting.
7. Exact React 18/ReactDOM/types/lock migration is entirely untouched.
8. Private drag coordinator and every concrete number/color/timeline/keyframe/resize/bookmark/assets continuation migration are entirely untouched.
9. CSS-only resize behavior has not been exercised; do not add an observer until a concrete descendant failure is demonstrated.
10. All fail-closed checkers, negative/converse controls, focused tests, evidence harness extensions, production builds, dual-Host evidence, parity/disposal, reports, hashes, and strict closure gates remain.

## Full remaining approved scope

All 49 numbered tasks remain unchecked and require their specified evidence. Continue without narrowing:

- finish exact scoped CSS and emitted-CSS checks;
- finish portal/shared/direct/submenu/tooltip ownership and focus tests;
- pin exact shared React 18 metadata and lock, prove singleton/runtime identity and Next 16 compatibility;
- complete internal accessible error behavior and lifecycle proof;
- determine CSS-only resize sufficiency and add only a demonstrated minimal observer if needed;
- implement the provider-private per-Surface/session live-owner drag coordinator and migrate every approved concrete site;
- add fail-closed CSS/portal/private-drag/React/public/viewport checks scanning tracked plus uncommitted files, with all negative and converse fixtures;
- run focused Bun suites, changed-file ESLint, focused TypeScript, and type ceiling 3;
- run Vite type/build, ten exclusions plus singleton, marker-bearing Next production build;
- generate owned-server, source-attributed dual-Host axe/error/portal/resize/drag/runtime evidence;
- rerun S02 disposal and R1 lifecycle/focus controls, then full parity from authoritative 28/19/9;
- hash final source/test/lock bytes before builds and after browser runs;
- complete 17-spec/every-SHALL falsification, reports, ledgers, screenshots, artifact manifest, strict Rasen validation, UTF-8/BOM/U+FFFD, PNG/manifest integrity, and final product/planning `git diff --check`.

## Mandatory eliminated hypotheses / dead ends

1. **Do not retry unavailable skills as the execution plan.** Predecessors established `rasen-apply-change` and `rasen-handoff` were unavailable.
2. **Containment alone is insufficient.** Keep the real Next Host / distributable Surface stylesheet split.
3. **Vite `resolve.dedupe` is not React A2 proof.** Exact React 18 metadata, lock, graph, runtime, and both production builds remain mandatory.
4. **Portal migration is broader than the original eight wrappers.** Tooltip and both direct portals are now drafted; submenu ownership still needs proof. Host toaster remains outside.
5. **Do not restore body fallback beneath a Surface.** The provider now gates descendants until owner availability; direct editor portals require that owner.
6. **Do not allow caller `container` to override a live Surface owner.** Current precedence is Surface owner first, explicit container only outside a Surface.
7. **Do not place drag coordination in `surface-focus.ts`.** It is provider-private, per-Surface/session, active-drag-only, and owner/pointer discriminated.
8. **Do not ban all document listeners.** Scan/classify concrete provider-private continuations; preserve explicit Host/non-goals.
9. **Do not add a resize observer speculatively.** Exercise CSS-only bounded resizing and add only minimal demonstrated invalidation.
10. **Do not globally format or use index renormalization.** Only `tooltip.tsx` currently needs scoped EOL normalization from this relay.
11. **Do not treat static draft presence as evidence.** Every checkbox requires its specified focused/mechanical/effectful proof.
12. **Do not use stale 25/16/9.** Authoritative inherited R1 parity is 28/19/9.
13. **Do not evade React 18 incompatibility.** No React 19 island, alias, externalized duplicate, ignored peer failure, or nested root; incompatibility returns to Direction.
14. **Do not broaden public Surface/lifecycle/transaction ownership.** Preserve props, focus matrix, opaque commit binding, Host ports/chrome, session mount/unmount/suspend/resume behavior, no auto-dispose, T3 routing, history/save behavior, and untouched T4.
15. **Final evidence must postdate final product/check/test/lock bytes.** Any later byte change invalidates builds/browser results/hashes and requires rerunning them.

No completion claim is warranted.
