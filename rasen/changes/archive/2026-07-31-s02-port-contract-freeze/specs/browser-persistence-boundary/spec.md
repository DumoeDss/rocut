## MODIFIED Requirements

### Requirement: The persistence boundary is explicitly provisional

The adapter SHALL be documented and labeled in code as provisional, and SHALL NOT be presented as
the final Host port contract.

Once a Host storage port contract exists, the provisional label SHALL attach to the *adapter
implementation* rather than to the absence of a contract, and the boundary documentation SHALL point
at where the storage contract now lives instead of stating that none is published. The adapter
remains provisional until it is retired by the change that inverts the storage dependency; that
retirement is not this requirement's concern.

#### Scenario: Provisional status is stated in code

- **WHEN** a developer opens the adapter module
- **THEN** its header states that it is provisional and will be superseded, and that it is not a
  public Host port contract

#### Scenario: The documentation points at the published storage contract

- **WHEN** a reviewer reads the boundary documentation after a storage port contract has been
  published
- **THEN** it names where that contract lives and states that the adapter is a provisional
  implementation awaiting retirement
- **AND** it does not state that no storage contract is published, which would be false
