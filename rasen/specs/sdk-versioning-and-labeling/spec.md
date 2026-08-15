# sdk-versioning-and-labeling Specification

## Purpose
TBD - created by archiving change s05-versioning-and-experimental-labeling. Update Purpose after archive.
## Requirements
### Requirement: Packages carry 0.x versions with a stated compatibility policy

Each publishable package SHALL carry a `0.x` version, and each SHALL ship a README stating the
compatibility policy for the `0.x` range. The policy SHALL define the surface classes and what
each promises within `0.x`: frozen surface is additive-only; provider surface may change in a
minor; experimental surface may change or be removed in a minor. The policy SHALL make no
stability claim beyond itself.

#### Scenario: The version and policy ship with the package

- **WHEN** a package tarball is packed and its contents are inspected
- **THEN** its manifest version is a `0.x` version
- **AND** its shipped README contains the compatibility policy statement naming the three
  surface classes and their `0.x` promises

#### Scenario: The policy states known surface constraints

- **WHEN** the Classic package's policy README is read
- **THEN** it states the known wasm-initialization constraint on the published migration surface,
  as a constraint of the current `0.x` surface rather than as a fix commitment

### Requirement: Every public export entry is classified

Each package SHALL carry a machine-readable surface manifest, shipped with the package, that
classifies every export entry of that package's export map as `frozen`, `provider`, or
`experimental`, with a stated reason. Every symbol-level override SHALL name a symbol the entry
actually exports. A manifest row SHALL NOT name an entry the export map does not declare.

#### Scenario: The manifest is complete over the export maps

- **WHEN** the surface manifest is compared with each package's export map
- **THEN** every declared entry has exactly one classification with a non-empty reason
- **AND** no manifest row names an undeclared entry

#### Scenario: A new entry is classified at birth

- **WHEN** an export entry is added to a package's export map
- **THEN** the surface-label check fails until the new entry carries a manifest classification
  with its forcing reason
- **AND** the failure names the unclassified entry

#### Scenario: Symbol overrides resolve to real exports

- **WHEN** a manifest row carries symbol-level overrides
- **THEN** every overridden name is a symbol the entry actually exports
- **AND** a dangling override fails the check

### Requirement: Non-frozen surface is labeled in the shipped source

Every `provider`- or `experimental`-classified entry SHALL carry a surface-class doc marker in its
entry source file, visible in the source the package ships. `frozen`-classified files SHALL NOT
be edited to carry markers: their classification lives in the manifest, and the frozen
S03+S04 surfaces SHALL remain byte-identical to their state before this change.

#### Scenario: Non-frozen entries carry in-source markers

- **WHEN** the source files of `provider`- and `experimental`-classified entries are read
- **THEN** each carries a surface-class marker naming its class
- **AND** the marker is present in the source as packed in the tarball, not only in the repository

#### Scenario: Frozen files are untouched by labeling

- **WHEN** the four S03+S04 frozen surfaces are compared byte-for-byte with their state before
  this change
- **THEN** they are identical
- **AND** no frozen-classified file was edited to carry a surface marker

#### Scenario: Marker and manifest agree

- **WHEN** the check compares each non-frozen manifest row with its entry file's marker
- **THEN** the classes agree
- **AND** a reclassification that updates the manifest without the marker, or vice versa, fails

### Requirement: An unlabeled experimental export fails the check

A committed check script SHALL enforce the surface-label rules — manifest completeness over the
export maps, class-vocabulary enforcement, marker agreement for non-frozen entries, and
symbol-override validity — refusing to report a pass over an empty scan, and reporting census
counts per package and per class so a coverage collapse is visible. The check SHALL provide a
negative control in which an unlabeled experimental export is caught and a converse control in
which correctly labeled surface, marker-less frozen rows, and prose that mentions a class name
all stay silent.

#### Scenario: An unlabeled experimental export fails

- **WHEN** the negative control materializes an experimental export without its in-source marker,
  and an export entry without any manifest row
- **THEN** the check reports both under its rules and exits non-zero

#### Scenario: Correct labels stay silent

- **WHEN** the converse control runs over properly classified and labeled surface
- **THEN** no rule fires
- **AND** a frozen row without a marker is not a violation, because that is its designed state

#### Scenario: The census is reported and non-vacuous

- **WHEN** the check runs at the ship commit
- **THEN** it reports per-package entry counts and per-class counts reconciling with the export
  maps
- **AND** a run whose scanned set is empty refuses to pass

### Requirement: No stability claim beyond the stated policy

No published material SHALL claim `1.0`, general availability, or stability beyond the stated
`0.x` policy — published material meaning anything a tarball ships, plus the repository-level
package documentation. The sweep SHALL be semantic: each candidate match is read and given a
disposition, because a version string like `0.1.0` contains `1.0` as a substring without being a
claim.

#### Scenario: The sweep covers shipped and repo-level material with dispositions

- **WHEN** the no-stability sweep runs over the tarball-shipped files and the repository-level
  package documentation
- **THEN** every candidate hit carries a recorded disposition
- **AND** no surviving text claims stability beyond the policy

#### Scenario: Repository documentation describes the current tree

- **WHEN** the repository-level `packages/README.md` is read after this change
- **THEN** it no longer states that `packages/*/src` is empty or that modules live under
  `apps/web/src`
- **AND** the figures it states carry their counting method and measurement point

### Requirement: Versions, policy and labels are verified from the packed tarballs

The consumer-facing evidence SHALL be verified from packed tarballs rather than from the
workspace — versions, the policy README, the surface manifest, and in-source markers — reusing
the existing pack module. The change SHALL add no runtime-closure import to any package; if any
is added, its dependency declaration SHALL land in the same commit and the scratch-install
harness SHALL run before the change claims completion.

#### Scenario: The consumer view is proven from the tarball

- **WHEN** the packages are packed and the tarball contents are inspected and extracted
- **THEN** each tarball's version is `0.x`, its README carries the policy, its surface manifest
  classifies exactly its export-map entries, and a non-frozen entry's source marker is present in
  the extracted file
- **AND** the verification reads the tarballs rather than the working tree

#### Scenario: Manifest truth holds

- **WHEN** the packages' dependency blocks are compared with their state before this change
- **THEN** nothing changed except the version fields, because labeling adds no runtime-closure
  import
- **OR** any import added is declared in the same commit with the scratch harness run recorded

