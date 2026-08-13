# sdk-package-boundary Specification

## Purpose
TBD - created by archiving change s05-package-boundary-freeze. Update Purpose after archive.
## Requirements
### Requirement: Declared package split

The repository SHALL declare exactly three publishable packages under `packages/`, in a fixed layer
order, with the Classic provider separable from the frozen contract surface:

| layer | package | role |
| ---: | --- | --- |
| 0 | `@opencut/editor-ports` | the Host port contract a Host author implements |
| 1 | `@opencut/editor-contracts` | domain, operations, transactions, draft, engine, conformance, vectors |
| 2 | `@opencut/editor-classic` | the OpenCut Classic provider and its React editor, including the embeddable Surface |

Each package SHALL carry a `package.json` with a `0.x` version, `"private": true`, an `exports` map
and a `files` field. Layer 0 and layer 1 SHALL declare no dependency on React, on any DOM API, or on
any editor-UI module.

#### Scenario: The three manifests exist and declare the layer order

- **WHEN** `packages/` is inspected at the ship commit
- **THEN** `packages/editor-ports/package.json`, `packages/editor-contracts/package.json` and
  `packages/editor-classic/package.json` exist
- **AND** each declares a `0.x` version, `"private": true`, an `exports` map and a `files` field
- **AND** `packages/boundary.json` declares the layer order `editor-ports`, `editor-contracts`,
  `editor-classic`

#### Scenario: The base layer is React-free and dependency-free

- **WHEN** the manifests for `@opencut/editor-ports` and `@opencut/editor-contracts` are read
- **THEN** neither declares `react`, `react-dom`, or `@opencut/editor-classic` in any dependency
  field
- **AND** no source file owned by either package imports `react`, `react-dom`, a DOM global, or a
  module owned by `@opencut/editor-classic`

#### Scenario: A third package is not silently introduced

- **WHEN** a fourth entry appears under `packages/` with a `package.json`
- **THEN** the package-boundary check fails, because the package is absent from
  `packages/boundary.json`'s declared layer order

### Requirement: Declared source ownership

`packages/boundary.json` SHALL assign every module under `apps/web/src` to exactly one package or to
a consumer application, by longest-prefix path match with file-level overrides, and SHALL record a
reason for each entry. The ownership declaration SHALL NOT assign any Host-shell path — the Next app
router, marketing site, blog, database, authentication or landing components — to a package.

#### Scenario: Every editor module is owned

- **WHEN** the ownership declaration is evaluated against the tracked and uncommitted source tree
- **THEN** every `.ts` / `.tsx` file under `apps/web/src` resolves to exactly one owner
- **AND** an unowned file causes the check to fail rather than to be skipped

#### Scenario: The Host shell cannot be claimed by a package

- **WHEN** an ownership entry assigns `apps/web/src/app`, `apps/web/src/site`, `apps/web/src/blog`,
  `apps/web/src/db`, `apps/web/src/auth` or `apps/web/src/components/landing` to any package
- **THEN** the check exits with a configuration error before scanning, rather than reporting a pass

#### Scenario: The Host port contract module travels with the ports package

- **WHEN** ownership is resolved for `apps/web/src/editor/host/editor-host.ts`
- **THEN** its owner is `@opencut/editor-ports`
- **AND** the module cycle between `editor/ports/index.ts` and `editor/host/editor-host.ts` does not
  become a package cycle

### Requirement: Acyclic dependency direction, mechanically asserted

A committed check script SHALL assert that every import edge crossing a package boundary points to a
strictly lower declared layer. The assertion SHALL run over the current source tree — tracked and
uncommitted — and SHALL NOT depend on source having been moved into `packages/` first.

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

### Requirement: Public entry points and no deep imports

Each package's public surface SHALL be exactly the subpaths its `exports` map declares. No consumer
SHALL reach a package's internals through a subpath the `exports` map does not declare, and no
declared entry SHALL re-export a module owned by another package's internals.

Within the `0.x` range, a declared entry SHALL NOT be removed, renamed, or repointed at a different
module; adding a new entry is permitted.

#### Scenario: Declared entries cover every existing cross-package consumer

- **WHEN** the specifiers that currently cross into `@opencut/editor-ports` and
  `@opencut/editor-contracts` from outside are enumerated
- **THEN** each resolves to a declared entry, or appears in the change's recorded list of specifier
  rewrites owed by the extraction child

#### Scenario: A deep import into package internals fails the check

- **WHEN** a consumer imports a subpath of a package that its `exports` map does not declare
- **THEN** the check reports it under the `public-entry-only` rule and exits non-zero

#### Scenario: A public entry re-exporting another package's internals fails the check

- **WHEN** a declared entry re-exports a module owned by a different package and not itself declared
  as an entry of that package
- **THEN** the check reports it under the `no-internal-reexport` rule and exits non-zero

### Requirement: Elftia-absence import rule

No package, Host or example SHALL import an Elftia package, an Elftia protocol identifier, or an
Elftia runtime object, and no Elftia package SHALL appear in the resolved dependency graph. The rule
SHALL match import specifiers, dependency names and identifiers — never raw substrings of file
content — and SHALL carry no exception for `adapter-elftia`.

#### Scenario: The repository is clean of Elftia coupling

- **WHEN** the check scans every tracked and uncommitted source file and every `package.json` and
  lockfile entry
- **THEN** it reports zero Elftia import specifiers, zero Elftia dependency names, zero Elftia
  protocol identifiers and zero Elftia runtime-object accesses

#### Scenario: An Elftia import is caught

- **WHEN** a file imports `@elftia/shared`, `elftia`, or a package matching `elftia-plugin-*`
- **THEN** the check reports it under the `no-elftia-import` rule and exits non-zero

#### Scenario: An Elftia dependency is caught

- **WHEN** any `package.json` declares a dependency whose name is an Elftia package
- **THEN** the check reports it under the `no-elftia-import` rule and exits non-zero

#### Scenario: Prose about Elftia is not a violation

- **WHEN** a source comment, a Markdown document, or an absolute filesystem path inside a generated
  artifact contains the word "elftia"
- **THEN** the check reports no violation, because the rule matches specifiers, dependency names and
  identifiers rather than file text

### Requirement: Controls for every rule

The check script SHALL provide a negative control that demonstrates each rule firing on a synthetic
violation, and a converse control that demonstrates each rule staying silent on a synthetic legal
case. Controls SHALL run against the same scanning function the live run uses.

#### Scenario: The negative control demonstrates every rule fires

- **WHEN** `node script/check-package-boundary.mjs --negative-control` runs
- **THEN** it reports a caught violation for each of `acyclic-direction`, `public-entry-only`,
  `no-internal-reexport`, `no-elftia-import` and `react-free-base`
- **AND** it exits non-zero if any rule fails to fire

#### Scenario: The converse control demonstrates no false positives

- **WHEN** `node script/check-package-boundary.mjs --converse-control` runs
- **THEN** it reports silence for a legal downward edge, a declared-entry import, an Elftia mention
  in prose, and a React import inside `@opencut/editor-classic`
- **AND** it exits non-zero if any of those produces a hit

### Requirement: Existing boundaries survive

Introducing the package boundary SHALL NOT weaken any boundary already enforced. In particular the
`no-desktop-app` rule in `check-distributable-boundary.mjs` SHALL survive unchanged, and
`apps/desktop` SHALL NOT be assigned to any package.

#### Scenario: All existing static checkers stay green

- **WHEN** the existing static checkers are run at the ship commit
- **THEN** every one of them passes, with no rule removed, relaxed, or allowlisted to accommodate
  the new package boundary

#### Scenario: The GPUI experiment is not promoted

- **WHEN** `packages/boundary.json` is read
- **THEN** no ownership entry references `apps/desktop`
- **AND** `check-distributable-boundary.mjs` still carries its `no-desktop-app` rule with its stated
  reason

### Requirement: Stated non-coverage

The change SHALL state in committed documentation what the package boundary does not verify, naming
the owner of each excluded claim, so that silence is not read as coverage.

#### Scenario: Non-coverage is written down with owners

- **WHEN** `BOUNDARIES.md`'s package-boundary section is read
- **THEN** it states that the "delete `adapter-elftia` and both Hosts still work" removal test
  belongs to Elftia-side integration CI in the E5/S07 era and is not evidence this repository can
  produce
- **AND** it states that resolution from an installed tarball is not asserted here and is owned by
  the third-party-conformance child
- **AND** it states that no behavioural or parity claim is made by this boundary

