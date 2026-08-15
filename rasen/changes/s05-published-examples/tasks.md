## 1. Baseline

- [x] 1.1 Capture the baseline with method and measurement point inline: the boundary checker's
      printed census (`git ls-files --cached --others --exclude-standard` filter, code files
      only), the 28-checker family sweep with per-checker `EXIT[<name>]:<code>` lines (expected:
      22 zero / 6 nonzero, the known set — any OTHER red is a finding), the frozen-surface
      byte-control over the four S03+S04 files, and confirmation `examples/` does not exist. This
      is the before-half of every comparison.
- [x] 1.2 Re-verify the harness reuse surface end-to-end before building on it: run P3's
      `run-scratch-conformance.mjs` once at default env and capture its control-assertion output
      (location, copy-not-link, removal proof, react-free) — the pre-extraction reference the
      Group-2 refactor must reproduce.

## 2. Harness first: extraction, promotion, runner skeleton

- [x] 2.1 Extract the scratch lifecycle + no-linking controls from
      `run-scratch-conformance.mjs` into an importable module — behaviour-preserving by
      acceptance: the conformance runner re-runs green over the extracted code with
      control-assertion output comparable to 1.2's reference (diffed, not eyeballed). One commit;
      P3's runner keeps its CLI and env seams unchanged.
- [x] 2.2 Promote the consumer view to committed tooling: the four clauses (0.x versions, README
      policy anchor, `surface.json` set-equality, markers in extracted source) plus the
      fail-closed dangling branch, as a module with a `--consumer-view-only` mode. Prove the
      dangling branch fires on a synthetic declared-but-absent entry
      (violation-and-revert), and that the mode runs standalone against pre-packed tarballs
      (`OPENCUT_PREPACKED_DIR`).
- [x] 2.3 Author `script/run-published-examples.mjs` over ONE placeholder example: pack via
      `packSdkTarballs` (import — never re-implement), scratch lifecycle from the extracted
      module, install with the fourth-tarball override, materialize, run, self-log exit codes,
      run the consumer view. Env seams: `OPENCUT_EXAMPLES_ROOT`, `OPENCUT_EXAMPLES` (subset
      selection) beside the inherited six. The placeholder's green run is the earliest
      end-to-end proof of the whole pipeline.

## 3. The examples, cheapest first

- [x] 3.1 `examples/install-packages/`: own manifest (ports + contracts dep names at `0.2.0`,
      typescript for the self-check), tsconfig, README with the consumed-surface table, and a
      runner script that imports from declared React-free entries, prints resolved versions,
      reads the installed `surface.json` + policy README as verification data, and asserts
      classic's installed metadata WITHOUT importing its runtime (React stays absent —
      `CONTROL-react-free` pattern). Execution includes its own `tsc --noEmit`.
- [x] 3.2 `examples/agent-transaction/`: the published `AGENT_SCENARIO` and corpus entry drive
      the published engine over the example's own in-memory store through the transaction API —
      every declared step executed and asserted, ledger written, full reload-reopen durability
      assertion against a fresh store instance over the same persisted data. No browser. README
      table; own tsconfig self-check.
- [x] 3.3 `examples/custom-storage/` (design E2.3, the honest pair): P3's adapter promoted to
      example shape — own `ProjectStore` behind a deliberately alien representation, published
      engine over it, port conformance (portable profile) run from the tarballs. Migration: the
      production path runs and records its skip distinctly; the real 31-step chain validated
      through `@opencut/editor-classic/evidence/wasm-test-mock`. README states the
      experimental-entry inheritance verbatim.
- [x] 3.4 `examples/embed-surface/` (heaviest, last): Vite + React app from the tarballs —
      stylesheet through the declared `./surface.css` entry, the example's own `react`/
      `react-dom` (the peer contract working as designed), a minimal committed asset set with a
      README pointer to the canonical allowlist, GPU-free configuration settled empirically
      (renderer "none" and/or swiftshader flags — the boot smoke is the judge). Execution =
      `vite build` against installed TS source AND a Playwright smoke asserting a booted
      interactive timeline with one interaction (build-only is not execution — the P1 vite
      Blocker is the precedent).
- [x] 3.5 Full local run: all four examples through the runner at default env, scratch
      location asserted outside repo and Temp, controls green per install, consumer view green,
      `EXIT[<name>]:<code>` lines for every step. If any example appears to need a missing
      export entry: STOP and escalate with the forcing example named — inventing a barrel for
      symmetry is the eliminated `./vectors/drivers` hypothesis.

## 4. Consumer declaration and census

- [x] 4.1 Declare `examples` as a consumer in `packages/boundary.json` (`{id, root, ownership}`
      shape beside the existing three — the ownership field settled by the existing records'
      precedent). The checker's derived scan roots pick it up with no script edit (P2's
      derivation); re-run and reconcile the census growth against the examples' actual code-file
      counts (figures from the checker's own printed filter at a named commit, never prose).
- [x] 4.2 Checker-audit rows for every checker that could see the new paths: `no-elftia-import`
      auto-covers (confirm its file count moved), `check-host-composition` deliberately
      scoped (examples are not Hosts), type-baseline deliberately `apps/web`-scoped (each
      example type-checks itself in its own execution), distributable-boundary stays
      vite-graph-scoped, surface-labels scoped to packages (examples cite labels, don't carry
      them). Silence per checker is not acceptable.

## 5. The CI leg

- [x] 5.1 Add the `sdk-examples` job to `.github/workflows/bun-ci.yml`: `ubuntu-latest`, checkout,
      `node script/run-published-examples.mjs` with `OPENCUT_SCRATCH_ROOT` at a non-Temp,
      non-repo path (under `$HOME` — never `runner.temp`, which the runner's assertion refuses
      by design) and `OPENCUT_BUN` defaulted. The job comment states what it claims — four
      examples + consumer view — and what it does not: local-only checkers stay local, no
      matrix extension, no publish.
- [x] 5.2 Validate the job's YAML and the runner's env-only drivability locally: a dry invocation
      with the CI-shaped env (scratch under a `$HOME`-style path) runs green — proving the job
      needs nothing this machine has that CI lacks. The first true CI execution lands on the
      post-delivery push; its log (exit-code lines) closes the evidence loop — stated, not
      hidden.

## 6. Documentation and close-out

- [x] 6.1 `BOUNDARIES.md`: the examples section (four shapes, the workspace-stance rule, the
      harness reuse seam, the honest-pair decision and its label consequence), the consumer
      entry, the checker-audit rows from 4.2, the CI leg statement, and the non-coverage
      statement (P7 owns notices in example files; wasm-init is Direction-level, demonstrated
      not repaired; no example covers the desktop shape — the electron Host does).
- [x] 6.2 The cross-cutting-correction sweep guard (P5's rule) over any identifier this change
      introduces or renames: `git grep -n "<identifier>" -- ':!rasen/changes/archive'`, every
      surviving hit dispositioned by class; run at completion, not once mid-flight.
- [x] 6.3 The F2-class delivery audit: pair every scenario clause of this change's spec delta
      with the evidence line that satisfies it; amend any clause the delivery does not meet
      BEFORE archive, headings verbatim, rulings attributed in design.md — never in spec text.
      Where a clause's evidence is the post-delivery CI push, the clause is authored to pair
      with the local run's log line and says so.
- [x] 6.4 Final controls: the frozen-surface byte-control still identical; the 28-checker family
      sweep green in the known 22/6 shape; `rasen validate s05-published-examples --strict
      --project rocut --json` → `valid: true, issues: []` (named-item form — bare `--strict`
      prints "Nothing to validate").

## 7. Ship

- [ ] 7.1 Line endings per stage (`tr -dc '\r' < f | wc -c` = 0 after every write; tool OUTPUT
      files too — python/redirected prints emit CRLF on this machine, `sed -i 's/\r$//'` before
      staging).
- [ ] 7.2 Explicit pathspecs; the `.rasen/` staging guard in a variable; one `feat(<change>):`
      commit per group; **local only, no push** — the portfolio delivers once at the parent.
      Return DONE only with the final commit hash in hand (P5's race lesson: an uncommitted
      tree reads as not-landed).
- [ ] 7.3 On review-clean: `{"kind":"standDown"}` to any parked worker's signals; confirm
      `signals/.state/` is empty before the archive is planned.
