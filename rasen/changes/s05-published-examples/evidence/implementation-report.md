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

## Findings so far (running list)

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
