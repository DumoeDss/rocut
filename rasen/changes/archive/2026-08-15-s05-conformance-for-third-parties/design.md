## Context

What exists and is reused, measured:

- **All five suites are already outside-shaped.** Each is a plain async function taking a
  fixture/factory and returning a structured report: `runPortConformance`
  (`@opencut/editor-ports/conformance`, per-port × per-case results, `"portable"` store profile,
  opt-in destructive `exerciseMigration`), `runTransactionConformance`
  (`@opencut/editor-contracts/conformance`), `runDraftEditingConformance`
  (`…/draft/conformance`), `runTransactionEngineConformance` (`…/engine/conformance`), and
  `runTransactionVectors` (`…/vectors`, plus the published in-memory and durable target drivers
  under `./vectors/drivers`). None requires React, a Host port, a test framework, or filesystem
  access; `detail` fields carry `error.message` strings, not stack traces.
- **The published surfaces deliberately take text and data, never paths** —
  `loadTransactionVectorCorpus({ manifestText, files, contract })`,
  `parseContractSurface({ operations, transaction, engineTypes })`,
  `runTransactionVectors({ corpus, contract, open })`. The file-reading harness
  (`vectors/__tests__/corpus-fixture.ts`) is test-only and unreachable from a declared entry.
- **The packages pack.** `npm pack --dry-run` on `editor-contracts` (npm 11.9.0) emits a 55-file,
  580.3 kB-unpacked tarball with shasum + integrity, `src` shipped whole (`files: ["dist","src",…]`),
  corpus JSONs included. All three manifests are `"private": true` — legal to pack, illegal to
  publish, which is exactly B1's shape.
- **`ContractSurface` is three string arrays** (`operationKinds`, `errorCodes`, `issueCodes`) —
  trivially publishable as data.
- **Two measured blockers, both known before this design:** `editor-contracts` declares
  `@opencut/editor-ports: workspace:*`, which a tarball carries verbatim; and
  `runStorageMigrations` is IndexedDB-hardwired
  (`services/storage/migrations/runner.ts:32-36` constructs `new IndexedDBAdapter(…)` directly),
  so a non-browser adapter implements migration by replicating the per-record walk over the
  published `migrations` + `CURRENT_PROJECT_VERSION` — P2's handoff names a package-side
  runner-core export as the legal attributed fallback if that proves structurally necessary.

Machine constraints carried from the portfolio context: `%TEMP%` is unusable for scratch trees
(AV hangs link creation; use an E:-drive path outside Temp), background exit codes lie
(self-log `REAL_EXIT_CODE`), the Write tool flips CRLF, and census figures must state their
method and measurement point inline.

## Goals / Non-Goals

**Goals:**

- Pack, install-into-scratch, and run: the full conformance evidence path executes against
  installed tarballs, with controls proving nothing resolves through the workspace.
- An outside adapter author's complete journey works: install, import the suites, obtain the
  corpus and contract surface from declared entries, run, and read failures that name the frozen
  requirement violated.
- A worked third-party-shaped adapter (not a Host) passes every applicable suite; a deliberately
  non-conforming variant fails exactly the named cases.
- Every export-map addition is attributed; every new path joins the checkers' scan sets with a
  recorded decision; the census growth is evidence, not a side effect.

**Non-Goals:**

- Editing any suite's code or any frozen S03+S04 signature (the legibility layer sits **beside**
  the suites; pressure to edit one returns to the contract as a `failed` finding).
- A CI leg (P6's, reusing this harness), registry behaviour (excluded by B1), version bumps and
  experimental labeling (P5), example authoring (P6), notices/SBOM inside tarballs (P7), the
  parity harness and Host profiles, the 255-error lint debt.

## Decisions

### E1 — Harness shape: one pack module, one runner script, one scratch lifecycle

`script/pack-sdk-tarballs.mjs` — packs the three packages via `npm pack` into a configurable
output directory (default: a gitignored build dir; never committed), and writes a committed
**tarball manifest** (npm's shasum/integrity per tarball + per-file inventory with SHA-256) into
the change's evidence directory. This is the "digest-manifested" half of B1's published reading,
and it is the module P6 imports rather than re-implementing.

`script/run-scratch-conformance.mjs` — owns the scratch project lifecycle: create fresh (wipe and
recreate — idempotent, no reused state), install (E3's mechanism), materialize the committed
adapter template into it, run the suites under **bun** (the TS-capable consumer the source-shipped
tarballs require — no `dist/` exists to fall back on), capture reports and self-logged exit codes,
and run the no-linking controls (E4). One process, one foreground log, no nested backgrounding.

*Rejected: a single do-everything script* — P6 needs pack+install without P3's adapter, so the
seam between them is the deliverable. *Rejected: a check-*.mjs checker for the whole thing* — the
27 checkers are static scanners; this harness packs, installs and executes, the
`run-c7-headless-host.mjs` runner precedent.

### E2 — Scratch placement and lifecycle

Default root: an E:-drive sibling path **outside the monorepo and outside any Temp directory**
(measured AV hazard; a hanging junction IS the signature). The default is overridable by env
(`OPENCUT_SCRATCH_ROOT`) so CI (P6's leg) never inherits this machine's geography, and the harness
asserts, every run, that the resolved root is not inside the repo tree and not under any Temp
path. Fresh-per-run: the harness refuses to run against a pre-existing root it did not create
(wipe + recreate + marker file), so a stale install can never masquerade as evidence.

### E3 — The `workspace:*` gate: resolution proven before the harness is built on it

A packed `editor-contracts` tarball carries `"@opencut/editor-ports": "workspace:*"` verbatim,
which cannot resolve outside a workspace. The gate (first task) packs all three tarballs, creates
a minimal scratch project, and measures the candidate mechanisms in order:

1. **npm install with `overrides`** mapping each `@opencut/*` name to `file:<tarball>` — npm's
   native protocol; tarball `file:` deps install as real copies.
2. **bun install with `overrides`** — same shape under bun, keeping the toolchain uniform.

*Rejected before the gate: rewriting the packed manifest* (pack → extract → fix → repack) — the
tarball under test must be the artifact `npm pack` produced, byte for byte, or the harness proves
nothing about the real distribution path. *Rejected: `--install-links`-style copy flags as the
primary mechanism* — they answer link-vs-copy, not the unresolvable protocol. The chosen
mechanism, its exact commands, and the failure text of the rejected one are recorded in the gate
evidence; the harness hard-codes nothing the gate did not prove.

### E4 — No-workspace-linking is a three-sided control, not an assertion

1. **Location:** the scratch root is outside the repo tree (asserted, E2).
2. **Copies, not links:** after install, each `node_modules/@opencut/*` is asserted to be a real
   directory copy — no symlink/junction (Windows: `readdir` + attribute check; a link that
   satisfies `fs.statSync(...).isDirectory()` is not sufficient, `lstatSync` distinguishes), and
   the scratch lockfile records tarball `file:` resolutions, not workspace ones.
3. **Dependency on the install, not the workspace:** a control run **removes** the installed
   `@opencut/editor-ports` copy and re-runs the adapter's import step — it must fail to resolve.
   A run that still succeeded would be reaching into the monorepo, which is exactly what this
   control exists to catch. Recorded like every other negative control, with its failure text.

The three together stand in for the registry install B1 excluded: everything a registry exercises
except the registry.

### E5 — Consumable entries: corpus as exact bytes, contract surface as data

One new `editor-contracts` entry, `./vectors/corpus`, exporting:

- `readPublishedCorpusText(): { manifestText: string; files: Record<string, string> }` — reads the
  three shipped `src/vectors/corpus/*.json` files via `node:fs` relative to `import.meta.url`,
  returning **exact file bytes**. This is deliberately the published form of the "harness reads
  files" layer the in-repo corpus-fixture already performs — the runner stays path-free; the
  corpus entry is the path-taking edge, now importable from an installed tarball (the files ship
  because `files` includes `src`).
- `PUBLISHED_CONTRACT_SURFACE: ContractSurface` — the three string arrays as static data.

*Rejected: static JSON imports* (`import manifest from "./corpus/manifest.json"`) — the parsed
object re-stringifies to different bytes, and the manifest's corpus digest is over exact bytes;
a consumer whose loader rejects its own published corpus is a self-inflicted §3.5 failure.
*Rejected: a generated `.ts` embedding the text* — a 500 kB generated blob that review cannot
read and regeneration can silently desync.

**Drift guards (in-repo, fail-closed):** a test asserts `PUBLISHED_CONTRACT_SURFACE` deep-equals
`parseContractSurface(readContractSources())`, and that `readPublishedCorpusText()` round-trips
`loadTransactionVectorCorpus` cleanly with the recomputed digest matching the manifest. If either
drifts — a contract export added, a corpus file edited — the entry is wrong and the guard is red.

### E6 — Legibility: a requirement index beside the suites, joined by name

The suites report `{ name, status, passed, detail? }` per case — structured, but a case name like
`"mismatched identity"` does not name the frozen requirement it exercises. The fix is published
**beside** the suites, not inside them:

- Per-package `./conformance/requirements` entries (one on `editor-ports`, one on
  `editor-contracts`) exporting a **requirement index** — every case name each suite can report,
  mapped to the frozen requirement it exercises (the S02/S03+S04 requirement ids as recorded in
  the specs) — plus `formatConformanceFailures(report)` rendering each failure as
  `requirement → case → detail`.
- **Drift guard:** an in-repo test runs every suite against its reference implementation and
  asserts every reported case name has an index entry — a renamed or added case without an index
  row is red, the same fail-closed shape the port-role register uses.

*Rejected: threading an optional `requirement` field through the five result types.* It is
assignment-compatible widening, but it edits five frozen-era modules to avoid one published
mapping, and every one of those edits is drift risk against the freeze. The index approach
touches no suite, fails loudly on drift, and is joinable by any consumer.

### E7 — The worked adapter: third-party-shaped, committed as a template, run from tarballs

`script/fixtures/third-party-adapter/` (committed; scanned by the boundary checker like any
source) contains the adapter the harness copies into the scratch project:

- **Its own store** — an in-memory `ProjectStore` whose internal representation is deliberately
  alien (records serialized to JSON strings in a `Map`, say): the conformance suite's
  opaque-payload case is the provider-private round-trip proof, and an alien shape makes
  normalization impossible to hide.
- **Its own neutral roles** — a differently-seeded id generator, a data-URL asset resolver, a
  recording diagnostics port: conforming-but-differently-shaped at every role.
- **The published engine over its store** for the engine, draft and vectors suites
  (`openTransactionEngine` + the durable-driver pattern) — the adapter's own transaction target
  for the transaction suite, and its own vectors target factory.
- **Migration by replication** — `migrate()` walks the published `migrations` list to
  `CURRENT_PROJECT_VERSION` over its own records: all-or-nothing, fail-closed (a refusing
  transform is a failure, not a `break`), chain reaching current. This is the third-party reality
  test for the IndexedDB-hardwired runner. **Fallback, attributed if forced:** a package-side
  runner-core export (`./storage/runner-core`, sequence-without-IndexedDB) is a legal monotone
  addition — taken only if replication cannot be made conforming, and then recorded as a finding
  about the surface, not a private convenience.
- **A `variant-nonconforming/` sibling** — the same adapter with its store normalizing payloads
  (dropping unknown fields on save). The mutation matrix: the variant must fail the ports suite's
  opaque-payload case (and any normalization-sensitive case) **by name**, and nothing else may
  newly fail; the base adapter passes every suite it runs.

The adapter is not a Host: no React, no window, no parity profile. Its whole job is to be what
§3.5 describes — someone else's implementation, run against our published suites from installed
artifacts.

**2026-08-15, review round 1 (finding F2) — the migration clause's two-mode truth.** The
adapter-passes scenario originally read "…passes on the portable profile with migration
exercised", authored at propose time on the expectation that the packed chain would initialize
in a plain TS consumer. The executed LEAD ruling (recorded verbatim in
`evidence/gate-1-tarball-resolution.md` under "## LEAD ruling"; see also the planning context's
P3-apply entry) accepted the honest-pair end state the evidence actually shows — its fork landed
branch (b) — and the spec clause now states exactly that: in the repository the migration walker
is validated against the real 31-step chain through classic's published `./evidence/wasm-test-mock`
entry, with the wasm-init finding recorded distinctly; from the installed tarballs the suite
passes with the migration leg absent — the skip recorded and named. The wasm-init class
(`wasm.__wbindgen_start is not a function`, identical in-repo and from tarballs) is P1's
disclosed pre-existing crash-masked wasm error, carried Direction-level by the LEAD; amending the
clause before archive keeps the synced main spec from enshrining a THEN the repo cannot meet
from tarballs. (The same review round also added the harness's missing env seams — tarball
output dir and adapter/variant template locations — so the pack requirement's
"root, tarball output and adapter location all env-configurable" CI-readiness clause is
implemented, not just claimed; finding F3.)

### E8 — CI-ready without a CI leg

P3 adds no CI step: §3.5 asks for executed evidence and §3.7's CI execution is P6's, reusing this
harness. CI-readiness is still a requirement on the harness itself — env-configurable roots
(E2), no E:-drive or Windows-specific default, a single entry-point command, and self-logged exit
codes — so P6's leg is a workflow addition, not a harness rewrite. Recorded as non-coverage with
P6 named as owner.

### E10 — Bounded spec-hygiene rider: the P1-move path refresh (LEAD-ruled in scope)

The `transaction-automation-api` spec still names the pre-P1 location in six places. P3's corpus
requirement fixes one as part of its own substance; the other five (`Host-neutral domain types
are frozen`, `The contract contains no editor-internal types`, `A durable transaction engine
consumes the frozen Host port`, `Reusable Draft conformance proves T2 semantics`, `Donor
candidates are explicit, projection-checked, and opaque-preserving`) carry stale
`apps/web/src/editor/contracts/…` paths that P1's archive never refreshed. **Ruled in scope for
P3 by the LEAD 2026-08-14** (recorded by P3's planner; see planning-context): the delta refreshes
the path text to the post-P1 package paths and nothing else — **no requirement semantics,
scenario inventories, or acceptance wording change**, and every scenario heading stays verbatim
(the validator's rule). The point of carrying it as MODIFIED blocks rather than a post-archive
edit is that the archive diff shows intent: each refreshed block is a whole-requirement copy
with only the location moved. Apply-time verification is a task box (Group 7): after archive,
`grep -c 'apps/web/src/editor/contracts' rasen/specs/transaction-automation-api/spec.md` must be
`0`.

### E9 — Sequence

0. **Gate:** pack all three; scratch-install spike for `workspace:*` (E3); mechanism chosen and
   recorded. Nothing else starts before this is green.
1. **Entries + guards:** `./vectors/corpus` and the two `./conformance/requirements` entries with
   their drift-guard tests, in-repo, before any scratch run depends on them. Export-map
   additions attributed in `BOUNDARIES.md`.
2. **Harness:** pack module (with digest manifest), scratch runner (lifecycle, install,
   materialize, run), controls E4.1–E4.2 wired and proven.
3. **Adapter:** base adapter passing all five suites **in-repo first** (workspace resolution),
   then from the scratch project (tarball resolution) — the delta between the two runs is itself
   evidence the entries are complete.
4. **Matrix:** the non-conforming variant's named failures; the removal control (E4.3).
5. **Close-out:** census/checker audit rows for every new path, `BOUNDARIES.md` harness section,
   non-coverage statement, full checker sweep, frozen-surface diff control (the P2 method:
   `git show <base>:<path> | cmp`).

## Risks / Trade-offs

- **[`workspace:*` resists both override mechanisms.]** → The gate runs before anything depends
  on it; the named escalation is a package-side version-literal fix (a manifest change, not a
  frozen-surface change) — decided with evidence at the gate, never mid-harness.
- **[The corpus entry's fs-read breaks under a future bundler consumer.]** → The entry is
  documented Node/bun-shaped (it is the path-taking edge by design); browser consumers compose
  from the runner's data-taking surface, which is unchanged. The limitation is stated in the
  entry's own doc comment, not discovered.
- **[The requirement index drifts from the suites.]** → The drift guard runs every suite against
  its reference target in-repo; an unindexed case name is red. Same fail-closed shape as the
  port-role register.
- **[The adapter quietly depends on repo state, not the tarballs.]** → E4.3's removal control is
  the proof; the in-repo-passes/scratch-passes pair (E9.3) makes any missing entry visible as a
  resolution failure in the scratch run specifically.
- **[AV hangs scratch creation on this machine.]** → E2's placement rule from the start; a hang is
  read as the signature; env override lets the run move without code changes.
- **[Evidence logs lie about exit codes.]** → Every run self-logs `REAL_EXIT_CODE:$?`; sweeps
  emit per-step codes; the reviewer reproduces from the logged line, not the shell's word.

## Migration Plan

Additive: two scripts, three entry modules, one fixture directory, evidence. Rollback is `git
revert`; no existing consumer changes behavior (the entries are new, the suites untouched). Ship
mode is **local (commit only)** — the portfolio delivers once, at the parent.

## Open Questions

- **The override mechanism (E3)** — settled at the gate; npm-first is the expectation, bun the
  fallback, and the choice is recorded with failure text either way.
- **Whether migration replication conforms without the runner-core export (E7)** — settled when
  the adapter's migration cases run; the fallback is a named, attributed addition if forced.
- **The index's requirement-id vocabulary** — the S02/S03+S04 requirement headings as recorded in
  `rasen/specs/`; if review prefers shorter stable ids, the mapping is data, decided once when the
  index is authored.
