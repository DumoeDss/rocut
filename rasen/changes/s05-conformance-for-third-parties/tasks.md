## 1. Gate: pack and prove tarball resolution before anything is built on it

- [x] 1.1 Pack all three packages with `npm pack` into a configurable output directory (gitignored
      build dir, never committed) and record npm's own output — tarball names, versions, shasums,
      integrity, file counts (`editor-contracts` measured at proposal time: 55 files, 580.3 kB
      unpacked — re-measure and record the current figures with method inline). Confirm the
      tarballs' manifests carry `workspace:*` verbatim for cross-package deps (the problem this
      gate exists to solve).
- [x] 1.2 Spike the resolution mechanisms in a throwaway scratch project on an E:-drive path
      outside the repo and outside any Temp directory (the measured AV hazard — a hanging link is
      the signature, not a tooling bug): (a) `npm install` of the three tarballs with `overrides`
      mapping each `@opencut/*` name to `file:<tarball>`; (b) the same under `bun install`. Record
      exact commands, results, and the rejected mechanism's failure text. Confirm installed
      `@opencut/*` entries are real directory copies (`lstatSync`, not `statSync`).
- [x] 1.3 Decide and record the mechanism (E3: no post-pack manifest rewriting — the tarball under
      test must be the artifact `npm pack` produced). If BOTH mechanisms fail, stop and escalate
      with the failure text: the named escalation is a package-side version-literal manifest fix,
      which is a decision, not a private patch. Evidence to `evidence/gate-1-tarball-resolution.md`
      with self-logged `REAL_EXIT_CODE:$?`; throwaway scratch deleted.

## 2. Consumable entries: the corpus and contract surface, published and guarded

- [x] 2.1 Author `packages/editor-contracts/src/vectors/corpus/index.ts` exporting
      `readPublishedCorpusText()` (fs-read of the three shipped `src/vectors/corpus/*.json` files
      relative to `import.meta.url`, returning **exact bytes** — `manifestText` + `files` map) and
      `PUBLISHED_CONTRACT_SURFACE: ContractSurface` (the three string arrays as static data).
      Declare the `./vectors/corpus` entry in the export map, attributed to the scratch consumer.
      Doc-comment the Node/bun shape of the fs-read deliberately (it is the path-taking edge the
      runner refuses to be).
- [x] 2.2 In-repo drift guards, fail-closed: a committed test asserts `PUBLISHED_CONTRACT_SURFACE`
      deep-equals `parseContractSurface(readContractSources())`; `readPublishedCorpusText()` loads
      through `loadTransactionVectorCorpus` with the recomputed digest matching the manifest's; a
      deliberate one-member surface mutation is proven to fail the guard (violation-and-revert,
      the P1 E6 pattern). Run under `bun test`; green.
- [x] 2.3 Re-verify the boundary checker after the export-map additions: `public-entry-only`
      still passes, the entry addition is attributed in `BOUNDARIES.md`, both controls re-run, and
      the census movement (files scanned, specifiers examined) is recorded with method and
      measurement point inline (P2's reviewer expectation).

## 3. Legibility: the requirement index beside the suites

- [x] 3.1 Author the requirement indices — one per package, at declared `./conformance/requirements`
      entries: every case name each suite can report (ports suite in `editor-ports`; transaction,
      draft, engine and vectors suites in `editor-contracts`) mapped to the frozen requirement it
      exercises, plus `formatConformanceFailures(report)` rendering each failure as requirement →
      case → detail. The five suite modules are NOT edited; the index is authored by reading them.
- [x] 3.2 Index drift guard, fail-closed: an in-repo test runs every suite against its reference
      implementation (in-memory ports, the in-memory and durable vector factories, the reference
      draft/engine fixtures) and asserts every reported case name — passed, failed AND skipped —
      has an index row. A synthetic renamed case is proven to fail the guard
      (violation-and-revert). Run green under `bun test`.
- [x] 3.3 Prove the formatter's contract on real input: run the non-conforming scenario from task
      6 against a local copy once the adapter exists, or against a deliberately failing reference
      target if authored earlier — the rendered output names the requirement first, contains no
      stack trace, and is captured as the format's worked example in the entry's docs.

## 4. The harness: pack module, scratch runner, no-linking controls

- [x] 4.1 Author `script/pack-sdk-tarballs.mjs`: pack the three packages, and write the committed
      tarball manifest into the change's evidence directory — names, versions, npm shasums and
      integrity, per-file SHA-256 inventory. Determinism control: pack twice from the same tree,
      record that the digests reproduce. Self-logged exit codes. This is the module P6 imports —
      its exported API is the deliverable, name it in `BOUNDARIES.md`.
- [x] 4.2 Author `script/run-scratch-conformance.mjs`: fresh-per-run scratch lifecycle (wipe +
      recreate + marker; refuse foreign roots), root resolution with the assertions of design E2
      (outside repo tree, outside any Temp path; env-overridable `OPENCUT_SCRATCH_ROOT` with the
      E:-drive local default), install via gate-1's mechanism, materialize the committed adapter
      template, run the suites under bun, capture reports + `REAL_EXIT_CODE` lines. One process,
      no nested backgrounding.
- [x] 4.3 Wire no-linking controls 1 and 2 into every run: root-outside-tree assertion, and
      copy-not-link assertion over each installed `@opencut/*` (`lstatSync`; the scratch lockfile
      records tarball `file:` resolutions, not workspace ones). Both assertions' pass lines appear
      in the evidence log of every run, not only once.
- [x] 4.4 Control 3 — the removal proof: a harness mode that deletes the installed
      `@opencut/editor-ports` copy and re-runs the adapter's import step; it MUST fail to resolve,
      and the failure text is recorded. A run that still succeeded would be reaching into the
      monorepo — that is the exact hole this control exists to close.

## 5. The worked adapter: third-party-shaped, passing from tarballs

- [x] 5.1 Author `script/fixtures/third-party-adapter/` — the base adapter: its own
      `ProjectStore` with a deliberately alien internal representation (records serialized to
      JSON strings in a Map — normalization cannot hide), its own id generator / asset resolver /
      diagnostics, the **published** engine opened over its own store for the engine, draft and
      vectors suites, its own transaction target and vectors target factory, and a runner script
      that executes all five surfaces and prints failures through the formatter. Imports are
      declared-entry `@opencut/*` specifiers only (the boundary checker scans this directory like
      any source).
- [x] 5.2 Implement migration over the published artifacts (E7): the adapter's `migrate()` walks
      the published `migrations` list to `CURRENT_PROJECT_VERSION` over its own records —
      all-or-nothing, fail-closed (a refusing transform is a failure, not a `break`), chain
      reaching current. If replication cannot be made conforming, STOP and record the finding: the
      attributed fallback is a package-side runner-core export, proposed, not smuggled.
- [x] 5.3 Pass **in-repo first**: run the adapter's runner from inside the repository (workspace
      resolution) — every suite passes, opaque payload round-trips, migration cases included.
      Green with self-logged exit codes.
- [x] 5.4 Pass **from the scratch project**: the harness materializes the adapter, installs
      tarballs, runs the same runner — every suite passes against the installed copies. The
      in-repo/scratch pair is the evidence the entries are complete: a missing entry fails ONLY
      the scratch leg, naming it.

## 6. The mutation matrix: non-conforming variant and its named failures

- [x] 6.1 Author the `variant-nonconforming` sibling: the base adapter with exactly one defect —
      its store drops fields it does not know on save. Nothing else differs (diff the two and
      show the single change).
- [x] 6.2 Run the variant through the same scratch harness: the ports suite's opaque-payload case
      fails **by name**, rendered through the formatter with its requirement; record the variant's
      full report beside the base adapter's passing one as the control.
- [x] 6.3 Assert the matrix's exactness: every case that differs between variant and base fails in
      the variant, and each differing case is attributable to the single defect — a case failing
      "extra" in the variant is an over-constrained suite and a finding about the suite, recorded
      and escalated rather than waived.

## 7. Close-out: audit, documentation, controls

- [x] 7.1 Checker-audit rows for every new path (P2's standing rule): `script/pack-sdk-tarballs.mjs`,
      `script/run-scratch-conformance.mjs`, `script/fixtures/third-party-adapter/**`, the three new
      entry modules. Confirm the boundary checker's census grew over the P3 baseline (re-captured
      at group 1 with method inline) by the adapter + entry file counts; `no-elftia-import`
      auto-covers the new files (its enumeration is repo-wide — confirm its file count moved);
      every other checker that could see the new paths gets "follows" or "deliberately scoped,
      because…". Silence per checker is not acceptable.
- [x] 7.2 Frozen-surface control (the P2 method): `git show <base>:<path> | cmp` over the four
      frozen S03+S04 surfaces at this change's base — byte-identical. The five conformance suite
      modules are diff-empty over this change. Any pressure discovered is a `failed` finding
      returned to the contract, never a patch.
- [x] 7.3 Run every runnable static checker green (sweep with per-checker `EXIT[<name>]:<code>`
      lines), and `bun test` over the touched package suites.
- [x] 7.4 `BOUNDARIES.md`: harness section (what runs where, the three no-linking controls, the
      reuse seam for P6), the three attributed entry additions, and the non-coverage statement
      (no CI leg — P6 owns it reusing this harness; registry behaviour excluded by B1; no
      browser-manager adapter beyond the draft fixture's needs).
- [ ] 7.5 Execute-and-verify the P1-move path refresh rider (design E10, LEAD-ruled in scope
      2026-08-14): the five refreshed `transaction-automation-api` requirement blocks land
      through this change's delta with path text only — no semantics, scenario-inventory, or
      acceptance-wording change, every scenario heading verbatim. **After archive**, run
      `grep -c 'apps/web/src/editor/contracts' rasen/specs/transaction-automation-api/spec.md`
      and record the result — it MUST be `0`. A non-zero count means a stale reference survived
      the delta and must be fixed before the change closes.
- [x] 7.6 Spec-falsification sweep: name which governance-spec §3 groups this change advanced
      (§3.5 fully; §4.1(a)'s harness obligation discharged) and which it left untouched, in the
      honest register prior children used.

## 8. Ship

- [x] 8.1 Line endings per stage (`tr -dc '\r' < f | wc -c` after every write; `git ls-files --eol`
      over the change's path set at the end) — the Write tool flips CRLF on this machine, and tsc
      output captured into logs carries CRLF (normalize when the log is the deliverable).
- [x] 8.2 Stage explicit pathspecs; the `.rasen/` staging guard (`RASEN_COUNT=$(git diff --cached
      --name-only | grep -c '^\.rasen/')` — `grep -c` exits 1 on zero, capture it in a variable)
      before every commit. Never `git add -A`. No `--no-verify` (no hooks exist).
- [x] 8.3 Commit locally to `feat/s05-community-beta`, one `feat(<change>):` commit per group.
      **Ship mode is local; do not push** — the portfolio delivers once, at the parent.
- [ ] 8.4 The moment the review loop goes clean, `{"kind":"standDown"}` to any parked worker's
      `<changeRoot>/signals/<role>.json`, confirm `signals/.state/` is empty before the archive is
      planned.

## 9. LEAD-ruling execution (added 2026-08-15; the ruling crossed DONE in flight)

- [x] 9.1 Manifest truth on classic: culori → dependencies (lockfile-resolved 4.0.2, exact pin),
      react → peerDependencies ^18.3.1, opencut-wasm → declared as the in-repo file: spec;
      bun install settles the lockfile with in-repo resolution semantics unchanged.
- [x] 9.2 Attributed entry ./storage/migrations (react-free barrel; closure audited file by
      file; forcing module = the third-party adapter's react-free migration conformance);
      boundary checker green + both controls; boundary.json self-registers via the dynamic
      manifest list (no edit needed — stated in evidence).
- [x] 9.3 Harness: fourth local tarball (rust/wasm/pkg) with the opencut-wasm override mapping;
      control 2 covers all four installed copies; committed tarball manifest regenerated with
      determinism reproduced on all four.
- [x] 9.4 React-free proof from tarballs: --legacy-peer-deps install + CONTROL-react-free
      react-absent assertion + the migration leg importing the entry live (PASS, all modes).
- [x] 9.5 Host re-gates: electron-host typecheck 0, vite-example typecheck 0, apps/web scoped
      program unchanged (same two pre-existing S01 rows, +1 scoped file, zero new diagnostics).
- [x] 9.6 The migration fork: branch (b) landed — wasm.__wbindgen_start init failure persists
      from installed tarballs with resolution honest; honest-pair end state per the ruling;
      wasm-init class recorded as Direction-level, LEAD carries it; variant + removal controls
      re-ran unchanged in the same sequence.
- [x] 9.7 Census re-derived (1107/989/361/362, +1 attributed); BOUNDARIES.md §13 entry row +
      harness record updated; report Group 9 + rewritten durable finding 1; commits landed.
