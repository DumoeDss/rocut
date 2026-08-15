## Context

What P6 builds on, all measured and none re-derived:

- **The harness to reuse (never rebuild):** `script/pack-sdk-tarballs.mjs` exports
  `packSdkTarballs`/`SDK_PACKAGES` (four tarballs: three packages at `0.2.0` plus
  `opencut-wasm` from `rust/wasm/pkg`; `overrides` map `opencut-wasm` to the fourth tarball;
  `npm install --legacy-peer-deps`; react deliberately not auto-installed). Six env seams:
  `OPENCUT_SCRATCH_ROOT`, `OPENCUT_BUN` (default `npx --yes bun@1.2.18`),
  `OPENCUT_PREPACKED_DIR`, `OPENCUT_TARBALL_OUT_DIR`, `OPENCUT_ADAPTER_TEMPLATE`,
  `OPENCUT_VARIANT_TEMPLATE`. The no-linking controls: outside-tree/outside-Temp assertions,
  copy-not-link (`lstatSync` + lockfile `file:` with no `workspace:`/`link:`), the
  remove-the-install re-run proof, `CONTROL-react-free`.
- **The labeled surface to cite:** 35 entries (frozen 16 / provider 13 / experimental 6,
  dangling 0), per-package `surface.json` + policy READMEs ship in the tarballs, non-frozen
  entries carry one exact `@opencutSurface` marker, labels change **no import behavior**, and no
  example machinery may read `surface.json` at runtime.
- **The consumer view to promote:** P5's archive-bound `consumer-view-from-tarballs.mjs` —
  0.x versions, README policy anchor, `surface.json` set-equality against the export map,
  markers in extracted source, fail-closed on dangling declared entries. It caught
  `./vectors/drivers` while every workspace-side gate was blind.
- **The wasm-init decision owed in-plan:** classic's published migration chain dies at wasm
  initialization in plain-TS consumers (`wasm.__wbindgen_start is not a function`), identical
  in-repo and from tarballs; the only working init path is the experimental-labeled
  `./evidence/wasm-test-mock` entry; the provider-chain→experimental-entry dependency is
  recorded in `surface.json` and classic's README.
- **The checker family:** 28 checkers, 22 exit-zero / 6 nonzero (the known set
  `{asset-manifest, emitted-runtime-assets, headless-graph ×2, headless-semantic-result ×2,
  resolution-equivalence, type-baseline}`); census arithmetic derives from the checker's own
  printed filter, never prose; `boundary.json` consumers now carry `{id, root, ownership}`
  records and the checker derives scan roots from them.
- **CI today:** one job, `matrix.os: [ubuntu, windows, macos]`, wasm checks + Next build.

## Goals / Non-Goals

**Goals:**

- Four minimal-but-real examples, one lesson each, committed as self-contained templates and
  executed from installed tarballs outside the monorepo under the inherited controls.
- A CI job that executes all four plus the standing consumer view — the portfolio's first
  on-push from-tarballs evidence.
- Labels visible in example documentation; the wasm-init honest-pair decided here, not
  mid-apply; every new path inside the checkers' scan sets with recorded decisions.

**Non-Goals:**

- Touching the four frozen surfaces (byte control stands), the packages' export maps or
  `surface.json` (no entry is expected to be forced; if one is: classified at birth, forcing
  example named — P5's rule), the 28 checkers' rules, any `apps/*` code, Electron anywhere in
  the examples (the electron Host already covers desktop), the local-only checkers' promotion,
  OS-matrix extension, publishing, or P7's legal content inside example files.

## Decisions

### E1 — Location and workspace stance: top-level `examples/`, never a workspace member

`examples/<name>/` with four project dirs. The root `workspaces` globs are `apps/*` and
`packages/*`, so `examples/` is invisible to the workspace by construction — an example that
resolved through the monorepo would be exactly the §3.7 failure ("tests our aliasing"). The
directory is declared as a **consumer** in `packages/boundary.json` (`{id: "examples", root:
"examples", …}` — implementer settles `ownership` shape beside the existing three), so the
derived scan roots pick it up: `public-entry-only` examines the examples' `@opencut/*`
specifiers, and the census grows by their code files. `no-elftia-import` covers them repo-wide
automatically. *Rejected: `apps/examples/*`* — inside the workspace glob, wrong by construction.
*Rejected: one monorepo-style multi-example package* — each example must be an independent
project an adopter could copy whole.

### E2 — The four shapes, and what "executed" honestly means for each

Each example is a standalone project (own `package.json` with `@opencut/*` dep names at `0.2.0`
— the harness resolves them to packed tarballs via the overrides mechanism; own tsconfig with a
`tsc --noEmit` self-check as part of its execution; own README). Execution always means:
materialized into the scratch project, installed from tarballs, run, self-logged exit codes.

1. **`install-packages`** (bun, no browser): import from declared React-free entries
   (ports' `.`/`in-memory`, contracts' `.`/`vectors`/`vectors/corpus`), print resolved versions,
   read the installed `surface.json` and policy README **as data an adopter reads them** (not
   runtime machinery — a verification script), and assert the installed classic metadata
   (version, export-map shape) **without importing classic's runtime** — classic's React peer is
   deliberately absent here (`CONTROL-react-free` is the pattern), and the React-bearing runtime
   belongs to example 2. Execution = the script's assertions green.
2. **`embed-surface`** (Vite + React + Playwright, headless): mounts the editor Surface from the
   tarballs — stylesheet through the declared `./surface.css` entry, React satisfied by the
   example's own `react`/`react-dom` deps (the peer-dep contract working as designed), a minimal
   **committed** asset set for a GPU-free boot, renderer "none" with the swiftshader flags as
   fallback. Execution = `vite build` succeeds against the installed TS source **and** a
   Playwright smoke asserts a booted, interactive timeline (mount assertions, one interaction) —
   build success alone is not execution (the P1 vite Blocker is the precedent). CI has no GPU;
   the established headless patterns carry it.
3. **`custom-storage`** (bun): P3's adapter promoted to example shape — own `ProjectStore`
   behind a deliberately alien representation, published engine over it, port conformance run
   from the tarballs. **Migration decision, made here: the mock-entry honest-pair.** The
   production path runs and records its skip distinctly; the real 31-step chain is validated
   through `@opencut/editor-classic/evidence/wasm-test-mock`; and the README states verbatim
   that the example therefore depends on an experimental-labeled entry and inherits its
   instability. *Scope-around rejected:* it would hollow out the most storage-shaped behavior an
   adopter needs to see, and the honest pair demonstrates both the current truth and the
   validated chain — the mechanics are proven working from installed tarballs by P3's walker.
4. **`agent-transaction`** (bun, no browser): the published `AGENT_SCENARIO` + corpus entry
   drive the published engine over the example's own store through the S03 transaction API —
   steps executed and asserted, ledger written, full reload-reopen durability assertion against
   the same store. Execution = the scenario's declared steps all pass.

### E3 — The runner and the P3 refactor it owes

`script/run-published-examples.mjs`: pack (import `packSdkTarballs`), scratch lifecycle,
install with the fourth-tarball override, materialize each example, run each one's own execution
entry, collect self-logged exit codes, run the no-linking controls once per install. The scratch
lifecycle + controls currently live inline in `run-scratch-conformance.mjs`; P6 extracts them
into an importable module **as a behaviour-preserving refactor whose control is P3's own runner
re-run green afterward** (byte-comparable output; the controls' assertions unchanged). The
examples runner gains two env seams of its own (`OPENCUT_EXAMPLES_ROOT` defaulting under the
scratch root; `OPENCUT_EXAMPLES` selecting a subset) so CI can run all four and a developer can
iterate on one.

### E4 — The consumer view becomes standing tooling

P5's four clauses move from archive-bound evidence into a committed module the runner executes
every run (and CI therefore every push): 0.x versions, README policy anchor, `surface.json`
set-equality against each export map, markers present in **extracted** source, and the
fail-closed dangling branch. This is a promotion, not a rewrite — the archive remains the
historical record; the standing gate is the port surface P5's handoff names. A
`--consumer-view-only` mode gives the cheap daily gate independent of the examples.

### E5 — The CI leg: one job, env-driven, narrowly claimed

A new `sdk-examples` job in `bun-ci.yml`: `ubuntu-latest`; checkout; run
`node script/run-published-examples.mjs` with `OPENCUT_SCRATCH_ROOT` pointed at a non-Temp,
non-repo path (the outside-Temp assertion is a this-machine guard — in CI the root comes from
env, e.g. under `$HOME`, never `runner.temp`) and `OPENCUT_BUN` defaulted. The job executes all
four examples and the consumer view against freshly packed tarballs (the `rust/wasm/pkg` fourth
tarball packs from the checkout — CI already builds wasm there).

Deliberately **not** claimed, recorded in the job's own comment and `BOUNDARIES.md`: the ~28
local-only checkers stay local (promoting them is a separate decision with its own census
work); the OS matrix is not extended — the runner is OS-neutral through its seams and extension
is a YAML change, not a port; wasm and Next jobs untouched; nothing publishes. The leg's
evidence is the run's own log artifact (self-logged exit codes, per-example `EXIT[<name>]:<code>`
lines — derived counts, never recalled).

### E6 — Labels in documentation, never in runtime

Each example's README carries a consumed-surface table: every `@opencut/*` specifier it imports,
its P5 class, and one line on why that class is right for this use. The custom-storage example
adds the experimental-inheritance statement (E2.3). No example reads `surface.json` at runtime —
labels are declarative metadata for humans and checkers (P5's rule, restated as an example-side
obligation so the examples don't accidentally build label-dependent machinery).

### E7 — Sequence

1. **Baseline:** boundary census + family sweep (the known 22/6 nonzero set), frozen byte
   control, `examples/` absent — recorded with method inline.
2. **Harness first:** the lifecycle/controls extraction with P3's runner re-run green; the
   consumer-view promotion with its `--consumer-view-only` gate; the examples runner skeleton
   over one trivial placeholder example (the earliest end-to-end proof).
3. **Examples one at a time, cheapest first:** `install-packages` → `agent-transaction` →
   `custom-storage` (honest pair) → `embed-surface` (heaviest — build + browser smoke last).
4. **Consumer declaration + census:** `boundary.json` +1 consumer, census growth reconciled
   against the examples' file counts, checker-audit rows for every checker that could see the
   new paths.
5. **CI leg:** the job, env-driven, green on push to the branch's CI mirror (or recorded
   honestly if CI can only be proven post-delivery — the scenario clauses are authored to pair
   with evidence lines, per the F2 lesson).
6. **Docs + close-out:** `BOUNDARIES.md` examples section, README label tables, non-coverage
   statement, delivery audit (scenario clause ↔ evidence line), frozen control re-run, strict
   validate.

## Risks / Trade-offs

- **[The P3 refactor weakens the controls invisibly.]** → The refactor's acceptance is P3's own
  runner re-run green with comparable output; the controls' assertion lines are diffed, not
  eyeballed.
- **[The embed example needs assets the canonical allowlist places in app build tooling.]** →
  The example carries its own minimal committed set with a README pointer to the canonical
  allowlist; if the set proves larger than minimal, that is the recorded moment to propose
  moving the allowlist — a decision, not a quiet cross-tree import (templates are copied out;
  relative imports into `apps/` break by design).
- **[CI proves the leg only after push.]** → The runner's local run IS the executable evidence;
  the CI scenario clause is authored to what a run produces (exit-code lines), and the first
  post-delivery push closes the loop — stated, not hidden.
- **[An example appears to need a missing export entry.]** → Escalate with the forcing consumer
  named; inventing a barrel for symmetry is the eliminated hypothesis (the `./vectors/drivers`
  ruling). Classification-at-birth rules apply if an entry is added.
- **[The wasm mock entry's experimental class changes shape.]** → The example's README already
  states the inheritance; a breaking change to the entry is a documented, labeled consequence —
  exactly what labels are for.
- **[Census arithmetic drifts into prose.]** → Every figure comes from the checker's own printed
  census at a named commit (P5's rule); the delivery audit re-derives counts from log lines.

## Migration Plan

Additive: four example templates, one runner, one promoted module, one CI job, one consumer
declaration, a behaviour-preserving extraction in P3's runner. Rollback is `git revert`; the
extraction's rollback restores P3's inline shape. Ship mode **local (commit only)** — the
portfolio delivers once, at the parent.

## Open Questions

- **`embed-surface`'s exact GPU-free configuration** (renderer "none" vs swiftshader-only) —
  settled empirically at its task with the boot-smoke as the judge; both patterns are
  established in-repo.
- **The examples' TypeScript versions** — each pins its own; aligned with the repo's by default,
  drift allowed if an adopter-realistic constraint demands it (recorded in the example's README).
- **Whether the CI job also runs `--consumer-view-only` as a separate cheap step** — folded into
  the examples run by default; splitting is a YAML nicety decided at the leg's task.
