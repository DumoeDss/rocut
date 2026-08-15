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
