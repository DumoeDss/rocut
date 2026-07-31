## MODIFIED Requirements

### Requirement: The wasm rebuild correspondence result is recorded

`UPSTREAM.md` SHALL record whether the local `rust/` source rebuilds the pinned
`opencut-wasm@0.2.10`, SHALL state the correspondence criterion used, and SHALL state which artifact
is the canonical one the editor consumes. Once the locally built artifact is canonical, the record
SHALL say so explicitly and SHALL state why the published package can no longer be the source: it
is archived upstream and can never gain the exports later work requires.

The C0 before-state correspondence criterion SHALL remain equality of the exported symbol set, the
emitted type declaration and the reported version. Binary hash equality SHALL NOT be the criterion.
Every remaining difference SHALL be enumerated and attributed to a named cause. C0b's deliberate
handle-keyed compositor operations, runtime-query providers and teardown exports SHALL be recorded
as an exact generated delta from that before-state rather than being hidden by rewriting the
correspondence baseline.

#### Scenario: Rebuild succeeds

- **WHEN** `bun run build:wasm` completes through the canonical wrapper
- **THEN** `UPSTREAM.md` preserves the C0 result that the before-state
  `opencut_wasm.d.ts` exported declarations matched the published package, both reported version
  `0.2.10`, and binary hash equality was explicitly not the criterion
- **AND** it separately enumerates the exact C0b declaration/export/import/generated-file delta

#### Scenario: Rebuild is not completed

- **WHEN** the required Rust wasm toolchain cannot be installed or the canonical build fails
- **THEN** `UPSTREAM.md` records the attempt, failure mode and blocked prerequisite as a finding
- **AND** the editor cannot be built, because the locally built artifact is canonical and the
  published npm package is not a fallback

#### Scenario: The canonical artifact is named

- **WHEN** a reviewer opens `UPSTREAM.md`
- **THEN** it states that the editor consumes the artifact built from `rust/`, states when and why
  that replaced the published package, and does not leave the superseded statement standing as
  current

#### Scenario: A deliberate divergence is attributed rather than hidden

- **WHEN** the built package differs from the published one because of a deliberate repository
  change
- **THEN** the record names the exact difference, names the change that caused it, and distinguishes
  it from an unexplained divergence

#### Scenario: C0b has one exact attributed surface delta

- **WHEN** the canonical package is rebuilt after `s02-wasm-api-surface`
- **THEN** the recorded delta contains every added handle operation, provider declaration and
  teardown export, plus any changed binary import/export or generated file
- **AND** a second generated comparison finds no unrecorded difference
