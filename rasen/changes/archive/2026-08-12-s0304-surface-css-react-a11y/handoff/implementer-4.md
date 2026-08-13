# R2 implementer successor #4 handoff — 2026-08-11

## Status

**CORE-STATIC milestone was not reached.** This relay made partial product progress but leaves an unstable semantic/formatting state that the successor must repair before continuing. No numbered task is complete and `tasks.md` remains 0/49.

## Receipt

- Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`
- Branch: `recovery/s0304-ui-commit-routing-final`
- HEAD inherited: `cdfae229ebe8ea393807cce0b7a9617083625f78`
- No commit, push, PR, archive, index operation, worktree creation, subagent, workflow, T4 change, or `.rasen/**` write was performed.
- Read implementer-3 first, then implementer-2, implementer-1, tasks, design, delta spec, planning context, proposal, README, and root AGENTS.md.
- LEAD's initial ordinary diff was clean under `git diff --check` before this relay.

## Product work attempted

1. Added a private draft `surface-drag-coordinator.tsx` under the Surface provider. It owns one coordinator instance per provider, installs document continuation listeners only during a live mouse/pointer/native drag, discriminates pointer IDs, removes listeners before finish/cancel dispatch, and cancels on provider cleanup.
2. Integrated `SurfaceDragProvider` inside the existing portal provider and outside editor providers, without changing public Surface props.
3. Draft-migrated:
   - number-field pointer scrub;
   - color-picker mouse drag;
   - assets native drag-overlay continuation;
   - timeline resize controller/hook;
   - timeline keyframe controller/hook;
   - timeline element interaction controller/hook.
4. Updated `check-surface-boundary.mjs` to allow global continuation listeners only in the private coordinator module.
5. Attempted exact React 18 pins, but `bun install`/lock regeneration was denied. To avoid leaving manifests inconsistent with the unchanged React 19 lockfile, manifest pins were reverted to their inherited React 19 declarations. React 18 migration therefore remains wholly incomplete.

## Important incomplete/broken state

- Bookmark drag migration was started only as an import/hook insertion and then reverted; its existing listeners remain unchanged.
- Coordinator/controller changes have not compiled or run tests. They may contain type or behavioral defects.
- Existing controller unit fixtures/config literals may need the new `startMouseDrag` dependency.
- `color-picker.tsx` and potentially other newly edited CRLF files now show whole-file EOL churn. Scoped Prettier was denied. Current `git diff --check` fails on CRLF-induced trailing-whitespace reports, principally `color-picker.tsx`. Normalize only relay-edited files before semantic review.
- Package manifests were rewritten with LF while restoring original dependency values; confirm their ordinary diffs are empty after EOL normalization. `bun.lock` is unchanged.
- The private coordinator currently lives under `EditorSurface`, so shared controls used outside a Surface will throw if they call the required hook. Inventory actual outside-Surface uses and either prove none or use a deliberate optional/fallback path that preserves Host behavior without weakening Surface ownership.
- The coordinator has no focused owner/cleanup/exactly-once tests yet.

## Commands and results

- Initial `git status --short; git diff --stat; git diff --check`: inherited product diff listed; `git diff --check` clean.
- `bun install --frozen-lockfile`: denied by command policy; did not run.
- `bun install`: denied by command policy; did not run.
- `bun run --cwd apps/vite-example typecheck`: denied; did not run.
- `node script/check-surface-boundary.mjs`: denied; did not run.
- `node script/check-surface-boundary.mjs --negative-control`: denied; did not run.
- `bun test apps/web/src/editor/surface/embedding/__tests__`: denied; did not run.
- scoped repo-local Prettier over relay files: denied; did not run.
- Final `git diff --check`: **FAIL**, CRLF whole-file churn beginning at `apps/web/src/components/ui/color-picker.tsx`.
- No lint, type baseline, checker controls, emitted CSS, lock/install, Vite typecheck, or focused suites passed.

## Dirty receipt

Tracked modified at handoff:

- inherited CSS/portal files from implementer-3;
- `apps/web/src/components/ui/color-picker.tsx`
- `apps/web/src/components/ui/number-field.tsx`
- `apps/web/src/timeline/controllers/{element-interaction-controller,keyframe-drag-controller,resize-controller}.ts`
- `apps/web/src/timeline/hooks/use-timeline-resize.ts`
- `apps/web/src/timeline/hooks/element/{use-element-interaction,use-keyframe-drag}.ts`
- `apps/web/src/components/editor/panels/assets/draggable-item.tsx`
- `apps/web/src/editor/surface/embedding/editor-surface.tsx`
- `script/check-surface-boundary.mjs`
- `package.json`, `apps/web/package.json` (dependency values restored; likely EOL-only residual)
- `apps/web/src/timeline/bookmarks/hooks/use-bookmark-drag.ts` appears modified from EOL churn despite semantic revert; normalize/reconcile.

Untracked product:

- inherited `surface-error-boundary.tsx`, `surface-portal.tsx`, `surface.css`
- new `apps/web/src/editor/surface/embedding/surface-drag-coordinator.tsx`

Pre-existing `.rasen/` remains untouched.

## Exact completed checkboxes

None. `tasks.md` remains **0/49**.

## Immediate successor order

1. Normalize EOL only for this relay's newly edited existing files and require ordinary `git diff --check` clean.
2. Inspect/review the coordinator and all migrated call sites; compile and add focused coordinator tests before extending migration.
3. Finish bookmark migration and classify native assets semantics; prove finish/cancel/replacement/unmount/session replacement and exact-once commit behavior.
4. Complete CSS/portal/error focused tests and emitted-CSS/source checker work.
5. Perform React 18 manifest+lock migration atomically only when install/lock mutation can run; never leave manifests and lock inconsistent.
6. Implement the remaining fail-closed checkers and controls, then run all core-static gates.
7. Leave final-source builds/browser/parity/disposal/hash/artifact/falsification/report work for the dedicated evidence milestone after bytes are stable.

## Remaining final-evidence tasks

All tasks 7.1–7.6 and 8.4–8.10 remain wholly unclaimed, including final Vite/Next builds, owned servers, dual-Host browser/axe/portal/resize/drag/runtime evidence, S02 disposal, R1 controls, parity, hashes, 17-spec falsification, reports/ledgers/screenshots/artifact manifest, strict Rasen validation, and final encoding/integrity checks.

## Mandatory eliminated hypotheses / dead ends

1. Do not retry unavailable skills as the implementation plan.
2. Containment alone is insufficient; preserve the Host/Surface stylesheet split.
3. Vite dedupe is not React singleton proof; React migration must update all manifests and lock atomically and pass peer/type/runtime/build checks.
4. Do not restore body fallback under a Surface or caller container precedence over a live Surface owner.
5. Do not place drag coordination in `surface-focus.ts` or ban all document listeners.
6. Do not add a resize observer without a demonstrated CSS-only failure.
7. Do not globally format or use index renormalization; normalize only touched files.
8. Do not mark tasks from static draft presence or unrun commands.
9. Do not use stale 25/16/9; inherited authority is 28/19/9.
10. Do not widen public Surface/lifecycle/transaction/Host ownership, add nested roots/React 19 islands/body editor portals/global shortcuts/auto-dispose, or touch T4.
11. Final evidence must postdate the final product/check/test/lock bytes.
