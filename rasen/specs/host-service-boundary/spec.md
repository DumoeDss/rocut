# host-service-boundary Specification

## Purpose
TBD - created by archiving change s01-vite-portability-baseline. Update Purpose after archive.
## Requirements
### Requirement: Server-backed editor features are configured by the host

Editor features that require a server endpoint SHALL obtain that endpoint from host-supplied
configuration rather than assuming a fixed application route.

#### Scenario: Endpoint is supplied by the Next host

- **WHEN** the editor runs inside the Next application
- **THEN** the sounds panel and the feedback feature use the endpoints the Next host supplies and
  behave as they did at the pinned upstream commit

#### Scenario: Endpoint is absent in the Vite example

- **WHEN** the editor runs inside the Vite example with no server endpoints configured
- **THEN** the affected features do not issue a request to a route that cannot serve them

### Requirement: Unavailable server-backed features degrade visibly and non-blockingly

A feature whose server endpoint is not configured SHALL display an explicit unavailability state,
and SHALL NOT block or interrupt editing.

#### Scenario: Sounds panel shows an explicit unavailable state

- **WHEN** the user opens the sounds panel in the Vite example
- **THEN** the panel displays a message stating the feature requires a server endpoint and is not
  available in this build
- **AND** no misleading parse or network error is shown in its place

#### Scenario: Feedback feature is absent rather than broken

- **WHEN** the editor header renders in the Vite example
- **THEN** the feedback control is either absent or displays an explicit unavailability state, and
  submitting is never offered against a route that cannot accept it

#### Scenario: Editing is unaffected

- **WHEN** any server-backed feature is unavailable
- **THEN** create, import, edit, save, reload and reopen all continue to work

### Requirement: Per-feature handling is recorded

The chosen handling for each server-route-dependent and remote-network-dependent feature SHALL be
recorded.

Once the host seam carries the full port surface rather than server endpoints alone, the record
SHALL also cover every port role the seam carries — storage, asset resolution, runtime resources,
navigation, export, diagnostics, id generation and environment capabilities — stating for each what
a Host must supply and what happens when it supplies nothing.

#### Scenario: Handling record is complete

- **WHEN** a reviewer opens the per-feature handling record
- **THEN** it lists the sounds panel, the feedback feature, the remote sticker/platform icon
  sources, the remote font source and the transcription model download, and states for each whether
  it is excluded or degraded and what the user sees

#### Scenario: Every port role's absence behaviour is recorded

- **WHEN** a reviewer opens the record after the seam carries the port surface
- **THEN** each port role states whether a Host must supply it or may omit it, and what the editor
  does when it is omitted
- **AND** a role whose omission has no defined behaviour is not accepted as recorded

### Requirement: Remote network dependencies are diagnostics, not acceptance

Features depending on third-party remote services SHALL be classified as diagnostics and SHALL NOT
be treated as acceptance criteria for this change.

#### Scenario: Remote-dependent features are classified

- **WHEN** the per-feature handling record is reviewed
- **THEN** remote font, sticker icon, brand icon and transcription model dependencies are marked as
  diagnostics rather than acceptance

#### Scenario: Blocked remote services do not fail acceptance

- **WHEN** the acceptance evidence is produced with all third-party hosts blocked
- **THEN** the acceptance scenario still passes and the degraded remote-dependent features are
  reported as diagnostics
