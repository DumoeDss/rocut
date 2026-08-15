# F2-class delivery audit — s05-published-examples

Every scenario clause of the spec delta (`specs/sdk-published-examples/spec.md`)
paired with the evidence line that satisfies it. Log-line citations are from this
change's committed evidence unless another file is named. Clauses whose full
evidence is the post-delivery CI push are paired with the local dry-run line and
say so, per the task's own instruction.

## Requirement: Four worked examples exist, one lesson each

**Scenario: The four examples are present as independent projects**

- *it contains the four example projects, each with its own manifest, tsconfig
  and README* — the four directories exist at the ship commit
  (`examples/{install-packages,agent-transaction,custom-storage,embed-surface}/`,
  each carrying `package.json`, `tsconfig.json`, `README.md` and its sources);
  the census counts them in
  (`logs/group4-census.log`: 1110 → 1135, "+22 example code files").
- *none of them is matched by the repository's workspace globs* —
  `logs/group6-f2-support-verifications.log`: workspaces
  `["apps/*", "packages/*"]`, "none of the example directories is matched by
  any workspace glob".

**Scenario: Each example demonstrates its named lesson**

- *the installing example resolves and imports from declared entries and reads
  the installed artifacts' versions and labels* —
  `logs/group3-install-packages.log`: "ok @opencut/editor-ports resolved at
  0.2.0 (pinned 0.2.0)" and the classification rows ("classified frozen
  (expected frozen)" etc.), "install-packages: every assertion green".
- *the embedding example mounts the editor Surface from the installed packages
  with its own stylesheet, assets and React dependencies* —
  `logs/group5-full-run-clean.log`: "CONTROL-react-present react-satisfied:
  PASS" for the embed-surface install, `EXIT[example/embed-surface/build]:0`,
  and the smoke's `interaction/focus-scope`, `mount/surface-root` assertions
  (`logs/group3-embed-surface.log` carries the full 9-assertion list from the
  tainted run; the clean run's smoke block is identical).
- *the custom-storage example supplies its own ProjectStore with the published
  engine over it and runs the port conformance suite* —
  `logs/group5-full-run-clean.log`: "suites/ports: passed=true cases=36" in
  both legs, `EXIT[example/custom-storage/run.ts]:0`,
  `EXIT[example/custom-storage/run-mock.ts]:0`.
- *the agent example drives the published agent scenario through the
  transaction API over its own store with a reload-reopen durability
  assertion* — `logs/group5-full-run-clean.log`: "executed exactly the
  declared plan (9 step(s))", "ledger asserts 87 comparison(s)", "reopen
  verdict passed … reopened revision 6 == committed 6 … a fresh store
  instance", `EXIT[example/agent-transaction/execute]:0`.

## Requirement: Examples execute from installed tarballs outside the monorepo

**Scenario: Each example runs from the scratch install**

- *the example's own execution entry completes with its assertions green and a
  self-logged exit code* — `logs/group5-full-run-clean.log`: 10
  `EXIT[example/...]:0` lines, zero nonzero; wrapper `REAL_EXIT_CODE:0`.
- *the run's evidence shows the no-linking controls passing for that install* —
  same log: `CONTROL-2 copy-not-link …: PASS` for every installed package on
  every one of the four installs, plus CONTROL-1a/1b/1c and the react controls.

**Scenario: The shared harness extraction is behaviour-preserving**

- *the pre-existing conformance runner re-runs green over the extracted code* —
  `logs/group2-p3-rerun-post-extraction.log`: the P3 runner re-ran green over
  `scratch-install-harness.mjs` (report section 2.1).
- *its control-assertion output is comparable to its pre-extraction run* —
  `logs/group1-p3-runner-reference.log` (pre-extraction) vs the rerun log:
  control-assertion lines diffed identical (report 2.1: "byte-for-byte what
  they were before the extraction").

## Requirement: The from-tarballs consumer view is a standing gate

**Scenario: The consumer view runs with every examples run**

- *the consumer-view checks have executed over the packed artifacts and
  passed* — `logs/group5-full-run-clean.log`: "consumer-view: PASS (3
  package(s) verified, 0 failures, 0 dangling)"; the same line appears in
  every full-run and subset log (groups 2–5).
- *a dangling declared entry introduced as a control fails the gate at any
  class* — report section 2.2: the declared-but-absent (dangling) negative
  control was applied and observed failing `check-sdk-consumer-view.mjs`
  closed at every class (run record in the Group-2 log set;
  `logs/group2-consumer-view-fresh-pack.log` is the green twin).

**Scenario: The consumer view is independently runnable**

- *it packs (or consumes pre-packed tarballs), verifies the four clauses, and
  exits with its own self-logged code* —
  `logs/group2-examples-runner-consumer-view-only.log` (runner's
  `--consumer-view-only` mode, exit 0) and
  `logs/group2-consumer-view-prepacked.log` (the checker's own CLI over
  `OPENCUT_PREPACKED_DIR`); both fresh-pack and prepacked paths exercised.

## Requirement: The examples are executed in CI against installed tarballs

**Scenario: The CI job runs the runner through its seams**

- *it invokes the runner with environment-provided scratch root and bun
  invocation* — `.github/workflows/bun-ci.yml` job `sdk-examples`:
  `OPENCUT_SCRATCH_ROOT="$HOME/.opencut-scratch-ci" node
  script/run-published-examples.mjs` with `OPENCUT_BUN` at its default.
- *the run's log carries per-example exit-code lines derived from the log
  itself* — the local pairing is `logs/group5-ci-dry-run.log` (the CI-shaped
  dry invocation, same env shape): per-install
  `REAL_EXIT_CODE[npm-install/<name>]:0` ×4 and per-step
  `EXIT[example/<name>/<step>]:0` ×10, wrapper `REAL_EXIT_CODE:0`,
  `DRY_DONE:0`. **The first true CI execution lands on the post-delivery
  push**; its exit-code lines close this clause — stated here, not hidden.

**Scenario: The CI leg claims only itself**

- *it names the four examples and the consumer view as what it executes* —
  the `sdk-examples` job comment in `.github/workflows/bun-ci.yml`: "Claims
  exactly what run-published-examples.mjs runs: the four published-SDK
  examples … plus the consumer view over the freshly packed tarballs".
- *it states that the local-only checkers remain local and that no OS-matrix
  extension or publish is claimed* — same comment: "Does NOT claim: the
  local-only checkers stay local (the checker family sweep is a local gate),
  no matrix extension beyond ubuntu, no publish"; BOUNDARIES.md §15 "The CI
  leg" records the same statement.

## Requirement: Example documentation surfaces the labeled surface

**Scenario: Consumed-surface tables name classes**

- *every @opencut/* specifier the example imports appears with its class and a
  stated justification* — each example's README carries its consumed-surface
  table (entry → class → one-line justification); report sections 3.1–3.4
  describe each table; the boundary census counted the import surface
  (`logs/group4-census.log`: `@opencut/*` specifiers 361 → 415).
- *no example code reads the surface manifest at runtime* —
  `logs/group6-f2-support-verifications.log`: `surface.json` is read only by
  `install-packages/run.ts`, as data — that example's named lesson per spec
  requirement 1 — and no example reads it to drive behavior.

**Scenario: The custom-storage example states its experimental inheritance**

- *it names the experimental entry its migration validation depends on and
  states the inherited instability* — `examples/custom-storage/README.md`:
  the honest-pair section names `@opencut/editor-classic/evidence/wasm-test-mock`
  as experimental-labeled and states the example inherits that entry's
  instability (report 3.3 cites the wording).
- *it describes the honest pair: the production path's distinct recorded skip
  and the validated chain through the published mock* — same README section;
  executed shape in `logs/group5-full-run-clean.log`: "migration/by-replication:
  SKIPPED distinctly (classic unresolved in the plain consumer …)" on the
  production leg, "migration/by-replication: green (real chain,
  mock-installed)" on the mock leg.

## Requirement: Example non-coverage is stated

**Scenario: Non-coverage is written down with owners**

- *it states that legal notice content in example files is the provenance
  child's to complete* — BOUNDARIES.md §15 "Non-coverage, deliberately":
  "LICENSE / NOTICE / SBOM notices in the example files are P7's" (P7 =
  the provenance-and-beta-closure child).
- *it states that the wasm-initialization defect is Direction-level and
  demonstrated, not repaired* — same paragraph; also carried in
  `logs/group5-full-run-clean.log`'s own runtime line ("the
  wasm-initialization defect is Direction-level, demonstrated not repaired").
- *it states that no example covers the desktop Host shape, which the
  repository's electron application already covers* — same paragraph: "No
  example covers the desktop shape — the electron Host (section 12) does".
