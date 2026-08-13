## 1. Baseline and fail-closed controls

- [x] 1.1 Record the implementation-start commit, all 17 canonical specs, R1 product/archive commits, authoritative 28/19/9 parity evidence, current React package resolutions, current Vite 2,931-module/10-exclusion graph, and pinned type ceiling 3
- [x] 1.2 Inventory every editor token/base selector, Radix/direct portal call, provider-private document drag registration, resize observer, and Surface/Host error boundary; classify each as R2-owned or an explicit Host/non-goal
- [x] 1.3 Add CSS-boundary checks over source and emitted distributable CSS that fail on editor-owned `:root`/`html`/`body`, unscoped editor token/base rules, missing containment, empty scans, and unexpected outside selectors
- [x] 1.4 Add portal-ownership and private-drag boundary checks scanning tracked plus uncommitted files; reject unowned editor portals, persistent/unpaired global drag listeners, missing owner discrimination, public private-type leakage, and empty scans
- [x] 1.5 Add a React-singleton checker over manifests, lock resolution, emitted Vite graph, and runtime-probe shape; require one exact React 18/ReactDOM 18 line and fail on a second package root
- [x] 1.6 Add negative and converse fixtures for every CSS, portal, React, drag, public-boundary, and viewport rule; prove deliberate violations fail while Host resets/toaster, same-root imports, root listeners, and live owner-scoped drags pass

## 2. CSS namespace and containment

- [x] 2.1 Split Next Host/page normalization from the distributable editor stylesheet so Vite imports no editor-owned `html`, `body`, or `:root` rules
- [x] 2.2 Re-home the complete editor token set and light/dark/panel variants under `:where([data-editor-surface])`-owned selectors without changing the public `cssNamespace` contract
- [x] 2.3 Scope universal border/outline, selection, backdrop, typography, and other editor base behavior to Surface/owned portal descendants; inspect final emitted CSS rather than relying on source form
- [x] 2.4 Apply `contain: layout style paint`, `isolation: isolate`, container-relative size, and min-size constraints to the Surface root and equivalent token ownership to its portal host
- [ ] 2.5 Add focused CSS tests for default/custom namespaces, two independently themed Surfaces, Host elements with same-named variables, and absence of editor selectors targeting Host roots

## 3. Surface-owned portals

- [x] 3.1 Implement one private portal-owner context/host per `EditorSurface`, carrying the same namespace and no public DOM/Radix type
- [x] 3.2 Update shared editor UI wrappers for dialog, alert-dialog, dropdown, context menu, menubar, popover, select, sheet, and applicable tooltip portals to prefer the current private owner while preserving explicit/outside-Surface behavior
- [x] 3.3 Retarget direct editor `createPortal` sites, including the assets drag overlay, to the current Surface owner and remove editor fallback to `document.body`
- [x] 3.4 Prove representative modal, menu/select, and drag overlay nodes stay under the initiating Surface, inherit its tokens, remain bounded, restore focus, and never attach to another Surface
- [x] 3.5 Prove Host-owned toaster/product overlays remain outside the Surface and are neither retargeted nor counted as editor portal escapes

## 4. Shared React 18

- [x] 4.1 Pin root, Web, and Vite `react`, `react-dom`, `@types/react`, and `@types/react-dom` to one exact compatible React 18 line and regenerate the lockfile without ignored peer failures
- [x] 4.2 Keep Vite package dedupe and make the React-singleton check green for manifests, lockfile, normal app entry, and Surface-evidence entry
- [x] 4.3 Add a shared runtime identity probe exercising context, state, and effect across Host-entry and Surface-import modules; assert one identity and no React #321/invalid-hook error in Next and Vite
- [x] 4.4 Run focused type/build compatibility checks after the downgrade and fix only R2-attributable React 18 API/type incompatibilities without widening the public Surface or creating an isolated runtime

## 5. Accessibility and error containment

- [x] 5.1 Give the Surface root a stable named-region semantic while preserving the exact passive/focused/full `tabIndex` and input matrix
- [x] 5.2 Add an internal Surface error boundary that normalizes a caught render/commit error, invokes the latest `onError` once, and renders a contained `role="alert"` diagnostic with no raw stack/secret dump
- [x] 5.3 Prove deterministic child render failure leaves Host siblings and a second Surface alive, never produces a blank Surface, never auto-disposes, and is not double-reported under Strict-Mode-shaped rendering
- [x] 5.4 Prove an error outside the Surface remains Host-owned and that the Vite outer boundary can remain defense in depth without changing common Surface fallback behavior
- [x] 5.5 Add `@axe-core/playwright` evidence support and require zero critical/serious WCAG 2 A/AA findings in the Surface root plus owned portal host on both production Hosts
- [x] 5.6 Add explicit keyboard assertions for named region, visible focus, representative overlay role/name/state, open navigation, Escape close, focus restoration, and fallback announcement; do not claim whole-application WCAG conformance

## 6. Bounded resize and provider-private drag ownership

- [x] 6.1 Exercise compact, wide, tall, repeated-same-size, and restored bounded containers; identify any real descendant that fails to respond before adding a Surface observer
- [x] 6.2 Implement only the minimal container-root resize invalidation needed, using root `ResizeObserver`, dimension comparison, bounded RAF coalescing, and deterministic cleanup—never `window.resize`, session remount, visibility calls, or body mutation
- [ ] 6.3 Add focused resize tests for callback bounds, same-size non-looping, cleanup, session identity, and no lifecycle/resource side effects
- [x] 6.4 Implement a provider-private per-Surface/session drag coordinator with live owner/pointer tokens and active-drag-only document move/up/cancel listeners
- [x] 6.5 Migrate number-field, color-picker, timeline element, keyframe, resize, bookmark, and applicable assets drag continuation to the coordinator while preserving existing controller and transaction callbacks
- [x] 6.6 Prove finish/cancel/replacement/unmount removes listeners synchronously, stale events cannot mutate, two Surfaces stay isolated, and no coordinator/controller type enters the public barrel
- [x] 6.7 Prove drag/trim/scrub beyond Surface bounds commits exactly once on release, does not activate Host controls, and preserves the established pointer-up transaction/history/save behavior

## 7. Dual-Host final-source browser evidence

- [x] 7.1 Extend the existing shared Surface evidence harness and one parameterized Playwright spec with asserted CSS, portal, React identity, a11y, error, resize, and drag steps; fail on zero assertions, skipped Host, or screenshot-only steps
- [x] 7.2 In Vite and Next, snapshot a declared computed-style/bounds/property set for html, body, Host chrome, outside sentinels, Surface, and portal host after CSS load and across mount/overlay/theme/resize/error/unmount; require zero outside R2-attributable delta
- [x] 7.3 In both Hosts, open representative overlays and prove DOM ownership, token values, clipping/bounds policy, z-order, keyboard behavior, focus restoration, and two-Surface isolation
- [x] 7.4 In both Hosts, run the shared React probe, injected render-error case, axe scan, named-region/focus assertions, and record machine-readable results with zero unexpected console errors
- [x] 7.5 In both Hosts, resize through the full matrix and run outside-bound drag/release plus unmount-mid-drag; assert exact bounds, no observer loop/remount/resource delta, one commit, and zero retained listeners
- [x] 7.6 Re-run the maintained S02 disposal oracle and R1 lifecycle/focus controls in both Hosts so R2 cannot conceal a resource, unmount, shortcut, or ownership regression

## 8. Build, attribution, falsification, and delivery gates

- [x] 8.1 Run focused Bun suites for Surface CSS/portal/React/error/a11y/resize/drag plus all existing R1 Surface/action/lifecycle/transaction/Host suites; require non-zero test counts and zero failures
- [x] 8.2 Run changed-file ESLint and focused TypeScript checks, then `node script/check-type-baseline.mjs`; require at most 3 diagnostics and none outside the pinned baseline
- [x] 8.3 Run CSS/portal/private-drag/React/Surface/transaction/port boundary checks normally and with all negative/converse controls
- [x] 8.4 Build Vite and typecheck it; run `script/check-next-imports.mjs` and the emitted `script/check-distributable-boundary.mjs`; retain all 10 exclusions and add exact one-root React/ReactDOM evidence for every Vite entry
- [x] 8.5 Build Next with the documented non-secret placeholders and a final-source build marker; require all routes, React 18 compatibility, and no hidden reuse of an ambient build/server
- [x] 8.6 Before builds and after browser runs, hash the complete R2 product/check/test/lockfile set and require equality; record build timestamps/markers, owned ports with `reuseExistingServer: false`, server identity, commands, ledgers, axe reports, screenshots, results, and artifact SHA-256 values
- [x] 8.7 Run the final Surface Playwright matrix on Vite and Next, then the established full parity scenario on both and compare snapshots; require every interaction green and no new semantic difference attributable to R2, using 28/19/9 as the authoritative R1 starting attribution
- [x] 8.8 Falsification-sweep all 17 canonical specs and every numbered SHALL clause; explicitly reconcile embeddable Surface, distributable boundary, parity, session lifecycle/disposal/isolation, Host ports/services, transaction automation, headless, persistence, WASM, provenance, reproducibility, and inherited defects
- [x] 8.9 Write the implementation evidence mapping every R2 delta scenario to focused/browser/check output and explicitly list remaining Host-wide accessibility, body-portal-outside-Surface, parity-classifier, and non-R2 limitations without overclaim
- [x] 8.10 Run `rasen validate s0304-surface-css-react-a11y --strict --project rocut --json`, strict UTF-8/BOM/U+FFFD checks, and product/planning `git diff --check`; confirm no run-state, unrelated user file, Rust/WASM, contract, or Host-port change is included

---

## Closure note — 47 / 49

Two tasks are left deliberately unchecked rather than claimed on adjacent evidence.

- **2.5 — focused CSS tests.** Every behaviour 2.5 names *is* proven, but by the dual-Host
  browser matrix and `check-surface-css-boundary.mjs` (including its negative and converse
  controls), not by a focused Bun suite. No `surface-css` test file exists among the ten
  focused suites. The behaviour is covered; the artifact the task asks for is not there.
- **6.3 — focused resize tests.** These would test the private root `ResizeObserver` that
  6.1/6.2 authorise *only if a concrete descendant needs one*. Task 6.1 ran the full matrix
  first and no descendant required an explicit invalidation signal, so **R2 added no
  `ResizeObserver` and no `window.resize` listener at all** — verified by `git diff` over
  `apps/web/src` and by `check-surface-boundary`'s `no-viewport-ownership` rule. With no
  observer, there is no callback-bounds, same-size-loop or observer-cleanup behaviour to unit
  test. Session identity and the absence of lifecycle/resource side effects across the five-step
  resize matrix are asserted in both Hosts.

Both are honest coverage gaps against the letter of the plan, not silent omissions, and both
are recorded in `evidence/implementation-report.md`.
