## Context

`package.json` declares `workspaces: ["apps/*", "packages/*"]`; `packages/` does not exist. All
editor source lives under `apps/web/src/`, and `apps/vite-example` consumes it through a Vite/TS
path alias (`@` → `../web/src`), not a package boundary. `BOUNDARIES.md` §2 states the consequence
plainly: *"This is not a published API. There is no `exports` map, no entry point and no stability
promise; the example reaches in through a path alias. Designing the real export surface is later
work."* This change is that later work's first half.

Four decisions arrive already ruled and are not reopened here:

- **B1** — "published `0.x`" is the narrow reading; no registry publish.
- **B2** — the second Host is Electron + Vite (P2's concern).
- **B3** — Roadmap M5's two `adapter-elftia` bullets are struck; what survives is one import rule
  inside this change's checker.
- **B4** — the split is layered: contracts / ports / surface, with the Classic provider separable
  from the frozen contract surface. **This change settles the exact package count and the provider
  seam within that shape; it does not reopen the shape.**

The constraint that actually decides the count is spec §3.5: a third-party adapter author must
implement ports and run conformance **without pulling React or the editor UI**. Any split that puts
React into the contracts/ports install is wrong by construction.

The constraint that decides what is *possible* is spec §3.9 and plan §8: no public signature frozen
by S03+S04 may change, and P1 is a refactor whose oracle is the parity fixture. A boundary that can
only be reached by inverting production dependencies is not a boundary P1 can execute.

### Measured import graph (2026-08-13, `feat/s05-community-beta`)

948 source files under `apps/web/src` and `apps/vite-example` were parsed for `import` / `export …
from` / `require()` / dynamic `import()` specifiers, alias-resolved (`@/` → `apps/web/src/`), and
grouped by candidate package. Two facts came out of it, and between them they settle the design.

**Fact 1 — there is a clean, React-free, two-layer base, and its direction is the reverse of the
intuitive one.**

| edge | production | total |
| --- | ---: | ---: |
| `editor/contracts/**` → `editor/ports/**` | 8 | 12 |
| `editor/ports/**` → `editor/contracts/**` | **0** | **0** |

`editor/ports` has **zero outgoing edges** to anything above it once `editor/host/editor-host.ts` is
counted as part of it (see D3). `editor/contracts` reaches only into ports:
`contracts/draft/immutable.ts`, `contracts/engine/{adapter,engine,invariant,native-adapter}.ts`,
`contracts/engine/conformance/index.ts` and `contracts/vectors/drivers/durable.ts` all consume
`IdGenerator` / `DiagnosticsPort` / identity types. Neither directory imports `react`,
`react-dom`, or any DOM global. Neither declares a single npm runtime dependency — the only bare
specifiers are `bun:test` (tests) and `node:{fs,path,url,crypto,child_process}` (the vector corpus
tooling).

**Fact 2 — everything above that base is one dense mutual-recursion knot, in production code.**

| candidate seam | A→B (prod) | B→A (prod) |
| --- | ---: | ---: |
| Classic provider ↔ editor UI | 228 | 293 |
| editor UI ↔ session/runtime | 95 | 17 |
| session/runtime ↔ Classic provider | 64 | 31 |
| editor UI ↔ `editor/surface` | 19 | 16 |
| `editor/surface` ↔ Classic provider | 5 | 1 |

Every candidate seam *inside* the implementation is bidirectional in production source. The
smallest one — `editor/surface` ↔ UI — is real and structural, not accidental:
`components/ui/{alert-dialog,dialog,…}.tsx` and `panels/assets/draggable-item.tsx` consume
`surface-portal` and `surface-drag-coordinator` as primitives (surface *below* UI), while
`surface/editor-root.tsx` composes `@/components/editor/panels/*` and `@/components/ui/resizable`
(surface *above* UI). The directory is two layers wearing one name.

## Goals / Non-Goals

**Goals:**

- Settle the package count and the provider seam, with the measurement that forced each.
- Declare each package's public entry points as an `exports` map, and state what `0.x` freezes.
- Assert the dependency direction **mechanically**, over real source, **today** — before P1 moves
  anything — so the split is proven executable rather than hoped to be.
- Fold the Elftia-import rule (B3) into the same checker, matched at specifier and dependency-name
  granularity.
- Leave every one of the nineteen existing checkers green, `no-desktop-app` included.

**Non-Goals:**

- Moving source. P1 owns that. `packages/` gains manifests, a declaration and documentation; it
  gains no modules.
- Writing a consumer. `apps/web` and `apps/vite-example` keep their path alias until P1.
- Proving anything about installed resolution. P3 owns the pack-and-install-from-tarball harness.
- Versioning policy and experimental labeling. P5 owns those; this change pins `0.1.0` and
  `private: true` so that P5 inherits a starting point rather than a fait accompli.
- Notices, SBOM and inventory inside the tarballs. P7 owns those; this change only declares the
  `files` entries that will carry them.

## Decisions

### D1 — Three packages, not four or five

| package | layer | owns | why it is a package |
| --- | ---: | --- | --- |
| `@opencut/editor-ports` | 0 | `editor/ports/**` and `editor/host/editor-host.ts` | The one complete surface a Host author implements. Zero dependencies, no React, no DOM — spec §3.5's install, mechanically. |
| `@opencut/editor-contracts` | 1 | `editor/contracts/**` | Domain, operations, transactions, draft sessions, the engine, four of the five conformance suites and the vector corpus. Depends only on layer 0. |
| `@opencut/editor-classic` | 2 | the OpenCut Classic provider and its React editor, including `editor/surface/**` | Everything React, everything provider-private, everything UI. Separable **from the frozen contract surface**, which is precisely what B4 requires. |

**Alternatives considered.**

*Four packages, splitting `react-editor` from `provider-opencut-classic` as Target State §4 draws
them.* Rejected on measurement, not on taste: Fact 2 above shows 228/293 production edges between
the provider and the UI, 19/16 between the UI and `editor/surface`, and 64/31 between the
session/runtime and the provider. Cutting any of those requires inverting production dependencies —
a rewrite. P1 is constrained to a behaviour-preserving move whose oracle is the parity fixture
(spec §3.2), and plan §8 names "extraction forces a contract change" as a `failed` condition. Buying
a fourth package with a rewrite would trade the Slice's only behavioural guarantee for a diagram.
**This is a finding for the Direction, not a private decision:** Target State §4's
`provider-opencut-classic` / `react-editor` sibling split is not reachable by extraction alone and
needs a Slice of its own — Roadmap M9/S09 "provider evolution" is its natural home. It is recorded
here so the divergence is visible rather than discovered later.

*A `surface-primitives` package carved below the UI* (`surface-portal`, `surface-drag-coordinator`,
`surface-focus`, `surface-lifecycle`), which would dissolve the smallest of the five cycles.
Rejected as scope this change cannot justify: it advances none of §3.1, §3.4, §3.5 or §3.6, and it
would require P1 to move source that the freeze has no reason to touch. Recorded because it is the
one seam that *is* cheap, if a later Slice wants it.

*A separate `@opencut/editor-conformance` package,* so a third party installs conformance without
the contracts. Rejected: `editor/contracts/index.ts` already re-exports `runTransactionConformance`
and `formatConformanceReport`, which S03+S04 froze. Extracting conformance would either break that
re-export (a frozen-signature change — a `failed` condition) or create a contracts↔conformance
cycle. The same granularity is delivered for free by subpath exports (D5).

*A single combined package.* Excluded by B4's ruling and by §3.5 directly.

### D2 — The layer order is ports → contracts → classic, with **ports at the bottom**

The intuitive reading of "contracts / ports / surface" puts contracts underneath. The source says
otherwise: 8 production edges run contracts→ports and 0 run ports→contracts. `contracts/engine`
needs `IdGenerator` and `DiagnosticsPort`; nothing in `ports` needs a domain type. The declared
order therefore is:

```
0  @opencut/editor-ports        (no dependencies at all)
1  @opencut/editor-contracts    (depends on 0)
2  @opencut/editor-classic      (depends on 0 and 1)
—  apps/web, apps/vite-example, P2's second Host   (consumers; not packages)
```

An edge is legal only if it points to a strictly lower layer. Consumer apps sit above all three and
may depend on any of them. App↔app edges are out of this checker's scope — `apps/web`'s Host
composition tests already reach `apps/vite-example/src/host/vite-host-config`, which
`check-host-composition.mjs` owns and which is not a package concern.

### D3 — `editor/host/editor-host.ts` is owned by `@opencut/editor-ports`

`ports/index.ts` re-exports `EditorHostNavigation` from `../host/editor-host` under the frozen name
`NavigationHost`, and `ports/in-memory/host.ts` imports the same module; meanwhile
`host/editor-host.ts` imports `@/editor/ports`. That is a live module cycle today, harmless only
because both directions are type-only. **Split those two directories into different packages and the
cycle becomes a package cycle** — the exact thing §3.1 forbids.

`editor-host.ts` is 118 lines, imports nothing but `@/editor/ports`, contains no React and no DOM,
and describes itself as *"the one complete surface a **host author** implements."* It belongs to the
ports package on its merits, and assigning it there resolves the cycle **without editing a frozen
re-export**. The rest of `editor/host/` does not follow it: `browser-runtime.ts` (browser ports) and
`editor-host-context.tsx` / `host-image.tsx` (React) go to `@opencut/editor-classic`;
`next-editor-host.ts` and `c4-next-runtime-probe.tsx` are Next-Host composition and stay in
`apps/web`.

*Alternative considered:* drop the `NavigationHost` alias from the ports barrel. Rejected — it is
public surface S02 declared and S03+S04 carried, and removing it to make a package boundary
convenient is exactly the "private patch" spec §3.9 forbids.

### D4 — Ownership is declared in a committed data file, by path, with file-level overrides

`packages/boundary.json` is the single source of truth the checker reads:

```jsonc
{
  "layers": ["@opencut/editor-ports", "@opencut/editor-contracts", "@opencut/editor-classic"],
  "consumers": ["apps/web", "apps/vite-example"],
  "ownership": [ { "path": "...", "owner": "...", "why": "..." }, ... ]
}
```

Matching is longest-prefix-wins over POSIX paths, so a directory rule can be overridden by a file
rule beneath it. Two places genuinely need file granularity, and both were found by measurement
rather than by reading:

1. **`apps/web/src/feedback/`** — the boundary runs *through* this directory.
   `feedback/queries.ts` imports `@/db` (Drizzle + Postgres) and `feedback/index.ts` re-exports it;
   both are reached only from `app/api/feedback/route.ts`. `feedback/components/feedback-popover.tsx`
   is editor chrome, imported by `components/editor/editor-header.tsx`, and it imports `../types`
   — **not** the index. So `feedback/{index,queries}.ts` → `apps/web`;
   `feedback/{types.ts,components/**}` → `@opencut/editor-classic`. Zero code change; placement
   only. Left undeclared, this is the single production edge that would make the package graph
   reach the shell, and it would have surfaced mid-P1.
2. **Four test files whose subject is not their directory.**
   `contracts/vectors/__tests__/agent-opencut-projection.test.ts` tests the Classic projection and
   is owned by `@opencut/editor-classic`; `editor/host/__tests__/{branding-assets,
   production-composition}.test.ts` and `services/storage/__tests__/c5-storage-red-controls.test.ts`
   test the Next Host and are owned by `apps/web`. Ownership follows the subject, which removes any
   need for a special "tests may point upward" exemption — a rule that would have quietly voided the
   direction check for a third of the tree.

**Verified result: with this map, the current source graph has ZERO upward package edges — zero in
production and zero in tests.** The split is proven executable before P1 starts, which is the whole
point of a freeze child.

### D5 — Public entry points are `exports` subpaths; `0.x` freezes them monotonically

`exports` is itself the enforcement for installed consumers — Node and every modern bundler refuse a
subpath a package does not declare — so the checker's `public-entry-only` rule is the *source-level*
pre-image of a guarantee the runtime already gives.

| package | declared entries |
| --- | --- |
| `@opencut/editor-ports` | `.`, `./host`, `./in-memory`, `./in-memory/host`, `./conformance`, `./package.json` |
| `@opencut/editor-contracts` | `.`, `./conformance`, `./draft`, `./draft/conformance`, `./engine`, `./engine/invariant`, `./engine/conformance`, `./vectors`, `./vectors/drivers`, `./package.json` |
| `@opencut/editor-classic` | `.`, `./surface`, `./surface.css`, `./session`, `./runtime`, `./browser`, `./storage`, `./project`, `./timeline`, `./renderer`, `./media`, `./fonts`, `./ui`, `./evidence`, `./package.json` |

The lower two lists are derived from measurement, not invention: every specifier that currently
crosses into `editor/ports` or `editor/contracts` from outside resolves to one of the declared
entries, plus **three deep imports P1 must rewrite** —
`@/editor/ports/project-store` (4 uses), `@/editor/ports/gpu-resources` (3 uses) and
`@/editor/contracts/engine/invariant` (2 uses). The first two fetch `ProjectStore`,
`ProjectStoreError` and `UNIMPLEMENTED_RUNTIME_GPU`, all three of which the package root already
exports, so those are pure specifier rewrites. The third is a real second entry — `engine/index.ts`
does **not** re-export `invariant`, and `surface/embedding/surface-transaction-binding.ts` consumes
`validateTransactionDocument` in production — so `./engine/invariant` is declared public rather than
forcing an additive edit to a frozen barrel.

`./draft/conformance`, `./engine/conformance` and `./conformance` are declared now although nothing
outside imports them today. Spec §3.5 requires all five suites to be consumable from outside, and
P3 must not have to reopen a frozen export map to deliver that.

**What `0.x` freezes, stated precisely, because "frozen" is doing real work here:** a declared entry
may not be removed, renamed, or repointed at a different module. Adding an entry is permitted within
`0.x` and is expected during P1 and P2 — the `@opencut/editor-classic` list above covers every
production reach-in `apps/vite-example` makes today, but that list is the Vite Host's needs, and P2's
Electron Host will legitimately need more. **Monotone growth is the freeze.** P5 turns this into a
stated compatibility policy; this change states the invariant P5 will formalise.

`./evidence` exists as its own entry rather than being folded into `.` because the harnesses behind
it (`c6-disposal-harness`, `headless-*`, `surface-evidence-harness`) are exactly what spec §3.6 asks
to be distinguishable from a frozen contract. A separate subpath is the strongest possible label and
costs P5 nothing.

### D6 — The checker runs four rules over the present and one over the future, and says which

Everything under `packages/` is asserted, and `packages/` has no source yet. Rather than ship a
check that is green because it inspects nothing, `check-package-boundary.mjs` splits its rules by
what it can honestly assert today:

**Live from this commit, over `apps/web/src` and `apps/vite-example` via `boundary.json`:**

- `acyclic-direction` — 341 real cross-package edges today, all downward. A single upward edge fails.
  (MINOR-4, review round 1: this was recorded as 138 at proposal time; 341 is the measured count as
  of review round 2, `apps/web/src` and `apps/vite-example` having grown since. The number is a
  live measurement restated here for orientation, not a frozen target — the checker itself, not this
  document, is the source of truth.)
- `no-elftia-import` — over every source file and every manifest in the repository.
- `react-free-base` — no file owned by layer 0 or 1 imports `react`, `react-dom`, a DOM global, or
  any file owned by layer 2.
- `public-entry-only` — a specifier crossing into a package must resolve to a declared `exports`
  subpath. (MINOR-4, review round 1: this was dormant at proposal time and described as such below;
  BLOCKER-1's review-round-1 fix widened its scope to `apps/web/src` and `apps/vite-example` — the
  scenario spec.md:108-111 actually names — so it has been live since commit `bea59790`, scanning 949
  files, 0 `@opencut/*` specifiers examined today.)

**Live from the first module P1 places under `packages/`, and reported explicitly as
`0 files scanned` until then:**

- `no-internal-reexport` — a package's declared entry may not re-export a module owned by another
  package's internals. This one rule's scope is genuinely still `packages/*/src/**` only, because a
  re-export needs a declared entry file to re-export FROM, and none exists until P1 places one.

The run prints a scan census for every rule (`scanned N files` / `N edges`), and **refuses to report
a pass on an empty scan** for the four live rules — the fail-closed idiom
`check-surface-portal-boundary.mjs` and `check-next-imports.mjs` already use (`exit 2`, not `exit
0`). Reporting `0 files scanned` for the two dormant rules is a deliberate visible statement of what
is not yet covered, not an omission.

The negative control synthesises a violation of each of the five rules and asserts the scanner
catches it; the converse control synthesises a legal case for each and asserts it stays silent. Both
run against the pure `scan()` function with in-memory sources, so the dormant rules are fully
control-tested from day one even though their live scan set is empty.

### D7 — The Elftia rule matches specifiers, dependency names and identifiers — never raw text

A substring scan is wrong here in both directions, and the measurement is worth recording because
the failure looks like success:

- **Ignored build output** embeds the checkout's absolute path, which contains `elftia`
  (`apps/vite-example/dist/module-graph.json`, `tests/parity-artifacts/**`, `apps/web/.next/**`).
  All of these are gitignored, so the house scan idiom —
  `git ls-files -z --cached --others --exclude-standard` — already excludes them. **The context
  warning is real but its usual framing is off by one: the build artifacts are not the trap, because
  the standard idiom already skips them. Any checker that walks the filesystem directly instead of
  asking git will hit all of them.**
- **Tracked source is the actual trap.** Eight tracked files contain the string `elftia`, and every
  occurrence is prose: `editor/ports/DECISIONS.md` (5), `apps/vite-example/README.md` (2),
  `editor/session/resources.ts` (2), `script/check-port-boundary.mjs`, `ports/gpu-resources.ts`,
  `ports/runtime-resources.ts`, `ports/conformance/index.ts`, and a compile guard — all of them
  explaining *why the ports are Elftia-neutral*. A substring rule would flag the very documents that
  record the boundary, and the obvious "fix" would be to delete the reasoning.

So the rule matches four things and nothing else:

1. **Import specifiers** — `import` / `export … from` / `require()` / dynamic `import()` whose
   specifier is `elftia`, `elftia/*`, `@elftia/*`, or matches `^elftia-plugin-`.
2. **Dependency names** — any key under `dependencies`, `devDependencies`, `peerDependencies`,
   `optionalDependencies` in any `package.json`, plus any package identifier in `bun.lock`, matching
   the same set. This is the "no Elftia package in the resolved dependency graph" half.
3. **Protocol identifiers** — the string literals `plugin://` and `elftia://` in a URL position.
4. **Runtime objects** — member access on `window.elftia`, `globalThis.elftia`, `window.native`,
   `window.api`, and the bare identifiers `CapabilityBroker`, `ArtifactRuntime`, `ArtifactRef` —
   the four names Target State §3.4 lists as the adapter's Elftia-side dependencies.

Comments and Markdown prose are **out of scope by construction**, since none of the four is a
textual match. The rule's scope is the whole repository, not just `packages/`: spec §3.4 says *no
package, Host or example*, and today's baseline is clean, so this locks a door rather than repairing
one.

**There is no exception for `adapter-elftia`.** It does not exist in this repository, it is listed
under *"Elftia work allowed after the gate"* in Target State §8, and housing it here would make the
portable SDK depend on its largest consumer — the thing invariant #9 exists to prevent. The absence
of an exception is the design.

### D8 — `0.1.0` and `private: true`

Each manifest carries `"version": "0.1.0"` and `"private": true`. B1 ruled no registry publish, and
`private: true` makes an accidental `npm publish` impossible while leaving `npm pack` fully
functional — which is exactly the shape B1 asks for, since P3's harness packs tarballs and installs
them into a scratch project outside the monorepo. A task in this change verifies that with
`npm pack --dry-run` rather than asserting it from memory.

The `@opencut` scope follows the existing workspace convention (`@opencut/web`,
`@opencut/vite-example`). It is **not** a reserved npm scope, and nothing here reserves it; Target
State §4 already says the package names are architectural roles rather than approved npm names or
branding. Any future registry publish is downstream work with its own authorization (spec §4.1(a))
and settles naming then.

`files` declares `dist`, `src`, `README.md`, `LICENSE` and `NOTICE`. The last two are declared
empty-handed on purpose: **P7 owns the bytes** and must regenerate them at the ship commit, and a
consumer installing from a tarball gets whatever `files` shipped, so the entry has to exist before
P7 can fill it.

## Risks / Trade-offs

- **[The freeze is only as good as the ownership map, and P1 could quietly widen it.]** → The map is
  a committed data file; widening it is a visible diff in a reviewed commit, and the `why` field is
  required per entry. `check-package-boundary.mjs` additionally refuses a map in which any consumer
  path (`apps/web/src/app`, `site`, `blog`, `db`, `auth`, `components/landing`) is claimed by a
  package — the same self-guard `check-next-imports.mjs` applies to its own allowlist.
- **[`public-entry-only` and `no-internal-reexport` are dormant at this commit and could rot.]** →
  Both are control-tested from day one against synthetic sources, and the live run prints
  `0 files scanned` for them rather than `PASS`. The distinction is visible in the output, not
  buried in a comment.
- **[Three packages is fewer than Target State §4 draws, and could read as scope reduction.]** → It
  is recorded as a finding with its measurement (D1), not absorbed silently. The gap is one Slice's
  worth of dependency inversion and belongs to a Slice that can afford it.
- **[`@opencut/editor-classic` will be large, and "one package for everything above the contracts"
  weakens §3.6's labeling.]** → Mitigated structurally by subpath granularity, `./evidence` in
  particular; P5 owns the rest and inherits a surface that is already partitioned by role.
- **[The Elftia rule's identifier list could go stale as Elftia evolves.]** → The four runtime names
  come from Target State §3.4 and are cited in the checker so a reader can re-derive them. The rule
  is a floor, not a proof of absence; the actual proof that the SDK is independent of Elftia is
  §3.2/§3.3/§3.5, which spec §3.4 says outright.
- **[Editing tooling flips files to CRLF on this machine.]** → `git ls-files --eol` is run over the
  change's touched files as an explicit task step; rocut is LF in the worktree.

## Migration Plan

Nothing to migrate. `packages/` is created empty of source, no existing file changes behaviour, and
the path alias keeps working exactly as it does today. Rollback is deleting `packages/` and
`script/check-package-boundary.mjs` and reverting two documentation edits.

Ship mode is **local (commit only)**. The portfolio delivers once, at the parent, after all seven
children complete; a partial portfolio is never pushed.

## Open Questions

- **Where does the `provider-opencut-classic` / `react-editor` separation land?** Not in S05 (D1).
  Recommended: raise it at Direction level against Target State §4 and Roadmap M9/S09. **Not
  blocking P1** — the three-package split is complete and executable without an answer.
- **Does `@opencut/editor-classic` need a `peerDependencies` entry for React, or a plain
  `dependencies` one?** Decision D2 from S02 (shared React 18) points at `peerDependencies` so a Host
  supplies one copy, and `resolve.dedupe` in `apps/vite-example` exists for exactly that hazard.
  Deferred to P1, which will have the resolution evidence; the choice does not affect any boundary
  rule and is additive to the manifest.
