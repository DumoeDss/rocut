# runtime-asset-delivery Specification

## Purpose
TBD - created by archiving change s01-vite-portability-baseline. Update Purpose after archive.
## Requirements
### Requirement: WASM and worker modules load from the production build

`opencut-wasm` and the editor's worker modules SHALL instantiate successfully from freshly built,
locally served production outputs of both the Vite and Next Hosts at configured non-root bases.
Development-server success, a stale output, or success only at the origin root SHALL NOT satisfy
this requirement. Emitted entry, Worker, editor-WASM, and nested Worker-sidecar URLs MUST remain
below the configured Host base.

#### Scenario: WASM instantiates from served production output

- **WHEN** each fresh production Host is opened at its exact configured non-root route
- **THEN** the editor WASM is requested below that base, has the expected WASM content, instantiates,
  and returns correct wasm-backed time math without a WASM error
- **AND** no root-relative `_next`, entry, chunk, or editor-WASM request is used

#### Scenario: Worker module resolves from the production build

- **WHEN** a session starts the Worker fixture through its runtime-resource port and the actual
  transcription Worker output is inspected
- **THEN** the Host-constructed Worker resolves and exchanges a message below the configured base
- **AND** the emitted Worker and its nested ONNX Runtime WASM sidecar contain no root-absolute
  first-party URL

#### Scenario: Development-only success is not accepted as evidence

- **WHEN** runtime asset evidence is reviewed
- **THEN** it identifies the exact commit/tree marker in source, DOM, and compiled output and records
  the exclusive production server URL, port, and PID for each Host
- **AND** evidence from a development server, C3 marker/server, reused `dist`/`.next`, or origin-root
  route is rejected

### Requirement: Required data assets resolve from the production build

Every first-party static asset the editor or Host chrome acquires at runtime SHALL begin as a
logical path, SHALL be resolved or loaded through the owning Host/session asset roles, and SHALL be
served below that Host's configured base. This includes font atlas/chunks and CSS mask URLs, flags,
effect-preview imagery, branding, and favicon; it excludes external, generated, navigation,
imported-media, fragment, data, blob, and object URLs.

#### Scenario: Font atlas loads

- **WHEN** the editor loads its font atlas and renders a font-chunk mask in either non-root Host
- **THEN** atlas JSON is parsed through `RuntimeAssetLoader`, every referenced chunk resolves through
  `AssetResolver`, the quoted CSS URL is valid, and all requests remain below that Host base

#### Scenario: Flags effects and branding retain the Host base

- **WHEN** the editor browses flags, renders an effect preview, and displays Host branding
- **THEN** each first-party URL is resolved through the owning Host's asset resolver, returns the
  expected non-empty content, and never requests `/flags`, `/effects`, or `/logos` at the origin root

#### Scenario: Two sessions do not share a path-sensitive cache

- **WHEN** two sessions in one process use distinct asset bases and distinct atlas fixture bytes
- **THEN** atlas, chunk-mask, flag, logo, sticker-image, and effect-preview results retain their own
  resolver/loader identity or final URL
- **AND** no first-mounted-session base or cached image leaks into the other session

#### Scenario: All fetched asset paths resolve

- **WHEN** each parity/smoke scenario runs against fresh production output with network capture and
  an origin-root decoy enabled
- **THEN** no classified first-party request escapes the configured prefix, returns a 404, resolves
  to an HTML fallback, or has an unexpected content type
- **AND** generated graphics decode successfully without producing a first-party network request

### Requirement: A runtime asset manifest is published with the build

The distributable build SHALL emit a non-empty, category-complete inventory of copied runtime
assets and bundler outputs. Copied entries SHALL identify their logical path, category, expected
MIME family, exact byte length, and SHA-256; the inventory and emitted-resource graph SHALL match
the fresh production output.

#### Scenario: Manifest matches output

- **WHEN** every manifest entry is fetched below the configured production base
- **THEN** every response has the expected MIME family, exact byte length, and SHA-256
- **AND** atlas JSON has the expected shape, referenced font chunks decode, and effect-preview
  imagery has non-zero natural dimensions

#### Scenario: Inventory and emitted graph are complete

- **WHEN** the manifest and production-output graph are checked
- **THEN** their counts are non-zero, every required category and both Host roots are present, every
  copied runtime asset appears exactly once, and Worker/editor-WASM/nested-sidecar layers are named
- **AND** deleting an entry, truncating a category, or omitting a Host/Worker/WASM root makes the
  check exit non-zero and name the omission

#### Scenario: HTML fallback and wrong bytes cannot pass

- **WHEN** one fixture returns SPA HTML with status 200 and another returns the expected MIME with
  wrong bytes
- **THEN** the checker rejects the first by MIME/content and the second by length or SHA-256
- **AND** both deliberate failures are recorded as negative-control evidence

#### Scenario: Deliberate exclusions remain excluded

- **WHEN** exclusion probes for marketing/PWA and generated-only public paths are requested
- **THEN** none resolves as a copied non-HTML runtime asset
- **AND** the manifest records why each excluded category is outside the editor distributable

### Requirement: Initialization and WASM failures produce visible diagnostics

Worker, WASM, and GPU initialization failures SHALL surface a visible message in the editor rather
than a blank screen or console-only error. A Host-forced no-rasterizer declaration SHALL drive the
existing `RendererManager` degraded state and editor-root banner, SHALL suppress raster work before
compositor acquisition, and SHALL NOT rely on Host-stamped backend or capacity values.

#### Scenario: WASM panic is surfaced to the user

- **WHEN** the WASM module records a panic through its panic side channel during editor bootstrap
- **THEN** the editor displays that panic message instead of remaining blank

#### Scenario: Loading state covers the slow GPU initialization path

- **WHEN** runtime initialization takes an extended time
- **THEN** the editor shows a loading state for the entire duration and does not render a blank or
  partially initialized editor

#### Scenario: GPU-unavailable degradation stays visible

- **WHEN** a production-like Host declares `rasterizer: "none"`, runtime query methods are poisoned,
  and the real provider/editor surface settles through its ordinary preview/effect schedule
- **THEN** the capability report is Host-forced with backend `null` and capacity `0`, the existing
  degraded-renderer banner is visible, and the session/page remains live
- **AND** there is no page error or unhandled rejection and the session compositor handle remains
  `null`

#### Scenario: Constructibility is not physical renderer evidence

- **WHEN** forced-none evidence is reported
- **THEN** it is labeled as a C4 Host constructibility/survival gate only
- **AND** software-raster timing and survival on an actual no-rasterizer machine remain open for E1

