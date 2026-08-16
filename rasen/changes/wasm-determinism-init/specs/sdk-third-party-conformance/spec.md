# sdk-third-party-conformance — delta

## MODIFIED Requirements

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
- **THEN** the ports conformance suite passes on the portable profile with its migration leg
  **exercised** — the published migration chain loads from the installed tarballs with no test
  mock in the process, and the run's own output names the chain's step count and target version
- **AND** the transaction, engine, draft and vector suites pass over the adapter's own store,
  target and target factory
- **AND** the provider-private opaque payload round-trips through the adapter's differently-shaped
  store unchanged

#### Scenario: A chain that cannot load is skipped distinctly, never silently

- **WHEN** the migration chain fails to load for any reason
- **THEN** the run records the observed failure with its reason and marks the migration leg as
  skipped by name
- **AND** the remaining surfaces still run, so one unavailable leg does not disguise itself as a
  pass and does not suppress the rest

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
