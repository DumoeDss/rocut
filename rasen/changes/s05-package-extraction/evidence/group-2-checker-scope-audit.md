# Task 2.4 — static checker scope audit

Audits every `script/check-*.mjs` for `apps/web/src`-scoped scan sets, per design E3's
generalisation ("every checker whose scan scope is written as `apps/web/src` has this bug
latent").

## Count discrepancy: 26 files exist, not 22

`ls script/check-*.mjs` returns **26** files today, not the 22 tasks.md names. Cause identified:
`check-agent-evidence.mjs` carries its own doc comment referencing
`s0304-agent-transaction-evidence` — a sibling Rasen change (rocut S03/S04, unrelated to this
Slice) that landed a new checker into this shared trunk after design.md's "22" was written. The
trunk's checker population has been growing concurrently from other in-flight work, not only from
this child's own history. Rather than guess which four to exclude to force-fit "22", this audit
covers **all 26 currently-existing files** — the task's own instruction ("do not leave any checker
unlisted") is stronger than matching a stale count. `check-type-baseline.mjs` is excluded from the
table below only because it has its own dedicated task (2.5), not because it was skipped.

25 checkers audited here + 1 (`check-type-baseline.mjs`) deferred to task 2.5 = 26.

## Classification scheme

Three buckets, one more than the task's stated two — the third is a considered addition, not a
deviation, recorded because several checkers assert against literal file paths whose post-move
destination is knowable in principle (mirrored shape, design E1) but **untestable today**, since
`packages/editor-classic/src` does not exist until Group 5 lands. Editing those checkers now would
be a guess I cannot verify with a live run, breaking the discipline used for 2.1-2.3 (every edit
there was confirmed byte-identical against a real run before being called done).

- **A — scope follows the source, fixed now.** The checker's scope-determination is a general
  discovery mechanism (glob/prefix over a package registry), not a literal enumeration, so it could
  be taught `packages/*/src` immediately and verified against today's (empty) tree, exactly as
  `check-package-boundary.mjs` was in 2.1-2.3.
- **B — deliberately Host-scoped.** The checker's subject is genuinely the Host/shell, not the
  editor package, so `apps/web/src` (or `apps/vite-example/src`) is the correct permanent scope.
- **C — literal-path tracker, deferred to the move.** The checker enumerates specific files or
  directories editor-owned code will occupy. Its scope cannot be corrected now because the
  destination cannot be verified until the corresponding Group 3/4/5 task actually performs the
  `git mv`. Each entry below names which task's move will make the checker fail loudly
  (`missing-required-root` or equivalent) and therefore force the literal-path update at that point.
  This is a forward-note for that task's own verification pass, not a gap being carried silently —
  none of these checkers goes quietly blind: each either asserts required-file existence (loud
  failure the moment the old path disappears) or is folded into Group 8's "run every checker, all
  green" sweep (task 8.5), which cannot pass while a checker still points at a pre-move path.
- **N/A — not applicable.** The checker's subject has no `apps/web/src` vs `packages/*/src`
  distinction at all (wasm artifacts, build output, evidence for an unrelated change, a JSON
  payload shape).

## Table

| Checker | Bucket | Notes / edit |
|---|---|---|
| `check-package-boundary.mjs` | A | Fixed in tasks 2.1-2.3 this session: `ownerOfPath()` gained a `packages/<dir>/src/` branch through discovered manifests; `resolveSpecifier()` gained `@opencut/<pkg>[/<subpath>]` resolution through declared `exports`; `guardUnownedFiles()` now refuses unowned `packages/*/src` files. Verified live-run + both controls byte-identical to the 1.4 baseline. |
| `check-reference-boundary.mjs` | A (no edit needed) | Already repo-wide: `git ls-files -z --cached --others --exclude-standard` with **no directory argument**, only a `POLICY_DOCS`/`rasen/` exclusion filter. Already correctly covers `packages/*/src` with zero changes. |
| `check-next-imports.mjs` | B | Explicit doc comment (lines 16-24) states the scope split by design: this check guards `apps/web/src` source-level Next imports, `check-distributable-boundary.mjs` covers the example host at the bundle level. Named in tasks.md 2.4 itself as the expected Host-scoped example. One observation, not an action: once editor code leaves `apps/web/src`, its `EDITOR_ROOTS` list will match zero files there, so this check becomes vacuously true for the editor side rather than actively guarding it — but that is correct, not a regression, since editor-owned packages cannot practically import `next/*` without declaring a `next` dependency they don't have; no replacement check is required by design or tasks.md. |
| `check-distributable-boundary.mjs` | B (10/10 rules unaffected) | All ten `RULES` test shell-owned prefixes (`app/`, `site/`, `blog/`, `db/`, `auth/`, `components/landing/`) or dependency/virtual-module substrings (`next`, `content-collections`, `changelog-notification`) or `apps/desktop/` — none reference editor-owned paths, so none need editing. One cosmetic, non-gating line: the "Composition" report (`editorModules = modules.filter(id => id.startsWith("apps/web/src/"))`) will undercount post-move since editor modules will resolve under `packages/*` in the Rollup graph. It is informational text printed after PASS/FAIL, not a rule — noted for a Group 8 touch-up, not blocking. |
| `check-agent-evidence.mjs` | N/A | Reads `rasen/changes/s0304-agent-transaction-evidence/evidence/browser-agent`, a sibling change's evidence directory. No relationship to editor source location. |
| `check-asset-manifest.mjs` | N/A | Operates on `apps/vite-example/dist/asset-manifest.json` (build output) and `apps/web/public` (static assets), not TypeScript source modules. |
| `check-emitted-runtime-assets.mjs` | N/A | Operates on emitted Next build output layers (`apps/web/.next`); delegates its source-level counterpart to `check-runtime-asset-boundary.mjs` (bucket C below). |
| `check-headless-semantic-result.mjs` | N/A | Validates the shape of a semantic-result JSON payload passed as a CLI argument (global-hook counts, digests). No filesystem path scope at all. |
| `check-wasm-api-surface.mjs` | N/A | Scans `rust/wasm/pkg` (the built wasm package's `.d.ts`/`.js`/`.wasm` surface) via `wasm-api-surface-contract.mjs`. Unrelated to editor TS source. |
| `check-wasm-paths.mjs` | N/A | Scans the built `.wasm` binary for leaked build-machine absolute paths. Unrelated to editor TS source. |
| `check-wasm-source.mjs` | N/A | Verifies `opencut-wasm` module resolution (via `createRequire`) points at the repo-built artifact, checking every physical `node_modules` copy. Unrelated to editor TS source. |
| `check-editor-singleton.mjs` | C | Walks only `sourceFilesUnder("apps/web/src")` + `("apps/vite-example/src")`. Hardcodes `OWNER`/`SESSION_FACTORY`/`REQUIRED` (7 literal paths, mostly under `apps/web/src/editor/**`) and `commandDirectory = apps/web/src/commands`. Also regex-matches the literal specifier text `"@/editor/use-editor"` (line 198) — coupled to Group 6's alias-rewrite, not just Group 5's move. Will fail loudly (`missing-required-root`) the moment Group 5 moves `session-core-owner.ts`/`create-session.ts`, forcing the update then. |
| `check-host-composition.mjs` | C | `HOST_ROOTS` (2 literals), `HOST_CONTRACT = apps/web/src/editor/host/editor-host.ts`, `RETIRED_ADAPTER` all under `apps/web/src/editor/**` or `services/storage/**`. `HOST_CONTRACT` specifically is task 3.1's `editor-host.ts` move target. |
| `check-port-boundary.mjs` | C + alias | `CONTRACT_AREAS` (`editor/ports/`, `editor/session/`), `CONTRACT_FILES` (`editor/host/editor-host.ts`), `REGISTRY_MODULE`, `NON_RUNTIME_AREAS` (4 more editor-owned prefixes) — all literal `apps/web/src/editor/**`. These are used as **filters**, not existence-asserted lists, so unlike `check-editor-singleton.mjs` this one risks a **silent vacuous pass** (0 files matched, still PASS) rather than a loud failure, once Group 3/5 move the underlying directories — the same failure shape 2.1-2.3 fixed in `check-package-boundary.mjs`. Also independently reimplements `@/` specifier resolution (own `resolveSpecifier`-equivalent), coupled to Group 6's alias-rewrite form. |
| `check-react-singleton.mjs` | C | `PROBE = apps/web/src/editor/surface/embedding/surface-react-identity-probe.tsx` (task 5.1's mirrored-move territory). Separately, `MANIFESTS` lists `package.json`, `apps/web/package.json`, `apps/vite-example/package.json` for the exact-React-version pin — does **not** yet include the three new package manifests. `editor-classic` declares React/UI dependencies, so once it does, a version drift there would go unchecked unless `MANIFESTS` is widened to include all three `packages/editor-*/package.json`. Recorded as a finding for Group 5/8, not fixed now (the packages' own dependency declarations aren't finalized until then). |
| `check-runtime-asset-boundary.mjs` | C | `BROWSER_ADAPTER`, two Host-config literals, and 5 producer-file literals (`fonts/google-fonts.ts`, `stickers/providers/flags.ts`, etc.), plus a directory walk over `apps/web/src` + `apps/vite-example/src`. All editor-owned entries move under Group 5. |
| `check-session-resource-boundary.mjs` | C | `SOURCE_ROOT = apps/web/src`, `REGISTRY`, `SHARED_SESSION_ENTRY`, per-Host entries, and ~5 more literal editor-owned paths (`ports/in-memory/index.ts`, `session/c6-disposal-harness.tsx`, etc.). |
| `check-session-state-boundary.mjs` | C + alias | Walks `apps/web/src` + `apps/vite-example/src`; ~10 hardcoded store-file literals (`panel-store.ts`, `editor-store.ts`, `preview-store.ts`, etc., all under `apps/web/src/**`). Independently reimplements `@/` alias resolution at lines 539/584 (`"@/" + path.replace("apps/web/src/", "")` and the inverse) — this is a **manual duplicate** of exactly the logic `check-package-boundary.mjs`'s `resolveSpecifier()` now owns; it must track whatever form Group 3-6 actually lands (relative-path rewrite, per gate-1), not the `@/` form it currently assumes. |
| `check-storage-boundary.mjs` | C + alias | `SOURCE_ROOTS`, `STORAGE_AREA = apps/web/src/services/storage/`, `PUBLIC_PORT_AREA = apps/web/src/editor/ports/`, `HOST_CONTRACT`, plus several shell-consumer literals. Independently reimplements `@/` resolution (`spec.slice(2)` form), same coupling as above. |
| `check-transaction-boundary.mjs` | C + alias | `CONTRACT_AREA = apps/web/src/editor/contracts/` — task 4.1's Stage B move target specifically. Independently reimplements `@/` resolution (`resolveSpecifier`, line 199, `spec.startsWith("@/")` form) plus ~7 fixture-path literals under the same tree. |
| `check-surface-boundary.mjs` | C | `SURFACE_ROOT = apps/web/src/editor/surface/`, plus a page-route literal. |
| `check-surface-css-boundary.mjs` | C | `SOURCE = apps/web/src/editor/surface/surface.css` — the exact file task 5.2 moves to `packages/editor-classic/src/surface/surface.css`. Narrowest-scope entry in the audit: one file. |
| `check-surface-portal-boundary.mjs` | C | `REQUIRED` lists 11 literals: 9 under `apps/web/src/components/ui/*` plus `draggable-item.tsx` and `audio-volume-line.tsx`. The 9 `components/ui/*` entries substantially overlap task 5.6's "eight `components/ui/*` atoms... kept in the package behind `./ui`" adjudication — worth cross-checking exact set equality when 5.6 runs, since the counts (9 here vs. "eight" in tasks.md) don't match exactly and the discrepancy should be resolved with evidence, not assumed to be the same list. |
| `check-surface-private-drag.mjs` | C | `COORDINATOR` + 2 more `editor/surface/embedding/**` literals, plus shell-exclusion prefixes (`app/`, `components/landing/`, `components/site/`, `components/blog/`, `components/changelog/` — these stay Host-owned, no change needed for them specifically). |
| `check-headless-graph.mjs` | C | ~10+ module-id literals (`ids: ["apps/web/src/editor/session/headless-runtime-probe.ts"]`, etc.) asserted against a headless bundle's module graph — same shape as `check-distributable-boundary.mjs` but for editor-owned modules specifically, so unlike that checker, these **do** need updating once the bundler resolves the moved sources to new module ids. |

## Bucket C is not a silent gap

Every bucket-C checker either (a) asserts a required file's existence and will `exit 1` the moment
its literal path stops resolving (`check-editor-singleton.mjs`, `check-react-singleton.mjs` via its
manifest read, etc.), or (b) is swept by task 8.5's "run every runnable static checker, confirm all
green" — which cannot pass while any checker still points at a pre-move path. The one exception
requiring explicit attention is **`check-port-boundary.mjs`**, whose `CONTRACT_AREAS`/
`NON_RUNTIME_AREAS` are used as silent **filters** (0 matched files still prints PASS) rather than
existence-asserted requirements — flagged above as the one bucket-C checker that risks the same
"vacuous pass" failure mode 2.1-2.3 fixed in `check-package-boundary.mjs`. It is deferred to Group 3
(ports)/5 (classic) rather than fixed now for the same untestability reason as the rest of bucket C,
but whoever executes those groups must not treat "check-port-boundary.mjs prints PASS" as sufficient
without also checking its scanned-file count moved off zero.

## Independent `@/`-resolution duplication (cross-cutting finding)

Four checkers besides `check-package-boundary.mjs` itself independently reimplement `@/` specifier
resolution rather than importing a shared helper: `check-session-state-boundary.mjs`,
`check-storage-boundary.mjs`, `check-transaction-boundary.mjs`, `check-port-boundary.mjs`. All four
must be updated to the chosen relative-path rewrite form (gate-1's decision) at the same time their
literal path lists are corrected — recorded here so Group 3-6 does not rediscover this coupling
file-by-file. Not extracted into a shared module in this task: doing so now, before Group 6 confirms
the exact rewritten form in practice across 2,179 real specifiers, risks building the wrong
abstraction. Recorded as a finding for task 9.4.
