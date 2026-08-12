## Why

R1 made the frozen Surface lifecycle and focus contract executable in both Hosts, but it deliberately retained the remaining embedding defects: editor design tokens and base rules are global, overlays can portal to `document.body`, the workspace currently resolves React 19 despite the ruled shared-React-18 decision, accessibility and render-failure behavior are not owned at the public Surface seam, bounded-container resizing lacks final evidence, and provider-private drag continuations still share document-level mechanics without an explicit Surface owner. These gaps prevent the Surface from being a safe distributable React embedding even though its R1 mount behavior is correct.

R2 closes only those residual Surface integration gaps. It preserves every frozen R0/R1 public, lifecycle, transaction, resource, focus, and Host boundary and proves the result effectfully in the final Next and Vite production builds.

## What Changes

- Re-home editor tokens, theme variants, base selectors, and containment under the existing `data-editor-surface` namespace; split Host-owned page normalization from distributable Surface styling; require no editor-owned `html`, `body`, or `:root` rule and zero computed-style/layout deltas outside the Surface.
- Add one private portal-owner context and a Surface-local overlay container. Editor-owned Radix portals and drag overlays resolve that container, inherit the Surface namespace, remain inside the bounded root, and restore focus locally. Host-owned toaster, chrome, mobile gate, picker, and product-shell overlays remain outside.
- Pin the application workspace to one exact shared React 18 / ReactDOM 18 runtime and compatible type line. Prove identity in both Hosts and prove the Vite emitted graph contains one application React/ReactDOM resolution while retaining all ten Next/product-shell exclusions.
- Add an internal Surface error boundary with a bounded, accessible diagnostic and exactly-once `onError` attribution, without changing the public prop shape or replacing Host-owned permanent disposal/recovery policy.
- Close concrete accessibility behavior at the Surface seam and representative editor overlays: named region, semantic fallback/status behavior, keyboard/focus restoration, and automated critical/serious accessibility checks plus manual focus-order assertions in both Hosts.
- Make bounded parent resize behavior deterministic through container-relative CSS and existing component resize seams; prove grow/shrink/repeated-resize behavior without viewport listeners, body mutation, session remount, or resource reacquisition.
- Centralize only the existing provider-private document drag continuations behind a session/Surface-owned private coordinator. Global move/up listeners exist only during an active drag, accept events only for their initiating owner, and are removed on end/cancel/unmount; no provider-private type becomes public and Surface focus machinery remains root-only.
- Extend focused checks and the shared dual-Host Playwright harness with negative/converse controls, final-source/build/test hashes, owned server/build identity, and a complete 17-spec falsification sweep. Keep the pinned type-baseline ceiling at 3.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `embeddable-react-surface`: Complete the frozen CSS namespace/containment strategy and add portal ownership, shared React 18, accessible failure/overlay behavior, bounded resize, provider-private drag isolation, and final dual-Host evidence.

## Impact

- **Surface runtime and styles:** `apps/web/src/editor/surface/**`, the editor stylesheet entry, and narrowly required shared UI portal primitives gain private Surface contexts and scoped behavior. Public `EditorSurfaceProps`, `FocusMode`, `SurfaceCommitBinding`, lifecycle behavior, and session ownership do not widen.
- **Provider-private interactions:** existing number/color/timeline/keyframe/resize/bookmark/assets drag continuations may adopt one private owner/coordinator; their public UI and transaction routing remain unchanged.
- **React composition:** root, Web, and Vite manifests/lockfile move from the current React 19 declarations to one exact compatible React 18 line; Next and Vite still render the Surface in the caller's single React tree.
- **Host composition:** Next and Vite retain their current outer wrappers and owners. The Vite Host's outer error boundary may remain as defense in depth, but the public Surface seam supplies the common bounded fallback in both Hosts.
- **Verification:** focused Bun/ESLint/type/build checks, CSS/portal/React/boundary negative controls, `@axe-core/playwright` browser checks, resize/drag/error scenarios, existing disposal and full parity oracles, emitted Vite module-graph exclusions, and strict project-scoped Rasen validation.
- **Explicit non-impact:** no Rust/WASM, transaction/domain operation, Draft, persistence, session lifecycle, Host-port, canonical save, project-loading, viewport/chrome, or product-shell redesign; no Shadow DOM, iframe, React 19 island, new public Surface prop, global shortcut recovery, or claim that all application-wide accessibility debt is closed.
