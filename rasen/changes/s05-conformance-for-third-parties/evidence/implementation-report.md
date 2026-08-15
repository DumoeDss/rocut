# Implementation report — s05-conformance-for-third-parties (P3)

Running log, appended per group. Repository: rocut at `feat/s05-community-beta`, commits local
only. Every command's evidence carries a self-logged `REAL_EXIT_CODE`; long commands ran
foreground with bounded timeout or background with bounded polling.

## Group 1 — Gate: pack tarballs + resolution spike + mechanism decision (tasks 1.1–1.3)

**State: complete. Commit `7e2f429d`.**

Full record in `gate-1-tarball-resolution.md` (raw output `gate-1-pack-output.log`). Summary:
npm pack of all three packages (TS-from-`src`, no build step) into gitignored
`dist-sdk-tarballs/`; scratch-install spikes on E:-drive non-Temp roots resolved the workspace
mechanism: **npm install with `overrides` mapping `@opencut/*` → `file:<tarball>`** is the
settled gate-1 mechanism, bun fallback recorded. `.gitignore` gained `dist-sdk-tarballs/`.

## Group 2 — Consumable entries: `./vectors/corpus` + drift guards (tasks 2.1–2.3)

**State: complete. Commit `ca41ceb0`.**

- `@opencut/editor-contracts` gained `./vectors/corpus` → `src/vectors/corpus/index.ts`:
  `readPublishedCorpusText()` (exact file bytes via `node:fs`, relative to `import.meta.url`)
  and `PUBLISHED_CONTRACT_SURFACE` (frozen contract surface as data).
- Guarded fail-closed by `vectors/__tests__/published-corpus-entry.test.ts`: published surface
  deep-equals `parseContractSurface(readContractSources())` with a live one-member
  violation-and-revert; published corpus text loads through `loadTransactionVectorCorpus`
  with every recomputed digest matching; every file text hashes to its manifest sha256.
- BOUNDARIES.md §13 opened: entry-attribution table + census movement (1078→1080 repo files,
  982→984 graph files, 359→359 specifiers, 360→360 edges), both checker controls green.
- Evidence: `logs/group2-drift-guard-final.log` (5 pass / 0 fail, `REAL_EXIT_CODE:0`).

## Group 3 — Legibility: requirement indices + drift guard + formatter proof (tasks 3.1–3.3)

**State: complete. Commit: this group's commit.**

- **3.1** — `@opencut/editor-ports` gained `./conformance/requirements` →
  `src/conformance/requirements.ts` (37 rows over the port suite's reportable names, including
  the synthetic `"the suite covers this port"` sentinel, indexed with a doc comment and
  excluded from the reverse check); `@opencut/editor-contracts` gained
  `./conformance/requirements` → `src/conformance/requirements/index.ts` (transaction 21 rows;
  engine T0 rows **generated** from the transaction rows via `Object.fromEntries` so the
  prefixed spellings cannot drift, plus 17 hand-anchored `T1: ` rows; Draft 22 `T2: ` rows;
  vectors 29 vector-id rows). Both publish `formatConformanceFailures(report)` rendering
  requirement → case → detail from recorded `detail`/`failures` strings only (the suites record
  `Error.message`, never a stack, so no rendering can contain one); the contracts formatter
  discriminates `ConformanceReport` vs `VectorRunReport` by shape. Unindexed names render the
  fail-closed fallback line. The five suite modules are untouched (diff-empty; the close-out
  frozen-surface control re-proves this).
- **3.2** — `packages/editor-ports/src/conformance/__tests__/requirements-index.test.ts` and
  `packages/editor-contracts/src/conformance/requirements/__tests__/requirements-index.test.ts`
  run every suite against its reference implementation (in-memory ports + store fixture;
  in-memory transaction store via the `_setProject` seam; engine and Draft reference fixtures
  replicated from `engine.test.ts` / `draft.test.ts`; corpus loaded **through the published
  `./vectors/corpus` entry**; both vector target factories) and assert: every reported name of
  every status has a row; every row is reported (stale-spelling converse, sentinel excluded);
  a synthetic renamed case fails the guard and the unmodified report stays clean
  (violation-and-revert). 8/8 green under `bun test`, `REAL_EXIT_CODE:0`
  (`logs/group3-requirements-guard-final.log`).
- **3.3** — formatter proof on real failing targets, both legs: the repo's own negative
  control (a store that replaces the opaque payload on load → 2 failed of 36, first failure
  `[host-port-contract / No port signature exposes an editor-internal or storage-mechanism
  type]`) and a frozen-`revision()` proxy of the in-memory transaction store (6 failed of 21,
  first failure `[transaction-automation-api / Revisions are monotonic and conflicts are
  detected]`). Assertions: requirement line precedes the `case:` line; no stack frames. The
  real captures replaced the drafted worked examples in both modules' doc comments.
- Full package suites: 151 pass / 0 fail across editor-ports + editor-contracts,
  `REAL_EXIT_CODE:0` (`logs/group3-full-packages-final.log`).
- Scoped typecheck (repo-local `node_modules/.bin/tsc`, TS 6.0.3, root-config options +
  `--types node,bun`): zero diagnostics over the four new modules,
  `REAL_EXIT_CODE:0` (`logs/group3-typecheck-scoped.log`). Note: a root-`tsconfig.json` sweep
  is not an oracle in this repo (fragment config; 4312 diagnostics across deliberately-broken
  archived fixtures and unbuilt apps) — the scoped run is the evidence.
- Boundary census (`logs/group3-boundary-census.log`): current tree 1084 repo files / 988
  graph files / 361 specifiers / 362 edges; baseline leg (Group-3 files + entry lines removed,
  then restored byte-identical and re-tested green) reproduced the Group-2 end-state exactly
  (1080/984/359/360); both controls green (`EXIT[A|B|neg|converse]:0`). The +2 specifiers are
  the contracts drift-guard test's `@opencut/editor-ports` / `@opencut/editor-ports/in-memory`
  imports — test-only, same specifiers the engine/Draft reference fixtures already use.
  BOUNDARIES.md §13 gained the two attribution rows and the census paragraph.

### Group 3 deviations

1. **`vectors/__tests__/corpus-isolation.test.ts` amended** (a committed Group-2-era guard,
   not a frozen suite module): its "no module imports the committed corpus" rule now exempts
   `__tests__` sources, renamed to "no **distributable** module imports the committed corpus".
   Reason: the requirement-index drift guard consumes the published `./vectors/corpus` entry
   exactly as a third party does, from `conformance/requirements/__tests__/`, and the P1-era
   regex keyed on the literal `vectors/corpus` specifier substring (Group 2's own corpus test
   passed it only by directory luck — `"../corpus"`). The guard's stated invariant is about
   distributable graphs; test files are not distributable. The JSON-by-relative-path ban and
   the converse control are unchanged. Reasoning recorded in the guard's own comments and in
   BOUNDARIES.md §13.
2. **Drafted worked examples corrected, not new**: both modules were authored with drafted
   formatter examples flagged for replacement; both now carry the real captured output.

## Group 4 — The harness: pack module, scratch runner, no-linking controls (tasks 4.1–4.4)

**State: complete. Commit: this group's commit.**

- **4.1** — `script/pack-sdk-tarballs.mjs` exports `SDK_PACKAGES` and
  `packSdkTarballs({ repoRoot?, outDir?, packages?, determinism?, log? })`; CLI
  `node script/pack-sdk-tarballs.mjs [--no-determinism] [--out <dir>] [--manifest <path>]`
  packs all three packages via `npm pack --json` (the real distribution path; no
  extract-fix-repack), inventories every file with SHA-256 (extracted with the system tar on the
  same drive, never %TEMP%), and runs the pack-twice determinism control. Wrote the committed
  manifest `evidence/tarball-manifest.json`: ports 21 files, contracts 59 files, classic 802
  files; digests **reproduced** for all three. Classic's npm shasum `a17ac138…` is unchanged
  from gate-1 (classic was untouched by Groups 2–3); ports 19→21 and contracts 55→59 file counts
  are the Group 2/3 entry additions, as expected. `REAL_EXIT_CODE[pack]:0`
  (`logs/group4-pack-module.log`). The exported API is named in BOUNDARIES.md §13 — this is the
  seam P6 imports for its CI leg.
- **4.2** — `script/run-scratch-conformance.mjs`: one foreground process owning the whole
  lifecycle. Root resolution (`OPENCUT_SCRATCH_ROOT`, local default a sibling of the repo on the
  E: drive) with CONTROL-1a (outside repo tree) and CONTROL-1b (outside TEMP/TMP/TMPDIR/tmpdir())
  asserted fail-closed every run; wipe-and-recreate with `.opencut-scratch-marker` (a pre-existing
  root without the marker is refused, never reused); tarballs staged from the pack module (or
  `OPENCUT_PREPACKED_DIR`); scratch `package.json` in gate-1's proven shape (3 `file:` deps +
  `overrides` for ports/contracts replacing the packed `workspace:*`); `npm install` with
  `REAL_EXIT_CODE[npm-install]`; materialize the committed adapter template when present
  (Group 5), else a loudly-labeled built-in smoke consumer; run under bun (`OPENCUT_BUN`,
  default `npx --yes bun@1.2.18`) with `REAL_EXIT_CODE[suites]`.
- **4.3** — CONTROL-2 copy-not-link over each of the three installed `@opencut/*`: `lstatSync`
  real directory (symlink=false) AND lockfile `resolved` starts `file:` with `link !== true`.
  Pass lines appear in every run's log, not only once — visible in both
  `logs/group4-scratch-run-smoke.log` and `logs/group4-control-3-removal.log`.
- **4.4** — `--control-removal` mode: after a full install, deletes
  `node_modules/@opencut/editor-ports` and re-runs the import step (the adapter template's
  materializer when present; here the probe `import "@opencut/editor-ports/conformance"`). It
  MUST fail: the run failed with `error: Cannot find module '@opencut/editor-ports/conformance'`,
  `REAL_EXIT_CODE[control-3-import]:1`, `CONTROL-3 removal: PASS`
  (`logs/group4-control-3-removal.log`). A resolution-failure regex gate rejects a pass-through
  from any other failure mode.
- **Smoke run** (`logs/group4-scratch-run-smoke.log`): full lifecycle at
  `<repo>/../opencut-scratch-p3`; npm install green; controls 1a/1b/2 green; smoke consumer
  under bun ran **ports 36/36 and transaction 21/21 green against the installed tarball
  copies**, plus `requirementOf("<first transaction case>")` resolved through the published
  requirements entry — the Group 3 legibility surface consumed from a scratch install,
  `REAL_EXIT_CODE[scratch-run]:0`.
- Sequencing note: the committed adapter template does not exist yet (Group 5); until then the
  runner falls back to the smoke consumer with a marker line in the log. The full-adapter scratch
  leg and the adapter-shaped removal re-proof land with Group 5/6 evidence.

### Group 4 build notes (failures the scripts now encode)

- `npm pack`'s last-stdout-line filename heuristic caught notice chatter instead of the filename
  → switched to `npm pack --json` + JSON.parse of the array slice.
- GNU tar reads an absolute Windows tarball path as a `host:path` **remote spec**
  ("Cannot connect to E:") → extraction runs with `cwd` at the scratch dir and a relative
  `../<basename>` path — same issue check-type-baseline.mjs documents.
- `spawnSync` with an args array + `shell:true` trips DEP0190 on Node ≥ 22 → single command
  string on Windows in every spawned tool (pack module, runner, removal probe).

## Group 5 — The worked adapter: third-party-shaped, passing from tarballs (tasks 5.1–5.4)

`script/fixtures/third-party-adapter/` — the committed adapter template. Every import is a
declared-entry `@opencut/*` specifier (audited: `editor-ports{,/conformance,/conformance/requirements}`,
`editor-contracts{,/conformance,/conformance/requirements,/engine,/draft,/vectors,/vectors/corpus}`,
`editor-classic{,/storage,/evidence/wasm-test-mock}` — all present in the exports maps; no deep
paths).

- **5.1 the adapter.** `src/alien-store.ts` — a `ProjectStore` whose entire durable state is ONE
  flat `Map<string, string>` keyed by JSON tuples (`["project", id]`, `["summary", id]`,
  `["attachment", projectId, key]`, `["library", ns, key]`), values are codec-encoded JSON
  envelopes. The codec (`src/alien-codec.ts`) is a typed subset inside JSON — Date/Map/Set/
  ArrayBuffer as `NUL+"alien:date|map|set|bytes"` marker objects (base64 for bytes), literal
  NUL-leading keys escaped with a second NUL, functions/symbols/class instances → `corrupt` —
  the structuredClone subset, so a payload field the contract has never heard of round-trips
  exactly. `src/alien-control.ts` supplies the store-suite seam (injected inspection, fail-next,
  pause-next through one `beforeCommit` on the single commit path; quota checked after
  `beforeCommit`, `available && capacity!==null && byteLength>remainingBytes`). `src/roles.ts`
  supplies the remaining host roles. `src/transaction.ts` is the adapter's OWN transaction
  target (contract semantics verbatim — idempotency before revision, collision before
  validation, atomic working-copy batches, cascade deletes, `capabilities()` frozen with
  `defensiveClone: true` — over a per-entity-JSON-text representation). `src/factories.ts`
  opens the PUBLISHED engine over the alien store for the engine/draft/vectors suites.
  `run.ts` executes all five suites and prints failures through both published formatters.
- **5.2 migration by replication.** `src/migrate.ts` walks the published classic chain over the
  adapter's own records: snapshot → outdated filter → per-record walk with `id` injected at the
  top level → `skipped`/throw/missing-step are typed `failed` (fail-closed) → monotone
  `ctx.report` → `legacyReplace` all-or-nothing. **Loading the chain is the recorded finding**
  (below). The walker itself is validated against the REAL 31-step chain in
  `__tests__/migration-walker.test.ts`, which loads classic's own published wasm mock entry
  (`@opencut/editor-classic/evidence/wasm-test-mock`, the same mechanism classic's storage tests
  use): migrated 30→31 with progress 1/1, second call `not-needed`, a `version: "thirty"` record
  declined by the REAL v30→v31 transform (`invalid version`) fails closed — plus the full ports
  suite with `exerciseMigration: true` (`migration brings the store to its declared
  version=passed`). Log: `logs/group5-migration-walker-real-chain.log`, REAL_EXIT_CODE 0.
- **5.3 in-repo leg green** (`logs/group5-adapter-in-repo.log`, also under pinned bun 1.2.18):
  ports 36/36, transaction 21/21, engine 38/38, draft 22/22, vectors 29/29,
  `REAL_EXIT_CODE:0`. Classic chain not loadable in-repo (finding below); migration cases
  covered by the walker test against the real chain.
- **5.4 scratch leg green** (`logs/group5-adapter-scratch.log`): harness materialized the
  committed template, npm-installed the packed tarballs (controls 1a/1b/2 PASS), and the SAME
  runner passed all five suites against the installed copies, `REAL_EXIT_CODE[scratch-run]:0`.
  Classic chain not loadable from the tarball install either — but with the OTHER root cause
  (`Cannot find package 'culori'`), the phantom-dep confirmed from the install side.
- **Adapter-shaped removal re-proof** (`logs/group5-control-3-adapter-removal.log`): control 3
  now re-runs the ADAPTER runner (not the bare probe) after deleting the installed
  `@opencut/editor-ports`. It failed exactly as required:
  `error: Cannot find module '@opencut/editor-ports/conformance' from '...adapter\run.ts'`,
  `REAL_EXIT_CODE[control-3-import]:1`, `CONTROL-3 removal: PASS`.

### Group 5 findings (recorded, not patched — frozen-surface pressure goes to LEAD)

1. **The classic storage barrel is not loadable by a plain TS consumer.** In-repo (bun 1.2.2 and
   1.2.18): `wasm.__wbindgen_start is not a function` — the migration chain is transitively
   bound to the `opencut-wasm` artifact (`migrations/transformers/v27-to-v28.ts` imports
   `roundMediaTime` from `src/wasm`, and `services/storage/service.ts` does the same, so the
   barrel and even `migrations/index.ts` directly initialize it). From the tarball install:
   `Cannot find package 'culori'` from `v21-to-v22.ts` — culori is in classic's runtime closure
   but not its declared dependencies. Two different walls, same verdict: the published chain is
   reachable only in a host that already provides wasm + culori (i.e., the app). The adapter
   records the observed error and skips the migration leg distinctly (`run.ts`); the walker is
   proven against the real chain via the published mock entry.
2. **The engine's idempotency ledger is not readable through the declared entries.** No
   `engine.idempotency()` read exists; `dryRun` returns no document; the native capture binder
   (`bindNativeCommittedTransactionStateCapture`) lives at the undeclared deep path
   `./engine/engine`. A third party therefore cannot build a Draft-suite committed-state capture
   that carries the ledger — and placement policies DO inspect it (the draft suite's
   policy-bearing cases fail with `idempotency: []`). The adapter's answer: record the ledger
   itself by observing every keyed apply through its own factory seam (fingerprint via the
   published `canonicalOperationFingerprint`), which is exactly what a diligent third party
   would do — but the read-side gap is real and worth an entry-reachable capture in a future
   change.
3. **The draft suite hardcodes the fixture project id** (`projectId("draft-project")` in its
   sample operations). A conforming factory must open that exact id; nothing in the factory
   options says so. Cosmetic, but worth a doc line in the suite's fixture contract.

### Group 5 build notes

- First draft-suite run failed 3 policy/journal cases — two causes, both adapter-side: (a) the
  capture returned `idempotency: []` while policies inspect the ledger (fixed by the
  recorder above); (b) my fixture opened `alien-draft-project` while the suite's operations
  address `projectId("draft-project")` (fixed by matching the suite's id).
- `import type { AlienProjectStore }` in migrate.ts erased the runtime binding the demo needs
  (`ReferenceError` only when the chain actually loads — caught by the walker test).
- The wasm failure is bun-version-independent (1.2.2 and 1.2.18 identical), so the finding is
  not a pin-away.

## Group 6 — The mutation matrix: nonconforming variant and its named failures (tasks 6.1–6.3)

- **6.1 the variant.** `script/fixtures/third-party-adapter-variant-nonconforming/` — a
  byte-identical copy of the base adapter except ONE hunk in ONE file
  (`logs/group6-variant-single-diff.txt`): `save()` keeps only primitive payload fields and the
  vendor engine's `transactionEngine` document key, dropping every field the store "does not
  know". That is the realistic non-conforming store — it supports the vendor's own engine
  format and silently normalizes every third party's payload.
- **6.2 the named failure** (`logs/group6-variant-scratch.log`, with the in-repo control run in
  `logs/group6-variant-in-repo.log`). The harness grew `--variant-nonconforming`: same
  lifecycle (root controls, tarball install, copy-not-link), materializes the VARIANT template,
  and EXPECTS the run to fail. It failed, `REAL_EXIT_CODE[suites]:1`, with the ports suite's
  opaque-payload case failing BY NAME through the published formatter:
  `[host-port-contract / No port signature exposes an editor-internal or storage-mechanism type]
  port: store, case: a known edit round-trips without losing opaque nested fields
  detail: provider-private payload is absent`.
- **6.3 exactness** — enforced as an executable gate, not a log note. The harness asserts the
  variant run fails EXACTLY the four attributable cases (each name present, total failing-case
  count == 4, any extra is a hard failure naming task 6.3):
  `CONTROL-variant-exactness: PASS (4 failing case(s), every one attributable ...)`. The four,
  with their requirement attributions:
  1. ports `a known edit round-trips without losing opaque nested fields` — the defect's own
     case (opaque nested fields + Date/Map payload dropped).
  2. ports `project values are defensively cloned in both directions` — same payload shape
     assertion fails (`provider-private payload is absent`) before cloning is even exercised.
  3. engine `T1: opaque provider fields survive adapter round-trip` — the ENGINE suite catches
     the same store defect through the adapter round-trip (`unknownSentinel was lost`).
  4. engine `T1: Project dry-run/apply/replay/reopen preserves one durable candidate` — the
     engine's opaque sibling beside the document key is dropped (`Project apply lost an opaque
     sibling`).
  Base passes all of these (36+21+38+22+29 with identical case counts); transaction, draft,
  vectors, and the corrupt-taxonomy case (`saveLibraryRecord` path) stay green in the variant —
  the defect cannot reach them, and no case fails extra. In-repo and from-tarballs the failure
  set is identical — the matrix is environment-independent.
  Cross-suite detection is the notable outcome: both the PORTS suite and the ENGINE suite name
  the dropped-fields defect independently, so a host author consuming either surface is
  protected.

## Group 7 — Close-out: checker audit, frozen surfaces, docs, spec sweep (tasks 7.1–7.6)

**7.2 — frozen-surface control (ran first; it feeds the audit).** P2's method at this change's
base `8248a115`: `git show <base>:<path> | cmp -s` (stat-cache-immune) over the four frozen
S03+S04 surfaces, plus `git diff --stat 8248a115..HEAD` over the five conformance suite modules.
All four IDENTICAL, all five diff-empty — record with method and surface list in
`evidence/frozen-signature-README.md`. No frozen signature changed; the `failed` condition never
arose; nothing escalated. `check-port-boundary` (which pins the frozen port-contract signature
directly) ran green in this group's sweep as independent corroboration.

**7.1 — census + the checker audit.** Final census movement over the base, fully attributed:
1078 → 1106 repo files scanned, 982 → 988 package-graph files, 359 → 361 `@opencut/*`
specifiers, 360 → 362 cross-package edges. Per group: Group 2 +2 files (the corpus entry);
Group 3 +4 files and both new specifiers (the contracts drift-guard test's two
`@opencut/editor-ports` imports); Groups 5–6 +22 files = 20 code files + the two adapter
`package.json` manifests, all under `script/` and therefore outside every package graph — their
`@opencut` specifiers are the third-party consumer's own, deliberately uncounted. The
checker's repo-wide no-elftia-import enumeration auto-covered every new file (its scanned-file
count is the 1078 → 1106 leg above); both controls re-run green at close-out (negative: "every
rule is proven able to fail"; converse: "no rule fires on a legal case" — exit 0 each).

Per-checker rows for the new paths (27 checkers swept, `logs/group7-all-checkers.log`, every
one with an `EXIT[<name>]:<code>` line — 23 zero / 6 nonzero):

- `check-package-boundary` — **follows**: census above; fixtures live under `script/`, the
  adapter's `@opencut` imports resolve through the installed tarballs in the scratch run, never
  through the repo's package graph. Controls green.
- `check-runtime-asset-boundary` — **follows**: scanned modules moved 835 → 838, exactly the
  three new package source files (`vectors/corpus/index.ts`, the two `conformance/requirements`
  modules); the `script/` fixtures are not production modules of any host and are not scanned.
  Green, "every Host and every required asset/Worker layer are present".
- `check-port-boundary` — **follows**: green; independently corroborates the frozen ports
  barrel (7.2 above).
- `check-distributable-boundary`, `check-storage-boundary`, `check-transaction-boundary`,
  `check-reference-boundary`, the four `check-surface-*`, the three `check-wasm-*`,
  `check-host-composition`, `check-next-imports`, `check-editor-singleton`,
  `check-react-singleton`, both `check-session-*` — **deliberately scoped, because** their
  domains are the package graphs and host apps: this change adds three ordinary package source
  files (covered by the green runs above) and zero paths under `apps/` (verified:
  `git diff --name-only 8248a115..HEAD -- apps/` is empty). Editor-singleton's scan count is
  byte-stable at 780/40 — no new runtime or command module entered its scope.
- `check-agent-evidence` — **follows**: green with all of this change's evidence logs present.

The six nonzero exits, each dispositioned by name against P2's precedent
(`archive/…-s05-second-host/evidence/logs/group-9-all-checkers.log`, report §9.3) — the set is
exit-code-identical to P2's six, and every cause is verified against THIS change's facts:

- `check-type-baseline` (1): the two "S01 regression" FAIL rows are byte-identical diagnostic
  text at the same file paths and line numbers as P2's sweep (same pin `cf5e79e9` comparison) —
  P1's move artifact. Both files are diff-empty since this change's base `8248a115` (verified),
  so this change cannot have produced them. The checker's scope grew 935 → 941 repo files
  (+6 = this change's new in-scope package files) and they produced zero diagnostics.
- `check-emitted-runtime-assets` (1): Next-output red (`relative-next-static-escape` in
  `static/media/worker.dd71b7fd.ts` — the same worker chunk hash as P2's record). The `.next`
  tree was built 2026-08-14 12:23, ~19 h before base `8248a115`; this change never builds
  `apps/web` and touches zero `apps/` paths. The red existed at the branch point with the same
  bytes.
- `check-asset-manifest` (2): the disclosed no-server attempt — no preview server at
  `127.0.0.1:4173` (vite preview binds `[::1]` by default; the checker fetches `127.0.0.1`).
  Same cause as P2's two exit-2 lines. This change modifies zero host/app/asset paths, so the
  checker's input domain is byte-untouched; the last committed exit-0 evidence remains P2's
  serve-dist stand-in (`archive/…/logs/group-5-composition-evidence.log` §[C-retry]).
- `check-resolution-equivalence` (1): fail-closed by design — it verifies staged
  import-specifier rewrites and exits 1 ("nothing was verified") when the staged diff contains
  none. This change is all-additive and rewrites no specifier.
- `check-headless-graph` / `check-headless-semantic-result` (2 each): usage-gated harnesses
  (explicit build coordinates; two headless report JSONs). No bare form exists to sweep; P3
  claims nothing headless.

Zero new red attributable to P3: every nonzero is a pre-existing condition P2 already
dispositioned, re-verified here against this change's base and diff.

**7.3 — package suites.** `bun test` over both touched packages and the adapter's own tests,
self-logged per leg (`logs/group7-package-tests.log`): `EXIT[ports]:0`,
`EXIT[contracts]:0`, `EXIT[adapter]:0` (the two migration-walker tests against the real
31-step chain, 4 expect calls, green).

**7.4 — BOUNDARIES.md.** §13 closed out: the deferred "lands at close-out" sentences replaced
by the end-to-end scratch-run record (what runs where), the three no-linking controls
including the adapter-shaped removal re-proof, the mutation leg's executable exactness gate,
the P6 reuse seam (`packSdkTarballs`/`SDK_PACKAGES` import; the runner's three env seams as
the CI blueprint), the non-coverage statement (no CI leg — P6's, reusing this harness;
registry behaviour excluded by the §4.1(a) ruling; the adapter is not a Host and claims no
browser-manager surface beyond the Draft fixture's needs), and the final census with
attribution.

**7.6 — spec-falsification sweep.** Which governance-spec §3 groups this change advanced, and
which it deliberately left untouched (governance spec = the Slice spec at
`elftia/rasen/work/opencut-agent-editor-sdk/slices/05-community-beta-second-host/spec.md`):

- **§3.5 advanced fully — this change is §3.5's delivery.** The five suites ran from installed
  tarballs in a scratch project outside the monorepo with no workspace linking (§4.1(a));
  failures read as frozen requirement → case → detail, not stack traces into our internals
  (the requirement indices and formatters); and it is proven by doing: the worked
  conforming-but-differently-shaped adapter (an alien flat-JSON-tuple store no Host resembles)
  passes all five suites in-repo AND from tarballs, while the deliberately non-conforming
  variant fails exactly its four attributable named cases.
- **§4.1(a)'s harness obligation discharged.** The narrow reading's own cost paragraph
  demands that packing, the `files` field, the exports map as an installer resolves it, and
  dependency resolution from outside the monorepo be tested anyway, or "an external developer
  can consume" degrades into "we can import our own workspace". The pack-and-install harness
  tests exactly that chain (real `npm pack`, `file:` deps + `overrides` install, lstat +
  lockfile copy proof, removal re-proof). Registry behaviour stays excluded, per the ruling.
- **§3.1 re-proven, not moved.** Three entry additions, each attributed to its consumer;
  boundary checker green over the widened census with both controls; frozen surfaces
  byte-identical at a third base (`8248a115`).
- **§3.4 followed.** The adapter consumes the packages only through declared entries; the
  checker's repo-wide Elftia-absence leg green over all +28 new files.
- **Deliberately untouched:** §3.2/§3.3 (Host legs — P2's; P3 adds no Host and moves no
  behaviour); §3.6 (versioning and experimental labels — the labeling child's); §3.7's
  published examples and CI execution beyond this harness (examples are the published-examples
  child's; the CI leg is P6's, reusing `packSdkTarballs` rather than re-implementing); §3.8
  (legal/provenance closure — the provenance child's); §3.9 (no inherited defect was patched:
  the classic-chain loading failures are recorded as findings and escalated, and frozen-surface
  pressure would have been returned, never applied — none arose).

## Open items

- **Phantom-dep blocker (escalated to LEAD, awaiting ruling):** confirmed concretely in Group 5
  — from the tarball install the chain dies on `culori`; in-repo it dies on the wasm artifact
  init. The adapter's migration leg records the finding and skips distinctly; the walker is
  validated against the real chain via the published mock entry. A package-side fix (declare or
  bundle the closure) is LEAD's call.
- Group 7 complete (see above). Group 8 (EOL audit, staging guards, ship) remains.
