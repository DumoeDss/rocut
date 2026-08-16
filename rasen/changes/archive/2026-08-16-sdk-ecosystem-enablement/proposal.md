## Why

S05 proved that a third party can install the `0.2.x` SDK from unmodified tarballs and run all
five conformance surfaces, but the proof is still arranged for repository maintainers: the
worked adapter lives under `script/fixtures`, the reusable fakes are not gathered into an
author-facing public entry, and no single guide takes an external author from `npm pack` to a
requirement-first failure report. The SDK needs an executed enablement layer now so an adapter
author can reproduce that proof without reading rocut internals, while S09 remains unopened.

## What Changes

- Add an adapter-author guide that covers the complete tarball-only workflow: pack and stage all
  four artifacts, install through `file:` dependencies and overrides in a repository-external
  scratch project, choose and implement the required ports, run all five suites, and interpret
  failures as frozen requirement → case → detail.
- Promote the minimal reusable contract fakes and fixture factories adapter authors need from
  test-only modules into declared public entries. Every new entry is additive, attributed to a
  concrete template/guide import, classified at birth in `surface.json`, and marked according to
  the existing P5 policy; no frozen signature or package-internal implementation is changed.
- Publish a copyable adapter scaffold derived from P3's conforming flat-JSON-tuple adapter. The
  scaffold owns its representation and port implementations, consumes only declared entries,
  and runs the ports, transaction, engine, draft, and vectors suites from installed tarballs.
- Add a dedicated runner that materializes the scaffold outside the repository, installs freshly
  packed tarballs with the existing no-link controls, type-checks it, and executes every command
  shown in the guide. Wire that runner into the existing `sdk-examples` CI job.
- Correct residual example/runner wording that describes a future registry shape. B1's permanent
  consumer model is `npm pack` → `file:` install with zero workspace links; this change publishes
  or claims no registry behavior.
- Record reproducible baseline, scaffold execution, package-boundary census, controls, full
  regression, and an independent blind-test transcript under this change's `evidence/`.

## Capabilities

### New Capabilities

- `sdk-adapter-author-enablement`: the tarball-only author journey, copyable adapter scaffold,
  public author fakes, five-suite execution, CI enforcement, and independent guide-only blind
  test.

### Modified Capabilities

*(none — existing package-boundary, conformance, labeling, and published-example requirements
remain unchanged and are reused as acceptance gates.)*

## Impact

- New documentation and scaffold paths under an author-facing SDK area, plus a focused
  scratch-install runner and evidence.
- Additive export-map and `surface.json` rows in the package(s) that own the promoted fakes;
  corresponding entry modules carry the required non-frozen `@opencutSurface` marker.
- `.github/workflows/bun-ci.yml` extends the existing Ubuntu `sdk-examples` execution without
  publishing artifacts or adding a registry leg.
- Existing example READMEs and runner comments are updated only where they contradict the
  tarball-only B1 ruling.
- No S06–S09 timeline/editor/export/provider work, no Elftia dependency, no change to the frozen
  S03/S04 public signatures, and no modification of the separate wasm-determinism worktree.
