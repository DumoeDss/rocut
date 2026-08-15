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

Consumer source roots SHALL be derived from the consumer list declared in `packages/boundary.json`
rather than hardcoded path prefixes. Files under any declared consumer root SHALL resolve to that
consumer as their owner, and their package specifiers SHALL be examined as edges like any other
consumer's, so that a consumer declared after the freeze is inside the scan by construction rather
than by a later repair. Adding a consumer root with source under it SHALL grow the reported census.

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

#### Scenario: A consumer added after the freeze is scanned rather than invisible

- **WHEN** a consumer root declared in `packages/boundary.json` after the initial freeze holds
  source files that import `@opencut/*` packages
- **THEN** those files resolve to that consumer as owner without any further checker edit
- **AND** their package imports appear in the examined-edge census, which grows relative to the
  census before the consumer held source

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

The no-deep-import guarantee SHALL hold for source files under every consumer root declared in
`packages/boundary.json`, including consumers declared after the freeze: such files SHALL be inside
`public-entry-only`'s scan set by construction, and declaring a consumer that holds package imports
SHALL grow the rule's examined-specifier count rather than leave the consumer unexamined.

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

#### Scenario: A deep import from a consumer declared after the freeze is caught

- **WHEN** a source file under a consumer root declared after the initial freeze imports an
  undeclared subpath of a package
- **THEN** `public-entry-only` reports that file and specifier and the check exits non-zero
- **AND** after the import is reverted the check exits zero with an examined-specifier count that
  still covers that consumer's files

## ADDED Requirements

### Requirement: Consumer roots are declared, derived, and visible

`packages/boundary.json` SHALL declare every consumer application's source root in its consumer
list, and the boundary check SHALL derive its consumer scan roots from that list rather than from
path prefixes written into the script. A change that adds or moves a consumer root SHALL be a
`boundary.json` diff, and the check's reported census SHALL make the consumer's presence visible:
the file counts it reports SHALL include every declared consumer's source files.

#### Scenario: The consumer list is the single source of scan roots

- **WHEN** the boundary check's consumer-root handling is inspected
- **THEN** every consumer root it scans traces to `packages/boundary.json`'s consumer list
- **AND** no consumer root is reachable only through a literal prefix inside the check script

#### Scenario: Declaring a consumer without source changes nothing observable

- **WHEN** a consumer root is added to the declaration while holding no scanned source files
- **THEN** the check's output is identical to its output before the declaration
- **AND** that control run is recorded as the proof the scope change is behaviour-preserving

#### Scenario: The census reflects every declared consumer

- **WHEN** the check runs with source files present under every declared consumer root
- **THEN** the per-rule file counts reconcile with the files each consumer root actually holds
- **AND** a consumer whose files are absent from a rule's count while present on disk is a scope
  failure even when the rule prints a pass
