## MODIFIED Requirements

### Requirement: Existing editor parity is preserved after C3 explicit-handle wiring

C3 SHALL consume C0b's generated provider and handle-keyed compositor surface without editing Rust
or generated WASM. The production editor SHALL move off the no-handle compatibility path while the
legacy handle-0 exports remain available, and canonical editing parity SHALL remain unchanged.

#### Scenario: The production runtime uses explicit handles

- **WHEN** the Next and Vite editor graphs are searched transitively after C3 wiring
- **THEN** session renderers call the handle-keyed compositor surface with tracked nonzero handles
- **AND** no production caller uses the no-handle compatibility exports or default compositor

#### Scenario: The additive compatibility surface remains available

- **WHEN** the generated API contract and negative-control surface checks run
- **THEN** the legacy handle-0 exports and C0b explicit-handle/provider exports retain their exact
  names, arities and semantics

#### Scenario: No runtime implementation is fabricated in TypeScript

- **WHEN** the adapter and Host changes are inspected
- **THEN** backend, capacity and live-handle answers come from the generated C0b runtime
- **AND** no TypeScript shadow table or Host-stamped substitute is accepted

#### Scenario: Parity remains green after wiring

- **WHEN** canonical packages are rebuilt, both Hosts run the existing parity scenario and their
  snapshots are compared
- **THEN** editing output is unchanged from the exact C0b+C2 joint baseline
- **AND** the parity fixture itself was not re-baselined
