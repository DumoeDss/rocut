# Regression evidence — `wasm-determinism-init`

Base `661d7ac8`. Every number below was re-run for this file, not carried from an archive.
Machine: Windows, rustc 1.88.0, wasm-pack 0.13.1, node v24.14.0, bun 1.2.18 (`npx bun@1.2.18`).

## 1. `bun test` — identical on both sides of the change

The decisive comparison is not "before my edits" (the working tree also carries doc edits) but
**with and without the artifact-level change**: `rust/wasm/pkg` reverted to its pre-fix shape (sync
entry deleted, `exports` map stripped, `bun install` re-run) versus the shipped shape.

| | pre-fix shape | shipped shape |
| --- | --- | --- |
| log | `logs/bun-test-prefix-baseline.log` | `logs/bun-test-final.log` |
| result | 724 pass / 6 fail / 3375 expect() | 723 pass / 7 fail / 3375 expect() |
| totals | 730 tests, 118 files | 730 tests, 118 files |

**The one-test delta is attributed and is not this change.** The extra failure is
`C6 independent anchor verifies fresh Vite and Next artifact digests`, which appeared only after
this session built `apps/vite-example/dist`, `apps/vite-example/dist-surface-css` and
`apps/web/.next` for the Host verification below — the anchor
(`script/fixtures/c6-session-resource-closure-anchor.json`) pins digests of a specific proof build,
and a plain `vite build` emits a truncated module graph against it.

Attribution measured, not argued (`logs/c6-anchor-prefix.log`): with the artifact change **reverted**
and the same build outputs present, `bun test script/__tests__/c6-session-resource-boundary.test.mjs`
still reports `17 pass / 1 fail`, failing on the **same** test name. The failure tracks the presence
of fresh build artifacts, not the wasm change. (The same class is on record in the S05 P1 archive,
which regenerated the anchor for exactly this reason.)

The six failures common to both runs are unchanged in name and count:

- `the ports suite passes with the migration case exercised`
- `mask snapping > snaps uniform scale handle for box masks`
- `mask snapping > snaps text mask movement using intrinsic text bounds`
- `custom mask point insertion > splits a segment into two segments at the insertion point`
- `editor singleton boundary > the complete runtime graph has no implicit editor owner`
- `resolveTrackPlacement > batch time spans reject tracks when any span overlaps`

**Why the suite is insensitive to the fix at all** — worth stating rather than leaving as a puzzle:
`packages/editor-classic/src/editor/session/__tests__/wasm-test-mock.ts` calls
`mock.module("opencut-wasm", …)` process-wide, so `bun test` never loaded the real artifact before
this change and does not now. That is precisely why the repair needed a gate of its own
(`check-wasm-init.mjs`) rather than a test in this suite: a test file here would be mocked out by a
sibling and would pass whether or not the artifact works.

## 2. Both Hosts build

| Host | command | result | log |
| --- | --- | --- | --- |
| Next (`apps/web`) | `bun run build` with the CI env block | **exit 0**, 15 routes emitted | `logs/next-build-green.log` |
| Vite (`apps/vite-example`) | `bun run build` | **exit 0**, 3842 modules, built in 41.16 s | `logs/vite-example-build.log` |

Two **failed** Next builds are committed beside the green one, because they are the measurement
that shaped the design and a reader should be able to check it:

- `logs/next-build-node-condition-attempt1-FAIL.log` — with a `node` condition and
  `readFileSync(new URL(…))`: `TypeError: The "path" argument must be of type string or an instance
  of Buffer or URL. Received an instance of URL`.
- `logs/next-build-node-condition-attempt2-FAIL.log` — same condition, realm-independent path
  string: `ERR_INVALID_URL, input: '/_next/static/media/opencut_wasm_bg.00e3ae0a.wasm'` — turbopack
  had rewritten the asset URL to a browser path.

That is why the shipped `exports` map declares `bun` only, plus an explicit `./sync` subpath.

## 2b. The `sdk-examples` CI job, run locally end to end

`logs/published-examples-final.log` —
`OPENCUT_SCRATCH_ROOT=E:/opencut-scratch-wasm node script/run-published-examples.mjs`, exit 0.
**4 examples, 10 legs, every `EXIT[...]` line `:0`** (agent-transaction, custom-storage,
embed-surface, install-packages), including embed-surface's 9-assertion GPU-free Playwright smoke.

The decisive leg is `custom-storage`'s **production** path, which npm-installs the freshly packed
tarballs and runs with no mock anywhere in the process:

```
classic chain: loaded (31 steps, target v31)
suites/ports: passed=true cases=36 (migration exercised)
migration/by-replication: green
  disposable legacy record: migrated 30->31, progress 1/1
  second migration call: not-needed
  declining transform: failed closed (invalid version)
```

Under S05 that leg's job was to record the failure and skip the migration leg distinctly. This is
the wasm-init repair proven **from installed tarballs**, which is the strongest form of the claim
available — and it is what forced the spec and example-documentation deltas listed in §8 below.

## 3. Checker family sweep

`logs/checker-family-sweep.log`. Method unchanged from S05 Group 1: every `script/check-*.mjs` run
bare in name order, one `EXIT[name]:code` line each.

- Family size **30 → 32 files**; **31 swept**. `check-wasm-reproducible.mjs` is excluded by name and
  the exclusion is printed in the log, because it rebuilds the wasm (minutes) — a silent skip would
  read as coverage it does not have.
- **25 exit-zero / 6 nonzero.**
- The nonzero set is **byte-identical to the known set** recorded at S05 P7:
  `asset-manifest:2, emitted-runtime-assets:1, headless-graph:2, headless-semantic-result:2,
  resolution-equivalence:1, type-baseline:1`.

One transient 7th nonzero was found and resolved rather than accepted: `surface-css-boundary:2`
(`refusing empty scan (source=1, emitted=0)`) because a fresh worktree has no
`apps/vite-example/dist-surface-css`. Built with its own config
(`vite build --config vite.surface-css.config.ts`) it reports `scanned 1 source and 1 emitted CSS
file(s) / clean`, exit 0. Building it with the *wrong* config first produced a different failure
(`FAIL [editor-host-selector] …`), which is recorded here so nobody re-derives that dead end.

## 4. The wasm gates

`logs/check-wasm-chain-final.log` — `bun run check:wasm`, all four gates, exit 0:

- `check-wasm-source`: 9 files, 2 Host resolutions, 44 Rust inputs considered, 4 gates wired,
  toolchain pins declared and enforced.
- `check-wasm-paths`: 12 assertions, 285 remapped `/cargo` occurrences (proving the scan is not
  vacuous), 0 disclosed paths.
- `check-wasm-api-surface`: 38 JS / 58 binary exports, 609 imports, 5 pinned files, entry parity,
  3 recorded exports conditions, structural compile.
- `check-wasm-init`: 2 runtimes initialized, 4 cross-runtime values agreed, the real 31-transformer
  chain loaded mock-free, and the pre-fix negative control still fires.

`logs/api-surface-negative-controls.log` — **20 controls, 20 fire** (was 14 before this change; the
six added are `sync-entry-export-drift`, `sync-entry-uninitialized`, `condition-swap`,
`condition-dropped`, `sync-subpath-dropped`, `node-condition-added`).

## 5. Reproducibility

`logs/reproducible-fresh-target.log` — `bun run check:wasm:reproducible`, exit 0.
Second build with a fresh `CARGO_TARGET_DIR` (full recompile at a different absolute path):
**10/10 emitted files byte-identical**, including `opencut_wasm_bg.wasm` at 3,285,863 B
(`7234c951f8bc53d2…`).

## 6. Mutation verification

`logs/mutation-prefix-gates.log` — with `rust/wasm/pkg` reverted to the pre-fix shape:

| gate | result |
| --- | --- |
| `check-wasm-init` | exit 2 — `opencut_wasm_sync.js` is absent |
| `check-wasm-api-surface` | exit 1 — `generated-files: opencut_wasm_sync.js is absent from rust/wasm/pkg` |
| mock-free chain probe under bun | `"error":"wasm.__wbindgen_start is not a function…"` — the original defect, verbatim |
| `check-wasm-source` | exit 0 — correct: it checks resolution and staleness, not initialization. This is the blind spot `check-wasm-init` exists to cover, demonstrated rather than asserted. |

The reverted `package.json` hashed back to **`6eab1bdb…`** — the value the contract carried before
this change — which proves the post-processing is exactly the three-key delta (`files`,
`sideEffects`, `exports`) and touches nothing else in wasm-pack's output.

## 7. Dead-target scan

Executable, over every path-shaped string in the 19 touched files:
`grep -ohE '(script|rust|packages|apps|examples)/[A-Za-z0-9_./-]+' <files> | sort -u` → **582 unique
targets**, each `-e` tested.

**10 non-existent, 0 attributable to this change:**

| target | verdict |
| --- | --- |
| `script/missing-gate.mjs`, `script/registration-swap-sentinel.mjs` | correct by design — synthetic names inside `check-wasm-api-surface`'s own CI-registration mutations, which must not exist |
| `apps/web/src/core`, `apps/web/src/editor/ports/project-store.ts`, `apps/web/src/editor/session/headless.ts`, `apps/web/src/services/storage/browser-project-store.ts` | pre-existing historical prose in `BOUNDARIES.md` / `UPSTREAM.md`, naming pre-extraction locations |
| `packages/editor` | pre-existing — `UPSTREAM.md:44` names it as a **rejected** alternative |
| `script/check-`, `examples/evidence/logs/group5-full-run-clean.log` | scanner artifacts: the first is the `check-*.mjs` glob with `*` outside the character class, the second a mid-path capture of `rasen/changes/s05-published-examples/evidence/logs/…` |
| `apps/web/bun.lock` | **pre-existing CI defect, recorded not fixed** — see findings |

## 7a. The `exports` map does not seal anything that resolved before

Adding an `exports` map to a package seals every subpath it does not declare, so the two claims the
map rests on are measured rather than asserted (`evidence/exports-map-resolution.mjs`,
`logs/exports-map-resolution.log`): **11 specifiers checked, 0 unresolvable.**

- Every deep path still resolves through `"./*": "./*"` — including
  `opencut-wasm/opencut_wasm.js`, which the init gate's negative control imports by name, and
  `opencut-wasm/opencut_wasm_bg.wasm`.
- `createRequire(...).resolve("opencut-wasm")` — which `check-wasm-source.mjs` calls once per Host
  — resolves to the bundler entry with **no `require` condition declared**, because Node's
  `default` is a catch-all. That is why the map does not need one; an `exports` map that declared
  neither would throw `ERR_PACKAGE_PATH_NOT_EXPORTED` and break the source gate.
- `opencut-wasm/sync` resolves to `opencut_wasm_sync.js` under both resolvers.

## 7b. The one assertion this change rewrote — and the review round that corrected the rewrite

`check-wasm-source.mjs` located a CI gate with `workflow.indexOf(gate)`. This change rewrote it,
and **the first rewrite was wrong**, caught by the independent review. Both the error and its
correction are recorded here rather than smoothed over, because the rewrite of an existing
assertion is precisely where a change can quietly widen.

**My first evidence pass overstated the case.** It compared the old form against my first rewrite
over four hand-picked edits and concluded "4/4 vs 3/4, no edit exists that the old catches and the
new does not". The reviewer constructed **nine** cases, including four the first pass had not
imagined, and the conclusion did not survive: there are edits the old form catches and the first
rewrite does not, and — the real defect — the first rewrite reports a perfectly valid **block-form**
(`run: |`) invocation as missing. This workflow already uses block form for its rustup step, so
that was a live false-failure one refactor away.

The shipped form asks the question the check actually means — *does an invocation exist AFTER
`bun install`* — over every invocation line, in inline, `- run:` and block form.
`evidence/gate-form-compare.mjs` (the reviewer's case set, kept as authored, with a `want` column
so each row is judged rather than merely diffed) scores all three forms:

| # | workflow edit | correct | OLD | FIRST rewrite | SHIPPED |
| --- | --- | --- | --- | --- | --- |
| 0 | unchanged | pass | ok | ok | ok |
| 1 | step deleted, comment still names the gate | catches | **WRONG** | ok | ok |
| 2 | step deleted, every mention scrubbed | catches | ok | ok | ok |
| 3 | flag appended to the only invocation | catches | **WRONG** | ok | ok |
| 4 | only invocation moved before `bun install` | catches | ok | ok | ok |
| 5 | extra early invocation with a flag, real step still after install | pass | **WRONG** | ok | ok |
| 6 | extra early invocation soft-failed, real step still after install | pass | **WRONG** | ok | ok |
| 7 | real step moved early with a flag, exact-form step at EOF | pass | **WRONG** | ok | ok |
| 8 | invocation moved into a `run: \|` block after install | pass | ok | **WRONG** | ok |

**Wrong answers over 9 cases — OLD: 5, first rewrite: 1, shipped: 0** (`logs/gate-form-compare.log`,
the harness exits non-zero if the shipped form is ever wrong, so this stays a gate rather than a
snapshot).

Argument exactness is retained deliberately (`node <gate> --flag` is reported as unregistered
rather than accepted): that is the rule `check-wasm-api-surface.mjs`'s `workflowCommandPosition`
already applies to its own gate, so the two wasm gate-wiring checks now agree on what registration
means, and fail-closed is the right direction for a registration check.

Case 1 is worth naming: the old form "catches" it only by accident — `indexOf` finds the mention in
the step's own *comment*, which sits before `bun install`, so it reports the gate as running too
early rather than as missing. That accident produced a false failure during this change, which is
how the rewrite came to be needed at all.

## 8. Statements this change falsified, and what was done about each

Found by grepping the shipped tree and the main specs for the wasm-init language after the
tarball run showed the production leg migrating for real. Every one is corrected, none is left
standing:

| statement | where | disposition |
| --- | --- | --- |
| "the production migration path running and recording its skip distinctly" | `rasen/specs/sdk-published-examples/spec.md` | MODIFIED delta in this change |
| "it states that the wasm-initialization defect is Direction-level and demonstrated, not repaired" | `rasen/specs/sdk-published-examples/spec.md` | MODIFIED delta; replaced by a scenario asserting the claim is **gone** |
| "from the installed tarballs, the suite passes with the migration leg absent — the skip recorded" | `rasen/specs/sdk-third-party-conformance/spec.md` | MODIFIED delta: migration is now **exercised**; the distinct-skip behaviour is retained as its own scenario |
| "The migration honest pair" section | `examples/custom-storage/README.md` | rewritten; the historical state kept as a dated note |
| "the migration honest pair (production path records its skip distinctly…)" | `examples/custom-storage/package.json` description | rewritten |
| "the wasm-initialization defect, Direction-level" / "demonstrated not repaired" | `examples/custom-storage/run.ts` header + runtime message | rewritten; the **skip branch itself is kept** as the fail-closed path |
| "the honest pair" framing | `examples/custom-storage/run-mock.ts` header | rewritten; the leg keeps its narrower, still-real job |
| "the glue's top-level `__wbindgen_start()` call needs top-level await" | `examples/embed-surface/vite.config.ts`, `apps/vite-example/vite.config.ts` | **still true, left alone** — those Hosts resolve the `default` condition, i.e. the unchanged bundler entry |

`BOUNDARIES.md` §16's original paragraph is *not* rewritten: it is the record of what was known at
S05 close-out, and it is marked closed with a pointer to §17 rather than edited into agreement with
a later measurement.

## Findings recorded, not fixed

- **F1 (Minor, pre-existing).** `.github/workflows/bun-ci.yml` caches bun modules with
  `key: ${{ runner.os }}-bun-1.2.18-${{ hashFiles('apps/web/bun.lock') }}`, but no
  `apps/web/bun.lock` exists — the lockfile is at the repository root. `hashFiles` on a missing
  path yields the empty string, so the cache key is constant and the bun module cache is never
  invalidated by a lockfile change. Out of this change's scope (it is not the wasm leg) and left to
  a decision rather than fixed in passing.
- **F2 (Informational).** `script/` is outside every lint gate this repository runs: ESLint is
  scoped to `apps/web/src`, `apps/vite-example/src` and `packages/*/src`, and `biome.json` exists
  with no npm script invoking it. The files added here are therefore unlinted — stated rather than
  claimed clean.
