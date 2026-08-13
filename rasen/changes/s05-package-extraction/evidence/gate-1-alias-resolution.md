# Gate 1 — `#/` subpath-import resolution spike (tasks 1.1–1.2)

Per design E2, this decision "carries a gate, not an assumption": before any of the 863 files
move, a throwaway two-file package proves whether `"imports": { "#/*": "./src/*" }` resolves
identically across the four resolvers apps/web and apps/vite-example depend on. If any resolver
disagrees, the fallback (relative-path rewrite) is chosen here, not discovered mid-move.

## Spike package

`packages/spike-imports-probe/` (deleted at task 1.3):

- `package.json` — `"imports": { "#/*": "./src/*" }`, `"exports": { ".": "./src/b.ts" }`
- `src/a.ts` — exports `SPIKE_VALUE`
- `src/b.ts` — `import { SPIKE_VALUE } from "#/a"`, re-exports `SPIKE_VALUE_VIA_HASH`
- `src/spike.test.ts` — bun test importing `#/a` directly

Consumers wired to exercise each resolver as a **reachable** module (not an orphan file — see
correction note below): `apps/web/package.json` and `apps/vite-example/package.json` each got a
temporary `"@opencut/spike-imports-probe": "workspace:*"` dependency.

## Correction made mid-spike

The first pass added `apps/web/src/spike-imports-probe-consumer.ts` (importing the spike package)
but never imported *that* file from anything reachable. `tsc`'s `include` glob still type-checked
it directly (globs match every `.ts`/`.tsx` regardless of import graph), so the tsc result below is
valid from the first pass. But Next's bundlers (webpack/Turbopack) and Vite only visit files
reachable from a real entry point — an unimported orphan file is invisible to them. The first-pass
`next build` reported "Compiled successfully," which was **not evidence of anything**: the probe
was never in the build graph. Caught this before recording a false positive; re-wired the import
into `apps/web/src/app/layout.tsx` (root layout, reachable from every route) and
`apps/vite-example/src/main.tsx` (the real `rollupOptions.input.app` entry) with a side-effecting
use (`if (typeof X !== "string") throw …` / `console.log(X)`) so no bundler could resolve-and-discard
it silently. All results below are from the corrected, reachable wiring.

## Results

| Resolver | Command | Result |
|---|---|---|
| bun test | `bun test` in `packages/spike-imports-probe/` | **FAIL** |
| tsc (apps/web, `moduleResolution: "bundler"`) | `apps/web/node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --incremental false --pretty false` (cwd `apps/web`, matches `check-type-baseline.mjs`) | **FAIL** |
| Next / Turbopack (apps/web) | `next build` (Next 16.1.3 defaults `build` to Turbopack; no `--turbopack` flag needed) | **FAIL** |
| Next / webpack (apps/web) | `next build --webpack` | **FAIL** |
| Vite (apps/vite-example) | `vite build` | **PASS** |

3 of 4 resolver buckets (bun, tsc, Next) fail; only Vite resolves the wildcard `#/*` cleanly.
Agreement is not unanimous, so per E2 the fallback triggers.

### bun test — exact failure

```
error: Cannot find module '#/a' from '…/packages/spike-imports-probe/src/spike.test.ts'
0 pass
1 fail
1 error
```

Reproduced independently in complete isolation (outside the monorepo, `/tmp/bun-imports-probe*`,
no bun workspace, no repo config) with both the pinned `bun@1.2.18` and latest `bun@1.3.14` —
same failure both versions. This matches a real upstream Bun issue (GitHub #28995, "Root-level
wildcard subpath imports are not supported in Bun", opened against 1.3.11), but the failure here
is **broader than that issue's title**: named-segment wildcard prefixes (`#lib/*`, `#src/*`) fail
identically in this environment, not just root-level `#/*`. An exact, non-wildcard `imports` key
(e.g. `"#foo": "./src/lib/a.ts"`) resolves correctly under both `bun test` and `bun run` — the
failure is specific to wildcard *pattern* matching in bun's `imports` resolver, not to
self-referencing imports generally.

### tsc — exact failure

```
../../packages/spike-imports-probe/src/b.ts(2,29): error TS2307: Cannot find module '#/a' or its
corresponding type declarations.
```

(The same run also reports pre-existing, unrelated diagnostics — `next.config.ts` `adapterPath`,
two `MediaTime` brand mismatches in timeline tests — that are baseline noise already present before
this spike, not caused by it.)

### Next / Turbopack — exact failure

```
▲ Next.js 16.1.3 (Turbopack)
./…/packages/spike-imports-probe/src/b.ts:2:1
Module not found: Can't resolve '#/a'
```

### Next / webpack — exact failure

```
▲ Next.js 16.1.3 (webpack)
../../packages/spike-imports-probe/src/b.ts
Module not found: Request should not start with "#/"
```

Webpack's message is the most explicit of the four: it rejects the `#/`-prefixed specifier outright
rather than merely failing to find a match.

### Vite — success (for completeness)

```
✓ 2945 modules transformed.
✓ built in 33.18s
```

`apps/vite-example`'s production build resolves `#/a` through the workspace-symlinked package's
`imports` field without error. Vite/esbuild/rollup is the one resolver in the matrix that supports
wildcard `imports` field patterns correctly here.

## Decision (task 1.2)

**The `#/*` wildcard `imports` form is rejected.** Per design E2's explicit gate clause ("If any
resolver fails, the fallback is the relative rewrite, and the fallback is chosen at that gate
rather than discovered at file 400"), stage 2 onward rewrites `@/x` to a computed relative path
from each file's new location to the target module — not to `#/x`. This is not carried forward as
an assumption; it is the recorded outcome of this gate given 3 of 4 resolvers failed, including
both of apps/web's own build paths (webpack and Turbopack) and the test runner (bun) that every
package's own suite runs under.

Practical consequence for stage 3 onward: the 2,179 `@/` rewrites become relative-path arithmetic
(design E2's "rejected" option), which means the resolution-equivalence check (task 6.1) carries
more weight than it would have under the two-character prefix-swap form — a wrong `../` that still
resolves to a real module compiles clean and is invisible to review. Task 3.2/4.2/5.x rewrites
should be scripted (not hand-typed) and their output verified against task 6.1's per-specifier
resolution-equivalence check, not spot-checked.
