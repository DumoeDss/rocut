## 1. Baseline and public-surface inventory

- [x] 1.1 Record the clean `661d7ac8` P3 scratch run and P6 four-example run with real exit codes, no-link controls, suite populations, surface census, and the known wasm-init skip in `evidence/baseline.md`.
- [x] 1.2 Inventory every adapter-author fake/fixture in ports and contracts, classify it as already public / keep internal / promote, and record the forcing consumer for the single selected public entry.
- [x] 1.3 Capture the pre-change contracts manifest/version/export map and frozen-surface hashes so later additive-only and byte-identity claims have a reproducible before half.

## 2. ProjectStore-backed contract fakes

- [x] 2.1 Add failing interface-level tests for fresh-store isolation, same-store reopen, engine/draft option forwarding, save/fail/pause observation, draft counter reset, vector seeded/relative opens, and setup-error legibility.
- [x] 2.2 Implement `@opencut/editor-contracts/conformance/fakes` with `createProjectStoreConformanceFactories({ createStore })`, hiding native seed/capture/counter/vector-driver mechanics behind existing frozen factory types.
- [x] 2.3 Replace duplicated engine/draft fixture assembly in the requirement-index guard with the new module and keep every requirements-index case populated and green.
- [x] 2.4 Add the attributed export-map row, `experimental` surface row and source marker; bump contracts to `0.3.0`, update per-package version expectations and the contracts README census without changing ports/classic versions.
- [x] 2.5 Run package tests, scoped typecheck, surface-label checker with negative/converse controls, package-boundary checker with negative/converse controls, packed consumer view, and frozen-byte comparison; record non-zero populations.

## 3. Copyable adapter project scaffold

- [x] 3.1 Create `templates/adapter-project/` from the P3/P6 flat-JSON-tuple adapter seed with a standalone manifest, TypeScript config, source inventory, customization map, and LF-only files.
- [x] 3.2 Route scaffold engine/draft/vector suites through the new ProjectStore-backed fakes while keeping ports and transaction suites on the scaffold's author-owned roles/store/target.
- [x] 3.3 Integrate the PR #3 wasm-init repair: the production leg loads the real chain and exercises migration, its distinct-skip branch remains fail-closed, and the mock-installed compatibility leg retains its documented experimental inheritance.
- [x] 3.4 Add a deterministic non-conforming/failure demonstration whose formatter output is frozen requirement → case → detail and contains no internal stack-trace guidance.
- [x] 3.5 Add an executable seed/drift guard proving the scaffold retains the P3 adapter's alien representation, opaque round-trip, five-suite coverage, and declared-entry-only imports without copying untracked internals.

## 4. Author guide and executed materialization

- [x] 4.1 Implement `script/run-adapter-author-template.mjs` by reusing the pack module and scratch harness for marker-owned lifecycle, four-tarball staging, `file:` manifest rewrite, npm install, copy-not-link controls, typecheck, both scaffold legs, failure demo, and self-logged step ids/exits.
- [x] 4.2 Author `docs/adapter-authors/README.md`: port/factory ownership map, tarball-only installation, five-suite invocation, requirement-first failure reading, `0.x` class consequences, migration constraint, and scaffold customization sequence.
- [x] 4.3 Add a guide-command drift check that pairs every executable guide command id with exactly one author-runner step and fails for an unexecuted prose command or undocumented author-facing step.
- [x] 4.4 Remove or rewrite residual registry-shaped claims in the existing example READMEs and published-example runner so all documentation consistently states `npm pack` → `file:` consumption only.

## 5. CI and repository documentation

- [x] 5.1 Wire the author runner and guide-command check into the Ubuntu `sdk-examples` job with a `$HOME/.opencut-adapter-template-ci` scratch root and no publish action.
- [x] 5.2 Update `BOUNDARIES.md` with the attributed fakes entry, final surface/package census, template/guide/CI execution record, checker audit, and explicit S06–S09/registry non-coverage.
- [x] 5.3 Update package/template documentation and any version-sensitive consumer assertions to the actual mixed package versions, then prove the packed manifests and README policies agree.

## 6. Verification and independent blind test

- [x] 6.1 Run the author runner from a clean E:-drive scratch root and record four installed copies, no links/workspace resolutions, typecheck zero, five non-zero passing suite populations, migration pair, failure demo, and all real exit codes.
- [x] 6.2 Run the complete relevant checker family, package/root tests, both parity hosts, published examples, and any required build/typecheck gates; disposition only genuinely pre-existing red with base/diff evidence.
- [x] 6.3 Strict-decode every changed text file as UTF-8; assert no BOM, CR byte, replacement character, mojibake pattern, `.rasen/` staged path, untracked generated artifact, or stale moved-path reference.
- [x] 6.4 Dispatch an independent sub-agent with only the guide and scaffold entry point, record its fresh-root blind-test transcript/customization answers/failure interpretation, fix any ambiguity, and have the same verifier rerun the affected delta.
- [x] 6.5 Run an author-not-verifier review over the full branch diff, fix every accepted finding, rerun the affected minimal gates, and record a clean delta review.

## 7. Delivery

- [x] 7.1 Validate the Rasen change strictly, confirm all implementation boxes and evidence populations reconcile, and confirm `signals/.state/` is empty before any archive attempt.
- [x] 7.2 Commit in explicit logical path groups with zero `.rasen/` paths staged and no unrelated worktree changes.
- [x] 7.3 Push `feat/sdk-ecosystem-enablement`, open a PR to `DumoeDss/rocut` `main`, and wait for the `sdk-examples`/author-template CI evidence to finish green without merging.
- [x] 7.4 After the user authorizes/merges the PR, archive the change under the on-merge policy and verify the archived evidence/change status.
