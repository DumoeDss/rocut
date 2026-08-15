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

## Open items

- **Phantom-dep blocker (escalated to LEAD, awaiting ruling):** `@opencut/editor-classic`'s
  runtime closure imports culori / opencut-wasm / react, blocking classic consumption outside
  the monorepo. Affects only tasks 5.4 / 6.2 scratch legs; everything else proceeds.
- Groups 4–8 pending.
