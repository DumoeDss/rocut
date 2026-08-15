# Task 2.5 — does `tsc` under `apps/web` already reach `packages/*/src`?

## Open question, settled empirically

Task 2.5 asks the question directly: does `tsc` under `apps/web` still reach package sources
through the workspace symlink (`node_modules/@opencut/editor-ports` → `packages/editor-ports`,
created by task 1.3's `bun install`), or must `apps/web/tsconfig.json` be widened explicitly (e.g.
a `references` array, or an `include` entry reaching outside `apps/web/`)?

Settled the same way gate-1 settled the `#/` resolver question (task 1.1): a throwaway spike with
an unambiguous signal, wired into the real resolution path, observed against the live checker, then
fully reverted. Reasoning alone was not trusted as sufficient — `moduleResolution: "bundler"`
resolving an `exports` map at the type level is exactly the kind of thing that looks obviously true
until it isn't.

### Spike

1. `packages/editor-ports/src/index.ts`:
   ```ts
   export const spikeTypeBaselineProbeValue: string = 42;
   ```
   Deliberate `TS2322` — a `number` literal assigned to a `string`-typed const. `packages/editor-
   ports/package.json`'s `exports` map already declares `"."` → `./src/index.ts` (P0's work), so
   this file lands exactly on the package's root entry.

2. `apps/web/src/spike-type-baseline-probe-consumer.ts`:
   ```ts
   import { spikeTypeBaselineProbeValue } from "@opencut/editor-ports";
   export const consumed = spikeTypeBaselineProbeValue;
   ```
   A reachable module under `apps/web/src` — nothing else imports it, but `tsconfig.json`'s
   `include` covers all of `apps/web/src/**/*.ts`, so it enters the program without further wiring.

### Result

```
$ node script/check-type-baseline.mjs
...
FAIL  1 diagnostic(s) not present at the pin — S01 regressions:
  ../../packages/editor-ports/src/index.ts:1 TS2322 (pin 0, now 1)
    Type 'number' is not assignable to type 'string'.
```

The regression fired on the **first** live run, with zero changes to `apps/web/tsconfig.json`.
`normalizePath()`'s `<repo>` collapse renders the file as `../../packages/editor-ports/src/index.ts`
relative to `apps/web` — outside `apps/web/`'s own directory, which is itself confirmation the
program is not artificially scoped to `apps/web/src`.

Cross-checked directly: `tsc -p tsconfig.json --noEmit --listFilesOnly --pretty false` (run from
`apps/web`) listed `packages/editor-ports/src/index.ts` in its raw output alongside the probe
consumer, both outside any `node_modules` segment.

**Conclusion: no widening required.** The workspace symlink plus the package's declared `exports`
map is already a complete, live resolution path for both the module system and the type checker.
`apps/web/tsconfig.json` needs no edit for task 2.5 or for any later Group 3-5 move — the same
mechanism will pick up `packages/editor-contracts/src` and `packages/editor-classic/src` the moment
sources land there, with no further action.

### Teardown

```
rm -f apps/web/src/spike-type-baseline-probe-consumer.ts
rm -rf packages/editor-ports/src
```

`git status --porcelain` confirmed clean for both paths before proceeding.

## Instrumentation added

`countTypeCheckedFiles(appDir)` in `script/check-type-baseline.mjs`: a dedicated
`tsc --listFilesOnly` run (separate from the diagnostic run, deliberately — parsing file paths out
of the diagnostic run's stdout/stderr would only accidentally avoid colliding with the `head`/
continuation-line regexes). Reports `{ total, repo }`, where `repo` excludes any path containing
`/node_modules/` — chosen so the headline count is sensitive to a genuine `apps/web/src` or
`packages/*/src` scope collapse, rather than being dominated by ~3300+ stable TypeScript-lib and
dependency `.d.ts` files that would barely move under any realistic regression.

Wired into both the `--regenerate` branch (stored in the fixture as `typeCheckedFiles: {total,
repo}`, printed after the fixture is written) and the normal comparison branch (computed fresh each
run, printed alongside the existing diagnostic summary — with the pin-side count appended when the
fixture carries one).

## Measurement recorded

```
$ node script/check-type-baseline.mjs
check-type-baseline: 3 diagnostic(s) now, 13 at the pin cf5e79e9
  compiler TypeScript 5.9.3, comparison key = file + code + message
  941 repo file(s) type-checked now (4328 total, including lib/dependency declarations)
...
PASS  no diagnostic outside the pinned baseline set
```

**941 repo files, 4328 total (including lib/dependency declarations), 0 new diagnostics** — the
diagnostic numbers are unchanged from `gate-1-pre-move-baseline.md`'s task 1.4 capture (3 now / 13 at
pin, the same 7 resolved entries), confirming the new instrumentation is additive only. `941` is the
reference figure later Groups' verification passes (3.5, 4.5, 5.7, 8.4) compare against — it must not
shrink as `packages/*/src` gains files while `apps/web/src` loses the corresponding ones; it should
stay roughly flat through Stage A/B/C and only reflect real additions/removals, never a scope
collapse.

There is **no pin-side figure in the committed fixture** — `script/fixtures/type-baseline.json` was
deliberately left untouched rather than regenerated. See `evidence/group-2-control-rerun.md` for why:
regenerating surfaced an unrelated, pre-existing fragility in the pin-reconstruction method that is
out of this task's scope to fix.
