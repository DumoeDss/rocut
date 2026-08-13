# Review report — `s05-package-boundary-freeze` (S05 P0)

Reviewer: independent non-author reviewer (dispatched, report-only). Date: 2026-08-13.
Commit under review: **`5e3fc7cb`** on `feat/s05-community-beta` (14 files, +2193, parent
`8e1f18ac` = `origin/main`). Repository: `_others/rocut`.

**Verdict: `findings` — 2 Blocker, 3 Major, 9 Minor, 2 Trivial.**

No finding is a runtime defect in the shipped commit. Both Blockers are **spec scenarios the
shipped checker provably does not implement**; each was reproduced end-to-end. The change's
architecture, measurements and documentation are, in my assessment, unusually solid — the
findings are concentrated in the checker's matcher and scope, not in the boundary it declares.

---

## Method

Everything below was executed, not inferred, unless marked *unproven*.

- Read the full diff with repository context, plus `planning-context.md`, `proposal.md`,
  `design.md`, `tasks.md`, the delta spec, `BOUNDARIES.md` §7 and Slice spec §3.1/§3.4.
- Ran `node script/check-package-boundary.mjs`, `--negative-control`, `--converse-control` in
  the real repo (all exit 0, output reproduced below).
- Built a **sandbox replica** in a scratch directory outside rocut — the real
  `check-package-boundary.mjs`, the real `packages/boundary.json` and the three real manifests,
  a minimal synthetic `apps/web/src` tree, its own `git init` — and ran 13 adversarial probes
  against it. **rocut's working tree was never modified**; `git status` is byte-identical to
  the state at review start. Probe ids `P-A` … `P-N` are cited per finding.

### Live output at the ship commit (reproduced)

```
check-package-boundary: scanned 1031 repo file(s) (tracked + uncommitted)
  PASS  acyclic-direction: ... (949 file(s) scanned, 341 cross-package edge(s) examined)
  ....  public-entry-only: 0 files scanned — packages/ holds no source yet
  ....  no-internal-reexport: 0 files scanned — packages/ holds no source yet
  PASS  no-elftia-import: ... (1031 file(s) scanned)
  PASS  react-free-base: ... (68 file(s) scanned)
clean
```
Negative control: 5/5 caught, exit 0. Converse control: 4/4 silent, exit 0.

---

## Scope check — CLEAN

- **Intent:** declare and mechanically freeze a three-package boundary; move no source, write no
  consumer.
- **Delivered:** exactly that. The 14 changed files are `BOUNDARIES.md`, root `package.json`
  (one `check:packages` script line), four new files under `packages/`, the new checker, and the
  change's own artifact directory. **Zero files under `apps/**` or `script/check-*` other than
  the new checker.** P0 moved no source and wrote no consumer — confirmed by file list, not by
  assertion.
- **No S03+S04 frozen public signature changed.** No source file is in the diff at all, so the
  Slice-level `failed` condition is not approached. In particular `editor/ports/index.ts`'s
  `NavigationHost` re-export is untouched; the cycle is resolved by ownership assignment
  (`packages/boundary.json:27-30`), which is the right instrument.
- `check-distributable-boundary.mjs` is not in the diff and still carries `no-desktop-app`
  (`script/check-distributable-boundary.mjs:86`).

## Hygiene — CLEAN

| check | result |
| --- | --- |
| `.rasen/` in commit | **0 paths** (`git show --name-only 5e3fc7cb \| grep -c '^\.rasen/'` = 0) |
| sibling `rasen/changes/s05-*` swept in | **none** — the only change dir in the commit is `s05-package-boundary-freeze` |
| line endings | **all 14 files `i/lf w/lf`** (`git ls-files --eol`) |
| `rasen validate --strict --project rocut --json` | `valid: true`, 0 issues |

---

# Findings

## BLOCKER-1 — `public-entry-only` never inspects a consumer, so §3.1's deep-import clause is not enforced and will still not be after the rule wakes

**Where:** `script/check-package-boundary.mjs:482-484` (`packagesSourceFiles`),
consumed at `:506` and `:537`.

```js
function packagesSourceFiles(files) {
	return files.filter((f) => /^packages\/[^/]+\/src\//.test(f.path));
}
```

**What the change promises.** Slice spec §3.1: *"no consumer reaches a package's internals
through a deep import."* The change's own delta spec is more explicit still
(`specs/sdk-package-boundary/spec.md:108-111`):

> **WHEN** a **consumer** imports a subpath of a package that its `exports` map does not declare
> **THEN** the check reports it under the `public-entry-only` rule and exits non-zero

**What it does.** The rule's scan set is `packages/*/src/**` only. `apps/web/**` and
`apps/vite-example/**` — i.e. every consumer that exists, plus P2's Electron Host — can never
enter it. This is not the dormancy: dormancy ends when `packages/` gains source; **this scope
gap survives dormancy.**

**Reproduced (P-E).** Sandbox with one legal file under `packages/editor-classic/src/` (so the
rule is awake) plus a consumer file
`apps/web/src/editor/surface/consumer.ts` containing
`import { Secret } from "@opencut/editor-ports/internal/secret";`:

```
PASS  public-entry-only: ... (1 file(s) scanned)
EXIT=0
```

The identical import placed inside `packages/editor-classic/src/deep.ts` **is** caught (P-E2):

```
FAIL  public-entry-only: ... (2 file(s) scanned)
  [public-entry-only] packages/editor-classic/src/deep.ts:1: imports undeclared subpath
  "@opencut/editor-ports/internal/secret" of @opencut/editor-ports
```

So the rule fires only in the direction that matters least (package→package) and is blind in the
direction §3.1 names (consumer→package) — and it reports a green `PASS` with a non-zero census
while blind, which is worse than the honest `0 files scanned` it prints today.

**Failure scenario.** P1 lands, `apps/web` imports `@opencut/editor-classic/src/internal/x`
(the shortest path when an entry is missing), `bun run check:packages` prints
`PASS public-entry-only (N files scanned)`, and the freeze P0 exists to provide is not provided
for the repository's largest consumer.

**Fix (small):** extend the scan set to consumer roots — the file classification already exists
in `ownerOfPath` — or gate the rule on both scopes and keep the census split. **Must land before
P1 writes its first consumer specifier**, which is the entire premise of freeze-before-consume.

**Confidence: high** (reproduced both directions).

---

## BLOCKER-2 — the delta spec's "a fourth package fails the check" scenario is not implemented

**Where:** `script/check-package-boundary.mjs:70` and `:601-606`.

```js
const PACKAGE_DIRS = ["editor-ports", "editor-contracts", "editor-classic"];
function loadManifests() { return PACKAGE_DIRS.map(...); }
```

**Spec** (`specs/sdk-package-boundary/spec.md:35-39`):

> #### Scenario: A third package is not silently introduced
> - **WHEN** a fourth entry appears under `packages/` with a `package.json`
> - **THEN** the package-boundary check fails, because the package is absent from
>   `packages/boundary.json`'s declared layer order

**What it does.** `packages/` is never enumerated. The manifest loader reads a hardcoded triple;
a fourth directory is simply invisible.

**Reproduced (P-D).** Added `packages/editor-extra/package.json` (name `@opencut/editor-extra`,
valid `exports`) to the sandbox:

```
PASS  acyclic-direction ...  PASS  no-elftia-import ...  PASS  react-free-base ...
EXIT=0
```

The check passes. It does not mention the new package at all.

**Failure scenario.** P1/P2/P5 introduce a fourth package (P5's versioning work or P2's Host
adapter are the plausible authors). `boundary.json.layers` is never updated, so the new package
has no declared layer, `layerIndex()` returns `null` for it, and every edge into or out of it is
skipped by `acyclic-direction` (`:281` compares `null` and the `!(target < source)` guard fires
only on defined numbers — but no edge reaches that point because `ownerOfPath` returns `null`
for paths outside `apps/`). The boundary silently stops covering a package while reporting
`clean`.

**Secondary effect:** in `publicEntryOnlyRule:510-511`, `dirToName.get(selfDir)` is `undefined`
for an unknown package dir, so `selfName` is `undefined` and the "importing its own internals is
fine" exemption at `:519` silently stops applying to that package. No crash, but the semantics
change without notice.

**Fix (small):** enumerate `packages/*/package.json` at load time and exit `2` on any manifest
whose `name` is absent from `boundary.json.layers` — the same fail-closed idiom the file already
uses in `guardSelfConsistency`.

**Confidence: high** (reproduced).

---

## MAJOR-1 — a single unrelated parameter named `document` disables DOM detection for the whole file; 15 of 69 layer-0/1 files are already in that state

**Where:** `script/check-package-boundary.mjs:118-123` and `:435`.

```js
const documentExempt = hasLocalDocumentBinding(file.text);   // :435 — computed ONCE PER FILE
```

`hasLocalDocumentBinding` tests the whole file text. If **any** line in a layer-0/1 file
declares `document` as a parameter, a destructured binding or a `const`/`let`, then **every**
bare `document` reference anywhere else in that file is treated as that local.

**Reproduced (P-C).** A contracts file containing both a harmless parameter and a real DOM call:

```ts
export function seed(document: string) { return document.length; }
export function mount() { return document.createElement("div"); }
```
→ `PASS react-free-base`, `EXIT=0`.

**Control (P-C2)** — the same file with the parameter removed:
→ `FAIL react-free-base ... probe-plain.ts:2: references a DOM global`, `EXIT=1`.

So the mechanism is exactly as read: the exemption is file-scoped, not scope-scoped.

**Blast radius, measured today.** Of 69 tracked `.ts`/`.tsx` files owned by layer 0 or layer 1,
**15 (22%) already satisfy `DOCUMENT_DECLARATION_PATTERN`** and are therefore already exempt:

```
contracts/draft/{__tests__/draft.test.ts, conformance/index.ts, manager.ts}
contracts/engine/{adapter,engine,evaluator,invariant,native-adapter,placement,projection,types}.ts
contracts/vectors/{drivers/durable.ts, drivers/in-memory.ts, loader.ts, runner.ts}
```

`contracts/engine/**` — nine files, the heart of the transaction engine S03 froze — is entirely
exempt. Any of those files can acquire `document.createElement(...)` tomorrow and
`react-free-base` stays green.

**Why this matters more than a normal matcher nit.** `react-free-base` is described by the Slice
as the *mechanical form of §3.5* — the binding constraint of the whole Slice. The design
correctly diagnoses that a textual `document.` scan is wrong (planning-context finding 3b), and
the identifier-level replacement is the right idea; the implementation just applies the
exemption at the wrong granularity.

**Fix:** narrow the exemption to the enclosing scope, or — far cheaper and adequate here —
exempt only the *declaration line* and lines within a brace-balanced window from it, or invert
the test: flag only `document.<domMember>` where `<domMember>` is a DOM API name
(`createElement`, `querySelector`, `body`, `head`, `getElementById`, …), which no draft-document
value has.

**Confidence: high** (mechanism read + reproduced + blast radius measured).

---

## MAJOR-2 — `globalThis.document` is invisible to `react-free-base`

**Where:** `script/check-package-boundary.mjs:138-149`. `globalThis` was deliberately removed
from `DOM_GLOBAL_PATTERN` (justified in the comment by `draft/manager.ts`'s
`globalThis.crypto.getRandomValues`), and `DOCUMENT_PATTERN` is `/(?<!\.)\bdocument\b/` — a
member access `X.document` never matches.

The two decisions are individually defensible and jointly leave exactly one hole.

**Reproduced (P-B).** In a contracts file:

```ts
export function make() { const el = globalThis.document.createElement("canvas"); return el; }
```
→ `PASS react-free-base`, `EXIT=0`.

**Boundary of the hole — measured, not assumed (P-H).**
`globalThis.localStorage` and `globalThis.navigator` **do** fire, because those tokens carry no
`(?<!\.)` lookbehind:

```
FAIL react-free-base ... probe-storage.ts:2: references a DOM global
```

So the gap is specific to `document` — which is the single most likely DOM entry point, and the
one the rule's own documentation spends a paragraph on. `window.document` is caught (via
`window`), as the header claims; `globalThis.document` is not, and the header does not say so.

**Fix:** add `\bglobalThis\.document\b` (and `\bglobalThis\.window\b`) as explicit patterns while
keeping bare `globalThis` unflagged. Two tokens, no loss of the `crypto` exemption.

**Confidence: high** (reproduced, plus the negative boundary case reproduced).

---

## MAJOR-3 — tasks 4.1–4.4 say "record the output" and no such artifact is in the commit; the strongest claim in the commit message has no evidence behind it

**Where:** `rasen/changes/s05-package-boundary-freeze/tasks.md:89-97` vs the committed
`evidence/` directory, which contains **only** `npm-pack-dry-run.md`.

Four ticked tasks each demand a recorded artifact:

- 4.1 "Run … and **record its output**"
- 4.2 "Run `--negative-control` and `--converse-control` and **record both outputs**"
- 4.3 "…temporarily add a real inverted import … **Record both runs**"
- 4.4 "Re-run the existing static checkers … confirm all remain green"

None was recorded. The commit message asserts *"All 19 pre-existing static checkers remain
green"* and *"the live negative control was additionally confirmed non-self-referential with a
real, reverted inverted import"* — the second is exactly the claim the reviewer was asked to
verify, and it left no trace at all.

**What I verified independently (so these are now evidenced, by me, not by the change):**

- 4.1 / 4.2 — reproduced in the real repo; outputs quoted at the top of this report. ✔
- 4.3 — **reproduced in the sandbox (P-A).** A genuine inverted import
  (`apps/web/src/editor/contracts/probe-inverted.ts` importing `@/editor/surface/thing`) makes
  the live path fail with the offending path named:

  ```
  FAIL  acyclic-direction ...
    [acyclic-direction] .../probe-inverted.ts:1: @opencut/editor-contracts (layer 1) imports
    @opencut/editor-classic (layer 2) via "@/editor/surface/thing"
  EXIT=1
  ```

  **The negative control is genuinely non-self-referential** for `acyclic-direction`, and the
  live path fails on real source, not only on fixtures. The implementer's claim is true.

**What I could NOT verify — flagged as unproven, not as wrong:**

- 4.4. `script/` contains **26** `check-*.mjs` files (25 pre-existing). The "19" figure is
  inherited from `planning-context.md` and is never reconciled against the 26 present, and no
  list of which 19 were run exists. Several need a build (`check-distributable-boundary`,
  `check-asset-manifest`, `check-emitted-runtime-assets`, `check-headless-*`), which is why task
  4.4 says "that need no build" while the commit message says "All 19". **The commit message
  overstates what task 4.4 scoped.**

**Fix:** commit the four outputs to `evidence/` and either enumerate the checkers run or restate
the commit-message claim to match task 4.4's actual scope.

**Confidence: high** on the missing artifacts; **high** on 4.3 now being satisfied; the
"19 green" claim remains **unverified**.

---

## MINOR-1 — a *trailing* comment mentioning an Elftia specifier is a false positive

`:167-169` `isComment` only recognises a **line-leading** `//`, `*`, `/*`. `extractSpecifier`
then runs over the whole raw line.

**Reproduced (P-K):**

```ts
export const x = 1; // never import from "@elftia/shared" here
```
→ `FAIL no-elftia-import ... probe-trailing.ts:1: Elftia import specifier "@elftia/shared"`,
`EXIT=1`.

This is the precise failure mode `BOUNDARIES.md:464-474` and delta-spec scenario
`spec.md:143-148` ("Prose about Elftia is not a violation") claim to have designed out — and the
converse control only exercises a *leading* `//` comment (`:825-833`), so it cannot catch this.
The repo has 8 tracked files whose Elftia prose is load-bearing; the day one of those sentences
moves onto the end of a code line, the checker demands its deletion. Fires loudly rather than
silently, hence Minor. **Fix:** strip `//`-to-EOL before extracting the specifier.

**Confidence: high.**

## MINOR-2 — `SELF_PATH` excludes the checker from *all five* rules, not just the one it needs

`:628-635`. The exclusion is applied in `collectRepoFiles`, so the file leaves the scan set
entirely. Only `no-elftia-import` would ever have judged it (the other four scope to `apps/**`
or `packages/**`), so the practical hole is one rule on one file — but it is real.

**Reproduced (P-G3):** appending `const broker = globalThis.CapabilityBroker;` and
`const art = window.elftia;` to the checker itself yields
`PASS no-elftia-import (7 file(s) scanned)` — the file is not scanned. The same two lines in
`script/other2.mjs` are caught twice (P-G4, control). Note that an actual `import … from
"@elftia/shared"` in this file would crash Node before the scan (P-G), so the exposure is the
non-import forms: `window.elftia`, `CapabilityBroker`, `ArtifactRuntime`, `ArtifactRef`,
`plugin://`.

**Fix:** exclude the file from `no-elftia-import` only, or — better — remove the need entirely by
assembling the fixture specifier from parts (`"@elf" + "tia/shared"`) so the file has nothing to
hide from. **Confidence: high.**

## MINOR-3 — `no-internal-reexport` has no converse fixture (4 of 5 rules covered)

`CONVERSE_FIXTURES` (`:803-844`) has four entries; `no-internal-reexport` is absent. The delta
spec's requirement text says *"a converse control that demonstrates **each rule** staying silent"*
(`spec.md:150-154`), while its own scenario enumerates only the four. The requirement is
therefore not met as written, and the one rule with no false-positive proof is a dormant one.
**Confidence: high.**

## MINOR-4 — `design.md:251` states "138 real cross-package edges today"; the shipped checker reports 341

The design presents 138 as the evidence that `acyclic-direction` is meaningfully live. The
committed checker's census says `341 cross-package edge(s) examined`. The most likely
explanation is that 138 counted production-only edges while the checker counts tests too, but
the design says neither, and `BOUNDARIES.md`'s separate 8/0 figure is explicitly labelled
"production" — so the unqualified 138 reads as the same kind of measurement and is not.
**Confidence: high** on the discrepancy; **medium** on the explanation.

## MINOR-5 — layer 0/1 source may import any bare npm package, including React-dependent ones

`reactFreeBaseRule:439` matches only the literal specifiers `react`, `react-dom` and their
subpaths; `checkManifestReactFree:406` guards only the two packages' own hand-written manifests.
A bare specifier in layer-0/1 *source* is judged by nothing.

**Reproduced:** `editor/ports/probe-npm.ts` importing `zod` (P-M) and
`editor/contracts/probe-fm.ts` importing `framer-motion` (P-N) — both `EXIT=0`, all rules PASS.

**Live impact today: none.** I measured every bare specifier imported by layer-0/1 source: only
`node:child_process`, `node:crypto`, `node:fs`, `node:path`, `node:url` and `bun:test`. So the
proposal's "no npm runtime dependency" claim is *true today* but *unenforced*. Given §3.5 is the
Slice's binding constraint and a `framer-motion`-class import would pull React transitively
without tripping any rule, this is worth an allowlist (`node:*`, `bun:*`, the two workspace
package names) before P1. **Confidence: high.**

## MINOR-6 — `guardUnownedFiles` is unreachable, so the "unowned file fails the check" scenario is satisfied only vacuously

`:669-678` refuses to scan when a file under `apps/web/src` resolves to no owner. But
`boundary.json:136-140` ends with a catch-all `apps/web/src → @opencut/editor-classic`, so
`resolveOwner` can never return `null` for that prefix. The guard is a fail-safe against a future
edit that deletes the catch-all — legitimate — but delta-spec scenario `spec.md:48-52` ("an
unowned file causes the check to fail rather than to be skipped") is currently proven by nothing
and provable by nothing. It also inspects only `.ts`/`.tsx`, while `resolveOwner`'s file-entry
matcher (`:213`) supports `.css` — a `.css` file-level override could be silently unowned.
**Confidence: high.**

## MINOR-7 — dormancy is disclosed, but not in the document each child's planner is told to read first

Dormancy disclosure is **honest and good** where it exists: the run prints `....` and
`0 files scanned` instead of `PASS` (`:701-703`), `BOUNDARIES.md:448-454` marks both rules
"dormant" in the rule table, and `design.md` D6 plus the Risks list state it plainly. That
answers the "will it silently never fire?" concern — it will not fire silently, and the negative
control already proves both dormant rules *can* fire (`:781-800`).

What is missing is the forward pointer: `rasen/changes/s05-community-beta-second-host/planning-context.md`
is the document the portfolio tells every child's planner to **read FIRST**, and the eight
durable findings P0's planner appended to it (lines 220-279) never mention the two dormant rules
or that P1 is the commit that wakes them. P1's author sees the deferral only if they read a
sibling change's `design.md` or notice the `BOUNDARIES.md` table.
**Fix:** append one line to `planning-context.md`'s durable findings.
**Confidence: high.**

## MINOR-8 — task counts: the artifact says 29/6/27, and neither reported figure matches

Measured on the committed `tasks.md`: **29 checkboxes across 6 groups, 27 ticked, 2 unticked**
(`6.1`, `6.2` — the ship group). The planner reported 25 checkboxes; the implementer reported
20/20. Both are wrong against the shipped artifact.

- I can see only one commit, so I cannot tell whether boxes were removed or merged before the
  commit — **that part is unproven**. What is certain is that nothing in the committed artifact
  produces either 25 or 20.
- The two unticked boxes are the *ship* tasks, which cannot be ticked inside the commit they
  describe. That is a chicken-and-egg artefact, not neglect — but it means the archived record
  permanently reads 27/29 with the ship steps open, and a mechanical "all tasks complete" gate
  would read it as incomplete.
- **The "already done pre-session" claim for 1.1–1.4 and 2.1–2.5 checks out.** I verified each
  against committed artifacts, not against the tick: `shellPaths` has the six roots
  (`boundary.json:12-19`); the two file-level splits and the four test reassignments are all
  present (`:36-85`); the three manifests carry `0.1.0`, `private: true`, the exact `files`
  shape, and the 6 / 10 / 15 declared `exports` entries the tasks name; React is absent from
  `editor-classic`'s manifest and the peer-vs-direct question is recorded as an Open Question;
  `packages/README.md` covers all four required topics; and `evidence/npm-pack-dry-run.md`
  records all three packs with `total files: 1`. **None of these is merely pre-ticked.**

**Confidence: high.**

## MINOR-9 — `bun.lock` was not regenerated after three workspace members were added

`package.json` declares `workspaces: ["apps/*", "packages/*"]` and this commit creates three
`packages/*` members. `bun.lock` still lists only `apps/vite-example` and `apps/web`, and
contains zero occurrences of `editor-ports` / `editor-contracts` / `editor-classic`.

CI runs plain `bun install` (`.github/workflows/bun-ci.yml:77`), **not** `--frozen-lockfile`, so
**this does not break CI** — I checked specifically for that. The consequences are that the next
local install produces an unrelated lockfile diff P1 inherits, and that `no-elftia-import`'s
`bun.lock` arm (`:380-389`) currently reads a lockfile that does not describe the declared
workspace. **Confidence: high** on the facts; I did not run `bun install` (it would mutate the
tree), so "the install succeeds cleanly" is **unproven**.

## TRIVIAL-1 — `apps/desktop` does appear in `boundary.json`, in prose

Task 1.4 says "Confirm `apps/desktop` appears **nowhere** in the declaration" and delta-spec
scenario `spec.md:182-187` says "no ownership entry **references** `apps/desktop`". It occurs
once, in the catch-all entry's `why` (`boundary.json:139`), as an explicit statement that it is
*not* assigned. The intent — no package claims the GPUI experiment — holds completely. Flagged
only because a future mechanical check of that scenario, read literally, would fail on its own
documentation.

## TRIVIAL-2 — a `*`-leading continuation line hides an import specifier

`isComment` (`:167-169`) treats any line starting with `*` as a comment, so

```ts
import
	* as elftia from "@elftia/shared";
```

is not caught (reproduced, P-L). No formatter in this repo emits that shape; recorded for
completeness alongside MINOR-1, since the same one-line fix (strip comments properly rather than
skip whole lines) addresses both.

---

# Direct answers to the six questions asked

1. **Dormancy.** Honestly disclosed — `....` + `0 files scanned` in the output, "dormant" in the
   `BOUNDARIES.md` table, D6 and Risks in the design; and both dormant rules are already proven
   able to fire by the negative control, so "a rule that will silently never fire" is **not** the
   risk here. It is structurally unavoidable at P0 (no source under `packages/`), and a fixture
   *does* exercise them today. **But the real problem is one layer down and worse than dormancy:
   `public-entry-only`'s scan set excludes consumers, so after it wakes it will still not enforce
   §3.1's consumer-deep-import clause** — see BLOCKER-1. The deferral to P1 is recorded in
   `BOUNDARIES.md` and `design.md` but **not** in the portfolio `planning-context.md` P1's planner
   is told to read first (MINOR-7).
2. **Task-count discrepancy.** Actual artifact: 29 boxes / 6 groups / 27 ticked. Neither 25 nor
   20 matches. The 2 unticked are the ship tasks, unbickable by construction. Whether boxes were
   removed before the single commit is unprovable from the history available (MINOR-8).
3. **"Already done pre-session".** Genuinely satisfied. Every one of 1.1–1.4 and 2.1–2.5 was
   verified against the committed artifact rather than the tick; all check out, including the two
   file-level `feedback/` splits, the four test reassignments, the exact `exports` entry sets, and
   the `npm pack --dry-run` evidence (MINOR-8, last bullet).
4. **Matcher correctness.** Three real false negatives found and reproduced — the file-wide
   `document` exemption (MAJOR-1, already active over 15 of 69 layer-0/1 files),
   `globalThis.document` (MAJOR-2), and a bare npm import in layer 0/1 (MINOR-5). One real false
   positive — a trailing comment (MINOR-1). `window['document']` is **caught** (via `window`), and
   `globalThis.localStorage` / `globalThis.navigator` are **caught** (no lookbehind on those
   tokens) — so the DOM hole is narrower than "globalThis was dropped" suggests, but it lands on
   `document`, the likeliest access. `SELF_PATH` **can** mask a real violation: reproduced with
   `window.elftia` + `CapabilityBroker` inside the checker itself (MINOR-2); an actual `import`
   would crash Node first, so the exposure is the identifier and protocol forms.
5. **Negative-control integrity.** Verified genuine. A real inverted import in a sandbox replica
   of the repo makes the live path fail and names the offending file and specifier (P-A); the
   same tree passes with the probe removed. The four converse fixtures stay silent, reproduced.
   The control is **not** self-referential. Two gaps: `no-internal-reexport` has no converse
   fixture (MINOR-3), and none of these runs was recorded as evidence (MAJOR-3).
6. **Scope discipline.** Clean. No source moved, no consumer written, no frozen S03+S04 signature
   touched — the diff contains no `apps/**` file at all. `no-desktop-app` survives unmodified.
   No Slice-level `failed` condition is approached.

---

# What I did not verify

- **"All 19 pre-existing static checkers remain green."** Not reproduced. 26 `check-*.mjs` exist,
  several require a build, and no list of the 19 was recorded (MAJOR-3).
- **`bun install` succeeds with the three new workspace members.** Not run — it mutates
  `bun.lock` and `node_modules` (MINOR-9).
- **Whether `tasks.md` had boxes removed before the commit.** Only one commit exists on this
  branch; no pre-commit draft is observable.
- **`npm pack --dry-run` outputs.** Read as recorded; not re-executed.

---

# Reproduction appendix

Every probe ran against a sandbox replica built from the real
`script/check-package-boundary.mjs`, the real `packages/boundary.json` and the real manifests,
in a scratch git repo outside rocut. rocut's working tree was not modified at any point.

| id | probe | expected | observed |
| --- | --- | --- | --- |
| P-A | real inverted import contracts→classic | FAIL | **FAIL**, path + specifier named ✔ |
| P-B | `globalThis.document.createElement` in contracts | FAIL | **PASS** ✗ (MAJOR-2) |
| P-C | param named `document` + real `document.createElement` | FAIL | **PASS** ✗ (MAJOR-1) |
| P-C2 | same file, parameter removed (control) | FAIL | **FAIL** ✔ |
| P-D | fourth package under `packages/` | FAIL | **PASS** ✗ (BLOCKER-2) |
| P-E | consumer deep-imports undeclared subpath | FAIL | **PASS** ✗ (BLOCKER-1) |
| P-E2 | same import from inside `packages/` (control) | FAIL | **FAIL** ✔ |
| P-G | real `@elftia/*` import in the checker itself | — | Node crashes before scan |
| P-G3 | `window.elftia` + `CapabilityBroker` in the checker | FAIL | **PASS** ✗ (MINOR-2) |
| P-G4 | same identifiers in another script (control) | FAIL | **FAIL** ×2 ✔ |
| P-H | `globalThis.localStorage` + `globalThis.navigator` | FAIL | **FAIL** ✔ |
| P-J | two imports on one line, Elftia second | FAIL | **PASS** ✗ (see note) |
| P-K | trailing comment mentioning `@elftia/shared` | silent | **FAIL** ✗ (MINOR-1) |
| P-L | `*`-leading continuation line | FAIL | **PASS** ✗ (TRIVIAL-2) |
| P-M | layer 0 imports `zod` | FAIL | **PASS** ✗ (MINOR-5) |
| P-N | layer 1 imports `framer-motion` | FAIL | **PASS** ✗ (MINOR-5) |

*Note on P-J:* `extractSpecifier` (`:171-177`) returns the first match per line and
`noElftiaImportRule` (`:340-368`) `return`s after the first hit, so a second specifier on the
same line is never examined. I measured the real-world exposure: of 50 tracked JS-family files,
exactly **one** contains a line with two specifiers — `check-package-boundary.mjs` itself, in its
fixture strings. Nothing in this repo is minified or bundled into tracked source. Folded into
MINOR-1's fix rather than raised separately.

---
---

# ROUND-1 RE-REVIEW — delta `bea59790`

Appended 2026-08-13 by the same independent non-author reviewer. **Everything above this line is
the round-1 report against `5e3fc7cb` and is left unaltered — the history is the evidence.**

Scope of this pass: **commit `bea59790` only** (the fix delta), judged against the round-1 findings
above. The base commit is not re-reviewed and nothing confirmed clean in round 1 is reopened.
Hygiene was independently confirmed by the LEAD and is not re-checked here.

**Delta verdict: `findings` — 0 new Blockers, 2 new Majors, 3 new Minors.**
All five routed findings (BLOCKER-1, BLOCKER-2, MAJOR-1, MAJOR-2, MAJOR-3) plus the bundled
MINOR-3 are **confirmed resolved**. Two of the fixes carry a residual gap of the same shape as the
finding they closed; those are raised fresh as `D-1` and `D-2` rather than as reopened findings,
because the reported defects genuinely are gone.

## Method (round 2)

Same discipline as round 1. Live runs against the real repo; every adversarial probe against a
**sandbox replica** built from the delta's `check-package-boundary.mjs`, the real
`packages/boundary.json` and the real manifests, in its own git repo outside rocut. rocut's
working tree was not modified by this review. Round-2 probe ids are `D-*`.

Independently reproduced at `bea59790`:

```
PASS  acyclic-direction   (949 files, 341 cross-package edges)
PASS  public-entry-only   (949 files)          <- was "0 files scanned" dormant
....  no-internal-reexport (0 files scanned)   <- still honestly dormant
PASS  no-elftia-import    (1031 files)
PASS  react-free-base     (68 files)
exit 0
```

`--negative-control`: **8/8 caught**, exit 0. `--converse-control`: **8/8 silent**, exit 0.
All three claimed counts verified, not accepted.

---

## Per-finding dispositions

### BLOCKER-1 — **RESOLVED (confirmed)**

`packageAndConsumerSourceFiles` (`script/check-package-boundary.mjs:549-556`) now scans
`packages/*/src/**` + `apps/web/src/**` + `apps/vite-example/**`, and `selfName` is set only for
files physically inside `packages/` (`:580-583`), so a consumer-side file has no self-exemption at
all. `public-entry-only` moved to `LIVE_RULE_IDS` (`:120`), which also puts it under the
empty-scan fail-closed guard. The new negative fixture uses my own P-E shape
(`apps/web/src/editor/surface/violation5.ts`) and is caught; the paired converse fixture at the
same kind of path stays silent. Both reproduced.

**Judging the stated reasoning specifically, as asked.** The conclusion is right; the justification
defeats a weaker alternative than the strongest one.

- **True:** gating on *"scan only files whose `ownerOfPath` is a declared consumer entity"* would
  have missed my reproduction. `apps/web/src/editor/surface/consumer.ts` is assigned to
  `@opencut/editor-classic` by `boundary.json`'s catch-all, not to `apps/web`. That variant is
  correctly rejected.
- **But that is not the strongest ownership-aware alternative.** "Scan every file, and use
  `ownerOfPath` only to decide what counts as *self*" would have caught my case too — owner
  `editor-classic` is not the target `editor-ports`, so it is judged. The fix is therefore not the
  only correct design; it is a *stricter* one.
- **Is path-based right?** For the **scope**, yes, unambiguously — scanning by path is simpler, has
  no dependence on the ownership map being correct, and cannot be silently narrowed by a
  `boundary.json` edit. For the **self** determination, path-based is strictly stricter than
  ownership-based, and that strictness is where any false-positive surface lives.

**False-positive surface, measured (D-B1a/b/c).** Exactly one shape exists: a pre-move file that
`boundary.json` already assigns to `@opencut/editor-classic` importing
`@opencut/editor-classic/<undeclared subpath>` **is flagged**, though post-P1 the same import would
be an exempt self-import. Reproduced. I judge this **benign, arguably beneficial** — a file that
will *become* editor-classic has no reason to reach itself through its own package name and an
undeclared subpath; a relative import is the correct form, and flagging it steers P1 right. The two
adjacent legal cases stay silent, both reproduced: the same file importing a **declared** entry
(`@opencut/editor-classic/surface`), and an import of a non-editor workspace package
(`@opencut/tools/x`, ignored by `PACKAGE_SPECIFIER_PATTERN`). **No live false positive exists
today** — nothing in the tree imports a bare `@opencut/editor-*` specifier at all
(grep over `apps/**` is empty).

### BLOCKER-2 — **RESOLVED (confirmed), and now proven rather than inspected**

`discoverPackageDirs()` (`:681-694`) enumerates `packages/*` from disk; `loadManifests(boundary)`
(`:700-717`) exits `2` on any discovered manifest whose `name` is absent from
`boundary.json.layers`.

**Reproduced (D-B2a).** Adding `packages/editor-extra/package.json`:

```
check-package-boundary: packages/ contains a manifest not declared in boundary.json's layer order,
refusing to scan:
  packages/editor-extra/package.json declares "@opencut/editor-extra", which
  boundary.json.layers does not include
EXIT=2
```

The spec scenario `spec.md:35-39` is now implemented **and** demonstrated.

**On "no fixture needed" — I accept it, with one caveat.** The guard is a load-time configuration
check that runs *outside* the pure `scan()` both controls exercise; there is no honest way to make
it a `scan()` fixture, and `guardSelfConsistency` — the idiom it is modelled on — has no fixture
either, so the codebase is internally consistent. What I do not accept is the epistemic status it
shipped with: "verified by inspection" is precisely the class of claim MAJOR-3 existed to reject.
That status is now upgraded — this review reproduced it — but the proof lives only in this report.
Recorded as `D-5` (Minor): one line in an evidence file, or a `--config-control` mode alongside the
two existing controls, would make it survive independently of me.

### MAJOR-1 — **RESOLVED (confirmed)** — see `D-2` for a residual gap of a different shape

`hasLocalDocumentBinding` and `DOCUMENT_DECLARATION_PATTERN` are **fully removed** — I grepped the
delta file for every identifier and found no dangling reference and no dead code. There is no
whole-file exemption left in the checker, so the mechanism I reported (one unrelated parameter
blinding an entire file, 15 of 69 layer-0/1 files already in that state) cannot recur.

**The implementer's no-collision claim is verified, and by something stronger than its own grep.**
`react-free-base` passes over **68 real layer-0/1 files** with the new member pattern active. That
is a live proof that no domain `document` value in the tree exposes a listed DOM member name — a
superset of the 15 files the implementer checked. Confirmed. Both on-list controls fire
(`document.createElement`, `document.body`), reproduced.

### MAJOR-2 — **RESOLVED (confirmed); the typeof strip cannot be abused**

`GLOBALTHIS_DOM_PATTERN` (`:190`) closes the hole. I probed the typeof-strip specifically for the
abuse asked about — a line carrying both a guard and a live access — and **could not construct one
that hides a real access**:

| probe | line | result |
| --- | --- | --- |
| D-M2a | guard + live access, one line, `globalThis` form | **FIRED** |
| D-M2b | guard + live access, one line, `window` form | **FIRED** |
| D-M2c | `typeof window` guard then bare `document.createElement` on the same line | **FIRED** |
| D-M2d | `typeof window.document.createElement === "function"` | **FIRED** |
| D-M2e | `const d = globalThis.document;` (alias entry point, no member) | **FIRED** |
| D-M2f | `typeof globalThis.document === "undefined"` (the real idiom) | silent |
| D-M2g | `globalThis.crypto.getRandomValues(...)` (must stay legal) | silent |

`stripTypeofGuards` removes only the literal `typeof globalThis.document` / `typeof window` token
pair, so any second occurrence — which is what a real access needs — survives the strip and is
matched. D-M2e is a genuine improvement over the round-1 checker: the aliasing entry point
`const d = globalThis.document` now fires on the assignment line.

One asymmetry, recorded as `D-4` (Minor): `typeof window.localStorage` — the same class of
environment guard — **fires**, because stripping `typeof window` leaves `.localStorage`, which
`DOM_GLOBAL_PATTERN` still matches at the word boundary. Reproduced. A future env guard for
`localStorage` or `navigator` in ports or contracts will be a false positive while the `document`
form is exempt.

### MAJOR-3 — **RESOLVED (confirmed)**

All four evidence files exist and are substantive, not placeholders.

**22/25 spot-check: accurate.** I re-ran all 25 pre-existing `check-*.mjs` myself, bare invocation,
capturing exit codes. **Exactly 22 exit 0.** The 3 failures are exactly the three named, for
exactly the reasons given:

| checker | exit | first line |
| --- | ---: | --- |
| `check-asset-manifest.mjs` | 2 | `no preview server at http://127.0.0.1:4173/ — fetch failed` |
| `check-headless-graph.mjs` | 2 | `usage: … <envelope> --host <host> --producer <producer>` |
| `check-headless-semantic-result.mjs` | 2 | `usage: … --vite <report JSON> --next <report JSON>` |

The correction from "19 green" to an enumerated 22/25 is right, and so is the sharper reason: these
3 need a **live server or capture artifacts**, not merely a build. `check-distributable-boundary.mjs`
in particular runs clean (exit 0) because it reads the committed `dist/module-graph.json` — which is
why "build-dependent" was the wrong category for the exclusion.

**The live inverted-import proof is genuine.** A real edge in a real tracked file
(`apps/web/src/editor/contracts/index.ts:84` reaching `../surface/editor-root`), caught by *two*
rules at once, cross-package edge count moving 341 to 342 (proving the walk is real, not cached),
reverted with `git checkout --` and re-run clean. This is stronger evidence than my round-1 sandbox
P-A, and it correctly notes that P-A was my sandbox rather than the change's own record. The
appended process note about `/tmp` `cp` reintroducing CRLF is a real hazard on this machine and
worth keeping.

### Bundled MINOR-3 — **RESOLVED (confirmed)**

`no-internal-reexport` has a converse fixture re-exporting a **declared** subpath
(`@opencut/editor-ports/host`) from a declared entry file, correctly distinguished from the
existing negative fixture's `/internal/secret`. 5 of 5 rules now carry one. Counts verified: 8
negative, 8 converse, all clean.

---

## New findings from the delta

### D-1 (Major) — `PACKAGE_SPECIFIER_PATTERN` still hardcodes the triple, so `public-entry-only` is blind to exactly the fourth package BLOCKER-2's fix legalises

**Where:** `script/check-package-boundary.mjs:529`

```js
const PACKAGE_SPECIFIER_PATTERN = /^(@opencut\/(?:editor-ports|editor-contracts|editor-classic))(\/.*)?$/;
```

BLOCKER-2 removed the hardcoded `PACKAGE_DIRS` triple and replaced it with disk enumeration. The
*other* hardcoded triple — the one that gates which specifiers `public-entry-only` and
`no-internal-reexport` will even look at — was left behind. `manifestEntrySets` is now built from
discovered manifests, so a fourth package's entries **are** in the lookup table; the regex rejects
its specifiers before that table is ever consulted.

**Reproduced (D-B2b).** Fourth package declared in `boundary.json.layers` (so BLOCKER-2's new guard
is satisfied — this is now the *legal* way to add one), plus a consumer file importing
`@opencut/editor-extra/internal/secret`:

```
PASS  public-entry-only: … (5 file(s) scanned)
EXIT=0
```

The deep import into the new package's internals is invisible. `acyclic-direction` cannot see it
either (a bare specifier resolves to `null`), so nothing covers it.

**Failure scenario.** P5 (versioning) or P2 (second Host) adds a fourth package the correct way —
directory, manifest, entry in `boundary.json.layers`. BLOCKER-2's guard passes. From that moment
`public-entry-only`, the rule BLOCKER-1 just made live, silently exempts every deep import into the
new package, while still printing `PASS`.

**Fix (small):** derive the pattern from `boundary.layers` at load time instead of hardcoding it —
the same move BLOCKER-2 already made for `PACKAGE_DIRS`. **Confidence: high** (reproduced).

### D-2 (Major) — the fixed DOM member list misses 17 probed real DOM accesses, including `document.addEventListener`

**Where:** `script/check-package-boundary.mjs:181-182` (`DOM_DOCUMENT_MEMBER_PATTERN`).

MAJOR-1's fix trades a *file-wide exemption* hole for an *enumeration* hole. The enumeration is
short and misses the most common DOM idiom in editor code. Every row below was run against a
layer-1 file in the sandbox; **all 17 returned exit 0 (silent)**, while the two on-list controls
fired:

| probed access | result |
| --- | --- |
| `document.addEventListener(...)` / `removeEventListener` | **MISSED** |
| `document.cookie` | **MISSED** |
| `document.readyState` | **MISSED** |
| `document.fonts.load(...)` — this repo has a whole `fonts` module | **MISSED** |
| `document.exitFullscreen()` / `document.fullscreenElement` | **MISSED** |
| `document.getSelection()` | **MISSED** |
| `document.hidden` / `document.visibilityState` | **MISSED** |
| `document.styleSheets` | **MISSED** |
| `document.createComment(...)` | **MISSED** |
| `document.write(...)` | **MISSED** |
| `document.location.href` | **MISSED** |
| `document.defaultView` | **MISSED** |
| `document.elementsFromPoint(...)` (plural; only the singular is listed) | **MISSED** |
| `document.pointerLockElement` | **MISSED** |
| `document["createElement"]("div")` (computed member) | **MISSED** |
| `document.createElement("div")` (control) | caught |
| `document.body` (control) | caught |

None of these is ambiguous against a domain document: a draft document or `VectorSeedDocument` has
no `.cookie`, `.readyState`, `.fonts` or `.addEventListener`. The list can be widened substantially
with no new false-positive risk.

Note the computed-member row is a small **regression** in one dimension: pre-fix, a non-exempt file
doing `document["createElement"]` matched the bare-identifier pattern; post-fix nothing matches it.
That is a fair trade against the 22%-of-files exemption hole it replaced, but it should be recorded
rather than discovered later.

**Fix:** add the missing members to the alternation (`addEventListener`, `removeEventListener`,
`dispatchEvent`, `cookie`, `readyState`, `visibilityState`, `hidden`, `fonts`, `styleSheets`,
`adoptedStyleSheets`, `getSelection`, `write`, `writeln`, `location`, `defaultView`,
`currentScript`, `forms`, `images`, `links`, `scripts`, `elementsFromPoint`, `exitFullscreen`,
`fullscreenElement`, `exitPointerLock`, `pointerLockElement`, `createComment`, `createAttribute`,
`createTreeWalker`, `createNodeIterator`, `importNode`, `adoptNode`, `evaluate`), and optionally
match `document\s*\[` to cover computed access. **Confidence: high** (all 17 reproduced).

### D-3 (Minor) — `public-entry-only`'s census counts files, not candidate specifiers, so "949 files scanned, PASS" overstates what was checked

`acyclic-direction` reports `341 cross-package edge(s) examined` alongside its file count, which is
what makes its `PASS` meaningful. `public-entry-only` reports only `949 file(s) scanned`, and there
are currently **zero** `@opencut/editor-*` specifiers anywhere in `apps/**` (verified by grep). So
the rule is live and looking, exactly as claimed — but a reader of the output cannot distinguish
"examined 341 candidates, all legal" from "examined 0 candidates". That distinction is the change's
own stated standard ("a check that is green because it inspected nothing is not the same claim as a
check that is green because it looked"), applied one level down. **Fix:** report
`N @opencut/* specifier(s) examined` the way `acyclic-direction` reports edges — today that number
is 0, which is both honest and informative. **Confidence: high.**

### D-4 (Minor) — `typeof window.localStorage` fires while `typeof window.document` is exempt

Detailed under MAJOR-2 above. Same class of environment-detection guard, opposite outcome, because
the strip removes `typeof window` and leaves `.localStorage` matching at the word boundary.
Reproduced. Low impact today (no such guard exists in layer 0/1), and the safe direction to err in,
but it will read as arbitrary to whoever hits it. **Confidence: high.**

### D-5 (Minor) — BLOCKER-2's guard shipped proven only by inspection

Detailed under BLOCKER-2 above. Accepted as a design choice (a load-time guard cannot be a `scan()`
fixture, and `guardSelfConsistency` sets the same precedent), but the demonstration currently
exists only in this report. One line in an evidence file, or a `--config-control` mode, would make
it durable. **Confidence: high.**

---

## Round-1 findings NOT addressed by this delta (still open, unchanged)

The delta closed the 2 Blockers, 3 Majors and MINOR-3. These round-1 items were not in its scope
and remain exactly as reported above — listed so the record is complete, not re-argued:

MINOR-1 (trailing-comment false positive), MINOR-2 (`SELF_PATH` excludes the checker from all
rules), MINOR-4 (`design.md:251`'s "138 edges" vs the shipped 341), MINOR-5 (layer-0/1 may import
any bare npm package), MINOR-6 (`guardUnownedFiles` unreachable under the catch-all), MINOR-7
(dormancy carry-forward absent from `planning-context.md`), MINOR-8 (task counts), MINOR-9
(`bun.lock` not regenerated), TRIVIAL-1, TRIVIAL-2.

Two of them are now cheaper or more relevant than they were: **MINOR-4** should be corrected in the
same pass as any doc edit, since `BOUNDARIES.md` was already touched here; and **MINOR-7** is now
more load-bearing, because `public-entry-only` going live changes what P1 inherits while
`planning-context.md` still describes it as dormant.
