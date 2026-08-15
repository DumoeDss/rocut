## ADDED Requirements

### Requirement: The packages install from packed tarballs outside the monorepo

A committed harness SHALL pack each publishable package with `npm pack`, install the resulting
tarballs into a scratch project located outside the repository tree and outside any Temp
directory, with no workspace linking, and run the conformance evidence from that project. The
scratch root SHALL be configurable by environment so the harness carries no machine-specific
default, and each run SHALL start from a fresh scratch project the harness itself created. The
packed tarballs SHALL be the artifacts `npm pack` produced, unmodified — no post-pack manifest
rewriting.

#### Scenario: The scratch install resolves without the workspace

- **WHEN** the harness packs the three packages and installs the tarballs into a fresh scratch
  project using its recorded mechanism for cross-package `workspace:` dependencies
- **THEN** every `@opencut/*` package resolves inside the scratch project's own `node_modules`
- **AND** the run's import step succeeds against those copies

#### Scenario: Nothing resolves through the workspace

- **WHEN** the installed copies are inspected after installation
- **THEN** each `@opencut/*` package is a real directory copy rather than a symlink or junction
- **AND** a control run that removes the installed copy of one package fails to resolve it
- **AND** that failure is recorded, proving the run depended on the tarball install rather than
  on reaching into the monorepo

#### Scenario: The scratch root is provably outside the tree

- **WHEN** the harness resolves its scratch root
- **THEN** it asserts the root is neither inside the repository nor inside any Temp directory,
  and refuses to run otherwise
- **AND** a pre-existing root the harness did not create is wiped and recreated rather than
  reused

### Requirement: Pack evidence is digest-manifested and machine-independent

The harness SHALL record, as committed evidence, each packed tarball's name, version, npm shasum
and integrity, and a per-file inventory with SHA-256 — the digest manifestation of the narrow
published reading. The harness SHALL be CI-ready — root, tarball output and adapter location all
env-configurable, one entry-point command, self-logged exit codes — while this change itself adds
no CI step and claims none.

#### Scenario: The tarball manifest is complete and committed

- **WHEN** the harness completes a pack
- **THEN** the evidence records every tarball with its shasum, integrity, file count and
  per-file SHA-256 inventory
- **AND** re-packing the same tree reproduces the recorded digests

#### Scenario: Exit codes are self-logged

- **WHEN** any harness step runs
- **THEN** its real exit code is written into the evidence log by the step itself
- **AND** a step that crashed without its logged code is treated as failed evidence regardless of
  the wrapper's exit status

#### Scenario: No CI leg is claimed

- **WHEN** this change's non-coverage statement is read
- **THEN** it names the examples child as the owner of adding the CI execution leg, reusing this
  harness
- **AND** nothing in this change runs on push

### Requirement: The corpus and contract surface are consumable from an installed package

The transaction-vector corpus and the frozen contract surface SHALL be reachable from an
installed package through declared export entries: a corpus entry returning the manifest text and
corpus file texts as **exact file bytes**, and a data-form published contract surface. The
published forms SHALL be guarded in-repository: the published surface SHALL equal the surface
parsed from the contract's real sources, and the published corpus text SHALL load cleanly through
the published loader with the manifest digest matching.

#### Scenario: An installed consumer obtains the corpus without this repository

- **WHEN** a consumer in the scratch project imports the corpus entry from the installed package
- **THEN** it receives the manifest text and every corpus file's exact bytes
- **AND** loading them through the published loader succeeds with the manifest's corpus digest
  matching the recomputed digest

#### Scenario: The published surface cannot drift from the contract

- **WHEN** the in-repository drift guard runs
- **THEN** the published contract surface equals the surface parsed from the contract's source
  files
- **AND** the published corpus text byte-matches the committed corpus files
- **AND** a contract export added without updating the published surface fails the guard

#### Scenario: The entry is attributed

- **WHEN** the export-map additions are compared with the frozen maps
- **THEN** each added entry names the consumer that required it
- **AND** no entry was removed, renamed, or repointed

### Requirement: Conformance failures name the violated requirement

A published requirement index SHALL map every case name each conformance suite can report to the
frozen requirement that case exercises, and a published formatter SHALL render a suite report's
failures as requirement, case and detail together. The suites themselves SHALL NOT be edited to
carry the mapping. The index SHALL be guarded: an in-repository test SHALL run each suite against
its reference implementation and refuse any reported case name that has no index entry.

#### Scenario: A failure reads requirement-first

- **WHEN** a suite report containing failures is passed through the published formatter
- **THEN** each failure is rendered naming the frozen requirement, the case, and the detail
- **AND** the rendering contains no stack trace into the packages' internals

#### Scenario: The index cannot drift from the suites

- **WHEN** the index drift guard runs each suite against its reference implementation
- **THEN** every reported case name resolves to an index entry
- **AND** a suite case added or renamed without an index row fails the guard

#### Scenario: The suites are untouched

- **WHEN** this change's diff over the five conformance suite modules is inspected
- **THEN** it is empty
- **AND** the frozen public signatures of S03 and S04 are byte-identical to this change's base

### Requirement: A worked third-party adapter passes every applicable suite from installed tarballs

A worked adapter that is none of the repository's Hosts SHALL be committed as a fixture,
materialized into the scratch project by the harness, and run against all five conformance
surfaces from the installed tarballs. It SHALL implement its own port roles with a deliberately
different internal shape, reuse the published engine over its own store where a suite requires
one, and implement migration over the published migration artifacts under its own sequencing.
Its results SHALL be captured as committed evidence with self-logged exit codes.

#### Scenario: The adapter passes from the scratch project

- **WHEN** the harness runs the worked adapter inside the scratch project against the installed
  tarballs
- **THEN** the ports conformance suite passes on the portable profile, its migration leg
  evidenced as a two-mode pair: in the repository, the migration walker is validated against
  the real 31-step chain through the published `./evidence/wasm-test-mock` entry and the
  wasm-init finding is recorded distinctly; from the installed tarballs, the suite passes with
  the migration leg absent — the skip recorded and named in the run's own output
- **AND** the transaction, engine, draft and vector suites pass over the adapter's own store,
  target and target factory
- **AND** the provider-private opaque payload round-trips through the adapter's differently-shaped
  store unchanged

#### Scenario: The adapter is third-party-shaped

- **WHEN** the adapter's source is inspected
- **THEN** it imports the packages only through declared entries and implements its own storage,
  identifier, asset and diagnostics roles
- **AND** it contains no React, no window dependency, and no parity host profile

#### Scenario: Migration runs without the browser runner

- **WHEN** the adapter's store migrates a seeded legacy record
- **THEN** it sequences the published migration artifacts to the current version under the
  adapter's own control, all-or-nothing and fail-closed
- **AND** a refusing transform is a failure rather than a skipped step

### Requirement: A non-conforming variant fails by name

A deliberately non-conforming variant of the worked adapter SHALL run the same suites as the
base adapter, and the mutation matrix SHALL hold: the variant fails the specific cases its
defect violates, by name, and no case fails that the base adapter passes without cause. The
variant SHALL differ from the base adapter in exactly one conforming dimension, such as a store
that normalizes payloads.

#### Scenario: The normalization variant fails the opacity case

- **WHEN** the variant whose store drops unknown-to-it fields on save runs the ports conformance
  suite
- **THEN** the opaque-payload case fails, named in the report with its requirement
- **AND** the base adapter's passing run of the same case is recorded beside it as the control

#### Scenario: Failures are exactly the declared set

- **WHEN** the variant's full results are compared with the base adapter's
- **THEN** every case that differs fails in the variant
- **AND** each differing case's failure is attributable to the variant's single defect rather
  than to an unrelated breakage
