# sdk-desktop-reference-host Specification

## Purpose
TBD - created by archiving change s05-second-host. Update Purpose after archive.
## Requirements
### Requirement: A desktop reference Host consumes the packages

The repository SHALL contain a minimal desktop reference Host at `apps/electron-host` — Electron
with a Vite-built renderer — that consumes the published packages as a workspace consumer. The
Host SHALL import package code only through subpaths the `exports` maps declare, SHALL NOT import
or depend on any Elftia package or adapter code, and SHALL NOT promote or include any part of
`apps/desktop`. The Host SHALL NOT be a package: it declares no `exports` map and appears in
`packages/boundary.json` only as a consumer.

#### Scenario: The Host builds and boots from its own production output

- **WHEN** the Host's renderer is built for production and the Electron application is launched
  against that build
- **THEN** the editor boots to an interactive timeline without a development server
- **AND** the boot produces no CSP violation and no console error

#### Scenario: The Host reaches the editor only through declared entries

- **WHEN** the Host's source is scanned for package imports
- **THEN** every `@opencut/*` specifier resolves to a subpath that package's `exports` map declares
- **AND** the package-boundary check passes with the Host's files inside its scan set

#### Scenario: The GPUI experiment stays excluded

- **WHEN** the Host's dependency list and source are inspected
- **THEN** nothing under `apps/desktop` is imported, copied or promoted
- **AND** `check-distributable-boundary.mjs`'s `no-desktop-app` rule survives unchanged

### Requirement: The Host implements its own desktop-shaped ports

The desktop Host SHALL provide its own implementations for the ports whose shape is
desktop-specific: a filesystem-backed `ProjectStore` whose byte I/O happens in the Electron main
process behind a narrow preload bridge with no filesystem path exposed to the renderer; runtime
assets resolved and loaded explicitly from the Host's own serving; and workers constructed by the
Host at the Host's own origin, treating the editor-supplied URL as a request it may rewrite. The
host-neutral roles MAY be composed from the packages' published in-memory reference
implementations, provided each such role is a deliberate, visible composition decision rather
than a silent fallback.

#### Scenario: Storage persists to the filesystem through a Host-owned bridge

- **WHEN** a project is saved in the desktop Host and the application is fully closed and
  relaunched against the same storage root
- **THEN** the project reopens with its tracks, clips, placements and trims intact
- **AND** the persisted form lives in the Host's own on-disk layout, written by the main process

#### Scenario: The renderer holds no filesystem capability

- **WHEN** the preload bridge exposed to the renderer is enumerated
- **THEN** it offers store-shaped operations keyed by identifiers, not filesystem paths
- **AND** no renderer-accessible surface accepts or returns an absolute path

#### Scenario: Runtime assets load explicitly from the Host's own serving

- **WHEN** the editor requests a first-party runtime asset by logical path
- **THEN** the Host resolves it to a location under the Host's own scheme and loads its bytes from
  there
- **AND** a copied-asset manifest covering the same allowlist as the Vite build is emitted with
  the Host's production output

#### Scenario: Workers are constructed by the Host at the Host's origin

- **WHEN** a session starts a worker through the runtime-resource port
- **THEN** the Host constructs the worker from a same-origin location under its own scheme or from
  a same-origin `blob:` URL
- **AND** the worker exchanges a message with the session

#### Scenario: The composition overrides rather than wraps the reference roles

- **WHEN** the Host's composition root is read
- **THEN** the desktop-shaped roles are final overrides supplied by the Host
- **AND** every role sourced from the in-memory reference implementations is identifiable in the
  composition root itself

### Requirement: The renderer runs under a narrow content security policy

The desktop Host's renderer SHALL be served from a registered custom scheme rather than `file://`,
and every response under that scheme SHALL carry a committed, narrow content security policy. The
policy SHALL be proven by execution: the editor's boot under it SHALL produce zero violation
reports, and any relaxation of the starting policy SHALL be recorded together with the feature
that forced it.

#### Scenario: The editor boots under the narrow policy

- **WHEN** the production renderer is opened under the Host's scheme with the committed policy in
  force
- **THEN** the editor boots to an interactive timeline with zero CSP violation reports and zero
  console errors

#### Scenario: Relaxations are attributed

- **WHEN** the shipped policy is compared with the narrowest starting set
- **THEN** every added or widened directive names the feature that required it
- **AND** no relaxation is unexplained

### Requirement: The same scenarios pass on the desktop Host

The desktop Host SHALL run the same scenario suite as the existing Hosts, through the same
harnesses rather than Host-private copies: the parity scenario's interactions (create, import,
multi-track edit, preview, save, reload and reopen), and the agent scenario (`automate`) through
the shared surface-evidence entry against the S03 transaction API — not through a Host-private
automation path. The parity snapshot for the desktop Host SHALL be read from the Host's own
persisted form through the same surface the store itself uses, not from a purpose-built export
path, and SHALL be compared with the Vite Host's snapshot by the unmodified parity diff tool.

#### Scenario: The parity interactions run on the desktop Host

- **WHEN** the parity scenario runs against a production build of the desktop Host
- **THEN** every one of import, drag, trim, split, snap, scrub, playback, save, reload and reopen
  is asserted by automation or evidenced by a capture
- **AND** the scenario passes with only local and first-party assets available

#### Scenario: The persisted snapshot comes from the Host's own storage form

- **WHEN** the desktop Host's parity snapshot is captured
- **THEN** it is read from the filesystem store's own on-disk layout through the page's own bridge
- **AND** the snapshot is normalized and diffed by the same unmodified tool the other Hosts use

#### Scenario: Parity against the Vite Host shows no new semantic movement

- **WHEN** the desktop Host's normalized snapshot is diffed against the Vite Host's
- **THEN** the report shows zero semantic differences outside the already-documented idempotency
  envelope
- **AND** any difference outside that envelope is a defect in this Host, never an accepted update

#### Scenario: The agent scenario runs through the shared evidence entry

- **WHEN** the agent scenario executes on the desktop Host through the shared surface-evidence
  entry with `?scenario=agent`
- **THEN** it drives the session transaction facade over the filesystem store and produces its own
  ledger with every declared step executed and asserted
- **AND** after a full window reload the reopened engine reports the exact committed revision and
  every committed entity is present with its committed values

### Requirement: Migration, disposal and provider-private round-trip pass on the desktop Host

The desktop Host's store SHALL pass the published port-conformance suite on the portable profile
with migration exercised, over the same store class the renderer uses. The provider-private
round-trip SHALL be proven by the suite's opaque-payload case: fields the contract has never heard
of survive a save and reload unchanged. Migration SHALL be proven against a seeded legacy on-disk
record brought forward by the published migration artifacts — the runner's published transform
chain and current-version constant, which the store sequences itself against the on-disk record
in an all-or-nothing pass (the published runner opens IndexedDB directly and cannot run against
a filesystem) — with a failing transform preserving the source record. Session-resource disposal SHALL be proven by reusing the S02 disposal harness
unmodified, composed with the desktop Host's ports.

#### Scenario: Port conformance passes on the portable profile

- **WHEN** the published port-conformance suite runs against the desktop Host's composed ports with
  a disposable filesystem-store fixture and migration exercised
- **THEN** every case passes or is explicitly skipped with a stated reason
- **AND** no port role reports zero cases

#### Scenario: Provider-private payload round-trips

- **WHEN** a project record carrying nested, unknown-to-the-contract fields is saved and reloaded
- **THEN** every field is present unchanged
- **AND** the store neither normalizes, validates nor reshapes the payload

#### Scenario: A legacy on-disk record migrates forward

- **WHEN** a record written in an older schema version is opened by the store
- **THEN** it is brought to the current version by the store sequencing the published migration transform chain, all-or-nothing
- **AND** a deliberately failing transform leaves the source record intact and reports the failure

#### Scenario: The S02 disposal harness runs unmodified

- **WHEN** the disposal harness is mounted in the desktop Host with the Host's composition and run
  through its cycles and negative controls
- **THEN** the harness code is the package's own, not a Host copy
- **AND** the oracle reports no leaked timers, workers, audio contexts or object URLs across
  cycles, and the durable-reopen proof passes against the filesystem store

### Requirement: Desktop Host non-coverage is stated

The change SHALL record, in committed documentation, what the desktop Host does not prove, naming
the owner of each excluded claim, so that silence is not read as coverage.

#### Scenario: Non-coverage is written down with owners

- **WHEN** the desktop Host's documentation is read
- **THEN** it states that no CI leg runs the Host's scenarios (owned by the third-party-conformance
  and examples children)
- **AND** it states that no installer, signing or auto-update packaging is built or claimed
- **AND** it states that consumption from installed tarballs is not tested here (the
  third-party-conformance child owns it)
- **AND** it states which runtime facilities the scenarios do not exercise (including the
  transcription worker) rather than leaving them implied

