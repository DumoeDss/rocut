# distributable-runtime-bundle — delta spec

> New capability. Follows the `elftia-plugin-director/scripts/pack.mjs` precedent
> (two-file runtime with a load-bearing sibling, commit-pinned provenance, smoke) and
> rocut's own `script/pack-sdk-tarballs.mjs` precedent (gitignored output dir,
> committed manifest, determinism control).

## ADDED Requirements

### Requirement: The CLI packs into a runnable distribution

The repository SHALL provide `script/pack-runtime.mjs` producing a distribution
directory (gitignored; the committed record is the evidence manifest) containing the
CLI bundled with esbuild (platform node, ESM, bundle format with code splitting so the
lazy storage-migration closure stays a separate chunk), the `opencut_wasm_bg.wasm`
file as a sibling of that chunk under its load-bearing name, the prebuilt editor
surface distribution copied verbatim when present, and a PROVENANCE.md. The bundle
SHALL be runnable with bun from the distribution directory without the repository or
its node_modules.

#### Scenario: The packed CLI runs standalone

- **WHEN** the packed entry is executed with bun from the distribution directory with
  a temp `ROCUT_TARGETS_ROOT` and no access to the repository tree
- **THEN** `target list` runs and reports no targets

#### Scenario: ensure round-trips from the packed CLI

- **WHEN** the packed CLI runs `host ensure` twice against a temp project directory
- **THEN** both runs exit 0, the second prints the first's target id and `editorUrl`,
  and exactly one daemon process and one registry entry exist

#### Scenario: The wasm sibling stays a separate load-bearing file

- **WHEN** the packed output is inspected
- **THEN** the lazy migration chunk references `opencut_wasm_bg.wasm` by sibling
  filename and that file is present beside it unmodified (byte-equal to
  `rust/wasm/pkg/opencut_wasm_bg.wasm`)

#### Scenario: The surface ships when built

- **WHEN** the packer runs and a prebuilt editor surface dist exists
- **THEN** it is copied verbatim into the distribution and recorded in the provenance
  manifest
- **AND** when no surface dist exists and `--skip-surface` was not passed, the packer
  fails with build instructions rather than producing a surface-less distribution
  silently

### Requirement: Provenance and determinism are recorded

The packer SHALL refuse to pack a dirty source tree and SHALL write PROVENANCE.md
recording the exact source commit, the esbuild version, the toolchain, and a per-file
SHA-256 manifest, with the explicit claim that the source commit plus the recorded
esbuild version reproduce the bundles (commit+esbuild reproducible) rather than any
byte-copy claim. A determinism control SHALL pack the same clean tree twice and
record that the digests reproduce.

#### Scenario: A dirty tree is refused

- **WHEN** the packer runs against a checkout with uncommitted changes
- **THEN** it exits non-zero without writing a distribution, naming the precondition

#### Scenario: PROVENANCE pins source and toolchain

- **WHEN** a pack completes
- **THEN** PROVENANCE.md contains the source commit, the esbuild version, and a
  SHA-256 line for every distributed file
- **AND** its claim is commit+esbuild reproducibility, not byte-copy equivalence

#### Scenario: Packing is deterministic

- **WHEN** the packer runs twice over the same clean tree into separate output
  directories
- **THEN** the per-file SHA-256 manifests are identical
