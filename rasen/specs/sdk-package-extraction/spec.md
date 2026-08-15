# sdk-package-extraction Specification

## Purpose
TBD - created by archiving change s05-package-extraction. Update Purpose after archive.
## Requirements
### Requirement: Source lives in the frozen layout

Every module assigned to a package by `packages/boundary.json` SHALL live under that package's
`src/` directory, and `apps/web/src` SHALL retain only the modules the ownership map assigns to the
`apps/web` consumer. Moves SHALL be recorded as renames so the diff attributes each file to its
origin.

#### Scenario: The three packages hold their assigned source

- **WHEN** the tree is inspected at the ship commit
- **THEN** `packages/editor-ports/src`, `packages/editor-contracts/src` and
  `packages/editor-classic/src` each hold the modules `packages/boundary.json` assigns to them
- **AND** no module assigned to a package remains under `apps/web/src`
- **AND** every module the map assigns to `apps/web` is still under `apps/web/src`

#### Scenario: Every declared export entry resolves to a real module

- **WHEN** each package manifest's `exports` map is resolved against the tree
- **THEN** every declared subpath resolves to an existing file
- **AND** no declared entry has been removed, renamed, or repointed at a different module

#### Scenario: Moves are attributable

- **WHEN** the staged diff is inspected with rename detection
- **THEN** each moved file is reported as a rename from its `apps/web/src` origin rather than as an
  unrelated delete and add

### Requirement: No unresolvable alias survives inside a package

Package source SHALL NOT depend on an alias that exists only in a Host's build configuration. The
`@/`-into-`apps/web/src` alias SHALL be absent from every file under `packages/`, and any
package-local alias used in its place SHALL be declared by the package itself so that it resolves for
a consumer who installs the package rather than links it.

#### Scenario: No package file imports through the Host alias

- **WHEN** every file under `packages/*/src` is scanned for import specifiers
- **THEN** none of them begins with `@/`

#### Scenario: The replacement form is declared by the package

- **WHEN** a package's source uses a package-local alias
- **THEN** that alias is declared in that package's own `package.json`
- **AND** it resolves under the type-checker, the test runner, and both Host bundlers

#### Scenario: The example no longer aliases into another app's source

- **WHEN** `apps/vite-example`'s Vite configuration and `tsconfig.json` are read
- **THEN** neither declares an alias from `@` to `apps/web/src`

### Requirement: Consumers reach packages only through declared entries

`apps/web` and `apps/vite-example` SHALL import package code through `@opencut/*` specifiers that
resolve to declared `exports` subpaths. Where an existing consumer reached a module that no declared
entry covers, the resolution SHALL be to widen a declared entry's barrel, and any newly added entry
SHALL be recorded together with the module that forced it.

#### Scenario: Every consumer import lands on a declared entry

- **WHEN** `node script/check-package-boundary.mjs` runs at the ship commit
- **THEN** `public-entry-only` reports zero violations
- **AND** it reports a non-zero count of `@opencut/*` specifiers examined

#### Scenario: Entry additions are attributed

- **WHEN** the shipped `exports` maps are compared with the frozen ones
- **THEN** any added subpath is accompanied by a written record of the consumer module that required
  it
- **AND** no subpath was added merely to avoid widening an existing barrel

### Requirement: Enforcement follows the source

Every static check whose scan scope was written against `apps/web/src` SHALL be audited, and each
SHALL either follow the source into `packages/` or record why it is deliberately Host-scoped. A check
SHALL NOT report a pass over a scope that the move silently emptied.

#### Scenario: The boundary checker judges the same graph in its new coordinates

- **WHEN** `node script/check-package-boundary.mjs` runs after the move
- **THEN** `acyclic-direction` reports a cross-package edge count of the same order as the pre-move
  census rather than a collapsed one
- **AND** `react-free-base` reports a non-zero count of base-layer files scanned

#### Scenario: The type baseline still watches the moved source

- **WHEN** `node script/check-type-baseline.mjs` runs after the move
- **THEN** it reports how many files it type-checked
- **AND** that count covers the moved package sources rather than only the remaining Host shell

#### Scenario: Every checker's scope decision is recorded

- **WHEN** the checker audit is read
- **THEN** each existing static check is listed with either "scope follows the source" or a stated
  reason for remaining Host-scoped
- **AND** no check is left unaddressed

### Requirement: The dormant boundary rules are proven live

`public-entry-only` and `no-internal-reexport` SHALL be demonstrated to fail on a real violation
introduced into post-move source and to pass again when it is reverted. A passing run whose examined
count is zero SHALL NOT be accepted as evidence for either rule.

#### Scenario: A real deep import is caught and the revert is clean

- **WHEN** a consumer file is given an import of an undeclared `@opencut/editor-classic` subpath and
  the live check is run
- **THEN** `public-entry-only` reports the violation and the check exits non-zero
- **AND** after the import is reverted the check exits zero with a non-zero examined count

#### Scenario: A real internal re-export is caught and the rule is no longer dormant

- **WHEN** a declared entry file is given a re-export of an undeclared subpath of another package and
  the live check is run
- **THEN** `no-internal-reexport` reports the violation and the check exits non-zero
- **AND** after the re-export is reverted the rule reports a pass over a non-zero scan rather than
  the dormant zero-file line

### Requirement: Behaviour does not move

Extraction is a refactor. The editing-parity comparison SHALL show zero semantic differences outside
the already-documented envelope, and the type baseline SHALL NOT grow. Any change to either is a
defect in the extraction rather than an accepted update.

#### Scenario: Parity is unchanged on both Hosts

- **WHEN** the parity and agent specs are run against both the Vite and the Next Host and the
  snapshots are diffed
- **THEN** the report shows zero semantic differences
- **AND** any incidental differences are the ones already classified before the move

#### Scenario: The type baseline does not grow

- **WHEN** the type baseline is compared against its pinned fixture
- **THEN** no new diagnostic is present
- **AND** any difference from the previous run is attributed to a named cause

#### Scenario: Every rewritten specifier resolves to the same module

- **WHEN** the pre-move and post-move import graphs are compared across the rename map
- **THEN** each rewritten specifier resolves to the module it resolved to before the move

#### Scenario: No frozen signature changed

- **WHEN** the public surfaces frozen by the transaction and Surface contracts are compared before
  and after
- **THEN** no signature differs
- **AND** if extraction had required one to differ, that is recorded as a finding returned to the
  contract rather than as a change

### Requirement: Ownership corrections are narrow and attributed

An ownership assignment in `packages/boundary.json` SHALL be corrected only where the module is
reached by no package module, and each correction SHALL appear as a declaration diff with an updated
reason. A correction SHALL NOT be used to avoid widening a declared entry's barrel.

#### Scenario: A correction is justified by callers

- **WHEN** an ownership entry is changed
- **THEN** the record shows that no module owned by any package imports the corrected module
- **AND** the entry's stated reason is updated to say so

#### Scenario: Corrections do not substitute for barrel work

- **WHEN** the set of ownership corrections is compared with the set of consumer imports that needed
  routing
- **THEN** no module was reassigned to a consumer while a package module still imports it

