## Context

P0 froze the boundary and moved nothing. The three manifests point their `exports` at `./src/*.ts`
— **the packages ship TypeScript source with no build step**, which is what B1's narrow reading of
"published" ("consumable from a checkout") asks for. `packages/boundary.json` assigns every module
under `apps/web/src` to a package or to the `apps/web` consumer, and
`script/check-package-boundary.mjs` proves the assignment is acyclic *in place*.

Measured against that map on `feat/s05-community-beta` at `8437084b`:

| destination | files |
| --- | ---: |
| `@opencut/editor-classic` | 791 |
| `@opencut/editor-contracts` | 54 |
| `@opencut/editor-ports` | 18 |
| `apps/web` (shell, stays) | 54 |

The current checker run is the baseline every task below is measured against:

```
acyclic-direction   PASS  949 files scanned, 341 cross-package edges examined
public-entry-only   PASS  949 files scanned,   0 @opencut/* specifiers examined
no-internal-reexport ....    0 files scanned — packages/ holds no source yet
no-elftia-import    PASS 1031 files scanned
react-free-base     PASS   68 files scanned
```

Two of those numbers are the whole reason this child needs a plan rather than a script: `0` and `0`.

## Goals / Non-Goals

**Goals:**

- Land all 863 files in the frozen layout, with `git mv` so the diff reads as renames.
- Rewire both existing Hosts onto `@opencut/*` specifiers and delete the `@` → `../web/src` alias.
- Keep every enforcement oracle pointed at the code after it moves — the boundary checker, the type
  baseline, and every other `apps/web/src`-scoped checker.
- Make `public-entry-only` and `no-internal-reexport` fire on real post-move source, proven by
  deliberate violation-and-revert, not inherited as a green light.
- Zero semantic parity rows outside the documented idempotency envelope; type baseline does not grow.

**Non-Goals:**

- Changing any public signature S03+S04 froze. Pressure to do so is a **`failed` condition**, not a
  patch.
- Changing the layer order or any declared `exports` entry. Additions are permitted by P0's
  monotone-growth rule; the measurement below says none is needed.
- Improving anything. Dead code, odd couplings and awkward names travel unchanged. A refactor that
  "tidies while moving" destroys the only oracle this child has.
- Installed-tarball resolution (P3), versioning (P5), notices (P7), CI legs (P3/P6).

## Decisions

### E1 — Target layout: mirror the tree, then add barrels at the declared entry paths

`editor-ports` and `editor-contracts` map almost directly: `editor/ports/**` →
`packages/editor-ports/src/**`, `editor/contracts/**` → `packages/editor-contracts/src/**`. Two
placements are forced by the frozen export map: `./host` → `src/host/index.ts` takes
`editor/host/editor-host.ts`, and `./in-memory/host` → `src/in-memory/host.ts` takes
`ports/in-memory/host.ts` unchanged.

`editor-classic` is the one that needs a rule, because its 14 declared entries do not correspond to
its 791 files' current directory shape. **The tree is mirrored (`apps/web/src/timeline/` →
`packages/editor-classic/src/timeline/`, `apps/web/src/editor/surface/` →
`packages/editor-classic/src/editor/surface/`, and so on) and the declared entries are authored as
thin barrels beside it.** Eleven barrels are new files (`src/surface/index.ts`, `src/session/`,
`src/runtime/`, `src/browser/`, `src/storage/`, `src/renderer/`, `src/ui/`, `src/evidence/`,
`src/project/`, `src/media/`, `src/fonts/`); `src/timeline/index.ts` already exists and takes on
double duty as internal barrel and declared entry. `./surface.css` cannot be a barrel, so
`editor/surface/surface.css` physically lands at `src/surface/surface.css` and its importers are
rewritten.

*Why mirror rather than restructure into the 14 roles.* Every intra-package relative import survives
byte-identical, which removes the largest single source of silent breakage in an 863-file move. The
export map constrains the *public* shape; it says nothing about the internal one, and
`no-internal-reexport` explicitly ignores relative specifiers within a package.

*Alternative rejected:* reorganising `src/` to match the 14 entries. It would recompute thousands of
relative paths for no boundary benefit, and every recomputation is a chance to point at the wrong
module in a way that still compiles.

### E2 — `@/` cannot survive inside `packages/`; rewrite it to a package-local `#/` subpath import

`@/` is an `apps/web` tsconfig `paths` entry and an `apps/vite-example` Vite alias. Neither exists
for a consumer who installs a tarball. Since the packages ship `./src/*.ts` with **no build step**,
there is no point at which an alias could be resolved away — so `@/` inside package source is broken
by construction, and it would fail in exactly the place B1's harness was designed to catch (P3,
outside the monorepo) rather than here.

2,179 occurrences across 544 files must therefore change. Two ways to do it:

**Chosen: Node subpath imports.** Each package declares `"imports": { "#/*": "./src/*" }` and every
`@/x` becomes `#/x`. The rewrite is a **two-character prefix swap with no path arithmetic**, so the
diff is uniformly reviewable and no specifier can be silently repointed at the wrong module. The
`imports` field is resolved by the *defining* package, so it keeps working for an installed
consumer, and TypeScript honours it under the repo's existing `moduleResolution: "bundler"`.

**Rejected: rewrite to relative paths.** Semantically equivalent, but it requires computing 2,179
correct relative paths across a tree that is simultaneously moving. A wrong `../` that still resolves
to a real module compiles clean and is invisible to review.

**This decision carries a gate, not an assumption.** Task 1.1 spikes `#/` resolution across all four
resolvers that must agree — bun (tests), `tsc` (type baseline), Vite (the example and both Host
builds), and Next/Turbopack (`apps/web`) — on a two-file throwaway package, *before* any source
moves. If any resolver fails, the fallback is the relative rewrite, and the fallback is chosen at
that gate rather than discovered at file 400.

### E3 — Two oracles are scoped to `apps/web/src` and both go quiet when the source leaves it

This is the defect class most likely to make P1 *look* successful while removing the evidence that
it was. Both instances are load-bearing and both are fixed before any file moves.

**(a) `check-package-boundary.mjs`.** `ownerOfPath()` answers for `apps/web/src/**` and
`apps/vite-example/**` and returns `null` for everything else, so a file at
`packages/editor-classic/src/timeline/x.ts` is *unowned*. Consequences after the move:

- `acyclic-direction` — `filesScanned` stays non-zero (the 54 shell files and the example are still
  there), so the empty-scan guard never trips, while `edgesExamined` collapses from **341** toward
  zero. It would print `PASS` for years.
- `react-free-base` — its `scanned` counter only increments for `apps/web/src` base-layer files, so
  it drops to `0` and the fail-closed guard **exits 2**. Loud, and therefore safe; but an implementer
  who meets it as a mystery will be tempted to "fix" it by relaxing the guard.

The fix is the move P0's own `discoverPackageDirs` already made for manifests: derive, don't
hardcode. `ownerOfPath()` gains a `packages/<dir>/src/` branch resolved through the discovered
manifest names, and `resolveSpecifier()` learns to resolve `@opencut/<pkg>[/<subpath>]` through the
declared `exports` map to a repo path, plus `#/` against the owning package's `src`. After that,
`acyclic-direction` judges the same graph in its new coordinates and the edge census should return to
roughly 341 — **the census number is the regression test**, and it belongs in the evidence.

**(b) `check-type-baseline.mjs`** runs `tsc -p tsconfig.json` with `cwd: apps/web` against a fixture
captured from the upstream pin, and fails on *new* diagnostics. Remove 863 files from that program
and no new diagnostic can appear from them: the check passes while watching a fraction of what it was
written to watch. It is not a growth, so "the baseline may not grow" is technically satisfied and
substantively hollow. The program must be extended so the moved sources stay inside a type-checked
program, and the run must report **how many files it type-checked** so a future shrink is visible the
way the edge census makes the boundary shrink visible.

**Generalisation for the rest of the family, and a task in its own right:** every checker whose scan
scope is written as `apps/web/src` has this bug latent. Task 2.4 audits all 22 individually and
records, per checker, either "scope follows the source" or "deliberately Host-scoped, because …".
Silence per checker is not acceptable; `check-next-imports.mjs`, for instance, is genuinely
Host-scoped and should say so.

### E4 — The consumer rewire: 96 distinct modules onto 14 entries, and the 14 are enough

Measured distinct target modules reached from outside their package:

| consumer | into classic | into ports | into contracts |
| --- | ---: | ---: | ---: |
| `apps/web` shell | 53 modules / 103 edges | 3 / 9 | 0 |
| `apps/vite-example` | 43 modules / 59 edges | 4 / 8 | 1 / 1 |

Every one of those maps onto an existing declared entry. The assignment, which the implementer should
record as a table in `BOUNDARIES.md` rather than leave implicit:

- `./ui` — `components/ui/*` (button, checkbox, context-menu, dropdown-menu, input, label, separator,
  sonner, tooltip, …), `components/icons`, `components/theme-toggle`, `components/editor/mobile-gate`,
  `components/providers/editor-provider`, `editor/host/editor-host-context`
- `./session` — `editor/session`, `create-session`, `editor/use-editor`
- `./runtime` — `session-core-owner`, `session-stores`, `wasm-runtime-providers`
- `./browser` — `editor/host/browser-runtime`, `editor/host/c4-project-load`
- `./surface` — `session-surface-bridge`, `editor-root`, `surface-drag-coordinator`, `surface-portal`
- `./storage` — `browser-project-store`, `-internals`, `-conformance`, the four probe modules,
  `browser-storage-mechanisms`, `indexeddb-adapter`, `migrations`, `migrations/v1-to-v2`
- `./project` — `project/types`, `migration-dialog`, `delete-project-dialog`, `rename-project-dialog`
- `./timeline` — `timeline`, `timeline/element-utils`, `timeline/scenes`
- `./renderer` — `services/renderer/canvas-renderer`, `scene-builder`
- `./fonts` — `google-fonts`, `use-font-atlas`
- `./evidence` — `c6-disposal-harness`, `c6-durable-reopen`, `headless-proof-control`,
  `headless-runtime-probe`, `headless-semantic-fixture`, `surface-evidence-harness`, `wasm-test-mock`
- `.` — `core`, `utils/{ui,date,id,string}`, `wasm`, `background/color`, `canvas/sizes`,
  `fps/defaults`, `feedback/types`
- `./media` — declared, currently unconsumed. Left in place: removing it would violate the freeze,
  and P2's Electron Host is the likely first consumer.

**No entry needs to be added.** If the implementer finds one that does, adding it is legal (monotone
growth) but must be recorded with the module that forced it — a quietly growing export map is how a
14-entry public surface becomes a 96-entry mirror of the internals, which is the outcome §3.1 exists
to prevent.

### E5 — Ownership corrections are permitted, narrowly, and are a finding rather than a convenience

Twelve modules are reached **only** by the shell — no `editor-classic` module and no
`vite-example` module imports them: `env/web`, `changelog/utils`,
`components/ui/{accordion,avatar,badge,breadcrumb,card,prose,react-markdown-wrapper,skeleton}`,
`project/components/project-info-dialog`,
`services/storage/components/storage-persistence-dialog`.

The rule: **a module that no package module imports is a candidate for correction to `apps/web`, and
correcting it must be a `boundary.json` diff with an updated `why`, reported as a finding.**
Recommended default, to stop this drifting either way:

- **Correct** `env/web` and `changelog/utils` — environment access and changelog helpers are shell
  infrastructure that the catch-all swept up; nothing in the editor graph touches them.
- **Do not correct** the `components/ui/*` atoms. They are one design-system unit with the atoms the
  editor does use, and splitting a design system across a package boundary is a worse outcome than
  exporting eight unused components behind `./ui`.
- **Adjudicate on evidence** the two dialogs; if the shell is genuinely their only caller they follow
  `env/web`.

Correcting an entry to avoid authoring a barrel is not a legitimate use of this rule, and the review
should test for it.

### E6 — Rule-activation plan: the two vacuous rules must fire on real source

Inheriting P0's green light for `public-entry-only` and `no-internal-reexport` would be exactly the
mistake spec §4 warns about. Each gets a deliberate violation, run against the **live repo scan**
rather than the in-memory control fixtures, and each is reverted immediately:

1. **`public-entry-only`.** After the classic move, add to a `apps/vite-example` source file an
   import of `@opencut/editor-classic/src/timeline/timeline-store` — an undeclared subpath of a real
   module. Expected: `FAIL [public-entry-only] apps/vite-example/... imports undeclared subpath`, exit
   `1`, and `specifiersExamined` non-zero. Revert; re-run; expect `PASS` with `specifiersExamined`
   still non-zero. **The second half is the real assertion** — a rule that passes with
   `specifiersExamined: 0` has proven nothing, which is precisely its state today.
2. **`no-internal-reexport`.** In `packages/editor-classic/src/surface/index.ts` — a declared entry
   file — add `export * from "@opencut/editor-ports/in-memory/internals";`. Expected: `FAIL
   [no-internal-reexport]`, exit `1`, and `filesScanned` non-zero rather than the `....` dormant
   line. Revert; re-run; expect the rule to report `PASS` with a non-zero scan, **never** the dormant
   `0 files scanned` line again. If it still prints dormant after the move, the rule did not
   activate and the child is not done.

Both probes are recorded in the evidence directory with both runs, following P0's
`inverted-import-proof.md` precedent. The same treatment is given to `acyclic-direction` in its new
coordinates: its post-move edge census must land near the pre-move **341**, and a collapse to a
small number is a scope regression even when it prints `PASS`.

### E7 — `DOMAIN_DOCUMENT_MEMBERS`: a decision procedure, not a reflex

`react-free-base` flags any `document.<member>` whose member is not in the seven-name allowlist
(`revision`, `tracks`, `clips`, `assets`, `markers`, `idempotency`, `project`). The allowlist is
inverted deliberately — it fires on the unknown rather than passing it — so ordinary domain reads
like `document.title`, `document.id`, `document.schema`, `document.summary`, `document.scenes`,
`document.version`, `document.duration`, `document.name` or `document.metadata` will trip it, and
several of those are already declared on `*Document` types. The failure is expected; the reflex to
"just add the member" is what needs a rule:

> Add the member **only** when the flagged `document` identifier is provably the domain document —
> traced to a parameter or binding whose declared type is a `*Document` from
> `@opencut/editor-contracts`. If the identifier's type cannot be named, it is a DOM leak until
> proven otherwise, and the fix is to rename the local binding rather than to widen the allowlist.

Each addition is committed with the member name, the file that forced it, and the type that proves
it — the same attribution discipline the type baseline requires. Widening the allowlist without that
line is how a rule protecting two React-free packages becomes decoration.

### E8 — Parity strategy: an import-graph invariant first, the runtime fixture as the verdict

The parity fixture is the oracle, but it runs at the end of a long move and reports a verdict, not a
location. So the move carries a cheaper invariant that fails *early and locally*:

> **Resolution equivalence.** For every rewritten specifier, the module it resolves to after the
> rewrite is the same module it resolved to before, compared as repo-relative paths across the
> rename map.

That is mechanically checkable from the same import extraction the boundary checker already does, it
covers all 2,179 rewrites, and it turns "did I break an import" from a runtime question into a
diff-time one. It does not replace the fixture — a correct import graph can still ship different
behaviour — but a broken graph is found in seconds instead of after a 15-minute dual-Host cycle.

Then the real oracle, unchanged from S01/S02/S03+S04: `PARITY_SPEC=parity` and `PARITY_SPEC=agent`
against `PARITY_HOST=vite` and `PARITY_HOST=next`, snapshots diffed by
`script/diff-parity-snapshots.mjs`. **Acceptance is zero semantic rows**; `PARITY.md` currently
records 9 differences, 0 semantic, 195 leaf values compared. Any new semantic row is a defect in the
extraction, never an accepted update, and the classification rules are inherited untouched.

### E9 — Sequence: bottom-up by layer, every stage a complete state

"A half-extracted graph has no meaningful acceptance state" is why this is one child. Inside it, the
order still matters, and the principle is that **no stage ends with the tree in an inconsistent
state**: each layer moves together with the rewrite of every specifier that points at it.

0. Spike `#/` across bun / tsc / Vite / Next (E2's gate). Choose the rewrite form.
1. Teach the checker and the type baseline to see `packages/*/src` **before** anything lands there.
   Re-run both; nothing has moved, so both must be unchanged — that is the control proving the scope
   change is behaviour-preserving.
2. Move `editor-ports` (18 files) and rewrite all ~157 `@/editor/ports*` and
   `@/editor/host/editor-host` specifiers repo-wide. Full verification pass. This is the smallest
   possible end-to-end proof of the whole pipeline: manifest, exports, resolution in four resolvers,
   checker, type baseline, tests.
3. Move `editor-contracts` (54 files) and rewrite its ~22 incoming specifiers. Full pass.
4. Move `editor-classic` (791 files), author the 11 barrels, move `surface.css`. Full pass.
5. Rewire the consumers onto declared entries; delete the `@` alias from `apps/vite-example`'s Vite
   and tsconfig; fix Next transpilation for source-shipped workspace dependencies.
6. Rule-activation probes (E6), full checker family, both parity specs on both Hosts, type baseline.
7. Documentation: `BOUNDARIES.md` entry-mapping table, `PARITY.md` restatement, ownership-correction
   findings.

Stages 2–4 are staging *within one delivery*, not sub-children: there is one commit series, one
review, one local ship.

## Risks / Trade-offs

- **[A rewritten specifier resolves to the wrong module and still compiles.]** → E8's resolution-
  equivalence invariant covers all 2,179; E2's prefix-swap form makes the class nearly unreachable.
- **[`#/` fails in one of the four resolvers, discovered late.]** → Gated at task 1.1, before any
  move, with a named fallback.
- **[The boundary checker prints `PASS` on a collapsed scope.]** → The edge census (341) is treated
  as a regression number, not decoration, and the two dormant rules must both be proven live by
  violation-and-revert.
- **[The type baseline passes because it stopped looking.]** → Program scope follows the source, and
  the run reports its file count.
- **[Barrel authoring quietly widens the public surface.]** → 14 entries in, 14 entries out; any
  addition names the module that forced it. `no-internal-reexport` is live from stage 4 and is the
  mechanical half of this.
- **[Extraction pressures a frozen signature.]** → Stop. It is a `failed` condition for the Slice and
  returns to the contract. The design deliberately mirrors the tree and adds barrels precisely so
  that no existing module's exports need to change.
- **[`git mv` renames get recorded as delete+add, damaging provenance.]** → Use `git mv`, and verify
  with `git diff --cached -M --summary`. **P7 inherits this**: `SOURCE_INVENTORY.{md,json}` derives
  fork additions from `git diff --name-status` against the upstream pin, and 863 renames will
  restate that inventory wholesale.
- **[Editing tooling flips files to CRLF on this machine.]** → `git ls-files --eol` after every batch;
  on a batch this size, run it per stage rather than once at the end.
- **[A parked worker's heartbeat stales the archive.]** → Write `{"kind":"standDown"}` to every
  parked role's signal the moment review goes clean, and confirm `signals/.state/` is empty before
  planning the archive.

## Migration Plan

There is nothing to migrate for a user: no behaviour changes, by construction. For the repository,
rollback at any stage is `git revert` of that stage's commits — the stages are ordered so each one
leaves a consistent, verifiable tree.

Ship mode is **local (commit only)**. The portfolio delivers once, at the parent.

## Open Questions

- **Does `tsc` under `apps/web` still type-check package sources through the workspace symlink, or
  must the program be widened explicitly?** Resolved empirically at stage 1, before anything moves;
  the answer changes the shape of the `check-type-baseline.mjs` edit but not the requirement.
- **Do the two shell-only dialogs (`project-info-dialog`, `storage-persistence-dialog`) belong to the
  shell?** Adjudicated on caller evidence at stage 5 (E5). Not blocking: either placement satisfies
  every rule; only the `why` differs.
- **Does `apps/web` need `transpilePackages` under Turbopack as well as webpack?** Determined at
  stage 5. It affects the Next Host build only, and the Next Host is the parity reference, so it must
  be settled before the parity run rather than after.
