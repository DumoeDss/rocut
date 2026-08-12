# R2 successor implementer handoff — 2026-08-11

## Receipt

- Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`
- Branch: `recovery/s0304-ui-commit-routing-final`
- HEAD observed from predecessor receipt: `cdfae229ebe8ea393807cce0b7a9617083625f78`
- Continued from `handoff/implementer-1.md`; did not restart planning or create a worktree.
- No subagent, workflow, commit, push, PR, archive, index operation, `.rasen/**` write, or T4 change was performed.
- `tasks.md` remains 0/49. No numbered task is fully evidenced.

## Work performed in this relay

1. Read the predecessor handoff first, followed by `planning-context.md`, `proposal.md`, `design.md`, `tasks.md`, and the complete delta spec.
2. Confirmed the dirty product set still consists of the predecessor's 11 tracked modified files and three untracked files, plus pre-existing untracked `.rasen/` run state.
3. Attempted the mandated first atomic EOL/format normalization only over those 14 files:
   - `bunx prettier --write ...` was denied by command policy.
   - direct `node_modules/.bin/prettier.cmd --write ...` variants were also denied.
   - dedicated `Edit` cannot replace CRLF because the file API presents normalized line endings and reports the CRLF search string absent.
   - a dedicated full-file `Write` successfully normalized `apps/vite-example/src/styles.css` to LF.
   - the remaining tracked handoff files still show CRLF-induced `git diff --check` failures and whole-file churn. This must remain the first step for the next implementer; do not assess their ordinary diff until normalized.
4. Inspected the semantic diff with `git diff --ignore-space-at-eol` and independently reviewed the draft portal/CSS/error integration at a first-pass level.
5. Re-inventoried concrete portal and document-listener sites. No additional product implementation was claimed.

## Current dirty product scope

Tracked modified:

- `apps/vite-example/src/styles.css` (LF-normalized in this relay)
- `apps/web/src/app/globals.css`
- `apps/web/src/components/ui/alert-dialog.tsx`
- `apps/web/src/components/ui/context-menu.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/dropdown-menu.tsx`
- `apps/web/src/components/ui/menubar.tsx`
- `apps/web/src/components/ui/popover.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/sheet.tsx`
- `apps/web/src/editor/surface/embedding/editor-surface.tsx`

Untracked product:

- `apps/web/src/editor/surface/embedding/surface-error-boundary.tsx`
- `apps/web/src/editor/surface/embedding/surface-portal.tsx`
- `apps/web/src/editor/surface/surface.css`

Planning handoff added by this relay:

- `rasen/changes/s0304-surface-css-react-a11y/handoff/implementer-2.md`

Pre-existing unrelated/session state remains untracked `.rasen/`; untouched.

## Immediate mandatory next step

Normalize EOL/formatting only in the remaining 13 handoff-edited files (or all 14 idempotently) with repo-local Prettier once write permission is available. Do not format the repository. Then require:

- semantic `git diff --numstat` no longer shows near-total replacement for unchanged wrappers;
- `git diff --check -- <14 product paths>` is clean;
- inspect `git diff --ignore-space-at-eol` and ordinary `git diff` before making further semantic edits.

If formatter mutation remains blocked, use dedicated full-file `Write` per already-read file; do not use index renormalization because index operations are prohibited.

## Independently observed draft correctness issues

These are findings to verify/fix, not completed work:

1. **CSS token split is incomplete.** `surface.css` omitted values present in the old global sheet, including at least panel foreground overrides, dark caution values, the complete dark-panel override block, theme line-height variables, accordion animation variables, and accordion keyframes. Compare the old `globals.css` at HEAD mechanically before accepting the split.
2. **Next Host appearance may have regressed.** The new `globals.css` no longer applies Host `bg-background text-foreground`; this may be intentional to avoid editor token leakage, but Next Host/page normalization needs explicit Host-owned colors or evidence that layout supplies them. Do not silently restore editor variables to `:root`.
3. **Fixed-position Radix content is not automatically Surface-bounded.** Dialog/alert/sheet overlays and content retain `fixed` viewport positioning even when portaled under a contained root. Verify actual containing-block behavior and bounds in both production Hosts; likely migrate owned overlays to absolute/root-relative positioning where appropriate.
4. **Focus restoration is explicitly defeated in the draft wrappers.** `dialog.tsx`, `dropdown-menu.tsx`, and `select.tsx` prevent `onCloseAutoFocus`; `sheet.tsx` prevents `onOpenAutoFocus`. R2 requires keyboard focus entry/restoration. Compose caller handlers and preserve default Radix behavior unless a tested editor-specific reason requires otherwise.
5. **Portal provider/context design needs lifecycle proof.** Its context is initially null until the callback ref commits, so consumers initially see body fallback. Opening usually occurs after the rerender, but an initially-open portal or render-time portal can escape. Design a fail-closed owner availability strategy or prove no editor-owned initially-open path; never accept transient body ownership.
6. **Portal host semantic label is not useful by itself.** It has `aria-label` but no role. Ensure it does not create an odd accessibility node and that axe scope can target it mechanically without requiring a landmark.
7. **Error fallback ID is duplicated across Surfaces.** `id="editor-surface-error-title"` is document-global and two failed Surfaces collide. Use `useId`/instance-provided IDs or an `aria-label` strategy compatible with the class boundary. Also test latest callback and exactly-once behavior; identity-only dedupe may not cover Strict-Mode-shaped remounts.
8. **Error boundary placement and session lifecycle need effectful proof.** A failed provider subtree unmounts its descendants and may invoke provider cleanup. Confirm this does not call `session.unmount()` (the lifecycle effect is owned by `EditorSurface`) and never disposes, while the second Surface and Host siblings survive.
9. **Applicable tooltip migration remains unimplemented.** Inventory shared tooltip wrappers and actual editor calls; only migrate editor-owned portals while retaining outside-Surface fallback.
10. **Direct portals remain:**
    - `apps/web/src/components/editor/panels/assets/draggable-item.tsx:171`
    - `apps/web/src/timeline/components/audio-volume-line.tsx:254`
   Determine ownership/applicability and retarget editor-owned sites through the private owner; no `document.body` fallback beneath a Surface.
11. **Wrapper prop precedence is unsafe.** The draft emits `container={owner ?? undefined} {...props}`, allowing caller `props.container` to overwrite the owner. Preserve explicit internal container behavior deliberately, but ensure ordinary Surface calls prefer the exact owner per D2. Define and test precedence rather than relying on JSX order.
12. **Submenu portals need review.** `SubContent` nodes in context/dropdown/menubar are not wrapped by the new local portal helpers. Confirm Radix nesting behavior and migrate if they can escape or resolve elsewhere.
13. **React 18 migration is untouched.** Current declarations remain React 19 ranges in root/Web/Vite. Exact versions and lockfile must be chosen consistently, installed without ignored peer failures, then proven with Next 16 production build and runtime identity—not merely dedupe.

## Concrete inventory reconfirmed

### Direct portal calls

- `apps/web/src/components/editor/panels/assets/draggable-item.tsx:171`
- `apps/web/src/timeline/components/audio-volume-line.tsx:254`

### Provider-private/global drag residuals requiring classification/migration

- `apps/web/src/components/ui/number-field.tsx:196-203`
- `apps/web/src/components/ui/color-picker.tsx:145-149`
- `apps/web/src/timeline/controllers/resize-controller.ts:246-252`
- `apps/web/src/timeline/controllers/keyframe-drag-controller.ts:245-251`
- `apps/web/src/timeline/controllers/element-interaction-controller.ts:433-439`
- `apps/web/src/timeline/bookmarks/hooks/use-bookmark-drag.ts:219-278`
- assets drag continuation at `apps/web/src/components/editor/panels/assets/draggable-item.tsx:69-72` requires applicability analysis.

Explicit Host/non-goal listeners also exist (shortcuts dialog, shift key, focus lock, paste, fullscreen, box select, zoom wheel, playhead, landing handlebars, beforeunload, runtime probes). Do not globally ban all document/window listeners.

### Existing resize seams

- `apps/web/src/hooks/use-resize-observer.ts`
- `apps/web/src/hooks/use-container-size.ts`
- timeline zoom/audio waveform/scroll observers and assets tabbar observer.

Exercise CSS-only behavior first. Add a Surface root observer only if a concrete descendant demonstrably fails, exactly as D6 requires.

## Full remaining approved scope

All 49 tasks remain. The successor owns, without narrowing:

- complete scoped CSS/token/theme/base/containment split and emitted-CSS proof;
- complete portal migration, direct sites, tooltip applicability, ownership, focus restoration, and two-Surface isolation;
- exact React 18/ReactDOM/types/lock migration, singleton checker, runtime probe, Vite graph, and Next 16 proof;
- internal accessible error containment and focused tests;
- bounded resize determination and minimal observer only if proven necessary;
- private per-Surface/session live-owner drag coordinator and all concrete sites;
- fail-closed CSS/portal/React/private-drag/public/viewport checkers with negative and converse controls over tracked plus uncommitted files and emitted output;
- focused Bun/ESLint/type tests and type ceiling 3;
- dual-Host final-source Playwright/axe/error/portal/resize/drag/runtime evidence;
- Vite type/build, 10 exclusions, marker-bearing Next build, owned servers, no ambient reuse;
- S02 disposal oracle, R1 lifecycle/focus controls, full 28/19/9-authoritative parity;
- source/test/lock hash binding before builds and after browser runs;
- 17-spec and every-SHALL falsification;
- implementation report, machine ledgers, screenshots, artifact hash manifest;
- strict Rasen validation, UTF-8/BOM/U+FFFD, manifest/PNG integrity, and final product/planning `git diff --check`.

Evidence must postdate final source/test bytes. Any later product/check/test/lock change invalidates build/browser/hash evidence and requires rerun.

## Mandatory eliminated hypotheses / dead ends

1. **Do not retry unavailable skills as a plan.** Predecessor established `rasen-apply-change` and `rasen-handoff` were unavailable in that runtime.
2. **Containment alone is insufficient.** The Vite import of global Next CSS was a real leak; retain a genuine Host/Surface split.
3. **Vite `resolve.dedupe` is not React A2 proof.** Exact React 18 metadata, lock, graph, runtime, and both production builds remain mandatory.
4. **Portal work is broader than wrapper edits.** Direct assets/timeline portals and submenu/tooltip applicability must be resolved; Host toaster stays outside.
5. **Do not place drag coordination in `surface-focus.ts`.** The coordinator is provider-private and active-drag-only; root focus ownership stays unchanged.
6. **Do not ban all document listeners.** Scan/classify concrete provider-private continuation and explicit Host/non-goals.
7. **Do not use index renormalization.** Index operations are prohibited for this apply stage.
8. **Do not treat `--ignore-space-at-eol` as normalization.** It is inspection-only; ordinary diff and `git diff --check` must ultimately be clean.
9. **Do not mark tasks from static draft presence.** Every checkbox requires its specified focused/mechanical/effectful evidence.
10. **Do not use stale 25/16/9.** Authoritative inherited R1 parity is 28/19/9.
11. **Do not evade React 18 incompatibility.** No React 19 island, alias, externalized duplicate, ignored peer failure, or nested root is allowed; incompatibility returns to Direction.
12. **Do not broaden the public contract or transaction route.** Preserve props, focus matrix, opaque commit binding, lifecycle/session/Host ownership, T3 facade/history/save behavior, and no auto-disposal.

## Gate status

- Formatting/EOL: **failed/incomplete** (only Vite styles normalized; remaining tracked files still CRLF churn)
- `git diff --check`: **failed** on remaining CRLF-churned tracked files
- Typecheck/lint/tests/checkers: **not run**
- Vite build/typecheck: **not run**
- Next production build: **not run**
- Browser/axe/parity/disposal: **not run**
- Hash/source attribution: **not run**
- 17-spec falsification: **not run**
- Strict Rasen/encoding/artifact gates: **not run**
- Tasks: **0/49**

No completion claim is warranted.
