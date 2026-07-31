## MODIFIED Requirements

### Requirement: The wasm rebuild correspondence result is recorded

`UPSTREAM.md` SHALL record whether the local `rust/` source rebuilds the pinned
`opencut-wasm@0.2.10`, SHALL state the correspondence criterion used, and SHALL state which artifact
is the canonical one the editor consumes. Once the locally built artifact is canonical, the record
SHALL say so explicitly and SHALL state why the published package can no longer be the source — it
is archived upstream and can never gain the exports later work requires.

The correspondence criterion SHALL be equality of the exported symbol set, the emitted type
declaration and the reported version. Binary hash equality SHALL NOT be the criterion. Every
remaining difference SHALL be enumerated and attributed to a named cause; a difference introduced by
a deliberate, in-scope repair SHALL be attributed to that repair rather than treated as a
correspondence failure or left unexplained.

#### Scenario: Rebuild succeeds

- **WHEN** `wasm-pack build rust/wasm --target bundler --out-dir pkg` completes
- **THEN** `UPSTREAM.md` records that the freshly built `opencut_wasm.d.ts` exported declarations
  match the published package's, that both report version `0.2.10`, and that binary hash equality is
  explicitly not the criterion

#### Scenario: Rebuild is not completed

- **WHEN** the required Rust wasm toolchain cannot be installed or the build fails
- **THEN** `UPSTREAM.md` records the attempt, the failure mode and the blocked prerequisite as a
  finding
- **AND** the editor cannot be built, because the locally built artifact is the canonical source —
  the published npm package is no longer a fallback and is not recorded as one

#### Scenario: The canonical artifact is named

- **WHEN** a reviewer opens `UPSTREAM.md`
- **THEN** it states that the editor consumes the artifact built from `rust/`, states when and why
  that replaced the published package, and does not leave the superseded statement standing as
  current

#### Scenario: A deliberate divergence is attributed rather than hidden

- **WHEN** the built package differs from the published one because of a change made deliberately in
  this repository
- **THEN** the record names the difference, names the change that caused it, and distinguishes it
  from an unexplained divergence

### Requirement: Repairing a donor code defect does not repair a recorded metadata defect

The upstream metadata defects recorded as deliberately unrepaired SHALL remain unrepaired by a code
defect repair, including where one of them is the root cause of a diagnostic the repair leaves
behind.

A recorded metadata defect MAY be repaired only by a change whose own scope makes it a live
correctness or release gate, and only with that repair patch-logged, evidenced, and its disposition
updated in the defects record. The defects record SHALL carry a per-defect disposition rather than a
single blanket claim, and the mechanical probe SHALL assert each defect against its declared
disposition — so that both an undocumented repair and a regression of a repaired defect fail
loudly.

#### Scenario: Recorded metadata defects are still present after the repair

- **WHEN** the metadata-defect probe is run after a code defect repair
- **THEN** every metadata defect whose recorded disposition is *unrepaired* is still detected as
  present

#### Scenario: A deliberately repaired metadata defect is detected as repaired

- **WHEN** the metadata-defect probe is run after a metadata defect has been deliberately repaired
- **THEN** that defect's recorded disposition is *repaired*, it names the patch identifier and the
  evidence, and the probe asserts its absence
- **AND** the probe exits non-zero if the defect reappears

#### Scenario: A diagnostic caused by a metadata defect is left in place with its cause named

- **WHEN** a remaining type diagnostic is caused by a recorded metadata defect
- **THEN** the change names that metadata defect as its cause and states that repairing the
  diagnostic would require altering a defect the provenance record requires to stay unaltered
