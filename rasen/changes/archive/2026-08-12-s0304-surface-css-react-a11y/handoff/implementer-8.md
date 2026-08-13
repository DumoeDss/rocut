# R2 implementer successor #8 handoff — 2026-08-11

## Status

**HANDOFF.** The exact intended optional-coordinator behavior was applied to `number-field.tsx` and the drag integration source suite was extended, but command permissions prevented focused tests, the canonical type gate, and an EOL-safe restore/reapply. The current number-field semantics are coherent, but its ordinary diff is not acceptable: LF rewriting presents as 344 additions/318 deletions against the CRLF HEAD baseline. React 18 migration was correctly not started because focused core could not be proven green. `tasks.md` remains unchanged (0/49 checked).

## Receipt

- Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`
- Branch: `recovery/s0304-ui-commit-routing-final`
- HEAD: `cdfae229ebe8ea393807cce0b7a9617083625f78`
- Read implementer-7 and implementer-6 handoffs, successor prompt, tasks, design, coordinator/tests, number-field, and all three manifests.
- No subagent/workflow/worktree/commit/index/push/archive/T4/dependency install/lock mutation/React migration or `.rasen/**` run-state write.

## Implemented behavior

`apps/web/src/components/ui/number-field.tsx` now contains the intended semantics:

1. Imports and calls `useOptionalSurfaceDragCoordinator` without making Surface context mandatory outside a Surface.
2. Captures the initiating `pointerId` and rejects other pointer IDs in move, finish, and DOM cancel handling.
3. Under a live Surface coordinator, registers `{ kind: "pointer", pointerId, move, finish, cancel }` and returns without installing its fallback listeners.
4. Outside a Surface, installs paired `pointermove`, `pointerup`, and `pointercancel` listeners and removes all three synchronously on matching finish/cancel.
5. Finish exits pointer lock and invokes `onScrubEnd` once; cancellation exits pointer lock without invoking `onScrubEnd`.
6. Existing first-pointer-lock-move suppression and scrub value calculation remain unchanged.

`surface-drag-integrations.test.ts` was extended to:

- include number-field among concrete coordinator integrations;
- require optional coordinator use and initiating pointer capture;
- require coordinator finish/cancel wiring;
- require a single `onScrubEnd` source call on the finish path;
- require paired add/remove source controls for pointer move/up/cancel.

## Number-field EOL/minimal-diff blocker

The semantic patch was initially a minimal ordinary diff of **27 additions/1 deletion**. `git diff --check` then classified every added CRLF line as trailing whitespace in this checkout. A full `Write` normalized the file to LF and made `git diff --check` pass, but expanded the ordinary diff to **344 additions/318 deletions**, which violates the minimal-patch requirement.

Attempting the correct repair:

```powershell
git restore --worktree -- "apps/web/src/components/ui/number-field.tsx"
```

required approval and did not run. The next authorized relay must restore exact HEAD bytes and reapply the same 27/1 semantic patch with a mechanism that preserves the file's baseline EOL convention while satisfying `git diff --check`. Do not retain the current whole-file ordinary diff.

## Gates and permission stop

LEAD-verified inherited state before this relay:

- new portal/error/drag suites: PASS 14/14, 55 expectations;
- canonical type baseline: PASS, 3 diagnostics/0 outside pin;
- Surface boundary normal + 4/4 negative + 4/4 converse: PASS;
- `git diff --check`: PASS;
- number-field: exact HEAD baseline.

Attempted after the number-field/test edits, but approval was required and commands did not run:

```powershell
bun test apps/web/src/editor/surface/embedding/__tests__/surface-drag-integrations.test.ts
node script/check-type-baseline.mjs
```

Current directly observed gates:

- `git diff --check`: **PASS** after LF normalization.
- Number-field ordinary diff: **FAILS minimality requirement** (344/318 due EOL rewrite).
- Focused drag integration suite after edits: **not run; approval required**.
- Full Surface/drag/controller suites after edits: **not run**.
- Canonical type baseline after edits: **not run; approval required**.
- Surface boundary after edits: **not rerun**.
- React install/type/Vite gates: **not started**.

No `tasks.md` checkbox was changed: the newly edited number-field path was not test/type verified, and the inherited portal/error/drag evidence had already been intentionally left unchecked pending the complete mapped gate set.

## React lock outcome

**Not attempted.** Root/Web/Vite manifests and `bun.lock` remain on their inherited lines. This is deliberate: milestone ordering requires focused core green before the atomic migration. The inspected Web manifest still preserves `rehype-stringify: ^10.0.1`.

When core is green, migrate manifests plus lock atomically to one exact mutually compatible React 18/ReactDOM 18/@types line, preserve every unrelated dependency byte/version, run normal `bun install` without ignored peers, and add singleton/runtime/negative/converse evidence. If Next 16 installation or build is incompatible, record the exact blocker and return to Direction; do not add a React 19 island, alias, or duplicate runtime.

## Dirty product receipt

Tracked modified:

- `apps/vite-example/src/styles.css`
- `apps/web/package.json`
- `apps/web/src/app/globals.css`
- `apps/web/src/components/editor/panels/assets/draggable-item.tsx`
- `apps/web/src/components/ui/{alert-dialog,color-picker,context-menu,dialog,dropdown-menu,menubar,number-field,popover,select,sheet,tooltip}.tsx`
- `apps/web/src/editor/surface/embedding/editor-surface.tsx`
- `apps/web/src/timeline/bookmarks/hooks/use-bookmark-drag.ts`
- `apps/web/src/timeline/components/audio-volume-line.tsx`
- `apps/web/src/timeline/controllers/{element-interaction-controller,keyframe-drag-controller,resize-controller}.ts`
- `apps/web/src/timeline/hooks/element/{use-element-interaction,use-keyframe-drag}.ts`
- `apps/web/src/timeline/hooks/use-timeline-resize.ts`
- `package.json`
- `script/check-surface-boundary.mjs`

Untracked product/tests:

- `apps/web/src/editor/surface/embedding/surface-{drag-coordinator,error-boundary,portal}.tsx`
- `apps/web/src/editor/surface/embedding/__tests__/surface-{drag-coordinator,drag-integrations,error-boundary,portal}.test.ts`
- `apps/web/src/editor/surface/surface.css`

Pre-existing `.rasen/` remains unrelated and untouched.

## Exact next sequence

1. Restore `number-field.tsx` exactly from HEAD with authorized Git tooling.
2. Reapply the same semantic patch without EOL churn; require approximately 27 additions/1 deletion and `git diff --check` PASS.
3. Run:

```powershell
bun test apps/web/src/editor/surface/embedding/__tests__/surface-drag-integrations.test.ts
bun test apps/web/src/editor/surface/embedding/__tests__/surface-drag-coordinator.test.ts
bun test apps/web/src/editor/surface/embedding/__tests__
node script/check-type-baseline.mjs
node script/check-surface-boundary.mjs
node script/check-surface-boundary.mjs --negative-control
node script/check-surface-boundary.mjs --converse-control
git diff --check
```

4. Run the focused timeline drag/controller suites discovered from package tests and repair only R2-attributable fixture/behavior regressions.
5. Only after all focused core gates are green, perform the atomic React manifests/lock migration and checker/probe work.
6. Do not start final production/browser evidence until product/check/test/lock bytes are stable.

## Remaining final evidence

- Every task remains unchecked: **0/49**.
- CSS source and emitted-distributable boundary checker plus negative/converse controls remain.
- Portal/private-drag dedicated static checker controls remain beyond the inherited Surface boundary controls.
- React singleton checker, runtime identity probe, emitted graph check, normal install, Vite type/build, and Next compatibility evidence remain.
- Focused accessibility, resize, CSS, and exact runtime number-field interaction evidence remain.
- All dual-Host final-source browser, axe, keyboard/focus, resize, drag, disposal, parity 28/19/9, hashes, artifacts, 17-spec falsification, strict validation, and evidence mapping remain.

## Eliminated hypotheses / constraints

1. Number-field must keep optional Surface ownership; requiring Surface context would break shared outside-Surface callers.
2. `pointercancel` must be paired in the outside fallback and must exit pointer lock without committing.
3. Coordinator cancellation has no PointerEvent, so number-field cancellation accepts an optional event: DOM fallback discriminates when present, while coordinator replacement/provider cleanup can still cancel and release lock.
4. `onScrubEnd` belongs only to matching finish; cancellation/replacement/unmount must not call it.
5. The current whole-file number-field diff is line-ending churn, not legitimate product scope; do not accept it as minimal.
6. Do not begin React 18 while edited focused core is unverified.
7. Preserve frozen public/lifecycle/transaction/Host boundaries, parity 28/19/9, type ceiling 3, and no T4/commit/index/push/archive/.rasen mutation.
