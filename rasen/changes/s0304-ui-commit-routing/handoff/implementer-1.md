# Implementer handoff: s0304-ui-commit-routing

## Disposition

- Role/session: `/root/t3_implementer`
- Repository: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut`
- Branch: `feat/s0304-ui-commit-routing`
- HEAD rechecked after revival: `f2e36b9b9ced88f3bee9514d5fa5f37febdd8abd`
- Index: clean; nothing staged.
- No commit was created. No run-state was edited. No Claude Code was used.
- Rasen status: `spec-driven`, `0/46` checkboxes. The checkboxes intentionally remain unmarked because unchanged editing parity is blocked by the frozen contract described below.
- Requested disposition: preserve the current safe implementation and the two proven production fixes; do not choose among weakening constraints, changing T0/T1, or accepting the semantic delta.

## Implemented work preserved in the worktree

The worktree contains the following material implementation, although `tasks.md` has not been marked complete:

- 1.1-1.7: OpenCut projection/diff, adapter, staged candidate validation, versioned revision/idempotency envelope, exact record adoption, canonical router/facade, project arbiter, and adapter/router tests.
- 2.1-2.6: coordinator no-save adoption, already-durable publication scoping, project lifecycle router ownership, shared engine access, mutation serialization, and persistence tests.
- 3.1-3.7: explicit routing classes, detached preparation, atomic `BatchCommand`, root commit/publication, ripple/reactor participation, nested preparation handling, exhaustive registration, and async caller updates.
- 4.1 and 4.3-4.6: routable timeline/bookmark migration, provider-private/immediate classification, media boundary audit, and fail-closed negative tests.
- 5.1-5.7: forward/inverse material, routed undo/redo, one-shot pointer-preview commit, retained failed preview, and instrumentation tests.
- 6.1-6.4 and 6.6 have concrete focused-test coverage for adapter/facade reopen/failure behavior, shared ordering, batch/ripple/reactor atomicity, durable-before-publication, and preview counters. Formal acceptance remains withheld with the whole task list.
- 7.1-7.4, 7.6, and 7.7 were exercised as listed below. A separate canonical-spec falsification sweep for 7.5 was not recorded before the blocker.

Two production parity defects found during verification were fixed and must be retained:

1. Stable routing identity under minification. Routing previously depended on `command.constructor.name`; Vite production minification renamed concrete commands to `o3` and failed closed with four `Command o3 has no routing registration` errors. All 40 concrete commands now declare an explicit stable `routingClass`; classification reads that field. A production-minification regression test covers this.
2. Audio track T1 invariant. Reopened audio tracks could project `hidden: undefined`, violating the document invariant. Projection now normalizes any non-boolean `hidden` to `false`. Adapter, command-level audio, direct audio candidate reopenability, and auto-placement regressions cover this.

Two test-only TypeScript baseline regressions were also corrected in the existing session ownership/isolation tests.

## Verification already executed

- Focused Bun suite over six files: **20 pass, 0 fail, 89 assertions**.
- `node script/check-type-baseline.mjs`: **3 diagnostics**, equal to the pinned ceiling of 3; fixture was not regenerated.
- `node script/check-transaction-boundary.mjs`: **PASS**.
- `node script/check-transaction-boundary.mjs --negative-control`: **PASS**, proving the boundary check remains sensitive.
- `rasen validate s0304-ui-commit-routing --strict --project rocut --json`: **PASS**, zero artifact/spec errors.
- `bun run build` in `apps/vite-example`: **PASS**.
- `bun run build` in `apps/web`: **PASS** using local dummy build-time environment values; no secret values are recorded here.
- Established Playwright parity scenario against the Vite production host: **scenario PASS**.
- The same parity scenario against the Next production host at `http://127.0.0.1:3010`: **scenario PASS**; the temporary process was terminated.
- The cross-host snapshot diff additionally reports transaction-envelope idempotency keys/fingerprints because the UUID tokens differ between independent host runs. This is nondeterministic transaction metadata. Do not change the parity oracle to hide it: task 7.6 expressly forbids parity-oracle edits.

The initial Vite parity attempts first exposed the minified routing-name failure, then exposed missing audio tracks. Both were fixed before the results above.

## Hard blocker: project settings cannot be routed under all frozen constraints

The established pre-routing editing fixture has a real semantic behavior: inserting the first `320 x 180` image changes the project canvas from `1920 x 1080` to `320 x 180`. The routed detached candidate currently remains `1920 x 1080` because `draft-context.ts` deliberately removes `fps` and `canvasSize` from nested settings mutations.

This is not an implementation omission that can be repaired within the current contracts:

1. T0's public `Project` contains `frameRate`, `canvasWidth`, and `canvasHeight`; therefore these settings are public, not provider-private.
2. The frozen `TransactionOperation` union contains only create/update/delete track, clip, asset, and marker operations. It has no project-update operation.
3. The staged donor adapter is required to re-project the complete donor candidate and prove exact equality with the engine candidate document for every frozen public field. If the donor candidate changes canvas/fps without a corresponding engine operation, that equality must fail.
4. Omitting the settings from the donor candidate preserves projection equality but changes established editing behavior, which violates task 4.2 and task 6.5's requirement that the normalized fixture remain unchanged.
5. Saving canvas/fps later through the legacy coordinator would create a second root/save, violate one-root/one-save atomicity, and expose a non-atomic intermediate state.
6. Adding `update-project`, widening T0/T1, or changing engine/adapter semantics is forbidden by the change's explicit non-goals and task 7.6.
7. Accepting or rewriting the parity snapshot is forbidden by task 6.5; changing the parity oracle is forbidden by task 7.6.

Thus no implementation can simultaneously keep the frozen operation union, keep exact donor/engine public projection equality, perform one root/one save, leave T0/T1 unchanged, and preserve the established canvas behavior. LEAD must obtain a constraint/artifact decision before implementation can proceed.

## Eliminated hypotheses and unsafe workarounds

- Treating canvas/fps as provider-private: invalid because they are fields of T0 `Project` and are included in projection equality.
- Smuggling the change in an opaque donor candidate: rejected by the exact public projection check and the public/private honesty boundary.
- Submitting an empty/no-op transaction or generic invoke payload: impossible under the closed union and explicitly forbidden by the proposal/spec.
- Performing a second legacy save: violates atomic one-root/one-save semantics and task 4.2.
- Adding a new project operation or editing T0/T1: outside T3 scope and expressly forbidden.
- Updating the fixture or parity oracle: violates tasks 6.5/7.6.
- Treating the Vite `o3` error or absent audio as the remaining blocker: both were independently reproduced, fixed, and regression-tested; the surviving edit delta is canvas size.
- Treating cross-host UUID/fingerprint differences as the canvas regression: those are separate nondeterministic envelope metadata. Each host scenario passes, while the canvas delta is a deterministic pre-routing-versus-routed editing semantic change.

## Remaining work / decision needed

- 4.2: cannot migrate nested project-setting work into the same candidate while matching the frozen engine document, because no operation can update the public project fields.
- 6.5: unchanged normalized editing parity cannot pass while the first-image canvas behavior is suppressed.
- 7.5: no standalone, recorded sweep of every canonical SHALL/MUST assertion was completed before the hard blocker.
- All 46 checkboxes remain unchecked pending LEAD's constraint decision and final acceptance. Do not mechanically mark the implemented areas complete while 4.2/6.5 are contradictory.
- Do not continue broad edits. Preserve the two fixes above. Do not modify T0/T1, run-state, the type-baseline fixture, or the parity oracle. Do not commit until LEAD resolves the artifact-level contradiction.

## Exact task-owned worktree files

### Modified tracked files (53)

- `apps/web/src/actions/use-editor-actions.ts`
- `apps/web/src/commands/base-command.ts`
- `apps/web/src/commands/batch-command.ts`
- `apps/web/src/commands/media/add-media-asset.ts`
- `apps/web/src/commands/media/remove-media-asset.ts`
- `apps/web/src/commands/project/update-project-settings.ts`
- `apps/web/src/commands/scene/create-scene.ts`
- `apps/web/src/commands/scene/delete-scene.ts`
- `apps/web/src/commands/scene/move-bookmark.ts`
- `apps/web/src/commands/scene/remove-bookmark.ts`
- `apps/web/src/commands/scene/rename-scene.ts`
- `apps/web/src/commands/scene/toggle-bookmark.ts`
- `apps/web/src/commands/scene/update-bookmark.ts`
- `apps/web/src/commands/timeline/clipboard/paste-keyframes.ts`
- `apps/web/src/commands/timeline/clipboard/paste.ts`
- `apps/web/src/commands/timeline/element/delete-elements.ts`
- `apps/web/src/commands/timeline/element/duplicate-elements.ts`
- `apps/web/src/commands/timeline/element/effects/add-effect.ts`
- `apps/web/src/commands/timeline/element/effects/remove-effect.ts`
- `apps/web/src/commands/timeline/element/effects/reorder-effect.ts`
- `apps/web/src/commands/timeline/element/effects/toggle-effect.ts`
- `apps/web/src/commands/timeline/element/effects/update-effect-params.ts`
- `apps/web/src/commands/timeline/element/insert-element.ts`
- `apps/web/src/commands/timeline/element/keyframes/remove-effect-param-keyframe.ts`
- `apps/web/src/commands/timeline/element/keyframes/remove-keyframe.ts`
- `apps/web/src/commands/timeline/element/keyframes/retime-keyframe.ts`
- `apps/web/src/commands/timeline/element/keyframes/update-scalar-keyframe-curve.ts`
- `apps/web/src/commands/timeline/element/keyframes/upsert-effect-param-keyframe.ts`
- `apps/web/src/commands/timeline/element/keyframes/upsert-keyframe.ts`
- `apps/web/src/commands/timeline/element/masks/delete-custom-mask-points.ts`
- `apps/web/src/commands/timeline/element/masks/insert-custom-mask-point.ts`
- `apps/web/src/commands/timeline/element/masks/remove-mask.ts`
- `apps/web/src/commands/timeline/element/masks/toggle-mask-inverted.ts`
- `apps/web/src/commands/timeline/element/move-elements.ts`
- `apps/web/src/commands/timeline/element/split-elements.ts`
- `apps/web/src/commands/timeline/element/toggle-source-audio-separation.ts`
- `apps/web/src/commands/timeline/element/update-elements.ts`
- `apps/web/src/commands/timeline/track/add-track.ts`
- `apps/web/src/commands/timeline/track/remove-track.ts`
- `apps/web/src/commands/timeline/track/toggle-track-mute.ts`
- `apps/web/src/commands/timeline/track/toggle-track-visibility.ts`
- `apps/web/src/commands/timeline/tracks-snapshot.ts`
- `apps/web/src/core/index.ts`
- `apps/web/src/core/managers/commands.ts`
- `apps/web/src/core/managers/media-manager.ts`
- `apps/web/src/core/managers/project-manager.ts`
- `apps/web/src/core/managers/save-manager.ts`
- `apps/web/src/core/managers/scenes-manager.ts`
- `apps/web/src/core/managers/timeline-manager.ts`
- `apps/web/src/editor/persistence/session-persistence-coordinator.ts`
- `apps/web/src/editor/session/__tests__/session-runtime-ownership.test.tsx`
- `apps/web/src/editor/session/__tests__/session-state-isolation.test.ts`
- `apps/web/src/media/use-paste-media.ts`

Tracked diff summary at handoff time: 53 files, 615 insertions, 181 deletions.

### Untracked task implementation/tests (13)

- `apps/web/src/core/managers/__tests__/transaction-command-routing.test.ts`
- `apps/web/src/core/managers/__tests__/transaction-persistence-coordination.test.ts`
- `apps/web/src/editor/transactions/opencut/__tests__/adapter-router.test.ts`
- `apps/web/src/editor/transactions/opencut/__tests__/fixture.ts`
- `apps/web/src/editor/transactions/opencut/__tests__/routing-registry.test.ts`
- `apps/web/src/editor/transactions/opencut/adapter.ts`
- `apps/web/src/editor/transactions/opencut/arbiter.ts`
- `apps/web/src/editor/transactions/opencut/draft-context.ts`
- `apps/web/src/editor/transactions/opencut/index.ts`
- `apps/web/src/editor/transactions/opencut/projection.ts`
- `apps/web/src/editor/transactions/opencut/router.ts`
- `apps/web/src/editor/transactions/opencut/routing.ts`
- `apps/web/src/editor/transactions/opencut/types.ts`

### Untracked task planning/handoff files (7 after this handoff)

- `rasen/changes/s0304-ui-commit-routing/.openspec.yaml`
- `rasen/changes/s0304-ui-commit-routing/README.md`
- `rasen/changes/s0304-ui-commit-routing/design.md`
- `rasen/changes/s0304-ui-commit-routing/proposal.md`
- `rasen/changes/s0304-ui-commit-routing/specs/transaction-automation-api/spec.md`
- `rasen/changes/s0304-ui-commit-routing/tasks.md`
- `rasen/changes/s0304-ui-commit-routing/handoff/implementer-1.md`

## Ownership warning

The repository contains a very large number of unrelated/parallel untracked Rasen artifacts under `.rasen/changes/**`, `.rasen/probes/**`, `rasen/changes/**`, `rasen/specs/**`, and `rasen/config.yaml`. Do not stage them by directory or use broad `git add -A`/`git add rasen`/`git add .rasen`.

In particular, `.rasen/changes/s0304-ui-commit-routing/ephemera/auto-run.json` is orchestration-owned run-state. It is untracked but is **not** an implementer task file: do not edit, stage, delete, or include it. The archived changes, other active `s02-*`/`s0304-*` changes, canonical specs, and probe output visible in `git status` belong to other workstreams and must also remain untouched.
