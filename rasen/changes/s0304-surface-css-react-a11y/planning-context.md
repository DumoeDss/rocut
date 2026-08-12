# Planning Context — s0304-surface-css-react-a11y

## User/runtime directive

Continue the existing `s0304-transaction-api-and-react-surface` auto-decomposed portfolio in the already registered rocut worktree. All new workers use Claude Code Opus with a 250k context window; do not use Codex and do not create another worktree. Every rocut-mutating worker is serialized. Child delivery is local-only; no partial portfolio push or PR.

## Portfolio position

- Parent: `s0304-transaction-api-and-react-surface`
- Child: R2 `s0304-surface-css-react-a11y`
- Pipeline: `small-feature`
- Dependency R1 `s0304-surface-mount-focus-lifecycle` is review-clean, locally shipped, and archived at `rasen/changes/archive/2026-08-11-s0304-surface-mount-focus-lifecycle/`.
- R1 product commit: `fb14b5b1f15f46b557dedf7ab463a73233b5eff5`.
- R1 archive commit: `cdfae229`.
- R0 contract archive: `rasen/changes/archive/2026-08-10-s0304-surface-embedding-contract-freeze/`.
- T4 is also dependency-ready but must wait until R2 completes because shared-worktree mutation independence is not proven.

## Frozen inherited decisions

- `EditorSurface` renders React inside the caller's tree; no nested `createRoot`.
- Public Surface signature remains opaque and Host-neutral.
- Session mount binds only the real root handle.
- Input/action ownership remains Surface/session scoped; no document/window capture added by Surface.
- Cleanup synchronously calls `session.unmount()` and never auto-disposes; hidden/visible delegate only to session suspend/resume.
- Commit binding remains private and reuses `editorForSession(session).transactions`; no sibling engine or duplicate T3 submission.
- Next/Vite product chrome, picker, mobile gate, project loading, and product-shell ownership stay Host-owned.
- Shared React decision A2 is **shared React 18**.

## R2 intended scope

R2 owns the residual Surface polish/integration explicitly deferred by R1:

- CSS namespace and containment implementation consistent with the frozen R0 contract.
- Portal containment/ownership so Surface UI does not escape into Host body ownership.
- Shared React 18 composition/deduplication across the distributable Surface and Hosts.
- Accessibility behavior and semantic checks.
- Error-boundary behavior at the public Surface/Host seam.
- Resize behavior for bounded containers.
- Provider-private document-level drag mechanics only where required to complete the frozen R2 boundary; do not broaden public Surface ownership or leak private types.
- Dual-Host executable evidence and boundary controls proving no outside style/layout/accessibility regression.

## Evidence and known constraints

- R1 final emitted graph: 2,931 modules, 630 from Web, all 10 exclusions clean.
- Current type-baseline ceiling: 3 diagnostics and none outside the pin.
- R1 accepted-known evidence reconciliation must not be accidentally rewritten: `spec-falsification-sweep.md:55` is stale 25/16/9; authoritative R1 final parity evidence is 28/19/9.
- Do not claim R2 closure from static declarations alone. Plan effectful dual-Host evidence for portal containment, CSS leakage, accessibility, error handling, and bounded resize.
- Browser evidence must be attributable to final source/test hashes and owned server/build identity.
- Preserve existing R1 tests and browser harness unless R2 deliberately extends them with clear attribution.

## Planning requirements

Produce a strict-valid proposal/design/tasks/spec delta. Research the current post-R1 code and the archived R0/R1 artifacts before choosing implementation details. Keep tasks independently checkable, include negative/converse controls for boundaries, include exact verification commands/evidence, and explicitly separate R2-owned work from deferred/non-goals. Append durable new planning discoveries to this file before returning.

## R2 planning discoveries (2026-08-11)

- The distributable Vite stylesheet currently imports `apps/web/src/app/globals.css` wholesale; that file owns editor tokens at `:root`, generic `.dark`/`.panel` variants, universal base selectors, and duplicate `body` rules. R2 must split Host/page normalization from Surface CSS and verify the final emitted CSS, not merely nested source syntax.
- Portal migration needs one private per-Surface owner rather than ad hoc props. `ContextMenuContent` already accepts an optional Radix `container`, while most other UI wrappers omit it and the assets draggable item calls `createPortal` directly. The portal host must carry the same namespace as the visual root; Host-owned toaster/product overlays remain outside.
- Root, Web, and Vite manifests currently declare React/ReactDOM 19; Vite only adds `resolve.dedupe`. A2 therefore requires an exact workspace-wide React 18/type pin, lock regeneration, emitted-graph singleton proof, and runtime context/state/effect identity in both final Hosts—not a Vite alias or dedupe-only assertion.
- Provider-private document drag residuals are concrete in number-field, color-picker, timeline element/keyframe/resize controllers, and bookmark drag. R2 will permit document move/up/cancel only through a private live-owner coordinator with paired cleanup; it does not weaken R1's prohibition on Surface focus machinery adding global input ownership.
- Vite's current error boundary is Host-local and Next relies on framework behavior. R2 adds a common internal Surface render boundary but leaves outer Host recovery/disposal and errors outside React render/commit capture explicitly out of claim.
