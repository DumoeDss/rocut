# R1 implementer handoff — 2026-08-10

## Reason and status

- Reason: `budget` under the handoff safety contract: the first coherent product/controller/Host-integration tranche is complete at 29/50, while the dual-Host browser harness, browser/build gates, and final evidence are still one substantial tranche.
- Task progress: **29 complete / 21 pending / 50 total**.
- Completed task IDs: `1.1`–`1.6`, `2.1`–`2.7`, `3.1`–`3.4`, `3.6`, `4.1`–`4.6`, and `5.1`–`5.5`.
- Pending task IDs: `3.5`, `4.7`, `6.1`–`6.7`, `7.1`–`7.7`, and `8.1`–`8.5`.
- No commit, review, archive, ship, or LEAD run-state edit was performed.

## Implemented architecture

- `EditorSurface` now renders one `data-editor-surface` root and `EditorRoot` in the caller's React tree. It derives Host and Session providers from the exact `session` prop and separately calls `session.mount({ target: root })`; it never creates a React root.
- `surface-focus.ts` owns the pure passive/focused/full matrix, dynamic eligible-tab-stop query, root-only pointer containment, non-passive wheel handling, and full-mode Tab cycling. It adds no document/window listener, global style, or pointer capture.
- `useKeybindingsListener` now accepts an optional stable `targetRef` and enable flag. An explicit Surface ref never falls back to document while null; the old document target remains only when no ref is supplied. `EditorProvider` threads this internal scope.
- `surface-lifecycle.ts` is a generation-aware controller. It stores the synchronous handle, suppresses stale readiness/visibility settlement, serializes/coalesces visibility, invokes `session.unmount()` synchronously once before awaiting cleanup, reports live/cleanup failures once, and never disposes.
- `surface-transaction-binding.ts` privately validates the minimal opaque batch shape and forwards exactly one call to T0 `TransactionApply`. `surface-commit-context.tsx` keeps the binding internal and opaque.
- `SessionEditorSurface` adapts `editorForSession(session).transactions`; no engine is opened and no command/pointer path is intercepted. In normal production use `onError` is absent, so the memoized binding is one per session. If a future caller changes `onError` identity at runtime, the binding is recomputed; tighten this only if browser evidence requires strict callback-identity stability.
- Next and Vite production roots now render the same `SessionEditorSurface focusMode="focused"`; their viewport/chrome/mobile gate/picker/error boundary/C4 probe/changelog/theme/tooltip/toaster ownership stays outside.
- The parity driver focuses `[data-editor-surface]` and verifies focus ownership before every shortcut.
- `script/check-surface-boundary.mjs` scans tracked + uncommitted runtime Surface modules, rejects empty scans, and has four negative plus three converse controls.

## Exact changed paths

Product/checker paths:

- `apps/vite-example/src/app.tsx`
- `apps/vite-example/tests/parity/driver.ts`
- `apps/web/src/actions/keybinding-target.ts`
- `apps/web/src/actions/use-keybindings.ts`
- `apps/web/src/app/editor/[project_id]/page.tsx`
- `apps/web/src/components/providers/editor-provider.tsx`
- `apps/web/src/editor/surface/embedding/index.ts`
- `apps/web/src/editor/surface/embedding/editor-surface.tsx`
- `apps/web/src/editor/surface/embedding/session-surface-bridge.tsx`
- `apps/web/src/editor/surface/embedding/surface-commit-context.tsx`
- `apps/web/src/editor/surface/embedding/surface-contract.assertions.ts`
- `apps/web/src/editor/surface/embedding/surface-focus.ts`
- `apps/web/src/editor/surface/embedding/surface-lifecycle.ts`
- `apps/web/src/editor/surface/embedding/surface-transaction-binding.ts`
- `apps/web/src/editor/surface/embedding/__tests__/surface-composition.test.ts`
- `apps/web/src/editor/surface/embedding/__tests__/surface-focus.test.ts`
- `apps/web/src/editor/surface/embedding/__tests__/surface-keybinding-scope.test.ts`
- `apps/web/src/editor/surface/embedding/__tests__/surface-lifecycle.test.ts`
- `apps/web/src/editor/surface/embedding/__tests__/surface-transaction-binding.test.ts`
- `script/check-surface-boundary.mjs`

Planning/evidence paths:

- `rasen/changes/s0304-surface-mount-focus-lifecycle/tasks.md`
- `rasen/changes/s0304-surface-mount-focus-lifecycle/evidence/implementation-report.md`
- `rasen/changes/s0304-surface-mount-focus-lifecycle/handoff/implementer-1.md`

## Verification completed

- RED control: initial focused run failed 3/3 because `surface-focus`, `surface-lifecycle`, and `surface-transaction-binding` did not exist.
- `bun test apps/web/src/editor/surface/embedding/__tests__` → **24 pass, 0 fail, 115 assertions** after implementation and after newline normalization.
- `bun test --timeout 30000 apps/web/src/editor/host/__tests__/production-composition.test.ts apps/web/src/editor/session/__tests__/session-runtime-ownership.test.tsx` → **2 pass, 0 fail**. Without the explicit Bun timeout, the isolated child suites sometimes cross the default 5-second outer timeout (observed 5.5s); that failure was harness timeout, not a product assertion.
- `bunx tsc --noEmit -p apps/vite-example/tsconfig.json` → **pass**.
- `node script/check-surface-boundary.mjs` → **pass**, 10 runtime modules scanned.
- `node script/check-surface-boundary.mjs --negative-control` → **pass**, every violation caught and every converse allowed.
- Focused ESLint over all newly added action/Surface source and tests → **pass with no output**.
- The first full changed-file ESLint also surfaced only three already-existing diagnostics in modified legacy files: `page.tsx` unsafe `params.project_id as string`; `editor-provider.tsx` hook immutability on `editor.command.isRippleEnabled`; and its legacy `BeforeUnloadEvent.returnValue` assertion. Do not repair them under R1 unless attribution changes. The Vite parity driver is ignored by the current root ESLint configuration.
- Baseline before product edits: `node script/check-type-baseline.mjs` → **3 current diagnostics, 0 outside pin, pass**. The post-edit type-baseline gate remains task `7.3` and must be rerun.
- `git diff --check` → **pass** after Prettier normalized five mixed-newline tracked files back to LF; the product diff is minimal again.
- Strict UTF-8 validation over 22 current changed product/planning files → **pass**, no BOM, U+FFFD, or common mojibake markers.

## Current worktree state

- Tracked modifications: the six pre-existing files listed by `git status` (`app.tsx`, parity driver, keybinding hook, Next page, editor provider, embedding barrel).
- New product/checker paths: the action helper, five focused tests, seven Surface runtime/assertion modules, and the Surface checker listed above.
- `rasen/**` planning/evidence is ignored by Git in this checkout but contains the 29 checked tasks, baseline implementation report, and this handoff.
- `.rasen/` remains untracked pre-existing orchestration state. It was not edited; specifically no `auto-run.json` or `portfolio-run.json` was touched.

## Next atomic tranche

1. Build the one shared evidence-only Surface harness and expose explicit Next and Vite entries (tasks `6.1`/`6.2`). It must control focus/visibility/mount/remount/readiness, include outside sentinels and machine-readable call/error/resource ledgers, and use a real session for suspend/resource evidence.
2. Add the parameterized Surface Playwright spec and run it for both profiles. Use actual assertions/captures per step; preserve ledgers/screenshots/style/bounds/resource data and hashes under this change's evidence directory (`6.3`–`6.7`). This browser tranche should close `3.5` and `4.7` too.
3. Run all boundary/negative controls, focused tests, changed-file lint attribution, post-edit type baseline, both builds/typechecks, import/emitted-graph checks, Surface browser runs, and full parity comparison (`7.1`–`7.7`). The documented Next placeholder environment is described in the archived T3 implementation report cited by the current implementation report.
4. Sweep all 17 specs, finish `implementation-report.md`, write `spec-falsification-sweep.md`, strict-validate with `--project rocut`, rerun UTF-8/BOM/U+FFFD and diff checks, and tick only proven tasks (`8.1`–`8.5`).

## Durable findings for later planners (verbatim)

1. **A Surface tree must pass an explicit `targetRef`; an explicit null target intentionally installs no document fallback.**
2. **React Strict Mode is safe only because cleanup invokes `session.unmount()` synchronously before awaiting settlement; do not defer that call into a promise microtask.**
3. **The public Surface renders React in the caller tree; `session.mount` binds lifecycle state and the real DOM target only, and a nested `createRoot` remains prohibited.**
