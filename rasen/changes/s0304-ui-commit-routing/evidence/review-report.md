# Independent Review Report: `s0304-ui-commit-routing`

**Status:** DONE_WITH_CONCERNS
**Verdict:** **FAIL — do not ship this tree**
**Mode:** dispatched, report-only; no product, test, spec, task, run-state, or Git edits
**Reviewed range:** `4b7af6f224519d4c9f0d3f387faa7f8f79707af8..0f9b4ff5ef0c8e0a04522ce4369f47511a14dc47`
**Branch:** `recovery/s0304-ui-commit-routing-final`
**HEAD / tree:** `0f9b4ff5ef0c8e0a04522ce4369f47511a14dc47` / `9e2c8e08365bfb576c546bf5e0021b7642369442`
**Review date:** 2026-08-10

Pre-Landing Review: **8 issues (5 Blocker, 2 Major, 1 Minor)**

The change has a sound central direction and several strong focused tests, but five required safety or behavior paths are either wrong or absent. Four were reproduced with read-only Bun probes. Two can lose or silently delete editing data. The 46/46 checked task state is therefore not supported by the reviewed implementation.

## Axis summary

| Axis | Result | Count | Worst issue |
| --- | --- | ---: | --- |
| Standards | FAIL | 8 unique findings | Silent automation-asset deletion and media-removal rollback races are Blockers |
| Spec | FAIL | 6 requirement failures | Required durable preparation, dependency ordering, and async caller migration are incomplete |
| Design | PASS | 0 | The only production TSX delta adds async rejection handling; it introduces no visual or CSS change |

All substantive fixes below are classified **ASK**: they change transaction ownership, operation ordering, or user-visible completion semantics and should be implemented by a non-author fixer. Finding 8 is mechanically auto-fixable, but this dispatched review did not edit it.

## Findings

### 1. [Blocker] [Standards + Spec] Automation-created assets are silently deleted by the next unrelated UI commit

**Evidence:** Automation `apply()` adopts and publishes the committed draft at `apps/web/src/editor/transactions/opencut/router.ts:194-205`, but the production publisher adopts only project and scene state at `apps/web/src/core/index.ts:81-92`. It never updates or otherwise carries forward `draft.assetCatalog`. The next UI command rebuilds its donor asset catalog only from `MediaManager.getAssets()` at `apps/web/src/core/managers/commands.ts:360-368`.

A read-only integration probe created `automation-asset`, then issued an unrelated UI project rename. Before the UI commit the shared engine returned `automation-asset`; the UI preparation emitted `update-project, delete-asset`; after the commit the engine asset list was empty. The two publication callbacks observed asset counts `1` then `0` while the live media catalog remained `0` throughout.

This violates the shared ordered engine requirement in delta spec lines 3-12 and task 1.6/6.2. Because an unrelated UI edit can silently delete durable automation data, this is a Blocker.

**Recommended fix:** make the router's latest committed donor draft/record, not `MediaManager.assets` alone, authoritative for the next UI base candidate. Merge attachment-backed live media into that current asset catalog without dropping automation-only assets. Add an integration test for `automation create-asset -> unrelated UI rename -> asset survives save and reopen`.

### 2. [Blocker] [Standards + Spec] Failed attachment removal can still durably delete referenced clips

**Evidence:** `RemoveMediaAssetCommand` is immediate, removes the live asset, then launches `editor.timeline.deleteElements()` without awaiting its routed transaction at `apps/web/src/commands/media/remove-media-asset.ts:69-89`. It independently starts attachment deletion at lines 91-105. Its failure handler restores only the live snapshots at lines 129-157; it cannot cancel or compensate the already queued transaction.

A read-only command/router probe forced `removeAttachment` to reject. The command reported/restored the asset, yet the queued project transaction committed revision 1 and removed `clip-1`. Final state was: live asset present, engine asset present, live clips empty, engine clips empty. The toast's “media item was restored” claim is therefore false for its referenced timeline content.

This conflicts with the explicit immediate-effect boundary in delta spec lines 80-88 and tasks 4.4-4.6. It is a data-loss path and therefore a Blocker.

**Recommended fix:** introduce an explicit, coordinated media-removal workflow with a defined durability order and compensation strategy. Do not fire an independent project transaction from inside an immediate command and then claim live rollback is sufficient. Add attachment-failure and project-save-failure integration tests that assert the attachment, asset catalog, clips, live managers, engine document, and reopened record remain mutually consistent.

### 3. [Blocker] [Standards + Spec] Moving the final clip off a pruned track emits an invalid dependency order

**Evidence:** `diffOpenCutProjection()` emits `delete-track` at `apps/web/src/editor/transactions/opencut/projection.ts:262-264`, before existing clip updates at lines 307-320. The evaluator cascades every clip on track deletion at `apps/web/src/editor/contracts/engine/evaluator.ts:368-389`, so its later `update-clip` fails `not-found` at lines 448-459.

A pure projector/evaluator probe moved `moving-clip` from `source-track` to `target-track` while removing the now-empty source. It deterministically emitted:

```text
delete-track source-track
update-clip moving-clip { trackId: target-track }
```

The evaluator rejected operation 1 with `Clip moving-clip not found`. This is the normal `MoveElementCommand` path (`apps/web/src/commands/timeline/element/move-elements.ts:90-123`) combined with the registered empty-track reactor, directly violating task 1.3, task 3.4, and the atomic ripple/reactor scenario at delta spec lines 53-57.

**Recommended fix:** topologically order clip moves/updates before deletion of their former parent tracks while preserving create-before-reference and clip-delete-before-asset-delete constraints. Add a command-level regression test that moves the last clip from an overlay/audio track and proves one successful save, revision, history entry, and reopen.

### 4. [Blocker] [Standards + Spec] Nested immediate effects execute during detached preparation instead of failing closed

**Evidence:** the detached command context exposes `executeWithoutHistory` as a direct `nested.execute(context)` call at `apps/web/src/editor/transactions/opencut/draft-context.ts:95-98`. It never calls `classifyCommand()` and therefore cannot reject an immediate or provider-private nested command before execution.

A read-only probe passed a fake command with `routingClass: "immediate"`; its external-effect counter incremented to 1. An outer routed command can therefore perform an external effect during preparation and only fail later when its projection is empty or invalid. This leaves tasks 3.5 and 4.6 marked complete despite the required negative behavior being absent, and it violates durable-before-publication at delta spec lines 20-35.

**Recommended fix:** replace the direct callback with a preparation-only nested dispatcher that classifies before dispatch and rejects every non-transaction nested command before calling `execute`. Add the exact task-4.6 negative test and assert zero external effects, saves, revisions, history, and live mutations.

### 5. [Blocker] [Standards + Spec] Ripple split-left reads command-produced state before routed execution starts

**Evidence:** `TimelineManager.splitElements()` dispatches a routed command and immediately returns `command.getRightSideElements()` at `apps/web/src/core/managers/timeline-manager.ts:187-202`. `SplitElementsCommand` initializes and populates that array only inside `execute()` (`apps/web/src/commands/timeline/element/split-elements.ts:43-49` and 195-205). Every routed mutation is deferred through `Promise.then(operation)` at `apps/web/src/editor/transactions/opencut/arbiter.ts:11-14`.

`use-editor-actions.ts:256-268` synchronously consumes the returned references to seek to the retained right segment during ripple split-left. It always sees the pre-execution empty array, so the expected seek is skipped. `duplicateElements()` has the same stale synchronous return contract at `timeline-manager.ts:806-813`, although its current production caller ignores the value.

This is the exact async caller migration required by proposal line 31 and task 3.7. The missing required behavior is on a normal editing path, so it is a Blocker.

**Recommended fix:** make result-dependent timeline APIs async, await `CommandManager.execute()`, then read the command-produced result. Update the action handlers to await or intentionally observe the returned promise and add a ripple split-left regression asserting both durable completion and the post-commit seek.

### 6. [Major] [Standards + Spec] Routed undo cannot rebase over an intervening automation commit

**Evidence:** history stores whole `undoTarget`/`redoTarget` donor snapshots (`apps/web/src/core/managers/commands.ts:26-35`). Undo then stages that old whole draft while applying only the stored inverse operations to the current engine document (`commands.ts:313-357`). The adapter correctly requires the staged donor projection to equal the engine result at `apps/web/src/editor/transactions/opencut/adapter.ts:407-420`.

A read-only integration probe performed a UI canvas update, then an automation `create-track`, then undid the still-top UI entry. Undo failed with `ProjectStoreError { code: "corrupt", message: "The transaction adapter could not encode a valid replacement" }`; revision stayed 2, history stayed 1, and the automation track remained live. The stacks are preserved, but the required undo is unusable solely because an unrelated valid automation change occurred.

Delta spec lines 147-166 require inverse/forward batches at the current revision, and tasks 5.2/6.2 require routed undo plus shared ordering. This plausible interleaving is therefore a Major correctness gap.

**Recommended fix:** derive the staged undo donor from the current committed donor state and apply only the history entry's owned inverse delta, preserving unrelated later automation/provider-private state. Add `UI edit -> disjoint automation commit -> undo -> redo` coverage with exact revision, watcher, history, persistence, and reopen assertions.

### 7. [Major] [Standards] Multi-keyframe user actions lost one-step undo

**Evidence:** this range replaced one `BatchCommand` per multi-keyframe action with loops that execute each provider-private command separately. The affected methods are `upsertKeyframes()` at `apps/web/src/core/managers/timeline-manager.ts:498-520`, `removeKeyframes()` at lines 576-589, and `updateKeyframeCurves()` at lines 631-644. `CommandManager.execute()` creates one provider-private history entry per call at `apps/web/src/core/managers/commands.ts:105-118`.

Consequently, editing N selected keyframes now requires N undo operations and can expose partial intermediate state. This is a regression from the pre-range behavior even though the routing-class split explains why the transaction-only `BatchCommand` could no longer be reused.

**Recommended fix:** add an explicit provider-private composite command/history entry that executes all children as one user action and undoes them in reverse order, without pretending the edit is a public transaction. Add focused tests for all three multi-keyframe APIs proving one history entry and one undo/redo gesture.

### 8. [Minor] [Standards] The exact reviewed range fails `git diff --check`

**Evidence:** the exact range reports trailing whitespace in `rasen/changes/archive/2026-08-09-s0304-transaction-contract-freeze/evidence/review-cycle-report.md:3-5` and a new blank line at EOF in `rasen/specs/transaction-automation-api/spec.md:697`. The product-only `apps/web` range passes. This contradicts the unqualified `git diff --check` pass recorded at `rasen/changes/s0304-ui-commit-routing/evidence/implementation-report.md:45`.

**Recommended fix:** mechanically clean those planning/spec whitespace errors or qualify the earlier evidence as product-only. Re-run the check on the exact delivery range.

## Scope and recovery provenance

- Exact range: 130 files, 26,928 insertions, 286 deletions.
- Product slice: 67 `apps/web` files (13 added, 54 modified), 3,778 insertions, 286 deletions.
- Planning/evidence overlay: 63 `rasen/**` files. It contains the T0/T1/T2/C1 prerequisite archives, the T3 change, `rasen/config.yaml`, and the canonical transaction spec.
- Task 7.6's protected product boundaries are clean in the exact range: no `apps/web/src/editor/contracts/**`, Host root, `apps/vite-example/**`, `rust/**`, `packages/**`, parity oracle/fixture, or type-baseline fixture change.
- Recovery commit chain is `14797382` -> merge `df814895` (parents `14797382`, `4b7af6f2`) -> `9f362c26` -> evidence overlay `0f9b4ff5`.
- The earlier recovery overlay `cd119b3e` was pruned by `0f9b4ff5`: 42 unrelated planning files were deleted from that overlay. The retained exact-range planning paths contain no `S02`, T4, or `s0304-transaction-api-and-react-surface` match. This supports deliberate contamination filtering.
- The artifacts' original source hashes `f2e36b9...`, `552f15a...`, `aac84ff1...`, and `27e4e8d2...` are all absent from this clone. Byte-equivalence between the reconstructed commits and those originals cannot be independently verified. The current exact tree was reviewed directly instead.
- `.rasen/changes/s0304-ui-commit-routing/ephemera/auto-run.json` agrees with current HEAD/tree and explicitly records that original local identities are unavailable.
- `tasks.md` is 46/46 checked, but findings 3-5 directly falsify tasks 1.3, 3.4, 3.5, 3.7, and 4.6; findings 1 and 6 leave tasks 1.6, 5.2, and 6.2 incomplete.

Scope Check: **REQUIREMENTS MISSING**. The product touch set is within the declared boundary, but required behaviors are incomplete. The recovery overlay is filtered, yet original-commit provenance remains unverifiable.

## Verification evidence

| Check | Result | Notes |
| --- | --- | --- |
| `rasen status --change s0304-ui-commit-routing --project rocut --json` | PASS | Canonical evidence path confirmed; archive timing `on-merge`; HEAD/tree metadata aligned |
| `rasen validate s0304-ui-commit-routing --strict --project rocut --json` | PASS | 1/1 item, zero issues |
| Adapter/router + routing-registry Bun tests | PASS | 11 tests, 0 fail, 48 assertions |
| Remaining four focused Bun files | ENVIRONMENT BLOCKED | Persistence coordination executed 4 pass; command/session suites could not load missing declared packages `sonner` and `culori` (3 failed plus 1 loader error in the combined invocation) |
| Transaction boundary | PASS | 31 contract modules; both rules clean |
| Boundary negative control | PASS | Every forbidden pattern was caught and both safe controls were ignored |
| Type baseline | ENVIRONMENT BLOCKED / FAIL | Current partial dependency tree produced 446 diagnostics vs 13 at the pin and made every pinned diagnostic disappear; the script correctly rejected this as a broken comparison environment |
| ESLint | ENVIRONMENT BLOCKED | launcher exists, but installed `node_modules` lacks `eslint/bin/eslint.js` |
| `git diff --check` exact range | FAIL | Four planning/spec whitespace findings (finding 8) |
| `git diff --check` product range | PASS | No `apps/web` whitespace errors |
| Design checklist | PASS | Full changed production TSX file inspected; no visual/CSS delta and no design-system document exists |
| Greptile | N/A | No PR detected for the recovery branch |

No dependency install or generated-file repair was attempted because this was a read-only dispatched review. The source findings above do not depend on the incomplete dependency environment: each cited probe ran against the checked-out modules and produced deterministic state/operation evidence.

## Focused probe results

| Probe | Result |
| --- | --- |
| Move clip + prune source track | Operations were `delete-track`, then `update-clip`; evaluator rejected `not-found` |
| Detached nested immediate command | External-effect counter became 1; no routing guard ran |
| Automation asset then unrelated UI rename | UI prepared `update-project`, `delete-asset`; asset disappeared from engine |
| UI edit, automation track, undo | Undo rejected `ProjectStoreError/corrupt`; history stayed in place |
| Attachment-delete rejection during media removal | Revision advanced; asset restored but referenced clip remained deleted |

## Coverage diagram

```text
CODE PATH COVERAGE
==================
[+] Router / adapter
    |-- [*** TESTED] token, base, digest, projection rejection; save failure; reopen
    |-- [*** TESTED] stable explicit routing identity and audio hidden normalization
    |-- [GAP]         automation-created asset carried into later UI donor candidate
    |-- [GAP]         UI history snapshot rebased over later automation state
    |
[+] Projection / command preparation
    |-- [**  TESTED] create/delete/update stable ordering on independent entities
    |-- [GAP]         clip moves away before source-track cascade deletion
    |-- [GAP]         nested immediate/provider-private rejection before execute
    |-- [GAP]         attachment failure coordinated with queued project deletion

USER FLOW COVERAGE
==================
[+] Durable UI editing
    |-- [*** TESTED] normal routed command, batch delete/ripple/reactor, save failure
    |-- [*** TESTED] first-image canvas commit and routed undo/redo basics
    |-- [GAP]         ripple split-left waits for result and seeks retained segment
    |-- [GAP]         moving the final clip off a disposable track
    |-- [GAP] [->E2E] automation creates asset, then user performs unrelated UI edit
    |-- [GAP] [->E2E] referenced-media removal with attachment or project-store failure
    |-- [GAP]         multi-keyframe action remains one undo/redo gesture

REVIEW-RISK COVERAGE: 6/13 paths directly covered (46%)
QUALITY: *** = 4, ** = 2, gaps = 7 (2 integration/E2E-worthy)
```

## Required disposition

Do not ship or archive this change as complete. Route the five Blockers first to a non-author fixer, add the named regression tests, then fix the two Major history regressions. Re-run the focused suites in a complete dependency environment, the type-baseline gate, strict Rasen validation, and exact-range `git diff --check`, followed by a non-author re-review of the resulting delta.

## Round-1 Delta Re-review — 2026-08-10 (independent non-author)

**Verdict: CLEAN.** Reviewed only the uncommitted Round-1 product/test delta against `HEAD 0f9b4ff5ef0c8e0a04522ce4369f47511a14dc47`, with the original F1–F8 report and full routing/engine context. No Blocker, Major, Minor, or Trivial finding remains in that delta.

| Finding | Disposition | Confirmation |
| --- | --- | --- |
| F1 | Resolved | `commitUi()` merges the adapter’s committed catalog with attachment-backed live assets before preparation; the focused test proves automation asset → unrelated UI canvas edit → retire/open preserves the asset. |
| F2 | Resolved | Attachment deletion happens before the single routed project commit; attachment failure has no project effect, and project-save failure restores the attachment before leaving catalog, clips, live state, engine revision, and reopened record at the prior state. |
| F3 | Resolved | The projector emits existing clip updates before old-track/asset deletion while retaining asset/track-before-new-clip and clip-before-asset-delete ordering. The final-clip move regression passes. |
| F4 | Resolved | The detached nested dispatcher recursively validates batches and rejects every non-transaction command before `execute`; the negative test proves zero effect/save/revision/history/live mutation. |
| F5 | Resolved | Split and duplicate now resolve command-produced references after durable completion. The seek is correctly on action `split-left` with `retainSide: "right"`; the fixer report’s “split-right” phrasing was inaccurate, not the code. |
| F6 | Resolved | `history-rebase.ts` applies only the owned `from → to` donor delta to the current draft, retaining current entities/opaque state that the entry did not own; the disjoint automation undo/redo regression passes. |
| F7 | Resolved | `ProviderPrivateCompositeCommand` permits only provider-private children, compensates executed children on failure, and gives all three multi-keyframe APIs one provider-private history entry and one undo/redo gesture. |
| F8 | Resolved | `git diff --check HEAD` is clean, including both previously named Markdown paths. |

### Scope and invariant audit

- Product/test delta remains within the declared UI-routing surface; no protected `editor/contracts/**`, Host composition, Rust/WASM, package, parity-oracle, or type-baseline fixture path changed.
- Stable explicit `routingClass`, audio `hidden` normalization, typed first-image `update-project`, `pushHistory: false` ownership, durable-before-publication, single root/save, exact adapter projection, and provider-private boundary remain intact.
- The new provider-private composite and donor-history rebase have no uncovered correctness regression in the reviewed paths. In particular, rebase preserves disjoint current entity records and opaque fields, and the composite rejects transaction/immediate children at construction.

### Independent gate evidence

| Gate | Result |
| --- | --- |
| `bun test apps/web/src/core/managers/__tests__/transaction-command-routing.test.ts apps/web/src/core/managers/__tests__/media-persistence-rewire.test.ts` | PASS — 22 tests, 177 expectations |
| changed-file `bunx eslint …` | PASS |
| `node script/check-transaction-boundary.mjs` | PASS — 31 modules |
| `node script/check-transaction-boundary.mjs --negative-control` | PASS |
| `node script/check-type-baseline.mjs` | PASS — 3 diagnostics, no diagnostic outside pinned baseline |
| `rasen validate s0304-ui-commit-routing --strict --project rocut --json` | PASS — 1/1 |
| `git diff --check HEAD` | PASS |

### Fingerprint

- HEAD content tree: `9e2c8e08365bfb576c546bf5e0021b7642369442`.
- Reviewed live product delta digest (tracked `apps/web/src` diff plus both untracked product files, path-delimited SHA-256): `fe3ef159278fdeff901a83913485d4b08a07f04365f3a0127afbb95abd539882`.
- UTF-8 strict decoding, no BOM, no mojibake, and no trailing-whitespace violations confirmed for this evidence and the two untracked product modules.
