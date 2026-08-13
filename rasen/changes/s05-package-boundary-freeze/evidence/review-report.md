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
