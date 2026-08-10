# Design audit 1: project mutation at the T3 transaction seam

## Disposition

**DONE — the claimed contradiction is real. There is no implementation that satisfies all of the stated frozen constraints.** The smallest sound correction is a narrowly scoped, typed `update-project` operation, delivered as a new corrective prerequisite Change inside the current composite Direction Slice. It should not be hidden inside T3 and the archived T0/T1 artifacts should not be rewritten.

The constraint to revise is only the T3 planner-authored prohibition on T0/T1 contract/engine edits. Preserve the other properties: exact donor/engine public equality, one engine apply and one `ProjectStore.save`, durable-before-publication, unchanged established editing behavior, one shared engine, opaque round-trip, and no generic command invocation.

No product source, planning artifact, run-state, parity oracle, commit, branch, or delivery state was changed by this audit. This document is the only write.

## Authority finding

The authority order is explicit: Target State > Roadmap > Slice Spec > Slice Plan (`elftia/rasen/work/opencut-agent-editor-sdk/slices/03-transaction-api-and-react-surface/plan.md:5-6`). At those authoritative levels:

- The Target State requires atomic typed operations (`target-state.md:328-346`), one shared UI/Agent transaction seam (`target-state.md:364-380`, locked decision 7 at `target-state.md:605`), explicit public/provider projection, and opaque provider round-trip (`target-state.md:449-458`).
- The Roadmap requires typed atomic transactions, the shared UI engine, save/reopen observation, and an OpenCut-free public payload (`roadmap.md:335-359`).
- The Slice Spec requires a frozen typed contract before consumption, a shared UI/Agent engine, and unchanged editing behavior proven by the established parity fixture (`spec.md:88-105`, `spec.md:130-139`).
- None of those documents fixes the operation union forever at eleven members. The Target State's locked decisions do not mention an operation inventory, and its open choices permit the exact provider-private payload seam to calibrate (`target-state.md:591-628`).

The contrary rule is local to the T3 Change:

- `proposal.md:29` says T0/T1 remain unchanged.
- `design.md:23-26` names changing T0 operations or T1 as a non-goal.
- `tasks.md:65` forbids any T0/T1 public contract or engine edit.

That local rule conflicts with the same Change's own task 4.2, which requires nested project settings to enter the same donor candidate and match an engine-side public sibling (`tasks.md:33`), and with exact public projection equality (`specs/transaction-automation-api/spec.md:61`). It is therefore an accidental planning constraint, not a Direction requirement.

T0 itself anticipated the correct response: widening the discriminated union is intentionally a visible, compile-breaking contract change, not something to hide (`archive/2026-08-09-s0304-transaction-contract-freeze/design.md:171`). The discovery calls for that explicit correction.

## Concrete contradiction

### Established donor behavior

`InsertElementCommand` detects the first visual element, reads its asset dimensions, updates the project canvas, then updates tracks (`apps/web/src/commands/timeline/element/insert-element.ts:69-117`). The committed fixture image is 320x180 (`apps/vite-example/tests/fixtures/FIXTURES.md:14,28`), while a new project starts at 1920x1080. Thus the established first-image transition includes:

```text
Project.canvas: 1920x1080 -> 320x180
timeline:       empty     -> first image clip
```

The canvas mutation is public, not provider-private. T0's `Project` contains `frameRate`, `canvasWidth`, and `canvasHeight` (`apps/web/src/editor/contracts/domain.ts:184-189`; T0 design mapping at `archive/2026-08-09-s0304-transaction-contract-freeze/design.md:50`).

### Frozen operation behavior

The current `TransactionOperation` union and `OPERATION_KINDS` contain only track, clip, asset, and marker mutations (`apps/web/src/editor/contracts/operations.ts:28-65`). The T0 fake keeps `project` outside its operation working copies (`contracts/in-memory/index.ts:64,99-287`). T1's evaluator likewise copies `document.project` unchanged while reducing those entity operations (`contracts/engine/evaluator.ts:66-110,481-488,592-600`).

Consequently, for any current legal batch evaluated from public document `D0`:

```text
evaluate(batch, D0).project == D0.project
```

T3 correctly projects donor canvas/fps into the engine Project (`editor/transactions/opencut/projection.ts:48-58`) and rejects a before/after Project difference because no operation represents it (`projection.ts:206-218`). Its adapter correctly requires the staged donor projection to equal the engine candidate before save (`editor/transactions/opencut/adapter.ts:352-369`).

Let `P0` be 1920x1080 and `P1` be 320x180. The frozen union implies the engine candidate remains `P0`; unchanged editing parity requires the donor candidate to be `P1`; exact equality requires `P0 == P1`. Contradiction. A later save cannot repair it without breaking the one-save atomic commit required by the canonical engine spec (`rasen/specs/transaction-automation-api/spec.md:233`) and T3 (`specs/transaction-automation-api/spec.md:146-152`).

This is an impossibility proof, not an estimate about implementation difficulty.

### The current workaround is evidence of the defect, not a solution

The dirty T3 draft context deliberately discards `fps` and `canvasSize` while retaining provider-private settings (`editor/transactions/opencut/draft-context.ts:41-54`). That makes exact projection pass only by removing established behavior. The latest local parity output is diagnostic evidence of exactly that split: `canvasSize` remains 1920x1080 while `originalCanvasSize` records 320x180 (`apps/vite-example/tests/parity-artifacts/vite/snapshot-vite.json:300-312`).

A Vite-versus-Next comparison can still pass because both Hosts execute the same regression. T3 task 6.5 requires before-routing versus after-routing snapshots, not merely Host-versus-Host equality (`tasks.md:55`). The already reported Host scenario passes therefore do not discharge unchanged-parity acceptance.

`UpdateProjectSettingsCommand` is also misclassified as wholly provider-private (`commands/project/update-project-settings.ts:8-31`). A direct canvas/fps edit can therefore change the donor and legacy record without changing the open engine Project; the next routed command either sees stale automation reads or fails the same project-difference check. This is the same contract hole outside the fixture path.

## Candidate analysis

| Candidate | Record/read/watch/idempotency/reopen trace | Parity and authority result | Verdict |
| --- | --- | --- | --- |
| Derive Project mutation from existing asset/clip operations | If only the donor adapter derives it, the saved record can say 320x180 while the engine keeps 1920x1080. If T0 fake and T1 evaluator both derive it, reads/watch/reopen can be consistent and the existing-operation fingerprint can deduplicate it, but `create-asset`/`create-clip` have acquired an undocumented second public effect. `changedIds` and conformance must also change. | Dimensions can sometimes be inferred from a public image Asset, but asset fps is not in T0 `Asset`; direct settings edits and some import sequences remain unrepresentable. It silently changes T0/T1 semantics and violates the explicit typed-operation intent. | Eliminated. It is a hidden contract revision, incomplete even as one. |
| Transaction-internal companion delta | The existing staged donor candidate is already this idea at the adapter seam. Letting a private Project patch alter the engine candidate requires a new engine input. Excluding that patch from the idempotency fingerprint makes same-key/different-patch retries indistinguishable; including it makes the hidden patch part of transaction identity. `validate`/`dryRun`, reads, result IDs, watch, and reopen must all learn it. | With all those changes it is semantically an untyped `update-project` operation that is absent from `supportedOperations()`. Without them it creates read/reopen or replay divergence. | Eliminated. Shallower and less honest than the typed operation. |
| Adapter or placement-policy inference | An adapter can encode 320x180, but `engine.ts:271` publishes the evaluator candidate, not the adapter's decoded output, so the open engine reads 1920x1080 until reopen while the adopted donor reads 320x180. Replay returns the old result against the stale in-memory Project. Placement policies cannot repair this: T1 deliberately gives them a deeply frozen disposable candidate and accepts only issues (`engine/evaluator.ts:618-626`), closing the earlier mutation vulnerability. | Requires weakening exact equality and the reviewed T1 policy invariant. A reopen would reveal state not produced by the typed batch. | Eliminated. Violates both current T1 and the shared typed seam. |
| Same-root immediate companion | Running a legacy project-settings save before or after the transaction yields two replacement records. The interval between saves is observable; either failure order leaves a partial result. The second mutation has no matching revision, watcher event, or idempotency identity. Reopen may show the final state, but retry and undo cannot treat it as one atomic root. | Eventual canvas parity is possible only by giving up atomicity and one-save semantics. Delaying live UI publication does not hide the already committed store/revision/watch transition. | Eliminated. "Same command" is not the same transaction. |
| Add typed `update-project` | The evaluator changes the Project in the same working document; the operation is in the canonical fingerprint and supported-operation probe; one encoded record contains Project, content, revision, and ledger; engine reads change only after save; watch fires once; replay is a true no-op; reopen decodes the same Project. The OpenCut adapter already overlays engine Project fields in `applyPublicDocument` (`adapter.ts:225-243`). | Preserves exact projection, one save, UI/Agent symmetry, first-image behavior, and opaque siblings. It changes the T0/T1 public contract, so it does not satisfy the accidental T3 no-expansion rule. | **Recommended contract correction.** |

There is therefore no contract-consistent "fourth workaround" under all current constraints. The fifth option is the smallest principled revision because it relaxes only the accidental constraint and preserves every user- and integrity-facing requirement.

## Recommended contract correction

Add one explicit operation, with no generic payload and no `ProjectStore` or engine-interface widening:

```ts
type ProjectPatch = Partial<
  Pick<Project, "name" | "frameRate" | "canvasWidth" | "canvasHeight">
>;

type UpdateProjectOperation = {
  readonly kind: "update-project";
  readonly projectId: ProjectId;
  readonly patch: ProjectPatch;
};
```

Required semantics:

- the selected document must contain a Project whose ID matches `projectId`;
- applying the patch must leave a valid Project (non-empty name, positive dimensions, valid rational frame rate);
- a successful apply includes `projectId` in `changedIds`, advances one revision, saves once, and notifies once;
- validation/dry-run use the same rule and perform no mutation;
- the operation and patch participate in the canonical idempotency fingerprint;
- the public Project read changes only after durability and survives reopen;
- `supportedOperations()` reports twelve kinds, including `update-project`;
- automation and staged UI paths produce the identical donor projection.

Do not name this `update-project-settings` or expose `TProjectSettings`; the operation owns only the Host-neutral public `Project`. Donor-only settings such as background, `canvasSizeMode`, and `originalCanvasSize` may ride in the staged candidate when the same command has a real `update-project` sibling, but remain provider-private when edited alone.

## Change ownership and exact ripple

### Delivery shape

Create a new corrective child Change inside the current S03+S04 Direction Slice, for example `s0304-project-update-operation`, depending on archived T1 and becoming a prerequisite of T2 and T3. This is not a new Direction Slice: Target State and Roadmap outcomes do not change. It is a calibration of the transaction line that the Slice Plan explicitly allows after freezes land.

Do **not** edit the archived T0/T1 Change directories. Their artifacts are accurate history. The corrective Change should author a MODIFIED delta for `transaction-automation-api`, run both existing conformance layers, receive independent review, and then sync into the canonical spec.

The Direction/portfolio record should be updated before product work resumes:

- `elftia/rasen/work/opencut-agent-editor-sdk/slices/03-transaction-api-and-react-surface/plan.md` — record the corrective child and dependency edges; preserve Target State/Roadmap.
- `rocut/rasen/changes/s0304-transaction-api-and-react-surface/planning-context.md` and its LEAD handoff — insert the correction before T2/T3.
- T3 `proposal.md`, `design.md`, `tasks.md`, and delta spec — replace "no T0/T1 change" with "consume the reviewed `update-project` correction"; keep exact equality and all atomicity/parity gates.
- New corrective Change artifacts: proposal, design, tasks, README/metadata, and `specs/transaction-automation-api/spec.md`.

Putting the correction directly inside T3 is mechanically smaller but architecturally wrong: it mixes a public compile-breaking contract revision, T0 fake semantics, T1 evaluator semantics, and donor routing in one review unit, and retroactively invalidates the premise under which archived T0/T1 were reviewed. A dedicated prerequisite preserves freeze-before-consume and makes rollback/review evidence local.

### Product files owned by the corrective child

- `apps/web/src/editor/contracts/operations.ts` — add the type and twelfth kind.
- `apps/web/src/editor/contracts/in-memory/index.ts` — include Project in the atomic working copy and implement `update-project`.
- `apps/web/src/editor/contracts/conformance/index.ts` — require the new supported kind and prove update/read/atomic failure/idempotency/watch behavior.
- `apps/web/src/editor/contracts/engine/evaluator.ts` — evaluate the Project patch in the same candidate and attribute `projectId`.
- `apps/web/src/editor/contracts/engine/conformance/index.ts` — replace the hard-coded eleven-kind assertion at lines 592-594 and add durable/reopen/dry-run coverage.
- `apps/web/src/editor/contracts/engine/__tests__/engine.test.ts` — focused invalid patch, save failure, queued ordering, replay/collision, and reopen cases.

`engine/invariant.ts`, the generic engine adapter interface, `engine.ts`, `ProjectStore`, and the OpenCut-free boundary need no interface widening. `engine/invariant.ts` already validates all Project fields; the evaluator can reuse that final-document invariant.

### T3 resume files

- `editor/transactions/opencut/projection.ts` — emit `update-project` instead of rejecting a Project delta.
- `editor/transactions/opencut/draft-context.ts` — stop stripping public `fps`/`canvasSize` from the detached draft.
- `commands/project/update-project-settings.ts` — classify commands containing `fps` or `canvasSize` as transaction-routable; mixed public/private settings use one typed public sibling. Private-only settings remain explicit gaps.
- `core/managers/commands.ts` — preserve the chosen history semantics for nested `pushHistory:false` settings rather than blindly treating every durable sibling as undo-owned.
- `core/managers/project-manager.ts`, `core/managers/media-manager.ts`, and legacy `commands/media/add-media-asset.ts` — remove public fps ratchets from untracked `executeWithoutHistory`/immediate mutation. Route them explicitly after attachment success through the same engine, with an explicit history policy.
- `editor/transactions/opencut/adapter.ts` and router tests — prove automation-only Project patches, staged equality, exact record adoption, replay, and reopen.
- `core/managers/__tests__/transaction-command-routing.test.ts` — add the first-image and direct-settings acceptance cases described below.

The existing adapter's automation overlay already knows how to map `Project` name/frameRate/canvas fields into the donor record, so no new private adapter seam is required.

### T2 and T4

T2 has not yet been materialized as a product Change in this worktree, so the cheapest point to absorb the correction is now. Its future Draft-safe operation register, private savepoint evaluator, approval flattening, and compensating batch must include `update-project`. Required tests are Project-patch savepoint rollback, stale approval rejection, one parent apply with a Project+clip batch, and correct compensation.

T4 currently has only a README. Its conformance vectors must advertise and exercise the twelfth kind. The Agent scenario should perform at least one typed Project patch (canvas is sufficient), assert one revision, then save/reopen and confirm it. This proves a third-party caller does not depend on donor inference.

## Migration and verification plan

1. Record the corrective dependency decision; leave the safe dirty T3 implementation and the minification/audio fixes intact.
2. Implement and independently review the corrective child through the public contract interface. Run T0 conformance and T1 engine conformance unchanged except for additive expectations.
3. Resume T3 and remove the canvas/fps suppression. Keep staged exact equality; do not weaken it to make a test pass.
4. Add an atomic first-image test starting at 1920x1080 with the 320x180 fixture. After one root it must assert: one apply/save/revision/watch/history publication; engine `project()`, live donor, persisted record, persistence cache, and reopened engine all report 320x180; a failed save leaves every surface at 1920x1080.
5. Add direct automation and UI Project-update tests, including same-key replay and same-key/different-patch collision, invalid dimensions/frame rate, store failure, and interleaved UI/automation ordering.
6. Capture **before-routing versus after-routing** normalized snapshots on both Hosts, then separately compare Vite versus Next. Do not treat the current cross-Host pass as pre/post evidence.
7. Run transaction boundary plus negative control, type-baseline ceiling, focused suites, both production builds, and the complete canonical spec-falsification sweep.

### Risks that must be decided, not hidden

- **Undo ownership of first-image auto settings.** Before T3, `InsertElementCommand.undo` restores tracks only (`insert-element.ts:129-134`) and the canvas update is explicitly `pushHistory:false` (`insert-element.ts:98-106`). T3's whole-snapshot inverse would instead restore 1920x1080. Pin the baseline with a test and preserve it unless Direction explicitly accepts a behavior change. Atomic durability and undo ownership are separate questions: a Project patch may be in the forward transaction but excluded from the compensating history material.
- **Frame-rate changes with existing clips.** T1 placement validates every clip/marker against the final Project timebase (`engine/placement.ts`). A user changing 30 fps to 24 fps can make existing 4,000-tick placements fail the 5,000-tick grid even though the donor currently permits the settings change. Decide whether the operation rejects, retimes in the same typed batch, or the placement contract is corrected; add a baseline behavior probe before claiming full `UpdateProjectSettingsCommand` parity.
- **Import-time fps ratchet.** `ProjectManager.ratchetFpsForImportedMedia` currently calls `executeWithoutHistory` (`project-manager.ts:524-540`), including from the immediate media path. Once fps is honestly public, that mutation cannot remain outside the engine. The orchestration needs an explicit historyless/system transaction after the attachment succeeds, or a documented behavior revision.
- **Union widening is intentionally compile-visible.** Exhaustive switches, conformance vectors, hard-coded operation counts, T2 classification, and downstream consumers must all be updated. There is no published 0.x package yet, so this is the least costly time to make the correction.

## Durable findings

1. A public field in `TransactionRead.project()` needs at least one typed mutation path if existing UI behavior changes it. Read-only public projection plus a closed entity-only operation union is not sufficient for a shared UI/Agent commit seam.
2. Exact donor/engine projection equality is not incidental planner ceremony. It is the proof that the typed transaction is the real mutation. Weakening it would create successful transactions whose record, current reads, replay semantics, and reopen state disagree.
3. Adapter output validation is not candidate equality. T1's generic `assertEncodedTransactionDocument` proves reopenability, but an adapter that encodes a different valid document can still leave the open engine stale. Concrete adapters must retain the stronger equality invariant.
4. Host-versus-Host parity cannot detect a shared regression. Commit-routing acceptance needs both axes: before-versus-after behavior and Vite-versus-Next behavior.
5. "Provider-private command" must be decided per changed field, not per command class. `UpdateProjectSettingsCommand` can be public-only, private-only, or mixed depending on its patch.
6. Atomic durability and undo ownership are distinct. Nested `pushHistory:false` work can belong to the same durable record without automatically belonging to the inverse history batch.
7. This is a contract-discovery failure at a planned seam, not evidence that the detached-candidate design is wrong. The current router/adapter/arbiter work should be preserved; the missing typed Project operation is the localized repair.
