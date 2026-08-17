## Why

The editor has no mutation seam. Commands mutate `EditorCore`'s stores directly via `editor.timeline.updateTracks(...)` with snapshot-and-restore undo — no revision, no atomicity, no idempotency, no typed operation boundary. An automation client (Agent, script, or the editor's own UI through T3) cannot query or modify the project through a stable, Host-neutral interface. S02 froze the *lifecycle* boundary (`createEditorSession`, `ports/`); this child freezes the *transaction* boundary — the typed contract every future mutation routes through.

## What Changes

- **New domain types** (Project / Track / Clip / Asset / Marker) and OpenCut-compatible `MediaTime` at a fixed 120,000 ticks/sec with rational `FrameRate`, authored as standalone TypeScript interfaces with no import dependency on any donor schema module, command class, or editor store.
- **Four typed interfaces** — `read`, `apply`, `getContext`, `watch` — defining the contract surface for querying and modifying project content.
- **Atomic batches** with monotonic revisions, expected-revision conflict detection, idempotency keys, structured errors, and changed/created ID reporting.
- **In-memory fake** of every interface, runnable without React or Electron.
- **Conformance suite** (plain async function returning a report, modelled on S02's `ports/conformance/`) that any future implementation runs unchanged.
- **Boundary check script** (`script/check-transaction-boundary.mjs`) with a negative control, proving no OpenCut schema type, command class, Zustand store, IndexedDB name, or OPFS path leaks into the public contract payload.
- **Wires nothing.** Commands keep committing exactly as they do today. No command bodies, no Surface, no `ports/` edits, no `rust/`. The contract is a single coherent surface in new files under `apps/web/src/editor/contracts/**`.

## Capabilities

### New Capabilities

- `transaction-automation-api`: Host-neutral domain types and the `read` / `apply` / `getContext` / `watch` transaction interfaces with atomic batches, monotonic revisions, expected-revision conflict detection, idempotency keys, and structured errors — plus an in-memory fake and a conformance suite.

### Modified Capabilities

None. No existing spec's requirement is changed. The spec-falsification sweep over all fifteen capability specs confirms: `host-service-boundary` addresses server-backed features and port-role handling — untouched; `editor-session-runtime` addresses session lifecycle and command-context wiring — untouched (commands keep committing as they do today).

## Impact

- **New files only**: `apps/web/src/editor/contracts/**` (domain types, operation/transaction/revision/error types, the four interfaces, in-memory fake, conformance suite) and `script/check-transaction-boundary.mjs`.
- **No existing files changed**: no command bodies (`commands/**`), no `ports/` edits (consumes the frozen `ProjectStore`; does not redefine it), no `rust/`, no Surface.
- **Both Hosts stay green**: `apps/web` and `apps/vite-example` build and pass parity unchanged.
- **Type baseline ceiling (3) unchanged**: the contract adds no type errors.
- **Branch baseline**: S02 product-line tip `feat/session-runtime-host-ports@d84d9d50`.
