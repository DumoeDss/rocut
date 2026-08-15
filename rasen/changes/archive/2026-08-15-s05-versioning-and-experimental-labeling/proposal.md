## Why

Spec §3.6's claim is that an adopter can tell a frozen contract from a Classic-provider
convenience — and today nothing on the public surface says which is which. Measured at this
propose: all three packages carry `0.1.0` with **no stated compatibility policy anywhere**; the
**36 classifiable export entries** (6 ports / 11 contracts / 19 classic, counted from the export
maps, `./package.json` excluded) carry **zero classifications**; and no check exists that would
make an unlabeled experimental export fail. The consumer-facing files the manifests promise
(`README.md` in every `files` list) do not exist — a tarball today ships version numbers and
silence. Two adjacent truths sharpen it: the Classic package mixes S03+S04-frozen surface (the
embeddable Surface, the engine) with provider conveniences behind one undifferentiated export
map, and P3's Direction-level wasm-init finding means at least one published surface
(`./storage/migrations`) carries a real usage constraint no adopter can currently read.

## What Changes

- **A three-class taxonomy for the public surface** — `frozen` (contract surface; additive-only,
  the S03+S04 freeze), `provider` (OpenCut Classic convenience; may change within `0.x` minors),
  `experimental` (explicitly unstable; may change or be **removed** in any `0.x` minor) — each
  with a stated promise in the version policy.
- **A machine-readable surface manifest per package** (`packages/<pkg>/surface.json`, committed
  and **shipped in the tarball**), classifying every export entry with a reason. Fail-closed on
  gaps: an export entry absent from the manifest fails the check, so every future addition is
  classified at birth — the labeling twin of the boundary checker's attribution rule.
- **In-source labels for the non-frozen classes only**: `provider` and `experimental` entries
  carry a `@opencutSurface` doc marker in their entry file, visible in the shipped source.
  **`frozen`-classified files are never touched** — the four S03+S04 frozen surfaces stay
  byte-identical (their classification lives in the manifest), which is what keeps labeling from
  becoming frozen-signature pressure. Pressure to edit a frozen file for labeling is a `failed`
  finding returned to the contract, never a patch.
- **A new family checker, `script/check-sdk-surface-labels.mjs`**: manifest completeness over the
  export maps, class-vocabulary enforcement, marker agreement for non-frozen entries,
  symbol-level override validity, empty-scan refusal, census lines in the house idiom — with
  `--negative-control` (an unlabeled experimental export FAILS — the spec's named evidence) and
  `--converse-control`, joining the existing checker family with the all-green baseline
  preserved.
- **Per-package `README.md` carrying the `0.x` compatibility policy** — making the manifests'
  existing `files` entries real and putting the policy statement where a tarball consumer reads
  it. The policy text also states the known wasm-init constraint on the Classic migration
  surface (P3's Direction finding, recorded as policy truth rather than a bug-tracker note).
- **The version policy's first application**: bump all three packages `0.1.0 → 0.2.0`, recording
  the surface additions since the first freeze as the policy's own minor-bump rule demands —
  exercising the policy once so it is a rule, not decoration. (The alternative — hold `0.1.0` —
  is named in the design and stays conforming; the bump is a decision, not a requirement.)
- **A semantic no-`1.0` sweep** of everything a tarball ships plus the repo-level published
  material (`packages/README.md`, `BOUNDARIES.md`, DECISIONS docs): no stability claim beyond the
  stated policy. Semantic, not substring — `"0.1.0"` contains `1.0`, and that trap is the
  Elftia-substring lesson in miniature. The sweep also refreshes `packages/README.md`, whose
  pre-P1 text still claims "`packages/*/src` is empty".
- **The consumer-view proof runs from the tarballs**, reusing P3's `packSdkTarballs` module
  (never re-implementing packing): versions, policy README, `surface.json` and in-source markers
  verified from the packed inventory and extracted view — not from the workspace. The
  manifest-truth obligation is honored: labels, manifests and READMEs add **no runtime-closure
  imports**; if any package import changes, the dependency is declared in the same commit and the
  scratch harness runs.

## Capabilities

### New Capabilities

- `sdk-versioning-and-labeling`: the `0.x` version policy and its statement in shipped material;
  the three-class surface taxonomy; the per-package surface manifest and in-source labeling with
  frozen files untouched; the checker that makes an unlabeled experimental export fail; the
  no-stability-claim sweep; and the from-tarball consumer-view evidence.

### Modified Capabilities

*(none — no existing requirement changes. The boundary checker's monotone-growth rule already
permits entry additions with attribution; this change adds classification at birth beside it, as
a new capability, not an edit.)*

## Impact

**Added**

- `packages/editor-ports/surface.json`, `packages/editor-contracts/surface.json`,
  `packages/editor-classic/surface.json` (36 entry classifications with reasons), the
  `@opencutSurface` markers in non-frozen entry files, per-package `README.md` (policy text),
  `script/check-sdk-surface-labels.mjs` with both controls.

**Modified**

- The three `package.json`s: version `0.2.0` (the policy's first application) and `surface.json`
  added to `files`. `packages/README.md` (current-tree restatement + policy pointer).
  `BOUNDARIES.md` (labeling section, classification summary, checker-audit row). Root
  `package.json` gains the checker's script entry.

**Untouched, deliberately**

- **The four S03+S04 frozen surfaces, byte-for-byte** (verified by the P2/P3 control method —
  labeling lives in the manifest for exactly this reason). The five conformance suites and P3's
  entries' behavior. The parity harness and Hosts. `rasen/specs/*` (no requirement changes).

**Not covered by this change, stated so silence is not read as coverage**

- `LICENSE`, `NOTICE`, SBOM, and provenance completeness inside tarballs — **P7's**; P5 creates
  the README (a policy statement), not legal artifacts.
- Any fix for the wasm-init Direction finding — LEAD-owned, next Slice; P5 records it as a policy
  constraint, nothing more.
- Automated release tooling (changesets/tagging) — the policy is stated and mechanically checked
  at the surface level; release automation is out of scope.
- CI enforcement — the checker joins the local-only family; any CI leg is P6's decision.
