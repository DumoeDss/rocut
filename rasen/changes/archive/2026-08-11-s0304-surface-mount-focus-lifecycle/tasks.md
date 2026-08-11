## 1. Baseline and failing controls

- [x] 1.1 Record the current commit, 17-spec inventory, pinned type-baseline result (ceiling 3), both Host composition paths, and the exact pre-R1 parity/disposal evidence used for attribution
- [x] 1.2 Add failing focused tests for the passive/focused/full pointer-keyboard-wheel-Tab matrix, controlled mode requests, two independent roots, dynamic tab stops, and listener cleanup
- [x] 1.3 Add failing focused tests for slow/rejected readiness, unmount-before-ready, rapid visibility changes, Strict-Mode-shaped remount, session replacement, live/stale error delivery, one unmount, and zero automatic dispose calls
- [x] 1.4 Add failing focused tests for the opaque-to-T0 commit adapter: one valid batch/one apply, malformed unknown rejection, async apply failure routing, unchanged public `void` shape, and no sibling-engine construction
- [x] 1.5 Create `script/check-surface-boundary.mjs` with tracked-plus-uncommitted scanning and an empty-scan failure for public provider-type leaks, Next imports, viewport ownership, and Surface-added `window`/`document` input listeners
- [x] 1.6 Add negative and converse controls proving each Surface-boundary rule catches its violation without rejecting private T0 adapter imports, container listeners, or Host-owned viewport wrappers

## 2. Container focus machinery

- [x] 2.1 Add the pure focus-mode matrix and eligible-tab-stop query under `apps/web/src/editor/surface/embedding/**`, excluding disabled, hidden, inert, disconnected, and negative-tabindex nodes
- [x] 2.2 Implement the Surface root pointer policy: passive advisory focus request without interception; focused/full local propagation containment and background-root focus without stealing descendant focus
- [x] 2.3 Implement non-passive wheel handling on the Surface root with a removable `{ passive: false }` listener and prove events outside/passive roots retain Host scrolling
- [x] 2.4 Implement full-mode Tab/Shift+Tab cycling against the current descendant set with a root fallback and no document guards, global style injection, or Surface pointer capture
- [x] 2.5 Retarget `apps/web/src/actions/use-keybindings.ts` to an optional stable container ref/enable flag while preserving the narrowly scoped default used by existing non-Surface evidence harnesses
- [x] 2.6 Pass the Surface keybinding scope through `apps/web/src/components/providers/editor-provider.tsx`, ensuring a Surface tree installs no shortcut listener on `document` or `window`
- [x] 2.7 Make all focus tests green and assert exact registration/removal counts across mode changes, two roots, and unmount

## 3. Lifecycle controller

- [x] 3.1 Add a per-instance, generation-aware Surface lifecycle controller that stores the synchronous `EditorSessionRootHandle` and never creates a React root or resource owner
- [x] 3.2 Implement readiness handling so only the still-live session/handle generation calls `onReady`, while rejection and stale settlement are attributable without stale state publication
- [x] 3.3 Implement latest-value visibility reconciliation with a serialized promise tail, redundant-value coalescing, and generation checks before each delegated `session.suspend()`/`session.resume()` call
- [x] 3.4 Implement cleanup that invalidates callbacks first, invokes idempotent `session.unmount()` once, reports cleanup failure, and never calls `session.dispose()`
- [x] 3.5 Prove hidden visibility drains preview/decoder activity only through the existing S02 `session.suspend()` resource ledger and that resume uses only `session.resume()`
- [x] 3.6 Make the lifecycle race suite green, including cleanup/setup remount and old-session/new-session overlap controls

## 4. Public Surface and T0 binding

- [x] 4.1 Implement the private `TransactionApply`/`TransactionBatch` adapter to R0's unchanged `SurfaceCommitBinding`, including minimal runtime batch validation and exactly-once async error routing
- [x] 4.2 Add an internal Surface commit context for Surface-local consumers without exporting T0, `EditorCore`, `SessionOpenCutTransactions`, OpenCut, command, or store types from the public barrel
- [x] 4.3 Implement `apps/web/src/editor/surface/embedding/editor-surface.tsx` with one `data-editor-surface` root, R0 defaults/props, the lifecycle/focus controllers, and provider values derived only from `session`/`session.host`
- [x] 4.4 Render `EditorProvider` and `EditorRoot` inside the public Surface while keeping `MobileGate`, viewport/chrome, project picker, error boundary, and product-shell overlays outside
- [x] 4.5 Export the runtime component from the existing Surface embedding barrel and add compile-time assertions that `session` remains the only required prop and public commit types remain opaque
- [x] 4.6 Add a non-public session-bound bridge that adapts `editorForSession(session).transactions` once per session and prove it neither opens an engine nor re-submits T3-routed command/pointer work
- [x] 4.7 Make public composition tests green for standalone provider identity, exact mount target, bounded sizing, two sessions/two roots, optional commit binding, and no nested React root

## 5. Next and Vite Host integration

- [x] 5.1 Replace the Next editor route's direct `EditorProvider`/`EditorRoot` composition with the session-bound public Surface in explicit focused mode while preserving its Host, viewport wrapper, `MobileGate`, C4 probe, and changelog sibling
- [x] 5.2 Replace the Vite loaded-editor branch's direct composition with the same session-bound public Surface in explicit focused mode while preserving `ViteEditorHost`, bounded `HostChrome`, project picker, error boundary, theme, tooltip, and toaster ownership
- [x] 5.3 Keep `EditorSessionHost` as the sole session creator/permanent disposer and prove project switching retires the prior core/facade before the replacement Surface becomes editable
- [x] 5.4 Update the shared parity shortcut driver to focus the Surface root before sending editor shortcuts instead of depending on document capture
- [x] 5.5 Add source/composition assertions that both Hosts render the public Surface, neither duplicates `EditorRoot`, and no Surface module owns a viewport or imports Next/product-shell code

## 6. Dual-Host Surface browser evidence

- [x] 6.1 Add one shared evidence-only Surface harness capable of controlled focus/visibility, slow readiness, mount/unmount/remount, real session-resource observation, outside sentinels, and machine-readable call/error ledgers
- [x] 6.2 Expose the shared harness through explicit Next and Vite evidence entries without placing Next modules in the Vite/editor graph or changing normal production behavior
- [x] 6.3 Add one Playwright Surface spec parameterized by the existing Host profiles and require every matrix/lifecycle step to contain an assertion or capture rather than silently pass
- [x] 6.4 On both Hosts, prove passive/focused/full keyboard, pointer, wheel, controlled-request, dynamic Tab-cycle, outside-event, multi-Surface, and listener-cleanup behavior
- [x] 6.5 On both Hosts, prove ready/unmount races, rapid hidden/visible reconciliation, real preview/decoder suspension, reversible remount, and repeated Host-owned dispose cycles against the S02 disposal oracle
- [x] 6.6 On both Hosts, snapshot html/body/Host chrome/outside sentinels after CSS load and prove mount/focus/hide/show/unmount creates zero R1-attributable computed-style or bounds delta outside the container
- [x] 6.7 Assert the Surface/root bounds equal the supplied bounded container and do not equal the viewport in the bounded harness, without claiming R2 CSS-variable/portal isolation complete

## 7. Boundary, build, and parity gates

- [x] 7.1 Run the Surface boundary check normally and with negative controls; run the transaction and port boundary checks normally and with their negative controls
- [x] 7.2 Run the focused Surface/keybinding/lifecycle/commit/Host Bun tests and focused ESLint/type checks, attributing every warning or baseline diagnostic
- [x] 7.3 Run `node script/check-type-baseline.mjs` and require at most 3 current diagnostics with none outside the pinned baseline
- [x] 7.4 Build the Next Host with its documented non-secret CI placeholders and build/typecheck the Vite Host
- [x] 7.5 Run `script/check-next-imports.mjs` and the emitted Vite module-graph `script/check-distributable-boundary.mjs`; require the public Surface bundle to contain no Next/app/site/auth/changelog/content-collections runtime
- [x] 7.6 Run the Surface Playwright matrix on Vite and Next and preserve the per-Host ledgers, resource/style measurements, screenshots, exact commands, and artifact hashes in the change evidence directory
- [x] 7.7 Run the established full parity scenario on Vite and Next, then compare snapshots; require every interaction green and no new semantic difference attributable to R1

## 8. Spec falsification and delivery evidence

- [x] 8.1 Sweep all 17 current `rasen/specs/*/spec.md` files, including numbered SHALL clauses, for assertions falsified by the exact R1 diff and record the complete inventory/result
- [x] 8.2 Explicitly reconcile `editor-session-runtime`, `transaction-automation-api`, `next-free-distributable-boundary`, `editing-parity-fixture`, `host-service-boundary`, `host-port-contract`, `session-resource-disposal`, `session-state-isolation`, and `headless-editing`
- [x] 8.3 Confirm R1 changed no Rust, ports, transaction/domain contract, provider-private public type, CSS namespace/portal/a11y/shared-React implementation, canonical save behavior, or automatic-disposal ownership
- [x] 8.4 Write the implementation evidence mapping every delta-spec scenario to its focused or browser assertion, including known portal/global-drag limitations left to R2
- [x] 8.5 Run `rasen validate s0304-surface-mount-focus-lifecycle --strict --project rocut --json`, strict UTF-8/BOM/U+FFFD checks, and product/planning `git diff --check`; confirm no unrelated user or LEAD run-state file is included
