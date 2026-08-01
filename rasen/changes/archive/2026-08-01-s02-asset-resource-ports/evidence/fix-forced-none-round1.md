# C4 review-loop round 1: forced-none project thumbnails

- Date: 2026-08-01
- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c4`
- Baseline: `507cecf456ed68007c60829be5c3c41bebf64a5d`
- Finding: `verify-report.md` Major #1
- Scope: project-thumbnail generation during thumbnail-less project load and project exit

## Root cause and repair

`ProjectManager.updateThumbnailFromTimeline()` was shared by both the missing-thumbnail branch of
`loadProject()` and `prepareExit()`, but it did not observe `RendererManager.isDegraded`. Both paths
therefore read the active scene and constructed a `CanvasRenderer` before the compositor boundary,
even after `EditorProvider` had applied the Host-forced no-rasterizer state.

The repair adds one shared early return:

```ts
if (!this.active || this.editor.renderer.isDegraded) return false;
```

It is deliberately before the active-scene read, `buildScene`, `createCanvasRenderer`, DOM canvas
creation, and `renderToCanvas`. Normal rasterizer behavior is unchanged.

The production-like Vite harness no longer seeds `metadata.thumbnail`. After its ordinary schedules
settle it explicitly calls `editor.project.prepareExit()` and requires
`thumbnailAbsentAfterExit === true` together with the existing null-compositor, zero-GPU-work,
zero-page-error, and zero-unhandled-rejection assertions. This prevents the harness from bypassing
the load/exit defect again.

## Test seam

The focused regression drives the public `ProjectManager.loadProject()` and `prepareExit()` methods.
Storage is replaced only at its system boundary. The observable raster boundary records active-scene
reads, Canvas renderer creation, rendering, dirty marking, and flushes. The degraded case requires
all five counts to remain zero and the compositor handle to remain null. A normal-mode control
requires one complete thumbnail render and save, including the exact thumbnail data URL.

Test file:

- `apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts`

## Red evidence

Command before the product guard:

```powershell
bun test apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts
```

Exit 1. The isolated inner run reported 1 pass / 1 fail. The normal-mode control passed. The degraded
load-plus-exit scenario observed `sceneReads: 2` and `createCanvasRenderer: 2` instead of zero; both
attempts then reached DOM canvas creation. This is the expected falsification of the review finding.

## Green and regression evidence

Focused regression, detailed isolated run:

```powershell
$env:OPENCUT_PROJECT_THUMBNAIL_TEST_ISOLATED='1'
bun test apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts
Remove-Item Env:OPENCUT_PROJECT_THUMBNAIL_TEST_ISOLATED
```

Exit 0: 2 pass / 0 fail / 5 expectations. The degraded load and exit leave
`sceneReads`, `createCanvasRenderer`, `renderToCanvas`, `markDirty`, and `flush` at zero. The normal
exit renders once, sets `data:image/png;base64,dGh1bWJuYWls`, marks dirty once, and flushes once.

Focused C4 composition plus thumbnail regression:

```powershell
bun test apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts apps/web/src/editor/host/__tests__/production-composition.test.ts
```

Exit 0: 4 pass / 0 fail / 15 expectations.

Type and baseline gates:

```powershell
bunx tsc --noEmit -p apps/vite-example/tsconfig.json
node script/check-type-baseline.mjs
```

Both exit 0. The type-baseline gate reports exactly the existing three diagnostics and no diagnostic
outside the pinned set.

Whitespace gate:

```powershell
git diff --check
```

Exit 0 (line-ending warnings only).

## Browser evidence status

The existing retained forced-none screenshots/network logs predate this repair and therefore are not
claimed as proof of the newly exposed thumbnail-less path. The harness itself is strengthened for the
next bounded production-browser rerun; that rerun must observe `data-status="ready"`, an empty
`data-assertion-failures`, `thumbnailAbsentAfterExit: true`, compositor `null`, GPU work `0`, page
errors `0`, and unhandled rejections `0` before final verification closes Major #1.

## Files changed in this repair

- `apps/web/src/core/managers/project-manager.ts`
- `apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts`
- `apps/vite-example/src/c4-forced-none-harness.tsx`

No task, runstate, `PATCHES.md`, `SOURCE_INVENTORY.*`, protected port/parity/WASM file, or other
review finding was edited by this leaf.
