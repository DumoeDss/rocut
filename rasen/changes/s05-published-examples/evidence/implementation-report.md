# Implementation report — s05-published-examples (P6)

Base commit for before/after comparisons: `4f0b9c69` (the branch HEAD at apply
start — P5's archive commit; the frozen surfaces there are byte-identical to the
P2/P3/P5 controls' base `5aae75ec`, re-proven below).

## Group 1 — Baseline (tasks 1.1, 1.2)

**1.1 — census + family sweep + frozen control + examples/ absence**
(`evidence/logs/group1-baseline.log`, `group1-family-sweep.log`,
`group1-frozen-byte-control.log`):

- Boundary census at `4f0b9c69`: **1110 repo files in scope, 989 package-graph
  files, 362 cross-package edges, 361 `@opencut/*` specifiers, 870/74
  no-internal-reexport/react-free split** — the checker's own printed filter
  (`git ls-files --cached --others --exclude-standard`, code files only), figures
  matching P5's close-out exactly. This is the before-half of the Group-4
  comparison.
- Family sweep: **28 checkers, 22 exit-zero / 6 nonzero**, the nonzero set exactly
  `{check-asset-manifest:2, check-emitted-runtime-assets:1, check-headless-graph:2,
  check-headless-semantic-result:2, check-resolution-equivalence:1,
  check-type-baseline:1}` — the known capture-run-needing set; no OTHER red.
- Frozen-surface byte-control vs `5aae75ec`: **4/4 IDENTICAL**
  (`editor/transactions/opencut/index.ts`, `contracts/engine/engine.ts`,
  `ports/index.ts`, `surface/embedding/types.ts`) — method `git show <base>:<path>
  | cmp -s`, stat-cache-immune.
- `examples/` does not exist (recorded in the baseline log).

Method note (a trap re-hit, disclosed): the first sweep pass reported 28/28 zero
because `node | sed; echo $?` captured **sed's** exit — the exact PIPESTATUS trap
P5's handoff names. The committed log is the corrected re-run
(`${PIPESTATUS[0]}`), whose 22/6 shape matches the inherited baseline. The first
pass was discarded, not committed.

**1.2 — P3 harness reuse re-verified** (`evidence/logs/group1-p3-runner-reference.log`):
`node script/run-scratch-conformance.mjs` at default env, exit 0. Control
assertions captured verbatim as the pre-extraction reference for Group 2's diffed
comparison: CONTROL-1a/1b (root outside repo tree + 4 Temp roots), lifecycle
wipe/marker, `npm-install:0`, CONTROL-2 copy-not-link ×4 (three `@opencut/*` +
`opencut-wasm`, all `file:tarballs/*.tgz`, `link=false`), CONTROL-react-free,
adapter materialization, suites green, `REAL_EXIT_CODE[scratch-run]:0`.

## Group 2 — Harness first (tasks 2.1, 2.2, 2.3)

**2.1 — the extraction, behaviour-preserving** (`evidence/logs/group2-p3-rerun-post-extraction.log`):
the scratch lifecycle + no-linking controls moved into
`script/scratch-install-harness.mjs` (`createScratchHarness({...})` — one
factory, P3's runner now a consumer); P3's own CLI and env seams unchanged.
Acceptance = the diffed control-assertion comparison against 1.2's reference:
**every runner-emitted line identical** (CONTROL-1a/1b, lifecycle, 4 CONTROL-2
copy-not-link lines, CONTROL-react-free, adapter materialization,
`REAL_EXIT_CODE[npm-install|suites|scratch-run]`) — the sole diff line is the
evidence wrapper's own exit echo (`REAL_EXIT_CODE:0` in Group 1's wrapper,
`FULL_EXIT:0` in Group 2's), which is not runner output. Both modes re-run
green after the extraction: full run exit 0, `--control-removal` exit 0 with
`CONTROL-3 removal: PASS`. (`--variant-nonconforming` exercises runner-local
code the extraction never touched — unchanged by construction, not re-run.)

Two additive parameterizations (both default to P3's exact behaviour, and the
re-run above is over the parameterized code): `controlCopiesNotLinks(root,
names)` defaults to the full SDK set — the examples runner passes what each
example's own manifest declares; `install(root, stepLabel)` defaults to
`npm-install` — the examples runner passes `npm-install/<example>`.

**2.2 — the consumer view promoted to standing tooling**
(`evidence/logs/group2-consumer-view-{fresh-pack,prepacked}.log`):
`script/check-sdk-consumer-view.mjs` — `runConsumerView()` exported (the
runner imports it), CLI self-logs `REAL_EXIT_CODE[consumer-view]`. The four
clauses green from a fresh pack (50 `ok` lines) AND standalone against
`OPENCUT_PREPACKED_DIR` (exit 0, 0 failures, 0 dangling both ways).

Dangling-branch proof, violation-and-revert: a synthetic
`./vectors/synthetic-dangling` entry (declared in BOTH the export map and
surface.json — set-equality holds, so the dangling branch is what fires) was
injected into contracts' manifest + surface.json, proven to FAIL at the
provider class and again at the frozen class, then both files restored at
blob level (verified `git hash-object` vs `git ls-tree HEAD` — the
stat-cache-immune check). **Staleness trap found while proving it (F-P6-2):**
the prepacked-mode proof first failed (1 dangling) because the tarballs
sitting in `dist-sdk-tarballs` had been packed DURING the injection run —
prepacked mode verifies whatever bytes are in the dir, and pack-in-time
matters. Re-packed clean from the restored tree → prepacked green. The
committed prepacked log is the post-repair run.

Named deviation (recorded, benign): design E4 names a
`--consumer-view-only` mode — it lives on the **examples runner**
(`script/run-published-examples.mjs --consumer-view-only`: verify the packed
surface, nothing materialized, nothing installed), not on the checker, whose
CLI stays flagless (its whole invocation IS the view). The mode's behaviour
is E4's — the cheap daily gate independent of the examples — and CI reaches
it through the full run.

**2.3 — the runner over one placeholder**
(`evidence/logs/group2-examples-runner-placeholder.log` and siblings):
`script/run-published-examples.mjs` + `examples/install-packages/` seeded as
the placeholder. Full-run shape, all green in one pass: scratch lifecycle +
CONTROL-1a/1b → 4 tarballs staged via `packSdkTarballs` (imported) →
**consumer view against the STAGED tarballs** (the exact bytes every example
installs from — the runner points `runConsumerView` at `<scratch>/tarballs`,
not a second packing) → materialize → `npm-install/install-packages:0` →
CONTROL-2 ×4 (ports/contracts/classic + wasm via the override) →
CONTROL-react-free → `EXIT[example/install-packages/execute]:0` →
`REAL_EXIT_CODE[examples-run]:0`. Seams proven:
`--consumer-view-only` (exit 0), `OPENCUT_EXAMPLES=install-packages`
(subset line printed, exit 0), `OPENCUT_EXAMPLES=nope` (refused with the
available list, exit 1).

Manifest shape ruling (E2's text implemented literally): the committed
example manifest declares plain exact pins (`"@opencut/editor-ports":
"0.2.0"` — the adopter-facing registry shape); the RUNNER resolves them to
tarballs at materialization (deps AND matching overrides rewritten to
`file:tarballs/<file>`, npm's direct-dep==override rule satisfied — P3's
gate-1 shape emerges from a registry-shaped manifest). Guarded fail-closed:
non-exact pins refused, committed overrides refused (the mechanism is the
runner's), `@opencut/*` in devDependencies refused, and a pin that doesn't
equal the packed tarball's version fails as a stale manifest. The wasm
override is injected only when the example depends on classic (the
four-tarball ruling's condition); the placeholder (all three deps, for 3.1's
classic-metadata assertion) carries it.



- **F-P6-1 (measured at apply start, load-bearing for 3.4):** classic's shipped
  source imports **33 distinct bare npm specifiers** beyond its declared
  manifest (which lists only `@opencut/*`, `culori`, `opencut-wasm` + peer
  `react`): the design-system closure (`radix-ui`, `@hugeicons/*`, `lucide-react`,
  `sonner`, `class-variance-authority`, `zustand`, `clsx`, `tailwind-merge`,
  `next-themes`, `react-day-picker`, `react-hook-form`, `react-icons`, 
  `react-markdown`, `react-resizable-panels`, `react-window`, `rehype-parse`,
  `unified`, `use-deep-compare-effect`, `motion/react`, `@radix-ui/react-separator`,
  `react-dom/*`, `mediabunny`, `eventemitter3`, `soundtouchjs`,
  `@huggingface/transformers`, `@napi-rs/canvas`, …). P3's manifest-truth repair
  covered exactly the react-free closure its consumer forced; **no from-tarballs
  consumer has ever imported the React-bearing UI surface**, so the debt was
  invisible to every gate since. The embed-surface example (3.4) is the forcing
  consumer; the repair class is P3's own (declare what the forcing consumer
  needs, same commit, attributed) — heavy non-browser deps
  (`@huggingface/transformers`, `@napi-rs/canvas`) are measured and dispositioned
  at 3.4, not blanket-declared.

- **F-P6-2 (prepacked-mode staleness, Group 2):** `OPENCUT_PREPACKED_DIR`
  verifies whatever bytes sit in the dir — a dir holding tarballs packed
  during a violation window will keep failing (or, worse, keep passing)
  long after the tree is repaired. Pack-in-time is part of the proof. The
  examples runner closes this for itself by verifying the tarballs it JUST
  staged (`<scratch>/tarballs`), never a dir with history.

## Group 3 — The four examples, cheapest first (tasks 3.1–3.5)

### 3.1 `examples/install-packages/` — the install contract as an adopter meets it

25 assertions, all green (`evidence/logs/group3-install-packages.log`):
resolved versions for all three `@opencut/*` equal the `"0.2.0"` pin; PORT_ROLES'
8 roles; fixture + store construct; `INITIAL_REVISION`; the vectors corpus
manifest + 2 files; `OPERATION_KINDS` (12) equal to
`PUBLISHED_CONTRACT_SURFACE.operationKinds`; `TRANSACTION_VECTOR_SCHEMA`;
surface classes of the 5 imported entries all `frozen` (read as data, never
runtime machinery); the README policy anchor in all three packages; classic's
export-map shape (surface + surface.css + storage/migrations) and its
`peerDependencies.react "^18.3.1"` **read from the installed manifest, without
importing classic's runtime**; `node_modules/react` absent (CONTROL-react-free
pattern); classic's `./storage/migrations` classified `provider` in extracted
source. EXIT lines: `typecheck:0`, `run.ts:0`.

### 3.2 `examples/agent-transaction/` — the published scenario over the example's own store

`src/own-store.ts` is an `OwnInMemoryStore` written from scratch against the
published `ProjectStore` port (Maps for records/summaries/attachments/library,
`structuredClone` both directions, a `saveCount` counter, JSON
snapshot/restore) — deliberately not a subclass of any in-repo store. `run.ts`
seeds `createTransactionNativeProjectSeed`, opens
`openTransactionEngine({store, projectId, documentAdapter:
createTransactionNativeDocumentAdapter()})`, drives the published
`AGENT_SCENARIO` (9 steps, 87 total assertions) through `runAgentScenario`
with `durableSaves: () => store.saveCount`, asserts per-step durable saves
(`accepted ? 1 : 0`), writes `ledger.json`, then round-trips the store through
`exportSnapshot` → `fromSnapshot` into a **fresh engine** for
`verifyAgentReopen` (fresh-instance reload-reopen — stronger than the in-repo
test's same-store reopen). Green: verdict passed, executedSteps 9/9,
commitment verified (`evidence/logs/group3-agent-transaction.log`).

### 3.3 `examples/custom-storage/` — the honest pair (design E2.3)

P3's third-party adapter promoted to example shape: `src/` is an independent
copy of `script/fixtures/third-party-adapter/src/` (the fixture itself stays
untouched — repointing its default template would change P3's logged control
lines and break extraction acceptance). The promotion needed strict-mode
repairs the fixture never faced (it had no tsconfig; it ran under bun only):

- `alien-codec.ts`: `isPlainObject` became a type predicate; an explicit
  fail-closed `AlienCodecError` for `undefined` (outside the serialized
  subset) before `getPrototypeOf` is reached.
- `alien-store.ts`: the library-namespace conflict branches rewritten as
  three straight-line locally-guarded branches — the original
  ternary-correlated formulation defeats strict control-flow analysis
  (semantics identical: namespace∧namespace compares namespaces; namespace vs
  library-record compares namespaces; anything else false).
- `factories.ts`: the operations array cast
  `as unknown as readonly TransactionOperation[]` (the same cast the published
  durable driver uses).
- `transaction.ts`: `(op.patch ?? {}) as Record<string, unknown>` before each
  of three spread sites (TS2698 spreading `unknown`).
- `types/culori.d.ts`: ambient `declare module "culori"` — **F-P6-3**: classic
  ships TS source importing culori, which publishes no declarations;
  from-tarballs consumers meet the gap head-on and must declare the module
  themselves. Recorded as a durable finding for P7 (classic's README could
  name the requirement).

Execution is two legs (`opencutExample.bunEntries`, each its own process —
the runner's array seam added for exactly this):

- **`run.ts` (production leg)**: 5 suites green (ports 36 cases with the
  migration case explicitly absent, transaction 21, engine 38, draft 22,
  vectors 29). The classic `./storage/migrations` chain is **NOT LOADABLE** in
  the plain consumer — recorded distinctly with the observed reason, and
  `migration/by-replication: SKIPPED distinctly`. The wasm-initialization
  defect is Direction-level: demonstrated, not repaired.
- **`run-mock.ts` (mock-installed leg)**: installs
  `@opencut/editor-classic/evidence/wasm-test-mock` **first**, then the real
  chain loads (31 steps, target v31), `demonstrateLegacyMigration` runs, the
  ports suite re-runs with migration exercised (36 cases, green). The README
  states verbatim that the example therefore depends on an experimental-labeled
  entry and inherits its instability.

`evidence/logs/group3-custom-storage.log`.

### 3.4 `examples/embed-surface/` — the forcing consumer (design E2.2)

Vite + React from the tarballs: the stylesheet through the declared
`./surface.css` entry, the example's own `react`/`react-dom` 18.3.1 (the peer
contract as designed, one copy via Vite `dedupe`), a minimal committed asset
set (`fonts/font-atlas.json`, `logos/opencut/svg/logo.svg`) with a README
pointer to the canonical allowlist at `apps/vite-example/build/editor-assets.ts`,
and the GPU-free configuration settled empirically: host-side rasterizer
`"none"` (`src/host.ts`) plus Chromium `--disable-gpu --disable-dev-shm-usage
--use-angle=swiftshader --enable-unsafe-swiftshader`. Execution is `vite build`
against the installed TS source AND a Playwright smoke that serves `./dist`,
boots headless Chromium, and asserts: mount with near-viewport extent, the
host-supplied branding logo, the degraded-renderer banner, two real
interactions, the committed assets actually fetched, and a clean boot scoped to
tolerate exactly the documented absent font chunks
(`/fonts/font-chunk-<n>.avif` 404s — the editor falls back to system fonts;
any other console error, page error, or failed response fails the gate).

The type/build gaps beyond 3.3's are all consumer-side and documented in the
example's README: `@types/culori` (classic's UI closure type-imports `Rgb`;
culori ships no types), classic's ambient declarations (`EyeDropper`,
`soundtouchjs`) reachable only by tsconfig `include` of the installed
package's `src/types`, `vite/client`+`node` types for `import.meta.env`, and
one build-time pin — `@swc/core` exactly `1.15.47`, because
`vite-plugin-top-level-await@1.6.0`'s chunk rewrite dies on @swc 1.16+'s
changed AST ("missing field `type`"), verified green at the pinned version.

Two further consumer-side defects the smoke caught that the build blessed —
the P1 "build-only is not execution" precedent in miniature:

- **F-P6-4 (unstyled-build: `source()` does not survive node_modules).** The
  `@import "tailwindcss/utilities.css" source("../../")` inside surface.css
  stops registering the editor's class scan once the file is consumed from
  node_modules. A stylesheet-rule probe of the built page found theme tokens
  present but `.size-full`/`.overflow-hidden`/`.flex-1`/`.min-h-0` absent —
  the editor renders colored-but-inert: nothing sizes, nothing clips. Fix is
  the consumer-side registration
  `@source "../node_modules/@opencut/editor-classic/src"` in the example's
  `styles.css` — the same self-registration the in-repo Vite host performs
  (`apps/vite-example/src/styles.css`). Durable for P7: classic's README
  should name this obligation; a consumer who skips it gets a silently
  half-styled editor.
- **F-P6-5 (indefinite-height collapse).** `min-height: 100%` on
  html/body/`#root` establishes no definite height, so the Surface's
  `size-full` resolved to content height: a 1440×**116** app — the entire
  timeline rendered but clipped invisible (`elementFromPoint` returned
  `<html>` for everything below the header). Fix is the explicit
  `height: 100vh` wrapper the in-repo harnesses use
  (`apps/vite-example/src/c4-forced-none-harness.tsx:257`). The smoke's mount
  assertion now requires >800×600, so a host that reintroduces the collapse
  fails the gate instead of shipping it.

The interaction design carries three measured lessons:

- **The empty-scene trap.** `buildDefaultScene` yields zero duration, and the
  seek controller clamps every ruler seek to it
  (`rawTimeSeconds = max(0, min(duration/TICKS_PER_SECOND, …))`) — the
  playhead of an empty project provably cannot move, which would make the
  scrub gate vacuous. The fixture adds one text element via the published
  `buildTextElement` (default duration 5s) on an overlay `TextTrack` (the
  main track accepts only video/image elements; the builder is declared to
  return the whole creation union, so the placement narrows it with
  `as CreateTextElement`). Recorded as F-P6-6 for P7: an adopter seeding an
  empty project gets an inert-but-blameless-looking timeline.
- **The occlusion disposition.** In this GPU-free layout the 1920×1080
  preview placeholder overflows its collapsed panel and intercepts pointer
  events across the banner and header (probe: `elementFromPoint` at the
  dismiss button's center = the placeholder, rect −600,−540 1920×1080). The
  banner therefore stays a VISIBILITY assertion; the state-changing
  interaction is the ruler scrub — the task's "interactive timeline" —
  asserted through the playhead's `aria-valuenow`/`left` moving.
- **preventDefault vs focus.** The ruler's seek controller preventDefaults
  mousedown, which suppresses the focus move — a ruler click does NOT land
  focus inside the surface. The focus-scope interaction is instead a plain
  click in the preview area, which rides the Surface's own focus scope.

Final state (scratch, byte-synced to the repo tree): typecheck exit 0,
`vite build` exit 0 (≈35s), smoke **9/9 assertions PASS** —
`mount/surface-root, mount/branding-logo, gpu-free/degraded-banner,
interaction/focus-scope, interaction/playhead-scrub, assets/fetched,
clean/console, clean/pageerror, clean/network`. Canonical logs:
`evidence/logs/group3-full-run.log` (all four examples, default env) and
`evidence/logs/group3-embed-surface.log` (the `OPENCUT_EXAMPLES` subset
seam).

### 3.5 Full local run through the runner, default env

`node script/run-published-examples.mjs` from a clean scratch lifecycle at the
shipping tree (`evidence/logs/group3-full-run.log`): tarball pack + staging,
**consumer-view PASS (3 packages, 0 failures, 0 dangling)** against the staged
tarballs, then all four examples in the runner's order —
`REAL_EXIT_CODE[npm-install/<name>]:0` ×4 with CONTROL-2 copy-not-link ×4 and
the react controls green per install, and per-example step exits all zero:
`EXIT[example/agent-transaction/{typecheck,execute}]:0`,
`EXIT[example/custom-storage/{typecheck,run.ts,run-mock.ts}]:0`,
`EXIT[example/embed-surface/{typecheck,build,smoke}]:0`,
`EXIT[example/install-packages/{typecheck,execute}]:0` — 10 EXIT lines, zero
nonzero. Final line: `examples: 4 example(s) executed green —
agent-transaction, custom-storage, embed-surface, install-packages`,
`REAL_EXIT_CODE[examples-run]:0`, wrapper `REAL_EXIT_CODE:0`.

The subset seam re-proven at the same tree
(`evidence/logs/group3-embed-surface.log`,
`OPENCUT_EXAMPLES=embed-surface`): the heaviest example alone through the
same default-env path, green end to end.

No example needed a missing export entry — the escalation clause never fired;
no barrel was invented.
