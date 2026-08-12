## ADDED Requirements

### Requirement: R2 scopes editor CSS to Surface-owned roots

The distributable editor stylesheet SHALL define editor design tokens, theme variants, base selectors, selection behavior, and containment only on or below a Surface-owned root. The visual root and its owned portal host SHALL carry the same `data-editor-surface` namespace and computed token set. The Surface root SHALL compute to `contain: layout style paint`, remain relative to its supplied container, and MUST NOT introduce an editor-owned selector targeting `:root`, `html`, or `body`.

#### Scenario: Default and custom namespaces own complete token sets

- **WHEN** Surfaces mount with the default namespace and with a Host-supplied custom namespace
- **THEN** each visual root and its portal host expose the complete editor token set under their own `data-editor-surface` value
- **AND** editor descendants resolve their light/dark/panel values from that owner rather than from `:root`

#### Scenario: Two Surface themes do not cross

- **WHEN** two Surfaces with different namespace/theme ancestors render in one document
- **THEN** changing one Surface's theme changes only its visual root and owned portal descendants
- **AND** the other Surface and every Host element retain their prior computed values

#### Scenario: Surface root is contained and bounded

- **WHEN** a Surface is mounted inside a container smaller than the viewport
- **THEN** its computed containment includes layout, style, and paint and its bounds remain within the supplied content box
- **AND** it does not acquire viewport dimensions or write size/style state to `html` or `body`

#### Scenario: Editor stylesheet causes zero outside delta

- **WHEN** final distributable CSS is loaded and declared Host elements are snapshotted before and after Surface mount, theme change, portal open, resize, error fallback, and unmount
- **THEN** their declared computed-style values and bounds have zero R2-attributable delta
- **AND** an injected editor `:root` token or body rule makes the mechanical or browser control fail

#### Scenario: Host-owned reset remains outside the claim

- **WHEN** a Host stylesheet independently styles its own `html` or `body`
- **THEN** the Surface checker does not classify that Host file as editor ownership
- **AND** the distributable Surface stylesheet remains free of the same selectors

### Requirement: Editor portals remain owned by their initiating Surface

Every editor-owned portal rendered beneath an `EditorSurface` SHALL resolve a private portal host belonging to that exact Surface. Portal content SHALL preserve the Surface namespace, focus ownership, and bounded paint ownership. The portal owner MUST NOT appear in the public Surface type graph, and Host/product-shell overlays outside the Surface SHALL retain Host ownership.

#### Scenario: Representative overlays mount under the Surface owner

- **WHEN** an editor dialog, menu/select, or direct drag overlay opens from a Surface control
- **THEN** the overlay DOM is a descendant of that Surface's portal host and not a direct child of `document.body`
- **AND** its computed editor tokens equal the initiating Surface's tokens

#### Scenario: Overlay focus remains local and restorable

- **WHEN** a keyboard user opens, navigates, and closes an owned overlay with Escape
- **THEN** focus enters the overlay according to its semantic primitive and returns to the invoking control
- **AND** focus never transfers to another Surface or requires a document shortcut listener

#### Scenario: Two Surfaces do not exchange portals

- **WHEN** two Surfaces open overlays in the same document
- **THEN** each portal node, namespace, callback, and focus restoration target belongs to its initiating Surface
- **AND** closing or unmounting one Surface does not remove or restyle the other's overlay

#### Scenario: Host overlays retain Host ownership

- **WHEN** a Host-owned toaster or product-shell overlay renders outside the Surface provider
- **THEN** it retains its existing Host portal destination and lifecycle
- **AND** it is not counted as an escaped editor portal

#### Scenario: Unowned editor portal is detected

- **WHEN** a deliberate editor portal bypasses the private owner and targets `document.body`
- **THEN** the portal boundary control or dual-Host DOM assertion fails
- **AND** the failure cannot be hidden by copying namespace attributes onto the body-level node

### Requirement: Both Hosts and the Surface share one React 18 runtime

The workspace SHALL resolve the Next Host, Vite Host, React Surface, and ReactDOM renderer to one exact compatible React 18 runtime and type line. The implementation MUST NOT bundle, alias, externalize, or mount an isolated React 19 or second React copy. Vite deduplication alone SHALL NOT be treated as sufficient evidence.

#### Scenario: Dependency metadata pins one React 18 line

- **WHEN** root, Web, Vite manifests and the lock resolution are inspected
- **THEN** application React, ReactDOM, and their type packages use the approved exact React 18-compatible line
- **AND** no application workspace resolves a second React or ReactDOM package root

#### Scenario: Runtime identity crosses the Host-Surface seam

- **WHEN** a Host-entry probe provides context and a Surface-imported child uses context, state, and effect in a final production build
- **THEN** both modules observe the same React runtime/dispatcher identity and the interaction updates successfully
- **AND** no React #321, invalid-hook-call, or duplicate-React console error occurs

#### Scenario: Emitted Vite graph proves singleton and exclusions

- **WHEN** the normal and Surface-evidence Vite production entries are built
- **THEN** their authoritative module graph contains exactly one application React package root and one ReactDOM package root
- **AND** all ten existing Next/app/site/auth/changelog/content-collections/desktop exclusions remain clean

#### Scenario: Duplicate React control fails closed

- **WHEN** a control manifest, graph, or runtime resolves a second React copy
- **THEN** the singleton check fails before browser evidence is accepted
- **AND** multiple modules importing the same resolved package root remain an accepted converse case

### Requirement: The public Surface seam contains render failures accessibly

`EditorSurface` SHALL contain render and commit-phase failures from its editor subtree with an internal error boundary. A caught failure SHALL invoke the latest public `onError` callback at most once and render a bounded, named `role="alert"` diagnostic inside the Surface namespace instead of leaving a blank editor. The boundary MUST NOT dump a raw stack or secret-bearing object, auto-dispose the session, invent asynchronous/event-handler coverage, or move Host recovery policy into the Surface.

#### Scenario: Child render failure shows one bounded diagnostic

- **WHEN** a deterministic descendant throws during render beneath the Surface boundary
- **THEN** the editor content is replaced by one visible alert with a heading and concise normalized message inside the Surface bounds
- **AND** `onError` receives that error once without a raw stack appearing in rendered output

#### Scenario: Host siblings and another Surface survive

- **WHEN** one of two mounted Surfaces catches a descendant render failure
- **THEN** the other Surface and Host-owned siblings remain mounted and interactive
- **AND** no session outside the failed Surface is unmounted, suspended, resumed, or disposed

#### Scenario: Strict-Mode-shaped rendering does not duplicate reports

- **WHEN** the failure path is exercised under the production Host's Strict-Mode-shaped composition
- **THEN** the same caught failure produces one attributable callback and one fallback
- **AND** it does not create a retry loop or duplicate lifecycle owner

#### Scenario: Failure outside the Surface remains Host-owned

- **WHEN** a component outside `EditorSurface` throws
- **THEN** the Surface boundary does not claim or report that error
- **AND** an outer Host boundary may handle it as defense in depth

#### Scenario: React boundary limitations are explicit

- **WHEN** an event handler or detached asynchronous callback throws outside React render/commit capture
- **THEN** R2 evidence does not report that throw as contained by the Surface boundary
- **AND** existing operation/lifecycle error routes remain responsible for their own errors

### Requirement: R2 accessibility is executable at the Surface seam

The Surface root SHALL be an accessibly named region while preserving the frozen focus-mode `tabIndex` matrix. Owned overlays and the error fallback SHALL expose correct role, name, state, keyboard navigation, and focus restoration behavior. Final Next and Vite production evidence SHALL report zero critical or serious WCAG 2 A/AA automated findings within the visual Surface root plus its owned portal host. The system MUST NOT describe this bounded evidence as whole-application WCAG conformance.

#### Scenario: Named region preserves focus modes

- **WHEN** the Surface is inspected in passive, focused, and full modes
- **THEN** it has a stable accessible region name while retaining `tabIndex=-1`, `0`, and `0` respectively
- **AND** no accessibility change installs a window/document shortcut or focus listener

#### Scenario: Owned overlay is keyboard operable

- **WHEN** a user reaches a representative trigger using only the keyboard and opens its overlay
- **THEN** the overlay has the expected role/name/state, exposes visible focus, supports its expected keyboard navigation and Escape close, and restores focus
- **AND** every focused node stays in the initiating Surface's owned roots

#### Scenario: Error fallback is announced

- **WHEN** the internal error fallback appears
- **THEN** it is exposed as a named alert with readable diagnostic text
- **AND** the Host page remains navigable without focus being moved to an unrelated control

#### Scenario: Automated scan covers visual and portal roots

- **WHEN** the final-source axe scan runs in Next and Vite
- **THEN** it scans both the visual Surface root and its owned portal host after representative content is open and reports zero critical/serious owned findings
- **AND** the run fails if either owned root is omitted, the scan executes zero rules, or an owned finding is filtered out

#### Scenario: Accessibility claim remains bounded

- **WHEN** unrelated Host/page findings or untested editor workflows exist
- **THEN** evidence records them outside the R2 ownership scope where applicable
- **AND** R2 claims only the Surface seam and exercised interactions, not complete editor or page conformance

### Requirement: Surface layout responds to bounded container resize

The Surface SHALL converge on the current supplied-container dimensions during grow, shrink, aspect-ratio, repeated-same-size, and restoration changes. Resize handling SHALL prefer container-relative CSS and MAY use a private root `ResizeObserver` only for a demonstrated descendant invalidation need. It MUST NOT listen to `window.resize`, mutate `html`/`body`, remount the session, change visibility, reacquire resources, or publish dimensions through the public Surface contract.

#### Scenario: Grow and shrink remain within Host bounds

- **WHEN** the Host changes the bounded container through compact, wide, tall, and original sizes
- **THEN** Surface, editor root, preview, and timeline converge to usable dimensions inside that content box
- **AND** no Surface paint or hit target overlaps declared outside Host sentinels

#### Scenario: Resize does not alter lifecycle ownership

- **WHEN** the full resize matrix runs on a ready Surface
- **THEN** the session/root identity and mount count remain unchanged and no suspend, resume, unmount, dispose, or resource-reacquisition call is caused by resize
- **AND** Host computed style/bounds outside the supplied container remain unchanged except for the Host's intentional container dimensions

#### Scenario: Same-size notifications do not loop

- **WHEN** an observer receives repeated entries with unchanged dimensions
- **THEN** no unbounded callback/render/animation-frame loop occurs
- **AND** the final layout and lifecycle ledger remain stable

#### Scenario: Resize cleanup is deterministic

- **WHEN** the Surface unmounts or replaces its session after resize observation starts
- **THEN** its observer and any pending coalesced callback are disconnected/cancelled
- **AND** a later stale size entry cannot mutate the old or replacement Surface

#### Scenario: Viewport-resize control is rejected

- **WHEN** a deliberate implementation adds `window.resize`, viewport dimensions, or body sizing to satisfy bounded resize
- **THEN** the Surface boundary negative control fails
- **AND** root-scoped observation remains an accepted converse case

### Requirement: Provider-private document drag continuation is owner-bounded

Existing editor interactions that require drag continuation beyond the Surface root MAY use document-level move/up/cancel listeners only through a provider-private per-Surface/session coordinator. Such listeners SHALL exist only while a live drag is active, SHALL dispatch only to the initiating owner and pointer, and SHALL be synchronously removed on finish, cancel, replacement, Surface unmount, or session replacement. No coordinator, donor controller, schema, command, store, or DOM owner type may enter the public Surface barrel, and Surface focus machinery SHALL remain root-only.

#### Scenario: Active drag alone owns temporary listeners

- **WHEN** no drag is active
- **THEN** the coordinator has no document move/up/cancel listener
- **AND WHEN** an owned drag starts
- **THEN** only the minimum paired continuation listeners are installed for that live owner/pointer

#### Scenario: Drag can finish beyond the bounded root

- **WHEN** a timeline drag/trim/scrub begins inside the Surface, moves beyond its bounds, and releases over Host chrome
- **THEN** the initiating interaction receives continuation and commits its accepted edit exactly once
- **AND** the Host control under the release is not activated and existing transaction/history/save semantics are preserved

#### Scenario: Two Surfaces isolate drag ownership

- **WHEN** two Surfaces exist and one owns an active drag
- **THEN** move/up events mutate only the initiating Surface/session
- **AND** the other Surface's controller, transaction facade, focus, and portal state remain unchanged

#### Scenario: Cancel and unmount prevent stale mutation

- **WHEN** pointer cancel, drag replacement, Surface unmount, or session replacement occurs before release
- **THEN** temporary listeners are removed synchronously and the active token is invalidated
- **AND** later document events cannot commit or mutate either the stale or replacement session

#### Scenario: Private types remain private

- **WHEN** public Surface types/barrels and the emitted declaration/import graph are inspected
- **THEN** no drag coordinator/controller, provider-private schema/command/store, portal DOM type, or document-listener handle is exposed
- **AND** the existing opaque commit and Host-neutral Surface signatures are unchanged

#### Scenario: Persistent or ownerless global drag control fails

- **WHEN** a deliberate fixture registers document drag listeners persistently, omits paired cleanup, or dispatches without owner discrimination
- **THEN** the private-drag boundary or behavioral negative control fails
- **AND** an active, paired, owner-checked private drag remains an accepted converse case

### Requirement: R2 closure is final-source, dual-Host, and boundary-preserving

R2 SHALL preserve all frozen R0/R1 public, focus, lifecycle, transaction, resource, and Host ownership requirements and SHALL prove its new behavior in final production builds of both Next and Vite. Evidence SHALL be attributable to one unchanged source/test/lockfile hash set, an owned build/server identity, explicit assertions, and hashed artifacts. The pinned type baseline SHALL remain at most 3 diagnostics with none outside the pin. Vite's authoritative emitted graph SHALL retain all ten distributable exclusions. No static declaration, single-Host run, empty scan, zero-test run, reused ambient server, or screenshot without an assertion SHALL establish closure.

#### Scenario: Final source identity encloses both Host runs

- **WHEN** R2 evidence is accepted
- **THEN** the product/check/test/lockfile hash manifest before builds equals the manifest after both browser runs and identifies the marker-bearing builds used
- **AND** each Host run verifies its explicit owned server/build marker with ambient-server reuse disabled

#### Scenario: Mechanical checks prove their own sensitivity

- **WHEN** CSS, portal, React, private-drag, Surface, transaction, and Host-port checks run
- **THEN** normal scans are non-empty and clean, every deliberate violation is caught, and every documented converse fixture is accepted
- **AND** no checker passes by excluding uncommitted R2 files or emitted final CSS/module entries

#### Scenario: Both Hosts execute the complete R2 matrix

- **WHEN** the parameterized Surface Playwright suite runs against final Vite and Next production builds
- **THEN** every CSS, portal, React identity, accessibility, error, resize, drag, lifecycle, and disposal step has a machine assertion and ledger record in both Hosts
- **AND** unexpected console errors, omitted steps, omitted Host profiles, or zero axe rules fail the run

#### Scenario: Type, build, and distributable gates remain bounded

- **WHEN** final type and build gates run
- **THEN** the pinned type check reports at most 3 diagnostics with none outside its baseline, Vite typecheck/build and marker-bearing Next build pass, and the emitted Vite graph retains all ten exclusions plus one React/ReactDOM root
- **AND** no Next/page/auth/site/changelog/content-collections/desktop module enters the distributable editor graph

#### Scenario: Existing parity and ownership remain green

- **WHEN** the established dual-Host create/import/place/drag/trim/split/snap/scrub/play/save/reload scenario and S02 disposal oracle rerun
- **THEN** every interaction/disposal assertion passes and no new semantic difference, duplicate apply/save/history publication, retained resource, or automatic Surface disposal is attributable to R2
- **AND** parity attribution begins from the authoritative R1 28/19/9 evidence rather than the stale 25/16/9 line

#### Scenario: Capability falsification and claims stop at R2

- **WHEN** all 17 canonical specs and numbered SHALL clauses are swept against the final diff
- **THEN** no lifecycle, transaction, Host, persistence, headless, WASM, provenance, reproducibility, disposal, isolation, distributable, parity, or inherited-defect assertion is made false
- **AND** evidence explicitly avoids claiming whole-application accessibility, viewport ownership, a new public API, or work deferred beyond R2
