## ADDED Requirements

### Requirement: The provenance set is regenerated and accurate at the ship commit

The derived provenance artifacts SHALL be regenerated at the code-complete revision and committed
as a delta whose diff touches only generated files — the source inventory, the patch-log
reconciliation, the added-file inventory and the SBOM. The regeneration's inputs (the upstream
pin and the revision it ran against) SHALL be named in the artifacts and in self-certifying logs
that state the tree was clean. A second regeneration with no source edits in between SHALL be
byte-stable.

#### Scenario: The delta commit is generated-files-only

- **WHEN** the regeneration's commit is inspected
- **THEN** its changed-file list contains only generated artifacts
- **AND** the revision the generation ran against is named in the committed log

#### Scenario: The regeneration is stable

- **WHEN** the generators run a second time with no edits in between
- **THEN** the derived artifacts are unchanged
- **AND** the drift counts they report are derived from the generators' own enumeration, with
  method named

### Requirement: The inventory covers the current tree

The inventory's derived areas SHALL cover the tree as it exists at the ship commit, including
the extracted packages, the examples, the script estate and every application, rather than the
pre-extraction layout. Every modified file inherited from the upstream pin SHALL carry a patch-log
row, and every fork-added file SHALL appear in the added-file inventory; the reconciliation SHALL
report both counts by derivation.

#### Scenario: Areas match the shipped layout

- **WHEN** the regenerated inventory's areas are compared with the ship commit's tree
- **THEN** every directory holding shipped or distributed source is covered
- **AND** no area names a location that no longer exists

#### Scenario: Patch rows are complete

- **WHEN** the modified-inherited-file set is compared with the patch log
- **THEN** every modified inherited file has a row, and the reconciliation states the counts
- **AND** a modified inherited file with no row is a recorded finding, not a silent pass

### Requirement: Notices and SBOM are verified inside the packed artifacts

Each package tarball SHALL ship its license and notice files as the `files` field promises, and
the notice set SHALL name the upstream project, the pinned revision, and this fork. Verification
SHALL inspect the packed artifacts — their file listings and extracted contents — rather than the
working tree, for all distributed tarballs including the wasm artifact.

#### Scenario: Every tarball ships its notices

- **WHEN** each packed tarball is listed and extracted
- **THEN** the three editor packages ship both the license file and the notice file
- **AND** the wasm tarball ships its license
- **AND** the license text is byte-identical to the repository's preserved upstream MIT text

#### Scenario: The shipped SBOM describes the shipped lock

- **WHEN** the SBOM is regenerated after the lockfile refresh
- **THEN** it reflects the lockfile's current workspace entries
- **AND** every recorded metadata defect matches its declared disposition

### Requirement: Packed-manifest dependency closure is checked with reachability

A committed check SHALL verify, over the packed tarballs, that every bare specifier the shipped
source imports is declared in the packed manifest or carries a written disposition, and that
every peer of a declared dependency which only unreachable subpaths import is recorded in a
documented-latent register with its reachability reason. A register entry whose peer becomes
reachable SHALL fail the check naming the register row. The check SHALL provide negative and
converse controls, census lines, and empty-scan refusal, joining the static-checker family.

#### Scenario: Undeclared runtime imports fail

- **WHEN** the extracted tarball's shipped source imports a bare specifier the packed manifest
  does not declare
- **THEN** the check fails naming the file and specifier, unless the specifier carries a written
  test-file-only disposition

#### Scenario: Latent peers are registered, and their activation fails

- **WHEN** a declared dependency's peer is imported only by subpaths the package's reachable
  graph never touches
- **THEN** the peer appears in the documented-latent register with its reachability reason
- **AND** a change that makes such a peer reachable fails the check and names the register row

#### Scenario: Controls and census hold

- **WHEN** the check's negative control materializes an undeclared import and a
  register-activation break
- **THEN** both fire and the failing log is committed beside the green run
- **AND** every run reports specifiers scanned, register size and disposition counts

### Requirement: The beta-closure record states delivery, stance, and residuals

A committed beta-closure record SHALL state what the portfolio delivers, restate the no-`1.0`
stance beside the version policy, record the wasm-initialization defect as a carried
Direction-level finding with its documented workaround, and name the residuals with their owners.
The same record SHALL complete the consumer-obligation documentation the published packages'
READMEs owe their adopters.

#### Scenario: Delivery and stance are stated

- **WHEN** the beta-closure record is read
- **THEN** it names the delivered packages with their versions and labeled surface, the
  conformance and examples executable from installed tarballs, the Hosts, and the CI leg
- **AND** it restates that no `1.0` or stability claim is made beyond the published policy

#### Scenario: The carried defect and residuals are named with owners

- **WHEN** the record's findings section is read
- **THEN** the wasm-initialization defect appears with its failure text, its workaround, and its
  Direction-level ownership
- **AND** the lint debt, the local-only checkers, and the single-OS examples job are each named
  with the decision owner that changing them belongs to

#### Scenario: Consumer obligations are documented

- **WHEN** the Classic package's shipped README is read
- **THEN** it names the declaration requirement for the dependency that ships none, the
  stylesheet self-registration without which builds are silently half-styled, the layout wrapper
  requirement, and the empty-scene seed behavior
- **AND** each obligation states the failure an adopter sees when it is missed

### Requirement: Beta closure claims no publish and touches no frozen surface

The closure SHALL NOT publish any artifact to any registry and SHALL NOT perform any irreversible
step. No provenance or documentation sweep SHALL edit the frozen S03+S04 surfaces, whose
byte-identity SHALL be re-proved at close.

#### Scenario: No publish exists

- **WHEN** the change's full diff is inspected
- **THEN** no registry publish, signing, or credential operation appears
- **AND** the beta record states that registry-specific behaviour was never exercised and is
  claimed nowhere

#### Scenario: Frozen surfaces remain byte-identical

- **WHEN** the four frozen S03+S04 surfaces are compared byte-for-byte with their state before
  this portfolio's children
- **THEN** they are identical
- **AND** any pressure that appeared to require editing one was escalated to the contract rather
  than patched
