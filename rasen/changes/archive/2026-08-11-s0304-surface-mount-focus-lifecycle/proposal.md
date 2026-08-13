## Why

R0 froze the public Surface shape, but the running editor still mounts `EditorRoot` directly, registers keyboard shortcuts on `document`, and never binds the Surface container to `EditorSession.mount`, visibility suspension, or deterministic React cleanup. R1 makes that frozen contract real in both Hosts now that T0's Host-neutral transaction types and the integrated session-owned transaction facade are available.

## What Changes

- Add the public `<EditorSurface session={...} />` runtime component around `EditorRoot`, with the Surface root as the one container owned by the embedding contract and with no viewport-sized class or Host-style mutation.
- Implement the exact `passive` / `focused` / `full` focus matrix on that container: scoped pointer activation, container-only keyboard shortcuts, scoped wheel prevention, and practical Tab/Shift+Tab cycling without `window`/`document` event capture.
- Bind Surface mount, readiness, visibility changes, unmount, and remount races to the existing `EditorSession` lifecycle. Hidden visibility delegates to `session.suspend()` so S02's existing preview/decoder drain remains the only drain path; React cleanup calls `session.unmount()` and never auto-disposes the reusable session.
- Add an internal adapter from R0's opaque `SurfaceCommitBinding` slot to T0's `TransactionBatch`/`TransactionApply` seam, and bind both production Hosts to the already session-owned transaction facade without exporting OpenCut/provider-private types or creating a sibling engine.
- Replace direct `EditorRoot` composition in the Next and Vite Hosts with the public Surface while preserving Host-owned viewport/chrome, mobile gate, project loading, product-shell overlays, and existing transaction-routed edit behavior.
- Add focused lifecycle-race, focus-matrix, transaction-binding, boundary/negative-control, and both-Host browser evidence. Keep the pinned Web type baseline at or below 3 and sweep all 17 current capability specs for falsification.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `embeddable-react-surface`: Implement the frozen component, focus, visibility, lifecycle, and opaque commit-binding requirements in both Hosts, and add observable race/boundary behavior for the mounted Surface.

## Impact

- **Surface runtime:** `apps/web/src/editor/surface/**` gains the component plus focused lifecycle, focus-scope, and T0 commit-binding adapters; the R0 public barrel exports the component without widening its public types to provider-private data.
- **Input integration:** the existing keybinding hook/provider is retargeted from `document` capture to the active Surface container while retaining a narrowly isolated legacy/test fallback outside a Surface tree if an existing harness still requires it.
- **Host composition:** the Next editor page and Vite composition root mount `EditorSurface`; viewport wrappers, Host chrome, `MobileGate`, and `ChangelogNotification` remain Host-owned.
- **Tests and checks:** focused Bun tests and a Surface boundary check with negative controls, plus the existing dual-Host Playwright parity harness extended with Surface focus/lifecycle/style assertions and S02 disposal evidence.
- **Unchanged ownership:** no transaction/domain contract redesign, no second transaction engine, no new resource-drain path, no CSS namespace/portal/a11y/shared-React implementation (R2), no automatic `session.dispose()`, and no Rust or Host-port change.
