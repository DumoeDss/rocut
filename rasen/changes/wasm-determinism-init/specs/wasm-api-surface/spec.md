# wasm-api-surface — delta

## ADDED Requirements

### Requirement: The recorded surface covers both entries and their routing

The surface gate SHALL record the explicitly-instantiating entry alongside the bundler entry: its
exact bytes, that the two entries re-export the identical set, that it performs the initialization
it exists to perform, and the exact export-condition routing that decides which consumer reaches
which entry — including the order of those conditions, because order decides resolution. Each rule
SHALL have a deliberate negative control that causes the gate to fail.

#### Scenario: A drifted second entry is rejected

- **WHEN** the explicitly-instantiating entry re-exports a name the bundler entry does not, or
  omits one it does
- **THEN** the surface gate exits non-zero and names the parity rule

#### Scenario: An entry that resolves but never initializes is rejected

- **WHEN** the explicitly-instantiating entry no longer sets the glue's wasm handle or no longer
  runs the start function
- **THEN** the surface gate exits non-zero, because that is the exact shape of the original defect:
  it imports cleanly and dies on first call

#### Scenario: Swapped, dropped or added conditions are rejected

- **WHEN** a condition is pointed at the other entry, the declared explicit subpath is removed, the
  wildcard passthrough is removed, or a condition that bundlers also claim is added
- **THEN** the surface gate exits non-zero in each case and names the routing rule

### Requirement: Recorded values state how they were derived

Every pinned value in the surface contract SHALL be re-derivable by a reader from a written
procedure, and a value that is corrected SHALL carry the derivation that establishes the previous
value was wrong. Correcting a recorded value by weakening or removing the assertion that caught it
SHALL NOT be an accepted repair.

#### Scenario: A stale recording is corrected, not dropped

- **WHEN** a pinned hash no longer matches the artifact on every platform
- **THEN** the value is re-recorded and the contract states the derivation showing what the old
  value was a hash of
- **AND** the file remains pinned rather than being removed from the pinned set

#### Scenario: The contract names the commands that re-derive it

- **WHEN** a reader wants to check any recorded value
- **THEN** the contract file names the build and comparison commands that reproduce it
