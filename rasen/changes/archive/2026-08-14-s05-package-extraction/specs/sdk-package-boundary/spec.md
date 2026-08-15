## MODIFIED Requirements

### Requirement: Acyclic dependency direction, mechanically asserted

A committed check script SHALL assert that every import edge crossing a package boundary points to a
strictly lower declared layer. The assertion SHALL run over the current source tree — tracked and
uncommitted — and SHALL NOT depend on source having been moved into `packages/` first.

Once source lives under `packages/*/src`, the assertion SHALL resolve ownership for those files and
SHALL resolve `@opencut/*` specifiers through the declared `exports` maps, so that the graph is
judged in whichever coordinates it currently occupies. Package ownership SHALL be derived from the
discovered manifests rather than from a hardcoded package list. The run SHALL report the number of
cross-package edges examined, so that a collapse in coverage is visible even when the rule reports a
pass.

#### Scenario: The current source graph is acyclic under the declared ownership

- **WHEN** `node script/check-package-boundary.mjs` runs at the ship commit
- **THEN** it reports the number of cross-package edges it examined
- **AND** it reports zero edges pointing to an equal or higher layer
- **AND** it exits `0`

#### Scenario: An inverted dependency fails the check

- **WHEN** a module owned by `@opencut/editor-contracts` imports a module owned by
  `@opencut/editor-classic`
- **THEN** the check reports the offending file and specifier under the `acyclic-direction` rule
- **AND** it exits non-zero

#### Scenario: An empty scan is refused rather than passed

- **WHEN** the scan set for a live rule resolves to zero files
- **THEN** the check exits with a distinct configuration failure code rather than reporting a pass

#### Scenario: Files under packages/ are owned rather than invisible

- **WHEN** a file under `packages/<dir>/src` is scanned
- **THEN** its owner resolves to the package whose discovered manifest declares that directory
- **AND** an edge from it to a higher layer is reported as a violation

#### Scenario: Package specifiers are resolved through the export maps

- **WHEN** a file imports `@opencut/<package>` or one of its declared subpaths
- **THEN** the specifier resolves to the module the manifest's `exports` map names
- **AND** the resulting edge is judged for direction like any other cross-package edge

### Requirement: Public entry points and no deep imports

Each package's public surface SHALL be exactly the subpaths its `exports` map declares. No consumer
SHALL reach a package's internals through a subpath the `exports` map does not declare, and no
declared entry SHALL re-export a module owned by another package's internals.

Within the `0.x` range, a declared entry SHALL NOT be removed, renamed, or repointed at a different
module; adding a new entry is permitted, and each addition SHALL name the consumer module that
required it.

Both rules SHALL be live once `packages/` holds source: `no-internal-reexport` SHALL report a
non-zero scan rather than its dormant zero-file line, and a pass reported by either rule over a zero
examined count SHALL NOT be treated as evidence.

#### Scenario: Declared entries cover every existing cross-package consumer

- **WHEN** the specifiers that cross into any package from outside it are enumerated
- **THEN** each resolves to a subpath that package's `exports` map declares
- **AND** no coverage is deferred to a later child, because the extraction has discharged the
  recorded list of specifier rewrites

#### Scenario: A deep import into package internals fails the check

- **WHEN** a consumer imports a subpath of a package that its `exports` map does not declare
- **THEN** the check reports it under the `public-entry-only` rule and exits non-zero

#### Scenario: A public entry re-exporting another package's internals fails the check

- **WHEN** a declared entry re-exports a module owned by a different package and not itself declared
  as an entry of that package
- **THEN** the check reports it under the `no-internal-reexport` rule and exits non-zero

#### Scenario: Neither rule reports a vacuous pass

- **WHEN** the check runs at the ship commit
- **THEN** `public-entry-only` reports a non-zero count of package specifiers examined
- **AND** `no-internal-reexport` reports a non-zero count of files scanned
