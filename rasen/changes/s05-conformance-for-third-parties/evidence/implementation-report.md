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

## Open items

- **Phantom-dep blocker (escalated to LEAD, awaiting ruling):** confirmed concretely this group
  — from the tarball install the chain dies on `culori`; in-repo it dies on the wasm artifact
  init. The adapter's migration leg records the finding and skips distinctly; the walker is
  validated against the real chain via the published mock entry. A package-side fix (declare or
  bundle the closure) is LEAD's call.
- Groups 6–8 pending.
