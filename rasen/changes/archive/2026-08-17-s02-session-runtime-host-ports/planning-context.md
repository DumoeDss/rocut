# Planning context — S02 portfolio (`s02-session-runtime-host-ports`)

> Written by the LEAD on 2026-07-31, before the first propose. Read this **first**, then research only
> what is missing. Append durable findings (decisions, discovered constraints — not chatter) to the
> bottom after each propose, so a re-spawned or successor planner stays cheap.

## 1. The user's intent, verbatim

Two messages, in order:

1. `首先阅读交接文档：rasen/handoff/opencut-phase1-delivered-s02-open.md 然后等待下一步指令`
2. `/rasen-auto` with `auto-decompose 继续推进后续所有工作！`

The user writes in Chinese and has twice asked for Chinese explanations. LEAD-facing summaries are in
Chinese; artifacts stay in English to match the existing corpus.

"继续推进后续所有工作" = drive S02 to completion, not just the first cohort.

## 2. Where authority lives — read these, do not re-derive them

Direction authority order: **Target State > Roadmap > Slice Spec > Slice Plan > this file.**

> ### ⚠️ READ `direction-corrections.md` NEXT TO THIS FILE, BEFORE YOU READ `plan.md`
>
> `plan.md` lives in the **Elftia** repository's main checkout, which a **different, concurrently
> running session** owns. The LEAD corrected six stale or false assertions there on 2026-07-31 and that
> session's next git operation **silently wiped every one of them** — the file is tracked, the edits
> were unstaged, and restoring the file to its committed state took them with it.
>
> `direction-corrections.md` sits in this directory, in `rocut`'s gitignored planning tree, which that
> session never touches. **Where `plan.md` and `direction-corrections.md` disagree, the corrections
> file is right.** In particular `plan.md` still claims the baseline is the pin, that the `C0 ∥ C1`
> write-set intersection is empty, that there are seven capability specs, and — the one most likely to
> mislead a later planner — it still carries the **superseded** E0 graphics reading in its C4 entry.

| Document | Path |
| --- | --- |
| Slice spec (acceptance contract) | `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\elftia\elftia\rasen\work\opencut-agent-editor-sdk\slices\02-session-runtime-host-ports\spec.md` |
| Slice plan (child boundaries, DAG, independence evidence) | same directory, `plan.md` |
| Target State | `...\rasen\work\opencut-agent-editor-sdk\target-state.md` |
| Roadmap | `...\rasen\work\opencut-agent-editor-sdk\roadmap.md` |
| S01 result (verdict, unverified paths, donor findings) | `...\slices\01-vite-portability-baseline\result.md` |
| Track 2 / E0 compat research (final, citable) | `E:\...\elftia\elftia\elftia\docs\research\rocut-elftia-compat\` (README + 9 numbered parts) |
| rocut main specs (7 capabilities) | `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\specs\` |

`plan.md` §4 gives every child's objective, touch set, observable outcome and proposed capability
delta. **A child's proposal should refine that, not reinvent it.** Where you disagree with the Plan,
say so explicitly in the proposal and flag it to the LEAD — silent divergence from Direction is the
failure mode this structure exists to prevent.

## 3. Baseline — measured by the LEAD on 2026-07-31, not inherited

- **Baseline revision: `main@49f8a88a`**, tree `97097f0a`. This is `rocut`'s `main`, which left the
  pin `cf5e79e9` on 2026-07-30 via a `--no-ff` merge that landed S01's three commits and Track 1's
  two together.
- `49f8a88a`'s tree is **identical** to `feat/session-runtime-host-ports@620f1c4f` (Track 1's tip).
  That is why D7 ("reconcile Track 1 before the first child commits") is **closed** — the merge
  already did it. `plan.md` §1/§3/§9.1/§10 have been corrected accordingly; older copies of that file
  claim `main` is still at the pin, which is **false**.
- **Type-baseline ceiling for the whole Slice: 3.** `node script/check-type-baseline.mjs` at the
  baseline prints `3 diagnostic(s) now, 13 at the pin cf5e79e9 … PASS`. Survivors: `next.config.ts`
  TS2345 ×1, `src/timeline/__tests__/update-pipeline.test.ts` TS2769 ×1,
  `src/timeline/placement/__tests__/resolve.test.ts` TS2769 ×1.
- The 13→3 drop was **verified, not assumed**: 6 are Track 1's positional-argument repairs; the other
  4 are in `apps/web/src/actions/keybindings/persistence.ts`, which **no commit since the pin has
  touched** — Track 1's `e3ca576d` added `isActionWithOptionalArgs` (`actions/definitions.ts:201`)
  and `isShortcutKey` (`actions/keybinding.ts:76`, a `value is ShortcutKey` guard), curing two TS2724
  missing-export errors and, through the new narrowing, two TS2345s. The file is still in scope. The
  oracle is intact, not collapsed.
- **`script/fixtures/type-baseline.json` is a PIN SNAPSHOT, not a moving ceiling.** `--regenerate`
  reconstructs `cf5e79e9` with `git archive` into a temp tree and runs `tsc` **there**. Reductions are
  informational and never fail; only a per-diagnostic count above the pin's fails. **No child needs to
  edit that file, and no child may.**
- **Disk: `E:` had 10.5 GB free at cohort launch.** Budget ~2.5 GB per worktree after `bun install`
  plus both Host builds. Rust `target/` must be directed to `C:` via `CARGO_TARGET_DIR`.
- **Parity oracle**: `apps/vite-example/tests/parity/parity.pw.ts`, run as `bun run test:parity` in
  `apps/vite-example` (Playwright). Comparison tooling: `script/diff-parity-snapshots.mjs`.

## 4. Repository layout facts that cost time to rediscover

- `rasen/` is **gitignored** in `rocut` (`.gitignore:56`). Planning artifacts live only in the main
  checkout at `E:\...\_others\rocut\rasen\changes\<change>\` and are **never committed**. Worktrees do
  not have a `rasen/` directory at all. Code commits therefore contain code only.
- Rasen commands for this project always need `--project rocut`; they resolve to the main checkout
  regardless of the cwd. Elftia's need `--project elftia`.
- Run-state / work directories live outside the repo, under
  `C:\Users\Sayo\.rasen\projects\rocut-703d9dad\changes\<change>\work\`.
- Worktrees in play: `_others/rocut` (main@49f8a88a), `_others/rocut-wt-s01` (S01's branch, keep —
  it is the pin-era measurement surface), `_others/rocut-wt-s02` (Track 1's delivered branch; tree
  == baseline, already carries `node_modules` and a built `.next`, so it is a **free read-only
  measurement surface**), plus one worktree per active child.
- Repo tooling: `bun` (1.2.18) workspaces + `turbo`. Root scripts include `build:wasm`
  (`wasm-pack build rust/wasm --target bundler --out-dir pkg`), `build:web`, `lint:web`, `test`
  (`bun test`). Check scripts live in `script/`: `check-type-baseline.mjs`,
  `check-asset-manifest.mjs`, `check-storage-boundary.mjs`, `check-next-imports.mjs`,
  `check-distributable-boundary.mjs`, `check-reference-boundary.mjs`, `generate-sbom.mjs`,
  `generate-source-inventory.mjs`.
- `core.autocrlf=true`: regenerated `PARITY.md` / `SBOM.md` can present as dirty with an empty diff.
  Expect it; do not chase it or commit line-ending churn.

### 4.1 Fresh-worktree bring-up — MEASURED BY THE LEAD 2026-07-31, follow it exactly

Run these **in order**. Skipping step 2 makes step 3 lie to you.

```
1.  bun install                     # ~35-40 s, 994 packages, ~1.85 GB
2.  <export the 9 env vars>  &&  npx turbo run build --filter=@opencut/web --force
3.  node script/check-type-baseline.mjs               # -> "3 diagnostic(s) now ... PASS"
```

**Step 2 uses `--force` deliberately — CORRECTED 2026-07-31 after both cohort-1 children hit it
independently.** `bun run build:web` can print **`FULL TURBO`** and exit 0 while leaving
`.content-collections/generated` **absent**, because `turbo.json` declares `outputs: [".next/**"]`
only — a cache hit restores `.next` without it. That reproduces the §4.2 false FAIL *even when you
follow this recipe exactly*. C0 independently refused to count a `FULL TURBO` replay as a build for
its parity evidence, for the same reason. **A cache replay is not a build.** `.next/BUILD_ID` existing
is not proof either; check `.content-collections/generated` too.

**Step 2 — `apps/web` does not build without a 9-variable environment.**
`apps/web/src/env/web.ts:30` runs `webEnvSchema.parse(process.env)` at **module top level**, and the
root layout imports it, so *every* page fails `collect page data` if any variable is missing. Only
`NEXT_PUBLIC_SITE_URL` has a default. The full set is already documented in `apps/web/.env.example`;
these values are LEAD-verified to produce a green build (`BUILD_ID` written, 54.86 s) and none is
contacted at build time:

```
DATABASE_URL=postgresql://opencut:opencut@localhost:5432/opencut
BETTER_AUTH_SECRET=supersecret
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_MARBLE_API_URL=http://localhost:9999
UPSTASH_REDIS_REST_URL=http://localhost:9998
UPSTASH_REDIS_REST_TOKEN=dummy
MARBLE_WORKSPACE_KEY=dummy
FREESOUND_CLIENT_ID=dummy
FREESOUND_API_KEY=dummy
```

**CORRECTION 2026-07-31 — an earlier revision of this file claimed `bun-ci.yml` sets only three of the
nine and that this is why the upstream CI build step is red. That is FALSE and was the LEAD's error**
(a truncated command output read as a complete one). `.github/workflows/bun-ci.yml:24-33` sets **all
nine**, and the file is byte-unchanged since the pin. Whatever makes upstream CI red, it is not the
env block — do not carry that explanation forward, and do not "fix" CI on its basis.

The recipe above is unaffected: it was measured, not inferred, and produces a green build. Copying
`.env.example` to `apps/web/.env.local` is the route the repo documents, but it carries
`NODE_ENV=development` and the LEAD did **not** verify that route against a production build — the
exported-variables route above **is** verified. Use it.

### 4.2 The type-baseline false-FAIL trap — this WILL bite you if you skip 4.1

In a fresh worktree that has installed but **not built**, `node script/check-type-baseline.mjs` does
not refuse to run. It reports **`11 diagnostic(s) now`** and exits 1 with
**`FAIL 8 diagnostic(s) not present at the pin — S01 regressions`**. All eight are spurious, and all
eight are downstream of **one** unresolved module: `apps/web/tsconfig.json` maps the
`content-collections` path alias to `./.content-collections/generated`, which the
`@content-collections/next` plugin generates at build time. `src/changelog/utils.ts:1` then raises
`TS2307`, and the four `TS7006` implicit-any errors in `src/app/changelog/**/page.tsx` follow from it.

Why this is a trap and not merely an inconvenience: the script's `--regenerate` path **explicitly**
links `apps/web/.next` and `apps/web/.content-collections` into the reconstructed pin and exits 2 if
either is absent. The **comparison** path has no equivalent guard, so instead of refusing it emits a
confident false FAIL that reads exactly like a real regression.

- The generated dir appears even from a **failed** `next build` — content-collections is produced
  before page-data collection — so the precondition is cheap.
- **Never** respond to this by re-baselining or by editing `script/fixtures/type-baseline.json`.
  Re-baselining is one of the Slice's named stop conditions (§8: the regression signal has been spent).
- **Never** junction `.content-collections` from elsewhere. A junction there is precisely what made
  `next build` impossible during S01.
- There is no standalone content-collections CLI in this setup. `npx content-collections build` fetches
  an **unrelated npm package of the same name** and fails with `NoSuchCommandError`. Don't.

## 5. The child DAG, and why it is almost entirely serial

Ten children. **Exactly one concurrency edge is proven safe: `C0 ∥ C1`.**

| id | change name | dependsOn |
| --- | --- | --- |
| C0 | `s02-wasm-self-built-canonical` | — |
| C1 | `s02-port-contract-freeze` | — |
| C0b | `s02-wasm-api-surface` | C0, C1 |
| C2 | `s02-session-runtime-singleton-removal` | C1 |
| C3 | `s02-session-scoped-state` | C2, C0b |
| C4 | `s02-asset-resource-ports` | C3, C0 |
| C5 | `s02-storage-port` | C4 |
| C6 | `s02-session-disposal` | C5, C0b |
| C7 | `s02-headless-editing` | C6 |
| E1 | `elftia-compat-spike` (**elftia** repo) | C1; its unmount item also needs C6 |

`plan.md` §5 carries the file-level evidence for every serialization. The standing rule: **parallelism
requires a positive independence proof, never merely the absence of a declared edge** —
宁可串行也不能乱并行.

Two rulings that are easy to get wrong when summarising:

- **`C0b` must NOT be folded into `C0`.** `C0`'s entire observable outcome is that the self-built
  artifact *corresponds* to published `opencut-wasm@0.2.10` (S01 proved byte-for-byte with all 638
  exported symbols identical). Adding exports in the same child makes that correspondence unprovable
  and the switch un-de-risked. `C0` proves "same artifact, new origin"; `C0b` proves "new origin, new
  API".
- **`C0b ∥ C1` was proposed and then WITHDRAWN** by the D9 ruling. Their file sets are disjoint, but
  C1 declares the host-facing preview-concurrency capability and C0b supplies the wasm query that
  answers it — one two-sided interface. **Disjoint file sets are not sufficient evidence of
  independence when two children own opposite ends of one interface.**

## 6. Closed decisions — do not silently reverse

- **D1** — "public/runtime execution paths" means the **runtime execution graph**, not an extracted
  package graph. Package extraction is S05's. Reading it the other way roughly doubles S02.
- **D3** — **ADD new Rust teardown exports.** The WASM module exports exactly ten functions and a
  `dispose|destroy|teardown|shutdown` search across `rust/wasm/src`, `rust/crates/gpu/src` and
  `rust/crates/compositor/src` returns **zero** hits. `COMPOSITOR_RUNTIME` / `GPU_RUNTIME` are
  `thread_local!` singletons. This promotes C0 from a provenance tidy-up to a **spine prerequisite**:
  the archived upstream npm package can never carry those exports.
- **D4 — REJECTED the narrowing.** Simultaneous dual-session preview **is** required; the user
  accepted the handle-keyed compositor API and the Rust redesign it implies. Do not reinstate.
- **D5** — the three Elftia `media://` defects get their own **Elftia** Change (sync main-thread read,
  `bypassCSP` width, past-EOF `206 + 1 byte` from the unreachable 416 branch at
  `protocols.ts:105-112`). Out of S02 scope but **owned**, so exclusion never means unowned.
- **D6** — E1 is created only after C1 lands, and is forbidden from defining ports privately.
- **D7** — closed 2026-07-31, see §3.
- **D8** — disk cleared by the user; re-measured at 10.5 GB.
- **D9 = (B)** — dual preview on WebGPU; on WebGL the runtime **REPORTS** a one-live-preview
  capability through the `EnvironmentCapabilities` port. **Honest reporting is an acceptance clause,
  not an implication**: a Host must be able to *ask* and get a truthful answer, proven by a test on
  **both** backends with the selected backend recorded per run, so a green cannot come from silently
  testing the same backend twice. *"A build that merely happens to render one preview on WebGL fails
  this clause."*

**D2 (React 18 shared import-map vs isolated React 19) is DELIBERATELY UNMADE.** It gates S04 and
E1's rebuild, not S02. **Do not decide it to be tidy.** Evidence is asymmetric and worth carrying:
isolated React 19 is *measured* working in a packaged build (host 18.3.1 / editor 19.2.5, full
timeline, healthy host tree, no invalid-hook or duplicate-React error); shared React 18 has its
*mechanism* measured but its **editor runtime only inferred**, and its static clearance covers the
editor's own 690 source files but **not** its dependency graph. CSS collides identically in both, so
CSS does not break the tie.

## 7. Facts established by E0/Track 2 — cite, do not re-measure

- **Asset resolution is the single blocker for embedding in Elftia.** Rewriting just **two**
  root-absolute paths took the editor from one fatal error to a fully booted timeline inside packaged
  Elftia. This makes C4 the highest-value port in the Slice.
- **The Worker failure is the SAME-ORIGIN rule, not CSP** (`SecurityError … cannot be accessed from
  origin 'app://bundle'`). **No CSP token can fix it**; only serving origin can. A runtime-resource
  port that can only accept an off-origin URL is known in advance to be unimplementable.
- **The editor acquires a real GPU context in all four measured configurations**, and the backend
  **flips with adapter availability** (WebGPU on default hardware; WebGL under `--disable-gpu` and
  under SwiftShader). S01's "without a GPU the editor crashes" is **falsified** — `--disable-gpu` on
  Windows still supplies WebGL 2, so S01 did not measure what it believed.
- **Packaged Elftia does reach the editor's timeline view on default hardware** (`run4`/`run9`).
- **Still unverified — must not be read as passing:** whether a *timeline view* renders under
  software rasterization; whether the editor survives a **no-rasterizer** host at all;
  `DegradedRendererBanner` has never been observed rendering; `window.__wasmPanic` was never written.
- **Open risk, carried:** the WebGPU result is one machine (RTX 3060 + Chromium 144 + this Electron
  build, `official` channel only). If typical users sit on integrated or GPU-blocklisted machines,
  **WebGL is the ordinary path and D9(B)'s single-preview branch is the default experience.** Do not
  plan or review S02 as though WebGPU were the norm.

## 8. Spec-falsification sweep — required of EVERY child, and no tool catches it

Rasen's archive guard only checks specs a delta actually declares as MODIFIED. A child can archive
fully green while leaving a **false assertion** in a capability it never touched. Two are already
predictable:

- `browser-persistence-boundary`'s *"The persistence boundary is explicitly provisional"* — falsified
  by C5;
- `runtime-asset-delivery`'s root-absolute asset assumptions — falsified by C4.

Every child greps **all EIGHT** existing capability specs (`inherited-defect-repair` was added by
Track 1's archive and post-dates the Slice Plan) — **including numbered `SHALL` clauses and scenarios
nested inside requirement prose, which is where this failure mode hides** — for assertions its diff
makes false, and declares them MODIFIED. This is manual.

### 8.1 The sweep has TWO directions, and only one of them is usually run

**Added 2026-07-31 after C0's review found a live instance of the second.** No tool catches either
direction.

| Direction | Question | Live instance |
| --- | --- | --- |
| **Falsification** (the one everyone runs) | does my diff make an **existing** assertion false? | C0: `upstream-provenance`'s scenario asserting *every* recorded metadata defect is still present — nested under a requirement about **code** defects, so a keyword grep would never surface it. |
| **Unimplemented addition** (routinely missed) | does my delta **add** an assertion describing behaviour that does not exist? | C0: its own new scenario *"A missing wasm build fails with an actionable message"* was **false** — `bun install` with the `file:` target absent emits `error: opencut-wasm@file:./rust/wasm/pkg failed to resolve`, never naming the build command, and no manifest has a pre/postinstall hook. |

**For every requirement or scenario your delta ADDS, confirm the behaviour exists by RUNNING it, not
by reading the code.** A delta that asserts something aspirational is worse than one that asserts
nothing: it archives green and the assertion is then quoted onward as established.

Two more shapes worth knowing, both measured in this portfolio:

- **`as const satisfies readonly (keyof T)[]` is a MEMBERSHIP check, not an EXHAUSTIVENESS check.**
  An omitted key compiles clean, exit 0. Any gate built on a hand-maintained key list this way
  silently narrows as the type grows. The correct idiom is a total `Record<K, …>` — which this repo
  already uses next door in `session-resources.ts:42`, where an omission *does* fail to compile.
- **"Nothing is in the production module graph" can be a restatement of "nothing consumes it."**
  Modules imported with `import type` only are **elided** by TypeScript, so they are absent from the
  dev graph too, tree-shaking or not. The independent proof is a complete `git diff --name-status`,
  never a curated path list.

## 9. Process constraints the LEAD is operating under

- The user authorized **worktree + commit + push** for this run. Merging into any mainline branch
  remains the user's call — never merge a child branch automatically.
- Children ship **local** (commit only, on their own worktree branch). Portfolio-level delivery is
  resolved once, at the end, by the LEAD with the user.
- Every child gets its own worktree branched from `main@49f8a88a`, never a reused one.

## 10. Durable findings appended by planners

*(Append below. Decisions and discovered constraints only — not status.)*

### 2026-07-31 — planner-1, after proposing C0 (`s02-wasm-self-built-canonical`)

- **There are EIGHT capability specs in `rocut`, not seven.** `rasen/specs/inherited-defect-repair/`
  was created by Track 1's archive and post-dates §8's count and `plan.md` §7. Every child's
  falsification sweep must cover eight. §8 above and `plan.md` §7 both say "all seven"; treat that as
  stale, not as a scope limit.
- **CI already builds the wasm before `bun install`, and then ignores the result.**
  `.github/workflows/bun-ci.yml` runs `rustup target add wasm32-unknown-unknown`, installs
  `wasm-pack`, caches `~/.cargo` + `target`, and runs
  `wasm-pack build rust/wasm --target bundler --out-dir pkg` **before** `bun install` on all three
  OS runners. Nothing consumes that output today. This is what makes C0's switch cheap: it makes an
  existing vestigial step load-bearing rather than adding a new one. It was not visible in the Slice
  Plan and it is the single largest input to C0's design.
- **`script/generate-sbom.mjs` will break when C0 adds `rust/wasm/LICENSE` — by design.** Its `D-5`
  probe returns true only while no LICENSE exists, and the generator `process.exit(1)`s when any
  documented defect goes missing. Any later child that repairs a recorded metadata defect hits the
  same guard. The fix pattern C0 adopts: give each defect entry an explicit **disposition**
  (`recorded` → probe must be true; `repaired` → probe must be false, with patch id + evidence) and
  assert against the disposition, so a *re*-introduction fails as loudly as an undocumented repair.
- **Adding `rust/wasm/LICENSE` may perturb the generated `pkg/package.json`.** Published `0.2.10`'s
  `files` array is exactly `["opencut_wasm_bg.wasm","opencut_wasm.js","opencut_wasm_bg.js",
  "opencut_wasm.d.ts"]` with no LICENSE entry. `wasm-pack` copies declared licence files into the
  out-dir; whether it also lists them is **unverified**. C0 therefore measures correspondence on
  **both sides** of the LICENSE addition. Consequence for the whole Slice: the correspondence
  criterion cannot be "byte-identical forever" — it is "exported-symbol set + declaration + version
  equal, every other divergence enumerated and attributed."
- **`rust/wasm/pkg/` is gitignored (P-002) and `packages/` does not exist.** The repo's convention is
  that generated output is *checked mechanically*, never committed — `UPSTREAM.md` states the same
  principle for the distributable graph. C0 keeps that: it uses a `file:` dependency on the build
  output rather than committing a 3.2 MB artifact. Rejected alternative recorded in C0's `design.md`
  D-A2; revisit only if the Rust toolchain requirement blocks a Host or a contributor.
- **`opencut-wasm` is declared in TWO manifests** — root `package.json` *and* `apps/web/package.json`
  — and imported from exactly three modules: `apps/web/src/wasm/media-time.ts`,
  `services/renderer/gpu-renderer.ts`, `services/renderer/compositor/wasm-compositor.ts`. The Slice
  Plan's C0 touch set names only the root manifest; `apps/web/package.json` is a genuine addition.
- **The declared dependency is not evidence of the resolved artifact.** A stale
  `node_modules/opencut-wasm` from a registry install can survive a manifest change and silently
  satisfy every import, which would mean every later S02 child measures the wrong artifact. C0's
  `script/check-wasm-source.mjs` asserts on the *resolved* content with a negative control. Later
  children (C0b especially) should re-run it rather than trusting the manifest.
- **`upstream-provenance` and `developer-reproducibility` are confirmed falsified by C0**, each with
  a named clause, not a guess: *"the published npm package remains the recorded parity source"*,
  *"every recorded metadata defect is still detected as present"*, and *"(for the **optional** wasm
  rebuild) Rust and wasm-pack versions"*. The second of those is the "numbered SHALL inside
  requirement prose" hazard class §8 warns about — it is a scenario nested under a requirement about
  *code* defect repairs, so a keyword grep for "wasm" or "licence" would not have found it.

### 2026-07-31 — planner-1, after proposing C1 (`s02-port-contract-freeze`)

- **⚠ The `C0 ∥ C1` write sets are NOT disjoint. `SOURCE_INVENTORY.md` and `SOURCE_INVENTORY.json`
  are in both.** `script/generate-source-inventory.mjs` enumerates files **added** under
  `AREAS = ["apps/web/src", "rust", "apps/web/public"]` and both files are git-tracked. C0 adds
  `rust/wasm/LICENSE`; C1 adds modules under `apps/web/src/editor/`. `upstream-provenance` requires a
  derived inventory to be *"regenerated after the commit that changes the compared set"*, so both
  children must regenerate. `plan.md` §5's *"No file appears in both"* is **false as written**.
  **It is benign, not a stop**: the files are generated and deterministic, each child regenerates
  correctly on its own branch, and a merge conflict there is resolved by re-running the generator —
  never by hand-merging. **This applies to every later child too**, since almost all of them add or
  modify files under `apps/web/src`. Treat "regenerate the inventory, resolve conflicts by
  regeneration" as a standing portfolio rule rather than a per-child surprise.
- **`PATCHES.md` belongs to C0 alone in this cohort, and the rule that makes that true is general**:
  `PATCHES.md` logs modifications to files inherited **at the pin**. `editor-host.ts`,
  `editor-host-context.tsx`, `host-image.tsx`, `editor-root.tsx` and `browser-host-adapter.ts` are
  files the *fork added* — `SOURCE_INVENTORY.md` already lists them as such — so modifying them is
  never a patch. Later children touching only fork-added files need no `PATCHES.md` row; children
  touching the 17 inherited-and-modified files do.
- **The five MODIFIED requirement headers in this cohort were verified byte-exact against
  `rasen/specs/`.** One scenario is **renamed** inside C1's `browser-persistence-boundary` delta
  ("Provisional status is stated in documentation" → "The documentation points at the published
  storage contract"). If archive-time scenario-set reconciliation objects, that is the loud,
  atomic, safely-retryable failure mode — not silent drift.
- **`browser-persistence-boundary` is falsified at C1, not at C5.** §8 and `plan.md` §7 both predict
  C5 as the falsifier. But `BOUNDARIES.md:141` states *"No stable storage contract is published by
  this work"*, and C1 publishes `ProjectStore` with a working reference implementation and a
  conformance suite. C1 therefore declares it MODIFIED with a narrow amendment (the provisional label
  moves onto the *adapter implementation*); **the adapter's retirement is still entirely C5's** and
  C5 will modify the same spec again. Serial, so no conflict.
- **The graphics contract must split "what the Host declares" from "what the runtime reports".**
  `EnvironmentCapabilities.describeGraphics()` returns `{mode:"detect"}` or
  `{mode:"force", rasterizer:"none"}` — Host-side; `session.capabilities.graphics()` returns the
  report carrying `rasterizer`, the selected `backend` and `livePreviewLimit` — runtime-side, never
  asserted by the Host. Collapsing these into one member is the obvious mistake and it breaks two
  clauses at once: §3.5 needs a **constructible** no-rasterizer Host (which only a Host-side *force*
  gives you, without special hardware), and §3.6 needs a report the Host cannot fake.
- **`livePreviewLimit` is a count, and the runtime query C0b owes is declared by C1 in TypeScript
  before C0b exists**, with a temporary `source:"unimplemented"` implementation reporting `1`. That
  makes the two-sided seam a **compile-time** contract: C0b exporting a boolean (the exact failure
  `plan.md` §5 names) fails to build rather than failing at runtime.
- **The disposal registry must MEDIATE ACQUISITION, not collect registrations.** Elftia's
  `PluginDisposerRegistry` is blind to all five resource classes precisely because it only sees
  disposers someone remembered to register; a `register(disposer)` API inherits that blindness *by
  construction*. C1 freezes `SessionResources.setTimeout / createWorker / createAudioContext /
  createObjectURL / trackGpuResource`, which turns a missed acquisition into a boundary-check
  violation instead of a leak. `dispose()` returns **created AND released counts per class** — E0's
  numbers were unusable because three classes were never created there, i.e. *unmeasured, not clean*,
  and C6 must be able to show "created before asserted released" mechanically.
- **`mount()` returns the root handle SYNCHRONOUSLY**, with readiness as a promise *on* the handle.
  Mounting awaits GPU init; a `Promise<Handle>` would leave a Host holding nothing to unmount during
  a slow or failed mount — a more general form of the exact gap E0 hit. Plus: `unmount()` idempotent,
  `dispose()` implies unmount, **one live root per session** (mounting a mounted session throws).
- **`ProjectStore` carries an opaque payload plus a typed summary.** This is not only §3.3's
  no-schema-types rule — it is what protects the Slice **stop condition** *"storage inversion cannot
  preserve provider-private round-trip"* (Target State §5.6). An opaque payload round-trips unknown
  fields by construction; a typed one loses them the first time the schema moves. C5 must not widen
  `ProjectStore` to typed project content to make its rewiring easier — that would silently spend the
  stop condition.
- **Migrations are owned by the `ProjectStore` implementation**, invoked once by the session during
  `create` before any project load, with progress on the diagnostics channel. Session-owned migration
  is rejected: a second session re-runs or races it. Corollary C3 depends on: `MigrationDialog` can
  only ever observe a migration if progress stops being global, so the session-scoped channel is a
  prerequisite of C3's dialog repair, not a nicety.
- **Only one `new Worker(...)` site exists** (`services/transcription/service.ts:114`) and **ten**
  `URL.createObjectURL` sites, in `apps/web/src`. The repo-wide form of the "no direct acquisition"
  check cannot be turned on until C4/C6 rewire those sites; C1 scopes it to the ports/session modules
  and says so, rather than shipping a check that fails on code it is forbidden to touch.
- **`RendererManager` already has `isDegraded`/`setDegraded` and `editor-root.tsx` already renders
  the degraded banner.** The state exists; what has never existed is a way for a Host to *cause* it,
  which is why S01 could never observe the banner. C4 should drive the existing state, not add a
  parallel one.

### 2026-07-31 — successor LEAD, before proposing C0b and C2

- **Current user boundary:** continue autonomously through **C3 completed**, then stop and report.
  C4 and later children remain in the portfolio but are outside this run's requested terminal point.
- **C0b and C2 are conditionally parallel-safe.** Read `direction-corrections.md` C-7; it supersedes
  this file's earlier statement that exactly one concurrency edge exists. Both children feed C3
  through a contract already frozen by C1; they do not own opposite ends of a new interface.
- **Common-base requirement:** C0 and C1 must first be round-3 review-clean and locally shipped.
  Merge their committed branches into the S02 integration branch, regenerate
  `SOURCE_INVENTORY.{md,json}`, and branch both C0b and C2 from that exact integration commit.
- **C0b scope obligation, verbatim:** *"export a live-handle enumeration satisfying
  RuntimeGpuResourceQuery, and make selectedBackend() able to return null."* A frozen type plus a
  working placeholder constrains shape but never compels the real implementation to arrive.
- **C2 scope guard:** use C1's placeholder-compatible `createEditorSession` seam; do not consume or
  wire C0b exports, touch Rust/generated WASM, or redefine C1's runtime contracts. C3 owns the join.
- **C3 entry gate:** after both children are review-clean and locally shipped, integrate them,
  regenerate derived inventories and WASM bindings, and run the combined source/build/type/parity/
  port-boundary/singleton checks before C3 planning starts.
- **Resource re-measurement:** E: had 10.66 GB free and C: 38.00 GB free immediately before the
  cohort was prepared. The user is independently reclaiming E: space. Keep real installs only and
  keep Rust `target/` on C:.

### 2026-07-31 - C0b/C2 apply-ready planning decisions

- **The common cohort-2 base is fixed at `daef023b5a714088a6e629743cabb9e154d5cc30`.**
  C0b owns Rust/WASM, its exact gate registration in root `package.json`/CI and provenance; C2 owns
  TypeScript/React session runtime and runs its singleton gate through the existing `bun test` CI
  path. Their product-source intersection is empty. `SOURCE_INVENTORY.{md,json}` remains the sole
  derived overlap and is always resolved by regeneration.
- **C0b's runtime surface is settled, not left for the implementer to reinterpret.** Handle `0` is
  the legacy default, explicit compositor handles are monotonic non-zero `u32`, reported/enforced
  capacity is WebGPU `2`, WebGL `1`, unavailable `0`, and backend is nullable before success/after
  failure or teardown. `WasmRuntimeGraphicsQuery` and `WasmRuntimeGpuResourceQuery` are exact
  generated structural providers; handle release is idempotent and shared GPU teardown refuses
  while any live handle remains.
- **C2 preserves C1's public session shape by using an internal
  `WeakMap<EditorSession, EditorCore>`.** There is no default/current-session path:
  `EditorSessionProvider` supplies the explicit key, command context is passed by each session's
  manager, process definitions bootstrap idempotently, and C2 reverses only the save/subscription
  effects multiplied by multiple cores. The two C1 graphics/GPU placeholders remain the only
  allowed unimplemented markers until C3; `useEditorPorts()` remains prohibited.

### 2026-07-31 - Cohort-2 provenance correction during apply

- C2's archived-capability sweep correctly found that `upstream-provenance` requires
  `PATCHES.md` rows for its behaviorally modified inherited files. The initial C2 write-set omitted
  that record and would have made the branch knowingly non-conformant.
- The LEAD expanded C2's **documentation/provenance** write-set to include `PATCHES.md`. C0b and C2
  remain product-source independent; each records only its own rows and neither consumes the other.
- The joint integration procedure now has two shared-file rules:
  `SOURCE_INVENTORY.{md,json}` is regenerated from the combined tree, while `PATCHES.md` is
  semantically merged so both row sets survive, followed by provenance validation.

### 2026-07-31 - C0b+C2 joint gate passed; C3 is unblocked

- Integration head: `2df009c9e1729e2ac933c0bd54762d744433073b`
  (tree `984bd269aef0f6c3a0060ff0573b65707b262c24`).
- `SOURCE_INVENTORY.{md,json}` was regenerated from the combined tree: 1,069 files, 75 modified /
  37 added versus the pin, rollup `8ce81cbd563de44ca6d99857fa9959feaeae4eb0992656deb1c4a10b7ba168bf`.
- `PATCHES.md` preserves the exact union as unique ids `P-001..P-091`: C0b remains P-028..P-033
  and the C2 rows are integration-renumbered P-034..P-091.
- Combined WASM rebuild used `CARGO_TARGET_DIR=C:\Users\Sayo\cargo-target`, followed by
  `bun install`; `check:wasm` reports 38 JavaScript exports / 58 binary exports / 609 imports and
  the API controls are 14/14.
- Distinct real runtime runs passed: Playwright Chromium selected WebGL with capacity 1; installed
  Chrome with `--enable-unsafe-webgpu --use-angle=d3d11` selected WebGPU with capacity 2 and two
  independent handles. The Playwright-bundled Chromium could expose an adapter but its Dawn device
  creation failed on local `dxil.dll`; its fallback was correctly rejected as WebGPU evidence.
- C1/C2 focused evidence passed: 26 port+singleton tests / 140 assertions, 40 lifecycle / 102, and
  9 ownership / 58; singleton graph 680 runtime modules / 39 command modules; port positive and
  negative controls pass.
- Fresh Next and Vite production builds pass; Vite emits 2,857 modules; type baseline is 3/PASS;
  storage/Next/distributable/reference boundaries pass; asset manifest serves 297/297 entries.
- Full Bun remains the reviewed baseline-red set at 219 pass / 8 fail / 2 errors. Vite parity is
  1/1; the existing cross-Host report remains 0 semantic / 9 incidental over 195 leaves.
- The worktree is clean. C3 planning may now start from this exact head; no earlier commit qualifies.

### 2026-07-31 - C3 planning complete and strictly valid

- Change `s02-session-scoped-state` now has complete `proposal.md`, `design.md`, four delta specs and
  `tasks.md`. `rasen validate s02-session-scoped-state --strict` passes. The plan contains 14
  requirements, 48 scenarios and 73 trackable tasks. Implementation remains unstarted; no product
  file, runstate or implementation branch was changed by planning.
- The only admissible implementation base remains
  `2df009c9e1729e2ac933c0bd54762d744433073b`, tree
  `984bd269aef0f6c3a0060ff0573b65707b262c24`. A dedicated clean worktree must verify both hashes,
  rebuild WASM with `CARGO_TARGET_DIR=C:\Users\Sayo\cargo-target`, reinstall, capture the exact-base
  full-suite red identities and stop before implementation if any of those observations differ.
- **Nine-store ownership is exhaustive:** panel, editor bootstrap, preview, timeline, sounds,
  stickers, keybindings, properties and assets panel become distinct vanilla Zustand StoreApi
  instances in a private session registry. C1's public session constructor/shape stays frozen.
  Existing persist keys remain compatible, but persistence is only shared durable input; live
  StoreApi identity, listeners, transient values and request generations are per session. The
  underlying sounds library and custom user preferences remain shared data sources until C5.
- **The no-selector seam is removed, not broadened.** Reactive reads use `useEditor(selector)`;
  intentionally event-only/orchestration reads use a named stable `useEditorInstance()` hook.
  No-argument `useEditor()`, `subscribeNone` and equivalent empty subscribers are prohibited by a
  negative-control gate. `MigrationDialog` selects live project migration state and is proved with a
  seeded deferred legacy migration while a second session remains unaffected.
- **Mutable module state is classified and gated.** The interaction-canceller registry and stickers/
  sounds request generations are session-owned. Idempotent definitions, content-keyed image/sticker/
  frame caches, custom presets and the underlying sounds library may stay process-shared for their
  recorded reasons. The default compositor and JS `gpuAvailable`/`initPromise` singleton are removed;
  a new unclassified mutable editor/renderer singleton fails the C3 boundary check.
- **The C0b/C2 join is exact.** Both production Hosts adapt C0b's live
  `WasmRuntimeGraphicsQuery`/`WasmRuntimeGpuResourceQuery`; they never stamp backend or capacity and
  never supply C1's unimplemented fixtures in the running graph. C0b owns initialization coalescing
  and generation safety, so C3 does not add another module promise.
- **One explicit nonzero compositor handle belongs to each rendering session.** Allocation is
  immediately tracked in the C1 resource registry; preview, snapshot, thumbnail and export receive
  the owning session renderer and share that session handle. Disposal releases only that exact
  handle, is stale-generation safe and does not call shared `disposeGpu()` (C6 owns last-owner shared
  teardown). Handle 0 remains generated compatibility API but is absent from both production graphs.
- **Real-browser evidence is two non-substitutable jobs.** Installed Chrome must be supplied through
  an explicit executable-path environment variable and launched with
  `--enable-unsafe-webgpu --use-angle=d3d11`; it must report WebGPU/capacity 2/two distinct handles
  and show two simultaneous independent frames. Playwright bundled Chromium is the WebGL job; it
  must report capacity 1, render the first preview, explicitly reject the second before layout, and
  preserve the first handle/frame. Missing executable, backend mismatch or fallback is a hard fail.
- Validation is deliberately broader than focused green: exact C0b API/generation gates, C1/C2
  focused tests, both Host builds and parity, type ceiling/fixture byte identity, asset/storage/Next/
  distributable/reference/port/singleton/state boundaries, the eight legacy plus all S02 archived
  capability falsification sweep, full unimplemented-addition sweep, provenance regeneration from
  the committed tree, and full Bun failure-signature comparison. Any new/changed red, fixture
  re-baseline or unclassified requirement stops delivery.
- **C4 handoff:** consume the new per-session renderer/provider seam; C4 still exclusively owns
  asset-base/root URL resolution, Worker runtime-resource delivery, effect-preview asset delivery
  and visible degraded-no-rasterizer behavior. It must not reintroduce a module compositor or Host-
  asserted capability. **C5 handoff:** isolated live stores deliberately sit over shared durable
  substrates; invert those substrates while preserving opaque round-trip. **C6 handoff:** start from
  exact per-session compositor tracking/release, then add shared GPU last-owner teardown and the full
  five-class resource/leak harness rather than moving those obligations backward into C3.

### 2026-07-31 - C3 completed, reviewed, integrated and archived

- C3 shipped locally at `07b36c82e25654199c860220e5f1cdf8cfe936ee`, product tree
  `ffcbd51b96cc1e3cba4a918d6f4291d1feb872c2`, with all 73 tasks complete and strict validation
  passing. The product merge into the S02 integration branch is `e99f0f4a`; the C3 archive/spec
  commit on `main` is `d777e5ed`; the final metadata merge is `507cecf4` (integration tree
  `2dd46187ff2d31b026010cb3d6573dcf099441d3`). No product path changed after `e99f0f4a`.
- The review cycle needed three rounds and ended independently CLEAN at 0 Blocker / 0 Major /
  0 Minor / 0 Trivial. Important fixes discovered by review: compositor serialization must include
  synchronous output-canvas acquisition and the real asynchronous export capture; Host cleanup must
  detach ownership before invoking any session/WASM disposer and must observe every rejection;
  replaceable async reads cannot share latest-wins identity with durable commands; two sound-add
  commands are independent; render-time imperative-read gates must follow aliases and synchronous
  callbacks rather than merely count hook calls.
- Final integration evidence is tied to the full `e99f0f4a` marker: fresh Vite (2,863 modules),
  bundled Chromium WebGL capacity 1 with one nonzero handle and explicit second-preview rejection,
  exact installed Chrome WebGPU capacity 2 with two distinct nonzero handles/frames, forced Next
  build 1/1 and 18/18 pages, asset manifest 297/297, type ceiling 3, WASM 38 JS / 58 binary exports /
  609 imports, and all state/port/singleton/storage/Next/distributable/reference gates passing.
  Full Bun is honestly classified at 222 pass / 8 fail / 2 errors / 552 expectations: the eight red
  identities/signatures are unchanged inherited baseline failures. Exact product-tree parity remains
  10+10 interactions, 0 semantic / 9 incidental over 195 leaves.
- C3's four delta specs are archived at
  `rasen/changes/archive/2026-07-31-s02-session-scoped-state` and synced into the main
  `editor-session-runtime`, `host-port-contract`, `session-state-isolation`, and
  `wasm-api-surface` specs.
- **Next frontier is C4, but C4 has not been started.** Plan it from the final integration head
  `507cecf4`, after rereading `direction-corrections.md` C-5. C4 owns injectable asset-base/root URL,
  first-party root-absolute fetch retirement, Worker delivery through the runtime-resource port,
  effect-preview asset delivery, and driving the existing `RendererManager.setDegraded` state from
  `EnvironmentCapabilities`. It must consume C3's per-session renderer/provider seam without
  reintroducing a process compositor or Host-stamped backend/capacity.
- C5 still owns durable storage inversion and opaque provider-private round-trip. C6 still owns
  shared-GPU last-owner teardown plus the complete timers/workers/audio-contexts/object-URLs/graphics
  five-class leak harness. C3's exact session-handle release is a prerequisite, not a substitute.

### 2026-08-01 - C4 asset/resource-port planning complete and strictly valid

- Change `s02-asset-resource-ports` now has complete `proposal.md`, `design.md`, two delta specs and
  `tasks.md`. `rasen validate s02-asset-resource-ports --project rocut --strict` passes. The plan has
  7 modified requirements, 25 scenarios and 86 trackable tasks. Planning changed no product file,
  implementation worktree, branch, runstate, delivery state or protected oracle.
- The complete thirteen-spec falsification sweep changes only `runtime-asset-delivery` and
  `host-port-contract`. The other eleven remain valid; notably `editor-session-runtime` keeps its
  broader five-resource-class C6 obligation even though C4 closes Worker acquisition, and
  `host-service-boundary` continues to own first-party API calls while C4 only makes their Next
  endpoint locations base-path-aware.
- **The build graph is part of the asset boundary.** C4 must scan source plus fresh Vite/Next HTML,
  CSS, JS, Worker and WASM output. The minimum emitted chain is Host entry -> editor WASM and Host
  entry -> transcription Worker -> ONNX Runtime WASM sidecar. Correct source URLs or a correct outer
  Worker do not compensate for a root-absolute nested sidecar.
- **Production roles are explicit final overrides.** Both Hosts currently spread
  `createInMemoryPorts()`. C4 supplies immutable browser `assets`, `assetLoader` and
  `runtimeResources` after that spread and gates their final identities against the default
  `assets/` resolver, empty loader and echo Worker. Other reference roles remain untouched for C5;
  the C4 browser asset/resource bundle is deliberately not C5's `BrowserHostAdapter`.
- **Asset bases are session identities, never mutable globals.** Font atlas/chunk/CSS masks, flags,
  sticker images, effect preview, logos and favicon resolve from the owning session/Host. Any cache
  containing a URL, fetched bytes, image or derived canvas is keyed by resolver/loader identity or
  the final resolved URL. Two simultaneous distinct bases are a mandatory isolation gate.
- **The manifest gate remains non-vacuous and content-sensitive.** Copied entries carry logical
  path, category, MIME, exact length and SHA-256; emitted entries identify entry/Worker/editor-WASM/
  ORT layers. HTML-200 fallback, same-MIME wrong bytes, missing/truncated categories and empty graphs
  are deliberate nonzero controls. Existing excluded marketing/PWA probes remain exclusions.
- **Worker construction moves, ownership does not split.** Transcription becomes session-bound and
  calls `SessionResources.createWorker`; only the Host browser adapter may call platform
  `new Worker`, and it may rewrite to a same-origin URL. A tiny local Worker proves metadata,
  rewrite, round trip, termination and registry ownership without requiring a Hugging Face model.
- **Forced-none uses the existing renderer state and proves zero raster work.** Poisoned live-query
  methods must remain uncalled; the report is Host-forced/backend null/capacity 0; the existing
  `RendererManager.setDegraded` and editor-root banner are the only state/UI path. After ordinary
  preview/effect scheduling, the page/session remains live with zero page errors/unhandled
  rejections and a null compositor handle. This is constructibility only, not software-render timing
  or physical no-rasterizer evidence; E1 still owns both measurements.
- Browser proof requires fresh C4-marked Vite at `/c4-vite/` and forced fresh C4-marked Next at
  `/c4-next`, exclusive ports/PIDs, origin-root decoys, exact prefixed routes, network/output scans,
  and stopping only recorded PIDs. C3 servers, markers, `dist` and `.next` are inadmissible evidence.
- Protected boundaries remain exact: preserve C3's one-compositor-per-session/exact release/full
  render-export transaction/Host teardown/selectors/state; do not edit C1 port/public session
  shapes, C5 persistence, C6 global lifetime policy, parity/type fixtures, Rust or generated WASM.
  Stop if a prefix escapes, a production C4 role falls back, nested ORT remains rooted, forced-none
  allocates/throws, a generated/Rust edit appears necessary, a gate accepts vacuous/corrupt input,
  or a new full-suite/type failure exceeds the inherited exact ceiling.
- **C5 handoff:** replace remaining reference persistence roles independently and preserve C4's
  explicit browser asset/resource overrides, immutable base identities, Host-service endpoint
  ownership and opaque public session shape. Do not merge live URL/image caches merely because a
  durable store is shared. **C6 handoff:** start from C4's session-owned Worker handle and
  resolver-scoped effect-preview state, then close AudioContext/object URL/timer/graphics acquisition,
  full service disposal and last-owner GPU teardown without adding a second Worker/degraded owner.
