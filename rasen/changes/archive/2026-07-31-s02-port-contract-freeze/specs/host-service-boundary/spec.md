## MODIFIED Requirements

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
