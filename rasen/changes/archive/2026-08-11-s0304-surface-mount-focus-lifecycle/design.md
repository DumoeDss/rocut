## Context

R0 froze `EditorSurfaceProps`, the three focus modes, an opaque `SurfaceCommitBinding`, and the lifecycle mapping. The recovered contract is intentionally type-only. In the current integrated tree both production Hosts still render `EditorRoot` directly under `EditorSessionHost` and `EditorProvider`; no `EditorSurface` component exists.

The current seams are materially different from the pre-S02 donor layout:

- `EditorSession.mount({ target })` synchronously creates a root handle/state machine but deliberately renders no React. `handle.ready` settles in a microtask, `session.unmount()` releases the handle idempotently, and `dispose()` remains Host-owned.
- `session.suspend()` synchronously closes activity admission and then delegates to `EditorCore.suspend()` plus `SessionResources.drainActivityResources()`. R1 must call this method, not duplicate preview/decoder draining.
- `EditorSessionHost` owns asynchronous session creation/disposal and already provides the Host and Session contexts. The Vite project picker also depends on that outer session-owned core, so R1 cannot simply replace `EditorSessionHost` with the Surface.
- `EditorProvider` loads the project and currently calls `useKeybindingsListener()`, which installs a capture listener on `document`. That listener must be retargeted for a Surface tree or the R0 focus contract is not real.
- T3 is already integrated: each `EditorCore` owns one `SessionOpenCutTransactions`, and routed UI commands already use it. The facade implements T0's `apply` shape. R1 must adapt the opaque R0 slot to this same facade; it must not open a second engine or re-route an already routed command a second time.
- The two production roots are `apps/web/src/app/editor/[project_id]/page.tsx` and `apps/vite-example/src/app.tsx` (with Host construction in `host/vite-editor-host.tsx`). The Next viewport wrapper, Vite bounded `HostChrome`, `MobileGate`, project picker, and `ChangelogNotification` are Host/product-shell concerns and stay outside the public Surface.

The current capability inventory is 17 specs. The pinned Web type gate reports a ceiling of 3. A2 remains R2 work: R1 uses the repository's current React runtime and does not add or isolate React 19. Portal CSS containment, CSS-variable re-homing, shared React 18 proof, a11y polish, error-boundary policy, and resize coverage remain R2.

## Goals / Non-Goals

**Goals:**

- Make `<EditorSurface session={...} />` a real public component that renders `EditorRoot` in a Host-owned container.
- Make focus ownership observable and container-scoped for `passive`, `focused`, and `full` modes, including pointer, keyboard, wheel, and Tab behavior.
- Bind mount/readiness, visibility suspension/resume, React unmount, session replacement, and stale async completions deterministically to the frozen session lifecycle.
- Bind the opaque R0 commit slot to T0's `TransactionBatch`/`TransactionApply` types at a private integration seam and to the existing session-owned facade in both Hosts.
- Preserve Next/Vite behavior, bounded-container layout, outside-host computed styles, no-Next distributability, and the type ceiling.

**Non-Goals:**

- Redesigning R0's `commit({ edit: unknown }): void`, widening `EditorSession`, changing T0 domain/operation types, or exposing `EditorCore`, `SessionOpenCutTransactions`, OpenCut schema, commands, or stores publicly.
- Adding a second transaction engine or wrapping T3's already routed UI commands in another apply.
- Implementing CSS namespace rules, portal containment, shared React 18, a11y/error-boundary/resize polish, or eliminating provider-private document-level drag mechanics; those are not R1 ownership.
- Calling `session.dispose()` from React cleanup or recreating the session's resource-drain logic.
- Moving Host viewport/chrome, navigation, auth, page, project-list, or product-shell UI into `EditorSurface`.

## Decisions

### D1 — `EditorSurface` is the public composition boundary; `session.mount` remains lifecycle state, not a renderer

`apps/web/src/editor/surface/embedding/editor-surface.tsx` will export the runtime component through the existing embedding barrel. It owns one root `<div>` carrying `data-editor-surface`, `tabIndex`, `className`, the container ref, and focus/lifecycle handlers. Inside that root it provides `EditorHostProvider` from `session.host`, `EditorSessionProvider` from `session`, `EditorProvider`, and finally `EditorRoot`.

This internal provider composition is required because `session` is the only required public prop: a Host rendering the public component must not also know which private contexts `EditorRoot` needs. Nesting the same values under today's `EditorSessionHost` is intentional and identity-preserving. `EditorSessionHost` remains responsible for creating/disposing sessions and continues to support non-Surface children such as Vite's project picker.

The mount effect calls `session.mount({ target: root })` only to bind the frozen root handle/state machine to the real DOM container. The Surface itself renders React normally; it does not pretend the current no-render `session.mount` implementation is a React renderer.

Alternatives rejected:

- Teaching `session.mount` to call `createRoot().render()` would merge the React-optional session runtime with R1/R2 Surface ownership and create a second React root inside the Host root.
- Requiring callers to pre-wrap private providers would contradict “session is the only required prop” and would not be a usable public Surface.
- Moving `MobileGate`, project picker, viewport wrappers, or changelog UI inside the Surface would reintroduce Host/product-shell coupling.

### D2 — One container-level input scope implements the exact focus matrix

The Surface root is the only delegation boundary added by R1. `useKeybindingsListener` gains an internal target/enable option and reads a stable root ref inside its effect; `EditorProvider` accepts that Surface scope while retaining its current default only for legacy evidence harnesses that are not in a Surface tree. A Surface tree never registers its shortcut listener on `document` or `window`.

| Mode | Root tabIndex | Pointer at Surface boundary | Keyboard shortcuts | Wheel | Tab |
| --- | ---: | --- | --- | --- | --- |
| `passive` | -1 | Descendant behavior is untouched; Surface does not prevent/stop it. A primary pointer may advise `onFocusModeChange("focused")`, but the controlled prop does not change locally. | No Surface shortcut listener. | No Surface prevention; Host scroll remains possible. | Normal Host order. |
| `focused` | 0 | Descendant handlers run, then propagation is contained at the root; clicking otherwise non-focusable root background focuses the root without scrolling. No document/window capture or Surface `setPointerCapture`. | Capture listener is attached to the root only and therefore fires only while focus is inside it. | A non-passive root listener prevents default and contains propagation only for events originating inside the root. | Normal Host order. |
| `full` | 0 | Same as `focused`. | Same as `focused`. | Same as `focused`. | Root key handling cycles first/last eligible descendants (or the root if none) for Tab/Shift+Tab; no document guard or global trap exists. |

The focusable-element query excludes disabled, hidden, inert, negative-tabindex, and disconnected elements and is evaluated per Tab press so dynamic editor controls are not cached stale. The controlled `focusMode` prop is always authoritative; the callback is only a request.

The existing `useFocusLock` is not reused: it injects a global style and captures `document.pointerdown`, which is suitable for its number-scrub interaction but violates the Surface ownership boundary. Existing donor drag implementations may still use document movement listeners; R1 adds no new global listener and does not claim to refactor provider-private interactions.

### D3 — A generation-aware lifecycle controller suppresses stale work while delegating every transition

The React component uses a small lifecycle controller/hook with an explicit mount generation:

1. On commit, call `session.mount({ target })`, store the synchronous handle, and attach `handle.ready` handlers tagged with the generation.
2. Call `onReady` only if that generation is still active, the component still owns the same session/handle, and readiness resolved rather than rejected.
3. Reconcile the latest `visibility` value through a per-instance promise tail. Each queued step rechecks generation and desired visibility before calling exactly `session.suspend()` or `session.resume()`; rapid identical values are coalesced.
4. Cleanup invalidates the generation before any callback can publish, calls `session.unmount()` exactly once, and catches/report cleanup errors. It never auto-disposes. The session's synchronous root-handle transition keeps Strict Mode cleanup/setup and session replacement remountable.
5. A stale `ready`, suspend, or resume completion may settle its own promise but cannot call `onReady`, mutate Surface-local state, issue a follow-up transition, or affect the next component generation.

The controller does not reach into `SessionResources`, decoder, renderer, or managers. The visibility measurement observes the existing session resource ledger to prove delegation closes preview/decoder activity.

Alternatives rejected:

- Independent effects with uncancelled promises can publish `onReady` after unmount and can dispatch stale visibility transitions after a prop race.
- `IntersectionObserver` or Page Visibility would guess Host semantics and introduce another visibility source.
- Auto-dispose on cleanup prevents reuse and conflicts with `EditorSessionHost`, which already owns permanent disposal.

### D4 — A private T0 adapter fills the opaque R0 slot and points at the existing session engine

An internal `surface-transaction-binding.ts` imports only T0 contract types (`TransactionApply`, `TransactionBatch`, `TransactionResult`) and adapts them to R0's unchanged `SurfaceCommitBinding`. It structurally rejects a non-batch `unknown` payload before calling `apply`, forwards one valid batch exactly once, and reports asynchronous rejection through the Surface error callback. The public `types.ts` and barrel continue to expose only `SurfaceCommitBinding`; they do not re-export T0 or provider-private types.

A non-public session bridge under the existing outer Session context obtains `editorForSession(session).transactions`, creates this adapter once per session, and renders the public `EditorSurface` with it. That facade is the canonical engine already used by T3. The binding neither constructs an engine nor intercepts normal command/pointer events, so existing routed UI work still produces one T3 apply rather than a duplicate Surface apply. The binding is made available only to Surface-local consumers through an internal context.

Alternatives rejected:

- Widening `EditorSession` with `transactions` changes the frozen S02 public surface and leaks an implementation timing concern into R1.
- Importing `SessionOpenCutTransactions` into public props would leak a provider adapter and contradict A1.
- Inventing a generic command payload or translating OpenCut edits inside the Surface would bypass the closed T0 operation union.

### D5 — Both Hosts use a session bridge, but keep their ownership outside the Surface

The Next editor page and the Vite editor branch replace `<EditorProvider><EditorRoot /></EditorProvider>` with a small session-bound bridge that reads the already-created session, supplies the T0 adapter, and renders `<EditorSurface>`. Both production Hosts select `focused` mode so the editor retains shortcut behavior after the user focuses/clicks inside it; the public default remains `passive`. The parity driver will focus the Surface root instead of blurring focus to `body` before sending a shortcut.

Next retains its `h-screen w-screen` Host wrapper, C4 probe, mobile gate, and changelog sibling. Vite retains its bounded `HostChrome`, project picker, error boundary, and Host factory. No viewport class is allowed in the Surface module, and the Surface's bounding box must equal its supplied container rather than `window.innerWidth/innerHeight` in the bounded harness.

### D6 — Pure controllers plus one dual-Host browser matrix provide falsifiable evidence

The implementation will separate focus/lifecycle/commit orchestration from JSX enough for Bun tests with fake targets/sessions. Focus tests cover every matrix cell, callback control, multiple roots, dynamic Tab order, and listener cleanup. Lifecycle tests cover slow/rejected ready, unmount-before-ready, Strict Mode-shaped mount/cleanup/remount, session replacement, rapid hidden/visible changes, error routing, idempotent cleanup, and no dispose. Commit tests prove one valid T0 batch reaches the supplied `TransactionApply`, invalid opaque input is rejected, errors route once, and no second engine is opened.

A shared Surface browser harness is exposed through explicit evidence-only Next and Vite entries and driven by one Playwright spec under both Host profiles. It records the focus matrix, real visibility suspend/resume resource observations, multi-cycle mount/unmount/dispose, container bounds, outside-sentinel/html/body computed styles, listener behavior, and the default production composition. Existing parity still covers real edits and the T3 pointer-up one-commit behavior.

Mechanical gates are:

- a new Surface boundary checker plus negative/converse fixtures for public provider-type leaks, Next imports, viewport ownership strings, and Surface-added `window`/`document` input listeners;
- existing transaction and port boundary checks (including their negative controls), `check-next-imports`, and the Vite emitted-module `check-distributable-boundary`;
- `node script/check-type-baseline.mjs` with current count no greater than 3;
- focused lint/type/tests, production Next and Vite builds, both Host Surface browser runs, both parity runs and comparison;
- a case-insensitive falsification sweep over all 17 current `rasen/specs/*/spec.md`, with named attention to `editor-session-runtime`, `transaction-automation-api`, `next-free-distributable-boundary`, `editing-parity-fixture`, `host-service-boundary`, `host-port-contract`, `session-resource-disposal`, `session-state-isolation`, and `headless-editing`.

The outside-style check is deliberately R1-scoped: stylesheets are loaded before the before-snapshot, then mount/focus/visibility/unmount must add zero computed-style deltas outside the container. It proves R1 introduced no runtime Host mutation; it does not claim R2's eventual CSS-variable/portal isolation is complete.

## Risks / Trade-offs

- **Nested Host/Session providers could drift from the prop.** → `EditorSurface` always derives both nested values from the same `session` prop and tests identity from a child probe; no alternate Host/session prop exists.
- **Container-scoped shortcuts do not fire while focus is in a Radix portal under `document.body`.** → Record this as the known R0 portal limitation; R2 owns portal container/a11y work. R1 must not recover behavior with a document listener.
- **Existing provider-private drag/scrub code has document-level mechanics.** → The Surface boundary check scopes its claim to listeners added by Surface focus machinery, and tests that no new global pointer capture is introduced. Refactoring all donor interactions is outside R1.
- **R0's opaque `void` commit method cannot return the transaction promise.** → Keep the frozen public type; the private adapter observes the promise and routes rejection to `onError`. A future public async redesign requires a separate contract change.
- **Rapid visibility/unmount transitions can leave an underlying session promise settling after React cleanup.** → Invalidate the generation first, issue idempotent `session.unmount()` immediately, and prevent stale completion from publishing or scheduling more work. Permanent closure remains Host `dispose()` ownership.
- **Changing the shortcut target can make parity tests appear broken.** → Update the driver to focus the Surface root before shortcuts and retain all persisted-behavior assertions; do not restore document capture to make the old driver pass.
- **A browser style snapshot could confuse preloaded global CSS with R1 mount deltas.** → Capture both sides after host CSS load against the same outside sentinels and report the exact property set; R2 separately owns global stylesheet remediation.

## Migration Plan

1. Add and test the pure focus, lifecycle, and T0 binding adapters plus the public runtime component.
2. Retarget `EditorProvider` shortcut installation when a Surface scope is present; keep unrelated harness behavior stable.
3. Switch Next and Vite editor composition to the session-bound public Surface, leaving their outer shell unchanged.
4. Add dual-Host Surface evidence and update parity shortcut focus.
5. Run focused gates, strict boundaries/negative controls, both production builds, both browser matrices/parity runs, type ceiling, and the 17-spec sweep.

Rollback is a normal code revert of the R1 component/Host integration. R0 types, T0/T3 transactions, session persistence, and durable data formats are unchanged, so no data migration or recovery action is required.

## Open Questions

None. A1, A2, default public focus mode, host-driven disposal, and R2 ownership are already locked. Any discovery that requires changing those decisions returns to the parent Direction rather than being absorbed by R1.
