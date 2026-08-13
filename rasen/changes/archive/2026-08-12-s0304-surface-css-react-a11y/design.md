## Context

R0 froze a Host-neutral Surface contract and R1 implemented it in the caller's React tree. The post-R1 component owns one `[data-editor-surface="<namespace>"]` root, derives providers from the supplied session, binds the real root to `session.mount`, scopes focus and shortcuts to that root, delegates visibility to `session.suspend/resume`, and synchronously calls `session.unmount` without disposal. Next and Vite render the same `SessionEditorSurface`; the Vite editor sits in a deliberately bounded Host box.

The residual R2 facts are concrete:

- `apps/web/src/app/globals.css` still defines editor tokens at `:root`, theme overrides on generic `.dark`/`.panel`, universal base selectors, and duplicate `body` rules. Vite imports that entire file. CSS containment on the root cannot make inherited/global selectors local.
- Most Radix UI wrappers portal without a container; `ContextMenuContent` already demonstrates the necessary optional-container shape. The assets draggable item also calls `createPortal` directly. Body-level overlays escape namespace, bounds, and root-focused shortcut ownership.
- Root, Web, and Vite manifests currently declare React/ReactDOM 19 (with Vite dedupe only). This contradicts ruled A2: one shared React 18 runtime. The rejected isolated React 19 experiment produced React #321 at the router-context seam.
- Vite has a Host-local `EditorErrorBoundary`; Next relies on framework behavior. Neither makes failure behavior a property of the public Surface seam.
- Existing provider-private document drag listeners occur in number/color controls and timeline element/keyframe/resize/bookmark mechanics. R1 correctly did not pretend those were Surface focus listeners. R2 must isolate ownership without moving pointer/keyboard capture into the public Surface contract.
- Resize observation already exists in timeline and shared hooks, but there is no R2 proof that repeated bounded parent resizing converges without remounting the session or claiming the viewport.
- The authoritative R1 browser evidence is 28/19/9 parity, not the stale 25/16/9 line in the R1 falsification sweep. The R2 type ceiling remains 3 and the capability inventory remains 17.

## Goals / Non-Goals

**Goals:**

- Make all editor-owned CSS variables and base behavior descend from the named Surface root or its owned portal container, with `contain: layout style paint` and zero outside computed-style/layout delta.
- Keep every editor-owned portal inside the owning Surface and preserve namespace, focus, z-order, and two-Surface isolation.
- Implement A2 as one shared React 18/ReactDOM 18 runtime across Next, Vite, and imported editor modules, with emitted-graph and runtime identity evidence.
- Give the public Surface seam a visible, bounded, accessible render-error fallback and exactly-once error attribution.
- Verify a bounded Surface under repeated parent resizes and close the Surface/representative-overlay accessibility contract.
- Replace ad hoc provider-private document drag continuation ownership with one private per-Surface/session mechanism that is active only for a live drag and cleans up deterministically.
- Preserve R0/R1 behavior and prove all claims in final-source dual-Host production evidence.

**Non-Goals:**

- Changing `EditorSurfaceProps`, the opaque commit slot, focus modes, lifecycle mapping, session creator/disposer, transaction routing, resource draining, Host ports, persistence, or canonical save semantics.
- Moving viewport wrappers, `MobileGate`, project picker, toaster, changelog, navigation, auth, or other product-shell overlays into the Surface.
- Shadow DOM, iframe isolation, CSS-in-JS replacement, a React 19 island, or a nested React root.
- Eliminating all document listeners in the application. Host/product-shell listeners remain outside the claim; provider-private drag continuation is allowed only under the bounded owner protocol below.
- Certifying complete WCAG conformance for the whole editor. R2 covers the public Surface seam and interactions it changes or uses as executable controls.
- Fixing unrelated editor responsiveness, renderer quality, parity harness's known causation-blind one-frame classification, or application-wide UI defects.

## Decisions

### D1 — Split Host base CSS from Surface CSS; scope the latter to both owned roots

Create a distributable editor stylesheet whose token declarations and base selectors are rooted at `:where([data-editor-surface])`. The existing `cssNamespace` remains the attribute value and no new public theming prop is introduced. Theme variants become selectors such as `:where(.dark) [data-editor-surface]` and `[data-editor-surface].dark`; panel overrides remain descendants of an owned root. The Surface root receives `contain: layout style paint`, `isolation: isolate`, `min-width: 0`, `min-height: 0`, and container-relative sizing.

Next-only page normalization (if still required) remains in a Host stylesheet and may target its own `html`/`body`; the distributable Surface stylesheet may not. Universal editor defaults become descendant selectors, including pseudo-elements/backdrops belonging to the Surface or its portal owner. Selection styling is similarly scoped. Vite imports only the Surface stylesheet plus its own Host reset, not the Next application global sheet.

The portal container is a second owned CSS root carrying the same `data-editor-surface` value. This is required because a portal node is not a descendant of the visual Surface root even when physically mounted under it through a dedicated child; both selectors must receive the same token set.

**Negative control:** inject a `:root` token/body rule and prove the CSS boundary checker and before/after browser snapshot fail. **Converse control:** a Host-owned body reset outside the distributable stylesheet is accepted and an unrelated Host element retaining its own same-named variable does not fail.

Alternatives rejected: Shadow DOM breaks current portal/event assumptions; Tailwind prefixing does not solve tokens/base selectors; relying on `contain` alone does not stop selectors or inheritance.

### D2 — A private portal owner is created by each Surface

Each `EditorSurface` creates exactly one portal host element within its root and provides it through a private `SurfacePortalProvider`. Shared editor UI primitives (dialog, alert-dialog, dropdown, context menu, menubar, popover, select, sheet, tooltip where applicable) resolve that owner by default when rendered in a Surface. Explicit `container` remains usable internally. Direct editor `createPortal` sites, including the assets drag overlay, use the same owner.

The owner carries the namespace and an overlay marker, is layout-neutral until content exists, and establishes an overlay stacking context without escaping the supplied bounds. Opening an editor overlay must not append overlay content to `document.body`; closing restores focus to the invoking control inside the same Surface. Two Surfaces cannot exchange portal nodes, callbacks, focus, or theme values. Host-owned toaster/product overlays stay outside because they are not descendants of the provider.

Portal context is private: no container or Radix type is added to `EditorSurfaceProps`. If a primitive is used outside a Surface, its existing body-portal behavior remains available for Host/product-shell callers; R2's guarantee is for editor-owned calls under the Surface provider.

**Negative control:** force one representative editor dialog/menu to omit the owner and assert the DOM-ownership/style/focus test fails. **Converse control:** the Host-owned toaster remains outside and is not classified as an editor escape.

### D3 — Shared React 18 is a workspace invariant, not a Vite-only dedupe hint

Pin `react`, `react-dom`, `@types/react`, and `@types/react-dom` to one exact mutually compatible React 18 line across root/Web/Vite manifests and regenerate the lockfile. Keep Vite `resolve.dedupe`, and add package/build checks that fail on multiple application React or ReactDOM resolutions. Do not alias a private React copy, externalize a second runtime, or suppress invalid-hook errors.

Runtime probes rendered inside each final production Host compare the React object/dispatcher identity observed by the Host entry and by a module inside the Surface tree, exercise context + state + effect, and require no React #321/invalid-hook console error. The Vite emitted module graph must report exactly one resolved React package root and one ReactDOM package root for the application entries. This augments—not replaces—the existing ten distributable exclusions.

Next 16 compatibility with React 18 must be demonstrated by the real production build and browser run; dependency installation warnings or framework incompatibility are blockers, not evidence to silently return to React 19. A2 may only be reconsidered by Direction.

**Negative control:** a fixture graph/runtime deliberately resolves a second React copy and the check fails. **Converse control:** multiple source modules importing the same package root pass.

### D4 — The Surface owns render containment; the Host owns recovery and disposal

Add an internal class error boundary immediately inside the Surface root and outside editor providers whose failures should be contained. It catches render/commit/lifecycle errors from the editor subtree, reports the normalized `Error` once to the latest `onError`, and replaces editor content with a bounded `role="alert"` diagnostic that has a heading, concise message, and no raw stack or secret-bearing object dump. It does not catch event-handler or arbitrary asynchronous errors that React cannot catch, and the spec says so explicitly.

The fallback remains inside the Surface namespace/containment and does not unmount/dispose the owning session beyond the existing React subtree/lifecycle semantics. The existing Vite Host boundary may remain as outer defense for failures outside the Surface. No automatic retry/reset prop or disposal policy is added in R2; a Host can recover by replacing/remounting according to existing ownership.

Tests inject a deterministic render throw below the boundary, not a production-only hidden switch. They assert one callback, one visible alert, unchanged Host siblings, no blank root, no duplicate report under Strict Mode, and independent survival of a second Surface. A throw outside the Surface is a converse control and remains the Host boundary's responsibility.

### D5 — Accessibility acceptance is semantic plus effectful, and bounded to R2

The Surface root is a named region (`role="region"` plus a stable accessible label) without changing its focus-mode `tabIndex` matrix. The error fallback is an alert. Representative owned dialog/menu/select surfaces must expose the expected role/name/state relationships, remain in the owning namespace, move focus on open, contain practical keyboard navigation according to the existing primitive, close with Escape, and restore focus to the trigger.

Add `@axe-core/playwright` as an evidence dependency and run WCAG 2 A/AA tags against the Surface root plus its owned portal host in both final production Hosts. Critical and serious violations in that owned scope are zero. Automated output is necessary but insufficient: Playwright separately asserts region naming, keyboard-only reachability, visible focus, overlay focus restoration, and error announcement. Known unrelated Host/page findings are recorded outside the R2 scope and may not be filtered from an owned node.

No claim of whole-application WCAG compliance is permitted.

### D6 — Resize follows the supplied container without remount or viewport ownership

The Surface uses container-relative CSS and existing descendant `ResizeObserver` seams. Add a small private root size observer only if a concrete child requires an explicit invalidation signal; it must observe the root, coalesce notifications with one animation frame, avoid exact-size loops, and clean up on session replacement/unmount. It must not listen to `window.resize`, write `html/body`, recreate the session/root, call suspend/resume, or expose dimensions publicly.

The dual-Host harness resizes the Host-owned box through at least compact, wide, tall, and original dimensions and waits on observer/layout stabilization rather than sleeps. Assertions cover exact root/content bounds, no overflow into sentinels, usable representative controls, preview/timeline dimensions updating, no mount/unmount/resource lifecycle delta, and no outside layout/style delta. Repeated same-size notifications form the loop/converse control.

### D7 — Provider-private drag continuation uses a live owner token

Introduce a private drag coordinator under the Surface provider. A drag start registers `{owner, pointer kind/id, move, finish, cancel}` and only then attaches the minimum document-level move/up/cancel listeners needed to continue beyond the bounded root. Listener callbacks accept only the active initiating owner/pointer, dispatch through that owner's existing controller, and remove themselves synchronously on finish, cancel, replacement, Surface unmount, or session replacement. At most one active drag exists per Surface, while two Surfaces may each own independent coordinators.

Migrate the concrete provider-private sites discovered at planning time: number-field pointer scrub, color-picker mouse drag, timeline element interaction, keyframe drag, timeline resize, bookmark drag, and assets drag overlay where continuation applies. Preserve their transaction/command semantics and pointer-up commit count. Do not export coordinator/controller/provider types and do not move these listeners into `surface-focus.ts`.

The Surface boundary checker is refined to distinguish forbidden persistent/global Surface input ownership from this allowlisted private module. It scans tracked plus uncommitted files, requires paired registration/removal and owner checks, rejects any public import/export, and has negative controls for persistent registration, missing cleanup, cross-owner delivery, and public leakage. Converse controls prove root focus listeners and an active private drag are accepted.

Browser tests drag beyond root bounds, release over Host chrome, then assert the intended edit commits once, outside Host controls do not activate, listener count returns to zero, a second Surface is unchanged, and unmount mid-drag cancels without stale mutation.

### D8 — Final evidence is source-attributed and fail-closed

Extend the existing shared Surface evidence entry and parameterized Playwright spec rather than creating Host-specific behavior. Every R2 scenario produces an assertion and a machine-readable ledger entry; no empty scan, zero-test run, omitted Host profile, or screenshot-only step passes.

Before final builds, record SHA-256 for the product source/check/test set and the lockfile. Build Vite and a marker-bearing Next production output from those hashes. Record build start/end, output identity, React resolution report, module graph, and marker. Start owned servers with `reuseExistingServer: false` on explicit ports and verify each page reports the expected build marker. After browser runs, re-hash the source/test set and require equality with the pre-build manifest; hash all ledgers, axe reports, screenshots, and result files. If source changes, rebuild and rerun both Hosts.

The final gate set includes focused tests/lint, `node script/check-type-baseline.mjs` (at most 3, none outside pin), CSS/Surface/portal/React/transaction/port checks with negative and converse controls, Vite typecheck/build, marker-bearing Next build, `check-next-imports`, the emitted Vite distributable check retaining all ten exclusions plus React singleton assertions, both R2 browser matrices, the existing S02 disposal oracle, and the full dual-Host parity scenario. Parity differences are reported using the established final 28/19/9 attribution unless final output changes; R2 may not rewrite the stale R1 25/16/9 line as authoritative.

## Risks / Trade-offs

- **Tailwind base output may resist selector scoping.** → Inspect emitted CSS, make the boundary check operate on final CSS as well as source, and split Host reset from editor utilities rather than assuming source nesting compiled correctly.
- **Some Radix primitives hide portal ownership behind wrappers.** → Centralize wrappers and test a representative modal and non-modal overlay plus a direct `createPortal` site; scan editor-owned portal calls for explicit/private owner resolution.
- **Portaling inside a paint-contained root can clip overlays.** → That is intentional Surface ownership; position overlays relative to the root and test edge placement in the bounded Host. Do not escape to body to restore old viewport behavior.
- **React 18 may expose Next 16 or dependency peer incompatibilities.** → Exact install/build/browser gates decide compatibility. Do not use duplicate React, aliases, or ignored peer failures as a workaround.
- **An internal boundary cannot catch event-handler/async exceptions.** → State the React error-boundary limit and test render/commit containment only; existing operation/lifecycle error paths continue through their established callbacks.
- **Axe can miss interaction failures and can be noisy.** → Scope to owned nodes, prohibit filtering owned critical/serious findings, and pair it with explicit keyboard/focus/error assertions.
- **Centralizing drag listeners can alter transaction timing.** → Preserve controller callbacks and run focused plus full parity assertions for drag/trim/scrub and exactly-one pointer-up commit.
- **Resize observers can loop.** → Prefer CSS, coalesce only when an explicit signal is needed, compare dimensions before dispatch, and assert bounded callback counts under repeated same-size delivery.

## Migration Plan

1. Add fail-closed CSS/portal/React/drag boundary checks and focused failing controls.
2. Split/scoped styles and establish the private portal owner; migrate representative then remaining editor-owned portals.
3. Pin one exact React 18 line and regenerate dependency metadata; make singleton checks and both production builds green.
4. Add the internal error boundary and bounded accessibility fixes/checks.
5. Migrate provider-private drag continuation and complete bounded-resize behavior without changing command/transaction ownership.
6. Run focused gates, final-source builds, both owned-server browser matrices, disposal/parity oracles, and the 17-spec falsification sweep.

Rollback is a normal code/dependency revert. No persisted data, transaction schema, Host port, session lifecycle, or public Surface type changes, so no data migration exists.

## Open Questions

None. A2, the frozen R0/R1 contracts, Host ownership, and the bounded R2 claim are fixed. A discovered need for a public prop, React 19, body-owned editor portal, new lifecycle action, or transaction reroute returns to Direction rather than being absorbed into implementation.
