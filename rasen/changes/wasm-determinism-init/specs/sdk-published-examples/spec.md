# sdk-published-examples — delta

## MODIFIED Requirements

### Requirement: Example documentation surfaces the labeled surface

Each example's README SHALL list every package entry the example imports with its surface class
and a one-line justification, and no example SHALL read the surface manifest as runtime machinery
for its own behavior — the installing example's manifest read is that example's demonstrated data
(requirement 1's own lesson), not machinery. The custom-storage example SHALL state that its
mock-installed leg depends on an experimental-labeled entry and that the example inherits that
entry's instability, alongside what its two legs now prove: the production path loading the
published chain from the installed tarballs and exercising migration for real, and the
mock-installed path validating the same chain through the published mock entry.

#### Scenario: Consumed-surface tables name classes

- **WHEN** an example's README is read
- **THEN** every `@opencut/*` specifier the example imports appears with its class and a stated
  justification
- **AND** no example reads the surface manifest as runtime machinery for its own behavior —
  the installing example's manifest read is its demonstrated data, not machinery

#### Scenario: The custom-storage example states its experimental inheritance

- **WHEN** the custom-storage example's README is read
- **THEN** it names the experimental entry its mock-installed leg depends on and states the
  inherited instability
- **AND** it describes both legs as they now behave, and records that the production leg's
  distinct-skip path remains as the fail-closed branch rather than being removed

### Requirement: Example non-coverage is stated

The change SHALL record what the examples do not prove, naming owners, so silence is not read as
coverage. A statement of non-coverage that has ceased to be true SHALL be corrected rather than
left standing.

#### Scenario: Non-coverage is written down with owners

- **WHEN** the examples' documentation is read
- **THEN** it states that legal notice content in example files is the provenance child's to
  complete
- **AND** it states that no example covers the desktop Host shape, which the repository's
  electron application already covers

#### Scenario: The repaired wasm-initialization defect is no longer claimed as non-coverage

- **WHEN** the examples' documentation is read after the wasm-initialization repair
- **THEN** it does not state that the defect is demonstrated-but-unrepaired
- **AND** the custom-storage example's production leg is recorded as exercising migration from the
  installed tarballs, which is the observable that changed
