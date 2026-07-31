## Why

C1 froze an explicit Session and Host-port contract, but every running editor path still reaches a
process-global `EditorCore`: 82 `getInstance()` calls in 43 files, including 39 command modules,
both runtime composition paths and the Vite project picker. A second Host session therefore still
shares the same managers, command history and core-owned side effects.

C2 makes the frozen contract the runtime entry without broadening it. It is a behaviour-preserving
ownership refactor: the parity fixture must not move, global Zustand/store isolation remains C3,
storage inversion remains C5, and complete resource disposal remains C6.

## What Changes

- Replace `EditorCore.getInstance()` / `EditorCore.reset()` with one core created for one explicit
  `createEditorSession({ host, ... })` result. The frozen C1 arguments and lifecycle remain the
  contract; the implementation may keep an internal session-keyed binding, but no accessor can
  return an editor without an explicit session.
- Add a React Session provider. `useEditor()` resolves the current session from that provider and
  then its session-owned core; it never resolves ports from `EditorHostContext`.
  **Do not create or restore `useEditorPorts()`**: C1 measured that seam pulling three contract
  modules into the production graph before there was a caller, and its final code records a direct
  prohibition.
- Make the twelve managers instance-owned by the session core and prove two sessions receive
  distinct manager and command-history objects. This child does not claim the nine global Zustand
  stores are isolated; C3 owns that next boundary.
- Give `Command.execute`, `undo` and `redo` an explicit editor/command context. The command manager
  supplies it, `BatchCommand` forwards it, and all 39 command modules stop resolving a global.
- Remove the remaining runtime singleton reads in `EditorProvider`, Vite project-picker flow and
  `sounds-store`. Host composition roots supply C1's existing in-memory/reference port
  implementations as explicit placeholders until C4/C5 and use C1's existing unimplemented
  graphics/GPU providers until C3. No private replacement port shape is introduced.
- Move default effect/mask/graphics/parameter/sticker registration out of the core constructor into
  an idempotent process bootstrap. A second session neither overwrites nor re-registers definitions.
  Per-session transcription diagnostics remain per-session.
- Reverse the core-owned side effects this refactor itself multiplies (notably save subscriptions
  and timers) when its session is disposed. This is the minimum no-regression counterpart to making
  the core multi-instance; it does not claim C6's five-class disposal acceptance.
- Add a committed singleton-boundary check over the complete runtime execution graph. It rejects
  `getInstance`, `reset`, a static core instance and module-scope core construction, and includes a
  deliberate violating fixture/temporary-tree negative control proving each rule can fail.
- Update `PATCHES.md` for every behaviorally modified inherited upstream file, then regenerate
  `SOURCE_INVENTORY.md` and `SOURCE_INVENTORY.json`; never hand-merge inventories. Do not edit
  `script/fixtures/type-baseline.json`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `editor-session-runtime`: the C1 contract becomes the real runtime entry; each session owns one
  core and twelve manager instances, commands receive explicit context, React consumers resolve an
  explicit session, default registration is idempotent, and a non-vacuous gate prevents the global
  singleton from returning.

## Impact

Both children in cohort 2 apply from the same review-clean integration commit
`daef023b` (C0+C1 plus regenerated derived inventories).

**Product-source write set:**

| Area | Allowed work |
| --- | --- |
| `apps/web/src/core/index.ts` and twelve `core/managers/**` | explicit construction and per-session ownership |
| `apps/web/src/commands/**` | explicit command context through execute/undo/redo |
| `apps/web/src/editor/{session/**,use-editor.ts}` | runtime binding and React Session provider |
| `apps/web/src/components/providers/editor-provider.tsx` | session-owned core consumption |
| `apps/web/src/sounds/sounds-store.ts` and its direct caller(s) | explicit core argument only |
| both Host composition roots and Vite picker/root | C1 placeholder ports plus Session provider |
| singleton/ownership focused tests and `script/check-editor-singleton.mjs` | positive and negative controls |
| `PATCHES.md` | provenance rows for each behaviorally modified inherited upstream file |
| `SOURCE_INVENTORY.{md,json}` | regenerated derived state |

Explicitly excluded: all `rust/**`, generated `rust/wasm/pkg/**`, C1 port signatures and compile
guards, a new port-resolving Host hook, C0b exports or adapters, global-store sessionization,
renderer/compositor ownership, storage rewiring, full resource disposal, and
`script/fixtures/type-baseline.json`. C2 also does not edit the root `package.json` or CI workflow:
the singleton script's positive and negative controls run from a focused test discovered by the
existing `bun test` CI path.

The product-source intersection with C0b is empty: C2 writes JavaScript/TypeScript runtime code;
C0b writes Rust/WASM. The planned documentation/derived-state overlap is `PATCHES.md` plus the
deterministic `SOURCE_INVENTORY` outputs. Each child appends independent patch-log rows; combined
integration preserves both sets semantically, then regenerates the inventories from the combined
committed tree. C2 must compile and run against C1's placeholders without importing or wiring C0b.
If either product-source boundary changes, the cohort stops and serializes.

C3 may start only after both branches are review-clean and locally shipped, then combined on one
integration commit. The joint gate rebuilds/reinstalls WASM, rebuilds both Hosts from scratch,
regenerates inventories, runs C0's WASM gates, C0b's API/handle negative controls, C1's port and
conformance gates, C2's singleton negative control, focused tests, type-baseline ceiling and parity.
Only after that gate may C3 replace the graphics/GPU placeholders, session-scope the nine stores,
repair the no-selector subscription/MigrationDialog path and demonstrate simultaneous independent
previews.
