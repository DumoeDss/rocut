# R2 implementer handoff — 2026-08-11

## Receipt

- Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`
- Branch: `recovery/s0304-ui-commit-routing-final`
- Start/HEAD: `cdfae229ebe8ea393807cce0b7a9617083625f78`
- Required `rasen-apply-change` skill was unavailable (`Unknown skill`), so the approved proposal/design/tasks/spec were followed directly.
- No subagent, workflow, worktree, commit, push, PR, archive, index operation, or `.rasen/**` write was performed.
- `tasks.md` remains 0/49 because no numbered task is yet fully evidenced.

## Completed coherent subset

1. Read, in required order, planning context; R2 proposal/design/tasks/spec; archived R0/R1 design/spec/evidence/tasks; root `AGENTS.md`; and current post-R1 Surface, stylesheet, package, portal, resize, drag, and checker inventory.
2. Added private Surface portal owner draft:
   - `apps/web/src/editor/surface/embedding/surface-portal.tsx`
   - one owner node per Surface, same `data-editor-surface` namespace, private context/hook.
3. Added bounded internal render boundary draft:
   - `apps/web/src/editor/surface/embedding/surface-error-boundary.tsx`
   - accessible alert with no raw error/stack; exactly-once guard by caught Error identity.
4. Integrated named region, error boundary, and portal provider into `editor-surface.tsx` without widening public props or lifecycle/focus/transaction ownership.
5. Migrated the first shared wrapper set to prefer the Surface owner while preserving outside-Surface fallback:
   - alert-dialog, context-menu, dialog, dropdown-menu, menubar, popover, select, sheet.
6. Drafted `apps/web/src/editor/surface/surface.css` with Surface-rooted tokens/base behavior, containment, bounded sizing, and portal-host ownership.
7. Split Host reset intent:
   - Next `globals.css` imports Surface CSS and retains only Host normalization.
   - Vite `styles.css` imports Surface CSS directly and keeps its own reset.

## Current dirty product scope

Modified:

- `apps/vite-example/src/styles.css`
- `apps/web/src/app/globals.css`
- `apps/web/src/components/ui/{alert-dialog,context-menu,dialog,dropdown-menu,menubar,popover,select,sheet}.tsx`
- `apps/web/src/editor/surface/embedding/editor-surface.tsx`

Untracked product:

- `apps/web/src/editor/surface/embedding/surface-error-boundary.tsx`
- `apps/web/src/editor/surface/embedding/surface-portal.tsx`
- `apps/web/src/editor/surface/surface.css`

Pre-existing unrelated/session state: untracked `.rasen/` (untouched).

## Immediate correctness caveats

- Formatting command approval was denied by the harness. The edited existing TSX/CSS files currently have CRLF-related `git diff --check` trailing-whitespace failures and large apparent line-ending churn. Normalize only the listed edited files with the repo Prettier command before evaluating semantic diffs.
- No typecheck, lint, build, browser, or checker gate has passed for this draft. Do not treat it as complete.
- Portal owner placement/provider semantics need review: provider value is null until the owner ref commits; later render should update consumers, but representative Radix open/focus behavior must be tested.
- Existing wrappers intentionally suppress some Radix close autofocus. R2 requires focus restoration, so those handlers need deliberate correction and tests rather than assuming portal migration suffices.
- The CSS draft is a mechanical first split and must be checked against Tailwind v4 emitted CSS. It may require restoring omitted theme animation variables/keyframes or other exact tokens from the old global file.

## Remaining implementation

- Finish portal migration: tooltip applicability, direct assets and timeline `createPortal` sites, scanner and ownership tests.
- Implement exact React 18/ReactDOM 18/type pin across root/Web/Vite, regenerate `bun.lock`, singleton checker/runtime probes, and prove Next 16 compatibility. This is potentially blocking and must not be evaded.
- Implement private live-owner drag coordinator and migrate number-field, color-picker, timeline element/keyframe/resize/bookmark/assets continuation sites.
- Determine whether CSS alone satisfies bounded resize; add only proven minimal observer behavior if needed.
- Add focused tests for CSS, portals, error boundary, accessibility, resize, drag, and React identity.
- Add fail-closed CSS/portal/private-drag/React checkers with all negative and converse controls over tracked plus uncommitted files and emitted output.
- Extend shared evidence harness/parameterized Playwright with axe, dual-Surface portal/error/resize/drag/runtime identity assertions and machine ledgers.
- Run all required focused suites, changed-file lint, type ceiling 3, Vite type/build, ten exclusions + singleton, marker-bearing Next production build, owned-server Host matrices, disposal oracle, full parity from authoritative 28/19/9, source hash binding, 17-spec falsification, UTF-8/mojibake, manifest/PNG integrity, strict validation, and final `git diff --check`.
- Write canonical implementation report, falsification report, machine reports/ledgers/screenshots, and artifact hash manifest; mark tasks only after each is genuinely complete.

## Eliminated hypotheses / dead ends

1. **Skill-driven execution is not available in this runtime.** Both `rasen-apply-change` and `rasen-handoff` returned `Unknown skill`; do not spend time retrying those names unless the skill registry changes.
2. **Containment alone cannot fix R2.** The post-R1 Vite entry imports all of `globals.css`; it contains `:root`, generic `.dark`/`.panel`, universal selectors, and body rules. A real Host/Surface stylesheet split is required.
3. **Vite `resolve.dedupe` is not A2 evidence.** All three manifests currently declare React 19; exact React 18 metadata/lock/runtime/build proof remains necessary.
4. **Portal migration is broader than `ContextMenuContent`.** Direct `createPortal` exists in assets draggable item and timeline audio-volume-line; wrappers use Radix portals across dialog/alert/dropdown/context/menubar/popover/select/sheet. Host toaster must remain outside.
5. **Provider-private document drag residuals are concrete, not Surface-focus listeners.** Inventory confirms number-field, color-picker, timeline element/keyframe/resize, bookmark, plus other Host/non-goal listeners. Do not put the coordinator in `surface-focus.ts` or globally ban all document listeners.
6. **Do not use formatter attempts that require unapproved shell mutation.** The harness rejected the Prettier write command; use approved tooling or explicit file edits, and do not claim `diff --check` until normalized.

## Durable constraints for continuation/review

- Preserve public `EditorSurfaceProps`, focus modes/tabIndex matrix, opaque commit signature, lifecycle mapping, session ownership, Host ports/chrome, and T3 transaction/save/history routing.
- Preserve authoritative R1 28/19/9 reconciliation; the archived R1 falsification line 25/16/9 is stale.
- T4 remains untouched/waiting.
- Final browser evidence must postdate final source/test bytes; any later source change invalidates builds/runs/hashes.
