# upstream-provenance Specification

## Purpose
TBD - created by archiving change s01-vite-portability-baseline. Update Purpose after archive.
## Requirements
### Requirement: Pinned upstream identity is recorded

The repository SHALL record its exact upstream source baseline, the extraction method used, and
which upstream areas are retained versus removed, in a committed `UPSTREAM.md` at the repository
root.

#### Scenario: Upstream pin is stated exactly

- **WHEN** a reviewer opens `UPSTREAM.md`
- **THEN** it names the source repository `OpenCut-app/opencut-classic`, the full commit
  `cf5e79e919144200294fb9fed22a222592a0aeea`, the extraction method, and the retained/removed area
  lists

#### Scenario: Toolchain is recorded

- **WHEN** a reviewer opens `UPSTREAM.md`
- **THEN** it records the supported bun, Node, Rust and wasm-pack versions used to produce the
  build evidence

### Requirement: Original license and copyright are preserved

The repository SHALL retain the upstream MIT license text and copyright notice unmodified.

#### Scenario: MIT notice is intact

- **WHEN** the root `LICENSE` file is compared against the file at the pinned upstream commit
- **THEN** the license text and the `Copyright 2025-2026 OpenCut` notice are byte-identical

### Requirement: Every local behavioral modification is patch-logged

A committed patch log SHALL map each local behavioral modification of upstream code to its
rationale and its verification. A modification with no rationale or no verification is not
acceptable.

#### Scenario: Patch log covers a modified upstream file

- **WHEN** any file that existed at the upstream pin has been modified in a way that changes
  behavior
- **THEN** `PATCHES.md` contains an entry naming the file path, the change, the acceptance clause
  that forces it, and the check or test that verifies behavior is preserved

#### Scenario: Patch log is complete

- **WHEN** the set of behaviorally modified upstream files is compared against the patch log entries
- **THEN** every modified file appears in the log

### Requirement: Dependency and asset inventory distinguishes code from assets and codecs

A committed SBOM/dependency inventory SHALL list the distributable dependency set and SHALL
distinguish code dependencies from fonts/assets and from codecs.

#### Scenario: Inventory separates categories

- **WHEN** a reviewer opens the SBOM
- **THEN** code dependencies, font/asset dependencies and codec dependencies are listed in
  distinguishable groups

#### Scenario: Known upstream metadata defects are recorded, not silently repaired

- **WHEN** a reviewer looks for the known upstream metadata defects
- **THEN** the SBOM records the root `package.json` self-dependency (`"opencut": "."`), the
  root-level `next` and `better-auth` entries, the wasm crate `repository` field pointing at the
  stale `github.com/opencut/opencut`, and the published package `sideEffects` reference to a
  nonexistent `./snippets/*`
- **AND** none of these have been altered in the working tree as an undocumented fix

### Requirement: AGPL reference source is classified and mechanically excluded

The repository SHALL classify `0xsline/OpenChatCut@85ee5dfaf5e78d880a8900bfc7048ab62d77405a` as an
AGPL clean-room design reference only, and SHALL provide a re-runnable check proving no AGPL or
Remotion-derived implementation entered the distributable graph.

#### Scenario: Reference is classified

- **WHEN** a reviewer opens `REFERENCE_SOURCES.md`
- **THEN** it names the OpenChatCut commit, states the AGPL classification, and states that no
  source, test, prompt, style, asset or Remotion-based implementation may enter the distributable
  graph

#### Scenario: No-copy check passes

- **WHEN** the reference-boundary check script is run
- **THEN** it reports no reference to an OpenChatCut checkout path, no `remotion` package in any
  manifest or lockfile, and no AGPL license header in any source file
- **AND** it exits non-zero if any of those are found

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

### Requirement: The pinned type-diagnostic baseline records the pin, not the working tree

The recorded set of type diagnostics captured at the upstream pin SHALL remain a record of the pin. It
SHALL NOT be re-captured or edited in order to absorb a deliberate repair, because the pin has not
changed and re-capturing would reproduce the same set while destroying the ability to see what the
repair resolved.

#### Scenario: The baseline fixture is unchanged by a repair

- **WHEN** inherited type defects are repaired
- **THEN** the pinned diagnostic fixture is byte-identical to its pre-repair content, and the recorded
  pin commit in it is unchanged

#### Scenario: A repaired defect appears as an enumerated resolved entry

- **WHEN** the type-baseline check is run after the repair
- **THEN** it passes, reports the reduced current count against the pin's count, and lists each
  diagnostic that is now absent
- **AND** the change records that list and states which repair resolved each entry

#### Scenario: Diagnostics that remain are accounted for

- **WHEN** diagnostics from the pin are still reported after the repair
- **THEN** each is named together with why it is out of scope for this change

#### Scenario: A fully green type gate does not silently change the patch set

- **WHEN** the repairs would leave no diagnostic at all
- **THEN** that is reported as a finding, because the check's anti-vacuity guard fails when every
  baseline diagnostic disappears at once
- **AND** the ratified patch that skips the build's type gate is not removed as a consequence of the
  repair

### Requirement: Repairing a donor code defect does not repair a recorded metadata defect

The upstream metadata defects recorded as deliberately unrepaired SHALL remain unrepaired by a code
defect repair, including where one of them is the root cause of a diagnostic the repair leaves behind.

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
- **THEN** the change names that metadata defect as its cause and states that repairing the diagnostic
  would require altering a defect the provenance record requires to stay unaltered

### Requirement: The known-defects record states the current disposition of each defect

The repository's known-upstream-defects record SHALL state, per defect, whether it is recorded and
unrepaired or repaired, and where repaired, SHALL point at the patch log entry and the evidence.

#### Scenario: Disposition is unambiguous per defect

- **WHEN** a reviewer reads the known-defects record after a repair
- **THEN** each listed defect states either that it remains recorded and unrepaired, or that it has
  been repaired, with the patch identifier and the verifying evidence named
- **AND** no defect is left described as unrepaired when it has been repaired

#### Scenario: A corrected defect count is visible in the record

- **WHEN** the recorded number of defect sites was wrong
- **THEN** the record carries the corrected number and states that the earlier number was wrong, rather
  than being quietly replaced

### Requirement: A derived inventory of modified files is regenerated after the commit that changes it

Any committed document whose content is derived from a comparison against the upstream pin SHALL be
regenerated after the commit that changes the compared set, and the regenerated content SHALL be
committed.

#### Scenario: The inventory matches the committed tree

- **WHEN** the derived inventory is regenerated a second time with no source edits in between
- **THEN** its content is unchanged, showing it was generated against the committed state rather than
  an uncommitted one

#### Scenario: File enumeration cannot silently scan nothing

- **WHEN** a check or generator enumerates repository files
- **THEN** it enumerates tracked and untracked-but-not-ignored files, so that a file which is not yet
  committed is still seen
