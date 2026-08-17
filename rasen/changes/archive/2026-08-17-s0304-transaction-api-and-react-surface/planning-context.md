# Planning context — `s0304-transaction-api-and-react-surface` (composite S03+S04)

> Read this FIRST. It is the LEAD's seed for every planner in this portfolio. Then read your child's
> README and the Direction spec/plan it points to. Research only what is missing — do not start from
> zero.

## What this is

A composite Direction Slice bundling **Roadmap S03 (M3 Transaction Automation API)** and **S04 (M4
Embeddable React Surface)** of the `opencut-agent-editor-sdk` workstream, run as one active Slice with
a two-line portfolio. Roadmap §2 requires they be one composite Slice, not two Direction Slices,
because M3's last acceptance bullet makes the Surface a consumer of the transaction contract.

**Authority (read these):**
- Spec: `elftia/rasen/work/opencut-agent-editor-sdk/slices/03-transaction-api-and-react-surface/spec.md`
- Plan (child DAG + §5 independence): `.../03-transaction-api-and-react-surface/plan.md`
- Target State / Roadmap: `elftia/rasen/work/opencut-agent-editor-sdk/{target-state,roadmap}.md`

All rasen commands use `--project rocut`. The planning/Direction artifacts live in the elftia repo;
the implementation lives here in `rocut`.

## Baseline

Branch from the **S02 product-line tip `feat/session-runtime-host-ports@d84d9d50`** (= C7 code ship
`be9cfc4e` + the reconcile-metadata merge). `main@88547d38` carries the archived **specs only**, not
the S02 code. S02 reconciled `passed` 2026-08-09: the Session factory (`createEditorSession`), the
frozen Host port contract (`editor/ports/`), and the session-owned `EditorCore` all exist on this
branch — read them before designing. The read-only `_others/rocut-wt-s02` worktree sits at
`be9cfc4e` and is a free measurement surface (it has `node_modules` + a built `.next`).

Key post-S02 facts the contracts attach to:
- `createEditorSession({host, runtimeGraphics?, runtimeGpu?})` returns an `EditorSession` with
  `mount/suspend/resume/unmount/dispose/watch`, but **`watch` is over the session snapshot only** —
  there is NO mutation/transaction seam yet. (S03 adds it.)
- `EditorCore` is session-owned via `editorForSession(session)`; nine managers (`playback timeline
  scenes project media renderer selection clipboard diagnostics`) each `.subscribe()`. Commands
  (`apps/web/src/commands/**`, ~50 modules + `base-command.ts`/`batch-command.ts`) mutate stores
  directly — unmediated. (T3 routes this through transactions.)
- `EditorRoot` (`editor/surface/editor-root.tsx`) already fills its container, not the viewport, but
  there is no embedding/focus/CSS-surface contract. (S04 adds it.)

## Decisions already ruled (do not re-open)

- **A1 = (a)**: the Surface↔transaction commit binding is consumed by child R1 against T0's frozen
  types — NOT frozen in R0. This is why `T0 ∥ R0` is the one concurrency edge.
- **A2 = shared React 18** (was S02's deferred D2; ruled 2026-08-08 on E1's measurement). R2
  implements/proves it; isolated React 19 is retired (React #321 at the router-context seam).

## Child DAG and the one concurrency edge

```
T0 transaction-contract-freeze ──┬─→ T1 engine ──┬─→ T2 draft ──┐
                                 │               └─→ T3 ui-commit ─┴─→ T4 agent-evidence
R0 surface-embedding-freeze ─────┴─→ R1 mount/focus/lifecycle ─→ R2 css/react/a11y
                                                     (R1 also consumes T0)
```

**Only `T0 ∥ R0` runs concurrently** (both pure type-freezes; disjoint write sets — only the
regenerated `SOURCE_INVENTORY.{md,json}` overlaps, resolved by re-running the generator, never
hand-merging). Every other pair is serial. Running order: cohort {T0, R0} → T1 → (T2, T3, R1 as they
unblock) → R2, T4. A dependent child waits until every prerequisite is implemented + review-clean.

## Per-child briefs (your child is one of these)

- **T0 `s0304-transaction-contract-freeze`** (txn, no deps): Author the transaction contract —
  Host-neutral domain types (Project/Track/Clip/Asset/Marker/MediaTime @120,000 ticks/sec), the
  `read/apply/getContext/watch` interfaces, atomic batches, monotonic revisions, expected-revision,
  idempotency, structured errors — + in-memory fake + conformance suite. **Wire nothing.** Touch set:
  new `apps/web/src/editor/contracts/**` + `script/check-transaction-boundary.mjs`. Capability delta:
  ADDED `transaction-automation-api`.
- **R0 `s0304-surface-embedding-contract-freeze`** (surface, no deps): Author the Surface embedding
  contract — public `<EditorSurface session={...}/>`, focus-mode types (passive/focused/full),
  CSS/theme namespace strategy, lifecycle binding to the session. **Wire nothing.** Touch set: new
  `apps/web/src/editor/surface/embedding/**`. Capability delta: ADDED `embeddable-react-surface`.
- **T1 `s0304-transaction-engine`** (deps T0): batch apply, revision, idempotency, errors,
  validation/dry-run, placement policy, feature discovery. New `editor/contracts/engine/**`.
- **T2 `s0304-draft-editing-sessions`** (deps T1): isolated multi-step Drafts, per-call savepoints,
  manual/auto approval, stale-revision rejection, atomic one-undo; draft-safe vs immediate separation.
- **T3 `s0304-ui-commit-routing`** (deps T1) — **shared seam**: route the command commit path through
  the transaction engine; pointer-move preview commits once. Touch set: `commands/base-command.ts`,
  `batch-command.ts`, `commands/**`, core dispatch. Not the Host composition roots.
- **R1 `s0304-surface-mount-focus-lifecycle`** (deps R0, T0): wrap `EditorRoot` in `<EditorSurface>`,
  focus matrix, visibility-suspend → `session.suspend()`, deterministic unmount. Touch set:
  `editor-root.tsx`, focus modules, both Host roots.
- **R2 `s0304-surface-css-react-a11y`** (deps R1): CSS namespace (zero host deltas), shared-React-18
  implementation, a11y/error-boundary/resize.
- **T4 `s0304-agent-transaction-evidence`** (deps T2, T3): Agent script (create tracks/assets/clips,
  move/trim/split, verify revisions) + published conformance vectors.

## Hard constraints (every child)

- No OpenCut schema/command-class/Zustand-store/IndexedDB-name in any public contract; enforce with a
  check script + negative control (S02's `check-port-boundary.mjs` is the model).
- Both Hosts stay green; the parity fixture is the oracle; an unchanged parity snapshot is evidence a
  refactor preserved behaviour.
- Type baseline never grows (ceiling **3** at the S02 baseline; `node script/check-type-baseline.mjs`).
- Consume S02's frozen ports/session — never redefine them privately.
- Spec-falsification sweep over **all 15** existing capability specs each child (the archive guard
  only checks a delta's declared MODIFIED; grep numbered SHALL clauses for assertions your diff makes
  false).
- Children ship **local** (commit only); the portfolio delivers once at the parent.

## Working notes

- `rasen` is 0.1.7. Run `rasen status --change <child> --project rocut --json` for each child's
  `changeRoot`/`evidenceDir`/`handoffDir`/`ephemeraDir`. Ephemera lives under
  `rocut/.rasen/changes/<child>/ephemera/` (new canonical layout).
- After proposing, APPEND durable new findings (decisions, discovered constraints — not chatter) to
  THIS file so later planners and Tier-B re-spawns stay cheap.

### R0 findings (proposed 2026-08-09)

- **No existing focus machinery in the S02 seam.** `EditorHostContext` provides host config; `useEditor`
  subscribes to 9 managers; neither handles keyboard/pointer/wheel focus scoping. Focus ownership is
  entirely new Surface machinery — R1 builds it from scratch against the R0 contract.
- **Portals break CSS containment.** `EditorRoot` fills its container (`size-full`), but Radix
  dialogs/dropdowns/toasts portal to `document.body` with fixed positioning. `contain:
  layout style paint` on the Surface root cannot cover these. R2 must address portal styling separately;
  R0's zero-delta guarantee covers the Surface root only, not portaled overlays.
- **`session.suspend()` already drains preview/decoder work.** `create-session.ts:264` calls
  `resources.beginActivitySuspend()` synchronously, then `ownedEditor().suspend()` +
  `resources.drainActivityResources()` asynchronously. The Surface's visibility-suspend binding is pure
  delegation — R1 needs no new resource-drain logic, only the prop-to-session-call wiring.
- **R0 strict-validated clean.** All 4 artifacts (proposal, design, specs/embeddable-react-surface,
  tasks) pass `rasen validate --strict`. Touch set is additive-only under
  `apps/web/src/editor/surface/embedding/**`.

### T0 findings (proposed 2026-08-09)

- **Donor schema uses different names than the contract.** "Clip" = donor `TimelineElement` (8 variants
  in a union); "Marker" = donor `Bookmark`; "Track" = donor `TimelineTrack` (5 variants). The contract
  defines minimal flat interfaces (single `Clip`, single `Track` with `kind` discriminator), NOT a mirror
  of the full donor schema. Provider-private fields (effects, masks, keyframes, retiming, animations) are
  excluded (Target State §5.3 Not Now). T1/T3 own the mapping at the seam.
- **`MediaTime` must be standalone, not imported from `@/wasm`.** The donor's `MediaTime` is a branded
  `number` from `@/wasm` at `TICKS_PER_SECOND = 120000`. The contract defines its own identical-rate
  branded integer independently — `@/wasm` is editor-internal and the boundary check bans it. Structural
  compatibility means the T1/T3 seam bridges with a zero-cost cast.
- **`EditorCore` has 15 members, not 9.** The session-subscribable managers are 9 (`playback timeline
  scenes project media renderer selection clipboard diagnostics`), but `EditorCore` also exposes
  `command`, `save`, `audio`, `transcription`, `persistence`, `resources`. The contract's `read`/`apply`
  surface does not touch any of these — it is a parallel typed layer that T1/T3 connect to.
- **Commands commit via `editor.timeline.updateTracks(snapshot)`.** No transaction boundary exists today.
  `BatchCommand` is just sequential array iteration, not atomic. `CommandManager` runs reactors after
  execute (e.g., empty-track pruning). T3 must account for these reactors when rerouting.
- **A3 ruled = async.** `getContext` returns `Promise` for consistency with `read`/`apply` and to allow
  implementations that probe external state. A4 ruled = `apps/web/src/editor/contracts/` (package
  extraction is S05).
- **T0 strict-validated clean.** All 4 artifacts pass `rasen validate --strict`. Capability delta is
  ADDED `transaction-automation-api` only (no MODIFIED — spec-falsification sweep over all 15 existing
  specs confirmed none are falsified). Touch set is additive-only under
  `apps/web/src/editor/contracts/**` + `script/check-transaction-boundary.mjs`.

### T1 planning findings (proposed 2026-08-09)

- **`ProjectStore` has no compare-and-swap token.** T1 can guarantee invocation ordering,
  expected-revision conflicts, revision monotonicity and idempotency for callers sharing one engine
  instance, and can persist that history across reopen, but it cannot truthfully claim exclusion
  against another process replacing the same record. The T1 design reports typed
  `cross-engine-cas: false`; T2 Drafts must share the session engine rather than open one per Draft.
- **Transaction metadata must commit inside the same opaque project record.** A library-record
  sidecar would require two non-atomic durable writes. T1 therefore gives an injected document
  adapter ownership of embedding revision/idempotency metadata while overlay-preserving the prior
  `ProjectRecord.data`; T3 owns the OpenCut adapter and mapping.
- **The existing transaction boundary checker scans the entire future `contracts/engine/**`
  subtree.** `@/editor/ports` is an allowed frozen dependency, but any donor schema/command/core/
  store-implementation import below `contracts/**` is rejected. T3's donor-aware document adapter
  must live outside `contracts/**` and satisfy T1's adapter interface.
- **The post-T0 capability inventory is 16, not 15.** The Direction plan's 15-spec count predates
  archiving `transaction-automation-api`; T1 and later children must sweep all 16 current
  `rasen/specs/*/spec.md` files (thereby still covering the original 15).
- **T1 artifacts are strict-valid.** Proposal/design/delta spec plus 31 implementation tasks pass
  `rasen validate s0304-transaction-engine --strict --project rocut --json`; the product touch set
  remains additive-only `apps/web/src/editor/contracts/engine/**`.

### T2 planning findings (proposed 2026-08-09)

- **Every Draft must share its parent session engine.** T1 advertises `cross-engine-cas: false`, so
  one engine per Draft would not provide honest stale-writer exclusion. Draft open instead captures a
  consistent base with a bounded revision-before/entities/revision-after sandwich.
- **One undo is a structured receipt, not T2 UI wiring.** Draft calls evaluate on private savepoints
  through `evaluateTransactionBatch`; approval flattens the accepted journal into one parent-engine
  apply at the captured revision and returns one compensating batch for T3's future command journal.
- **The immediate boundary distinguishes storage effects from reversible deletes.** Closed T1
  project-content operations (including delete-track/clip/marker/asset) remain Draft-safe, while
  generation/export/source-package or external-resource deletion are named immediate categories;
  candidate asset references must pass a project-retention preflight before apply.

### T3 planning findings (proposed 2026-08-10)

- **The closed T0 operation union cannot represent a provider-private-only UI edit.** Effects,
  masks, keyframes, scene-only structure and similar private fields may ride in the same verified
  donor candidate when a real public operation exists, but an empty public projection must remain an
  explicit provider-private gap — never a no-op batch or generic command invocation disguised as a
  transaction.
- **One shared engine is necessary but not sufficient while legacy saves remain.** SaveManager and
  `SessionPersistenceCoordinator` can otherwise encode from a stale retained snapshot after an engine
  save and overwrite revision/idempotency metadata. T3 must share a per-project mutation arbiter,
  adopt the engine's exact encoded record into coordinator caches, and suppress only the duplicate
  dirty signal caused by publishing that already durable candidate.
- **T3 selected detached prepare → durable commit → publish.** The adapter interface has no donor
  candidate parameter, so the external OpenCut router binds an explicit staged candidate to a unique
  idempotency token, base revision/record digest and exact public re-projection; mismatch rejects
  before save, and live state/history/selection publish only after T1 apply succeeds.

### Project-operation correction findings (proposed 2026-08-10)

- **Project updates distinguish missing intent from unchanged intent.** `update-project` rejects an
  empty patch, but a non-empty same-value patch follows the existing update convention: it succeeds,
  reports the Project ID in `changedIds`, and advances one revision/save/watch; only rejection and
  exact keyed replay are transaction no-ops.
- **A frame-rate patch is validated against the complete final batch document.** Existing clips and
  markers that fall off the new frame grid reject the Project update unless typed operations in the
  same batch restore final placement validity; the evaluator never infers or silently retimes repairs.
- **Atomic durability and inverse ownership remain separate.** T2 compensates a changed Project with
  one constant-size pre-image `update-project`, while T3's first-image canvas patch is durably part of
  the forward root but remains outside command undo to preserve its baseline `pushHistory: false`
  behavior.

### R1 planning findings (proposed 2026-08-10)

- **`session.mount()` owns only the root handle/state machine; it does not render React.** The public
  `EditorSurface` must render `EditorRoot` in the caller's React tree and separately bind the real
  container to `session.mount({ target })`; teaching Session to create a nested React root would cross
  the React-optional runtime boundary and conflict with R2 ownership.
- **The remaining global shortcut seam is `useKeybindingsListener()` on `document` capture.** R1 must
  retarget that hook through `EditorProvider` to the Surface root for focused/full modes; the shared
  parity driver currently blurs to `body`, so it must focus `[data-editor-surface]` before sending
  shortcuts instead of preserving global capture for the test.
- **The canonical transaction facade is session-owned indirectly as `EditorCore.transactions`, not a
  public `EditorSession` member.** R1 can consume T0 types privately by adapting
  `editorForSession(session).transactions` to R0's opaque slot; it must neither widen the frozen
  Session API nor open a sibling engine or double-submit T3-routed UI work.
