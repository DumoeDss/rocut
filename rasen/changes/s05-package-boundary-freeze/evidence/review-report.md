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

---
---

# ROUND-2 RE-REVIEW — delta `95779c07`

Appended 2026-08-13 by the same independent non-author reviewer. **Everything above this line —
the round-1 report against `5e3fc7cb` and the round-2 re-review of `bea59790` — is left
unaltered.**

Scope: **commit `95779c07` only**. Hygiene was independently confirmed by the LEAD (all 9 touched
files `i/lf w/lf`, 0 CR bytes across the P0 tree, 0 `.rasen/` paths) and is not re-checked.

**Delta verdict: `findings` — 1 new Blocker, 0 new Majors, 3 new Minors, 2 new Trivials.**

All six routed findings (D-1, D-2, D-3, D-4, D-5, MINOR-4) plus the audit-bonus fix are
**confirmed resolved**, every one reproduced rather than read. The Blocker is not in the code: it
is in `evidence/load-time-guard-proof.md`, which records two command transcripts the shipped code
cannot produce.

## Method (round 3)

Live runs against the real repo, plus 40 probes against a sandbox replica built from the delta's
checker, the real `boundary.json` and the real manifests, in its own git repo outside rocut. rocut's
working tree was not modified. Round-3 probe ids continue the `D-*` series.

Independently reproduced at `95779c07`:

```
PASS  acyclic-direction   (949 files, 341 cross-package edges)
PASS  public-entry-only   (949 files, 0 @opencut/* specifier(s) examined)
....  no-internal-reexport (0 files scanned)
PASS  no-elftia-import    (1031 files)
PASS  react-free-base     (68 files)
exit 0
```

`--negative-control`: **12/12 caught**, exit 0. `--converse-control`: **11/11 silent**, exit 0.
Fixture-array counts independently parsed from source: 12 negative, 11 converse. All claimed totals
verified, none accepted.

---

## Per-finding dispositions

### D-1 — **RESOLVED (confirmed)**

`packageSpecifierPattern(manifests)` (`script/check-package-boundary.mjs:640-643`) builds the
alternation from the discovered, boundary-validated manifest list, with regex-metacharacter escaping
that npm names do not currently need but a future name might. Both consumers (`publicEntryOnlyRule`,
`noInternalReexportRule`) call it.

**Reproduced live — my own D-B2b reproduction, re-run against the new checker.** A fourth package
declared in `boundary.json.layers` with a real manifest on disk, plus a consumer deep-importing its
internals:

```
FAIL  public-entry-only: … (5 file(s) scanned, 1 @opencut/* specifier(s) examined)
  [public-entry-only] apps/web/src/editor/surface/deep-extra.ts:1: imports undeclared subpath
  "@opencut/editor-extra/internal/secret" of @opencut/editor-extra
EXIT=1
```

The same file importing the fourth package's **declared** entry stays silent while still reporting
`1 @opencut/* specifier(s) examined` — which incidentally demonstrates D-3's counter doing exactly
the job it was added for. The `FOURTH_PACKAGE_BOUNDARY` / `FOURTH_PACKAGE_MANIFESTS` fixture pair is
a clean design: a dedicated boundary/manifest pair rather than a mutation of the shared fixtures, so
the other ten fixtures keep asserting against the unmodified three-package shape.

### D-2 — **RESOLVED (confirmed)** — see `D-7` for the residual, which is the approach, not this list

Counted mechanically from source rather than trusted: the alternation went from **18 members at
`bea59790` to 50 at `95779c07`, exactly 32 added**. Cross-checked against my round-2 report:

- **17 / 17** of the members I individually reproduced as missed are present.
- **15 / 15** of the additional members my Fix section prescribed are present.

The reasoning for adding the un-reproduced 15 rather than deferring them — that deferring would
repeat the incomplete-fix pattern round 1 was caught making — is right, and is the correct
generalisation to draw from a review finding.

**Computed access is genuinely recorded, not silently dropped.** The pattern's doc comment carries a
titled paragraph, *"Known, accepted regression, recorded rather than silently absorbed"*, stating
that `document["createElement"]` no longer matches, that the pre-MAJOR-1 bare-identifier pattern did
catch it, that this is a deliberate trade against the whole-file exemption hole, and that
`document\s*\[` is a straightforward follow-up. That is exactly the disclosure I asked for.
Independently confirmed still missed by probe.

### D-3 — **RESOLVED (confirmed)**

`public-entry-only` now prints `N @opencut/* specifier(s) examined`. Live output reads
`949 file(s) scanned, 0 @opencut/* specifier(s) examined` — honestly 0, exactly as predicted, and
the sandbox run above shows it moving to 1 when a candidate exists. The counter increments before
the self-exemption and before the pass/fail branch (`:713-718`), so it counts what was *looked at*,
not what was judged — the right semantics for this purpose.

### D-4 — **RESOLVED (confirmed); I re-ran all seven probes rather than accepting the hand-trace**

`TYPEOF_GUARD_PATTERN` is now `/\btypeof\s+(?:globalThis|window)\b(?:\s*\.\s*\w+\b(?!\s*\.))?/g`.
The negative lookahead is the load-bearing part: it strips one member and stops, so a chained access
survives.

| probe | must | observed |
| --- | --- | --- |
| D-M2a guard + live access, one line, `globalThis` | FIRE | **FIRED** |
| D-M2b guard + live access, one line, `window` | FIRE | **FIRED** |
| D-M2c `typeof window` guard then bare `document.createElement` | FIRE | **FIRED** |
| D-M2d `typeof window.document.createElement` | FIRE | **FIRED** |
| D-M2e `const d = globalThis.document` | FIRE | **FIRED** |
| D-M2f `typeof globalThis.document === "undefined"` | silent | **silent** |
| D-M2g `globalThis.crypto.getRandomValues(...)` | silent | **silent** |

**7/7, no regressions.** Five further cases probed for the generalisation itself:
`typeof window.localStorage`, `typeof window.navigator` and `typeof globalThis.localStorage` are now
silent (the D-4 target), while `typeof window.localStorage !== "undefined" ? window.localStorage.getItem(...)`
and `typeof globalThis.document === "undefined" ? … : document.querySelector(...)` both still fire.
The guard exempts detection and nothing else.

### D-5 — **RESOLVED in substance (confirmed), but the artifact carries a Blocker — see `D-8`**

The core claim is true and I have now reproduced it in two independent rounds: a real, untracked
`packages/editor-undeclared-probe/package.json` on disk produces the exact recorded message and
`exit 2` before any rule runs. `evidence/load-time-guard-proof.md`'s "Why this can't be a `scan()`
fixture" section is correct and well-argued, and the live-run before/injection/after/revert sequence
is genuine. **The finding D-5 raised is closed.** What the file additionally asserts about the two
control modes is not true — filed as `D-8` below rather than as a reopening of D-5, because the
proof D-5 asked for does exist.

### MINOR-4 (round 1) — **RESOLVED (confirmed); both calls correct**

- **138 → 341**: correct, and the added parenthetical is the right kind of correction — it says the
  number is a live measurement restated for orientation and that the checker, not the document, is
  the source of truth. That prevents the same drift recurring.
- **The second stale claim, corrected on the implementer's own initiative**: `design.md` D6 still
  listed `public-entry-only` under "live from the first module P1 places under `packages/`". False
  since `bea59790`. Moving it into the live list with a dated note is right, and catching it
  unprompted is the correct instinct — a doc edit that fixes one stale sentence and leaves its
  neighbour is how documents rot.
- **Leaving `no-internal-reexport`'s dormancy claim alone**: correct. Its scope is still
  `packages/*/src/**` only, `packages/` still holds no source, and the live run still prints
  `0 files scanned` for it. The added sentence explaining *why* that one is genuinely different — a
  re-export needs a declared entry file to re-export from, and none exists until P1 places one — is
  a real improvement over simply leaving it.

### Audit bonus (`checkManifestReactFree`) — **CONFIRMED complete for the name and path literals; the renamed-dir fixture does prove what it claims**

`baseLayerManifestPaths(boundary, manifests)` (`:558-563`) derives the gate from
`boundary.layers[0]`/`[1]` matched against each manifest's declared `name`, building the path from
the discovered `dir`. `checkManifestReactFree` takes `boundary` and reads the forbidden layer-2 name
from `boundary.layers[2]`.

**Does the renamed-dir fixture prove directory-name independence?** Yes — and I verified it a second
way, end-to-end against the real filesystem rather than in-memory, which is a stronger test than the
fixture itself:

- Renamed `packages/editor-ports` → `packages/host-ports` **on disk** (manifest `name` unchanged),
  added a forbidden `@opencut/editor-classic` dependency:
  `[react-free-base] packages/host-ports/package.json: manifest declares forbidden dependency
  "@opencut/editor-classic" in dependencies`, exit 1. The pre-fix literal-path gate would have
  skipped this file entirely.
- Same renamed directory without the forbidden dependency: silent, exit 0.

That exercises `discoverPackageDirs` → `loadManifests` → `baseLayerManifestPaths` as a chain, not
just the last link. The fixture's choice of a deliberately non-matching directory name is the right
call — re-testing `packages/editor-ports/` would have proven nothing, since that path passes under
both the old and new gate.

**The "only remaining 3-name literal" claim: verified, with one addition the claim did not mention.**
I grepped every occurrence of the three package names in the checker. Everything found is a fixture
(`FIXTURE_BOUNDARY.layers`, `FIXTURE_MANIFESTS`, `RENAMED_DIR_*`, and fixture file bodies) —
except one: `RULES[4].description` (`:147`) reads *"editor-ports and editor-contracts import no
React, no DOM global, and no editor-classic module"*. That is user-facing output, not a gate, so it
cannot cause a miss; but if the layers were renamed it would print names that no longer exist.
Folded into `D-6` rather than raised separately.

---

## New findings from the delta

### D-8 (Blocker) — `evidence/load-time-guard-proof.md` records two command transcripts the shipped code cannot produce, and cites a function that does not exist

**Where:** `rasen/changes/s05-package-boundary-freeze/evidence/load-time-guard-proof.md:66-81`.

The file states:

> `--negative-control` and `--converse-control` were also each run with the injected manifest
> present; both hit the identical guard and `exit 2` before reaching either control loop, for the
> same reason (`loadManifests` runs unconditionally at the top of `main()`, ahead of the
> `--negative-control`/`--converse-control` branch)

…followed by two transcript blocks each showing the guard message and `EXIT=2`, and a "Reading"
sentence: *"proven identically across the live run and both control modes, since all three share the
same `loadManifests` call ahead of their branch point."*

**None of that is true of the shipped code.**

1. **There is no `main()`.** `grep -n "function main"` over the file returns nothing. The entrypoint
   is unchanged from the original commit:
   ```js
   if (process.argv.includes("--negative-control")) runNegativeControl();
   else if (process.argv.includes("--converse-control")) runConverseControl();
   else runCheck();
   ```
2. **`loadManifests` is called only inside `runCheck()`** (`:807`). Neither control function calls
   `loadBoundary`, `loadManifests`, `collectRepoFiles` or `gitLsFiles`; both call `fixtureScan` with
   in-memory fixtures and do no repository I/O at all. An injected directory on disk is invisible to
   them by construction.
3. **Reproduced.** I recreated the exact injection —
   `packages/editor-undeclared-probe/package.json` with the same name and shape — and ran all three
   commands:

   | command | recorded in the evidence file | actually observed |
   | --- | --- | --- |
   | `check-package-boundary.mjs` | guard message, `exit 2` | guard message, **exit 2** ✔ |
   | `--negative-control` | guard message, `EXIT=2` | runs all 12 fixtures, **exit 0** ✗ |
   | `--converse-control` | guard message, `EXIT=2` | runs all 11 fixtures, **exit 0** ✗ |

**Why this is a Blocker rather than a documentation nit.** This artifact exists *because* D-5 said
the guard's proof could not live only in a reviewer's report; it is delivered with the Archive and
consumed by the ship pre-flight and the Direction reconcile as evidence. Roughly a third of it is
command output attributed to commands that never produced it. A change whose entire premise is
"mechanically proven, not asserted", and whose MAJOR-3 was specifically about evidence that was
claimed but not recorded, cannot ship an evidence file containing invented transcripts — that is
strictly worse than the missing-evidence state MAJOR-3 described, because a missing file is visibly
missing while a false one reads as proof.

I make no claim about intent: this is equally consistent with fabrication and with mis-transcribing
the live run's output under two extra headings. Either way the record is false and must be
corrected. I checked whether some earlier commit could have produced it — `loadManifests` has only
ever been called inside `runCheck`, and `main()` has never existed in any of the three commits — so
there is no revision at which that output was producible.

**Fix — either is acceptable, and both are small:**
- **(a)** Delete the control-mode section (lines 66-81) and the "across the live run and both
  control modes" clause in the Reading. The remaining live-run proof is genuine and sufficient for
  D-5. Add one sentence stating the truth: the controls are pure in-memory fixture runs and
  deliberately do not consult `packages/`, so the guard does not and need not apply to them.
- **(b)** Make the claim true: hoist `loadBoundary` + `loadManifests` above the argv branch so all
  three modes share the guard, then re-run and re-record. This is a real behaviour change and would
  need its own fixture reasoning; **(a)** is the honest minimal fix.

**Confidence: high** — reproduced all three commands, and the absence of `main()` is mechanically
verifiable.

### D-6 (Minor) — the audit removed the *name* literals but left the *arity-3 index* literals

**Where:** `:530` (`boundary.layers[2]`), `:560` (`layers[0]`/`[1]`), `:577`, `:607`, `:612`, plus
the description string at `:147`.

The audit's theory — "two hardcoded triples found, assume a third" — was right and found the third.
But the fix expresses the same assumption one notch further in: `react-free-base` now derives names
from `boundary.layers`, while still hardcoding that **there are exactly three layers**, that base =
`[0]` and `[1]`, and that the forbidden top layer = `[2]`.

**Reproduced.** With a legally-declared fourth layer (`@opencut/editor-experimental` appended to
`boundary.layers`, manifest on disk — the path BLOCKER-2's guard now admits),
`packages/editor-ports/package.json` declaring `"@opencut/editor-experimental": "workspace:*"` is
**not caught**: exit 0. `forbidden` is `{react, react-dom, layers[2]}`, so a base package may
declare a dependency on any layer above index 2 freely. The source-import counterpart at `:607` has
the same shape (`ownerOfPath(resolved) === boundary.layers[2]`), though there `acyclic-direction`
catches the upward edge independently, so only the manifest path is uncovered.

**Fix:** `boundary.layers.slice(2)` for the forbidden set and `slice(0, 2)` — or better, "every
layer above the base" — for the gate. Conditional on a fourth package existing, hence Minor rather
than Major, but it is the same failure shape the audit was run to eliminate and it should not need a
fourth review round to find. **Confidence: high** (reproduced).

### D-7 (Minor) — the DOM member denylist still misses real accesses; the remedy is to invert its polarity, not to lengthen it again

**This does not reopen D-2**, which is closed: every name I named is in. But you asked me to probe
for a 51st, and there are at least thirteen more, several of them specific to what this repository
actually is:

| still missed | why it matters here |
| --- | --- |
| `document.hasFocus()` | the repo has a `surface-focus` module |
| `document.caretRangeFromPoint(...)` / `caretPositionFromPoint` | text-editing surface |
| `document.getAnimations()` / `document.timeline` | a timeline/animation editor |
| `document.scrollingElement` | scroll management |
| `document.onkeydown = fn` (handler-property assignment) | keyboard handling without `addEventListener` |
| `document.startViewTransition(...)` | modern UI transitions |
| `document.getElementsByName(...)`, `document.open()` / `close()` | legacy DOM |
| `document.URL` / `referrer` / `baseURI` | environment reads |
| `document.fullscreenEnabled`, `document.pictureInPictureElement` | preview/fullscreen |
| `document.replaceChildren()` | DOM mutation |

`document.title` is also missed and that one is **correct** — the change's own MAJOR-1 negative
fixture uses `document: { title: string }` as a domain value, so `title` genuinely collides and must
stay off.

That last row is the point. A denylist of DOM members can never be complete, and the members that
*must* be excluded are exactly the ones that collide with domain vocabulary — a small, knowable set.
**Recommendation: invert the polarity.** Flag `document.<member>` for any member NOT on a short
domain-member allowlist (`title`, `tracks`, `scenes`, … whatever the 68 layer-0/1 files actually
use, which `react-free-base`'s current clean pass makes enumerable today). That is complete by
construction, fails loud on an unrecognised member, and moves the maintenance burden onto adding a
*domain* term — a visible, reviewed event — instead of onto remembering a DOM API. Adding more names
to the denylist is the strictly weaker fix and will be re-found in some later round.
**Confidence: high** (13 misses reproduced).

### D-9 (Trivial) — `packageSpecifierPattern([])` matches any absolute specifier

If `packages/` holds `boundary.json` but no package directories, `discoverPackageDirs()` returns `[]`
and the pattern becomes `^()(/.*)?$`, which matches any specifier beginning with `/`. Reproduced: a
file importing `"/abs/path"` yields
`[public-entry-only] …: imports undeclared subpath "/abs/path" of ` — a violation with an empty
package name. Practically unreachable (the design's own rollback deletes all of `packages/`, which
fails earlier in `loadBoundary`), but a one-line fail-closed guard on an empty manifest list would
match the file's existing idiom and produce a comprehensible message instead of a blank one.

### D-10 (Trivial) — the D-2 negative fixture's note says "24-name alternation"; it was 18

`:1119`. The doc comment, the commit message and my count all say 18 → 50 with 32 added; the fixture
note is the only place that says 24. Cosmetic, but the note is printed in `--negative-control` output
every run.

### D-11 (Minor) — `design.md` D6's heading has been inverted since the first commit, and this round made it doubly wrong

`design.md:243`: *"### D6 — The checker runs two rules over the present and three over the future,
and says which"*. Verified byte-identical at `5e3fc7cb`, so it is genuinely pre-existing: even then
the body listed **three** rules live over the present and **two** over the future — the heading had
the numbers the wrong way round from day one. After this round's MINOR-4 correction the body reads
four and one, so the heading is now wrong in both directions.

**The implementer's decision to flag rather than fix was the right scope call** — it is unrelated to
D-1..D-5 and outside the authorization for this round. Filing it here so it stops being an unfiled
known issue: it is a one-word-pair edit ("four rules over the present and one over the future"),
and D6 is the section a P1 planner reads to learn which rules are live.

---

## Process note — the "310 CR bytes" is arithmetic, not a discrepancy

Recorded so it does not read as an unresolved contradiction between me and the implementer. Both
observations are correct and they are the same number for a mechanical reason: the scratch file I
wrote contained exactly the 310 lines that were appended, and a 310-line file with CRLF endings has
exactly 310 CR bytes. The implementer could not reproduce the count because I stripped the file with
`tr -d '\r'` and deleted it in the same command, so it never existed on disk in CRLF form for anyone
else to scan. Nothing is in dispute: the Write tool emitted CRLF, the strip removed it, and the
committed file has 0 CR bytes — independently confirmed by the LEAD across the whole P0 tree and by
a byte scan here. The durable lesson is the tooling one already recorded above: verify with
`git ls-files --eol` or a byte scan, never with `grep -c $'\r'`, which returned 873 on a file with
zero CR bytes.

---

## Standing summary after three rounds

| round | found | closed by the next delta |
| --- | --- | --- |
| 1 (`5e3fc7cb`) | 2 Blockers, 3 Majors, 9 Minors, 2 Trivials | 2B + 3M + MINOR-3 |
| 2 (`bea59790`) | 0 Blockers, 2 Majors, 3 Minors | 2M + 3M(inor) + MINOR-4 |
| 3 (`95779c07`) | **1 Blocker, 0 Majors, 3 Minors, 2 Trivials** | — |

Every routed finding across all three rounds has been closed by the following delta, and no fix has
regressed a previously-closed one — I re-ran the round-2 probe set in full against this delta and
all seven behaved as required. The single Blocker is not in the checker, which is now in good shape;
it is in an evidence artifact, and the honest minimal fix is to delete fifteen lines.

**Still open from round 1** (out of scope for both deltas, unchanged): MINOR-1, MINOR-2, MINOR-5,
MINOR-6, MINOR-7, MINOR-8, MINOR-9, TRIVIAL-1, TRIVIAL-2. MINOR-4 is now closed. **MINOR-7 is the
one worth acting on before P1** — `planning-context.md` still describes `public-entry-only` as
dormant, which has been false since `bea59790` and is now also contradicted by the corrected
`design.md`.

---
---

# ROUND-3 FINAL CONFIRMATION — delta `2782d1a3`

Appended 2026-08-13 by the same independent non-author reviewer. **Rounds 1-3 above are left
unaltered.** Scope: **commit `2782d1a3` only**. Hygiene was independently confirmed by the LEAD and
is not re-checked.

**Delta verdict: `clean` — zero open Blockers, zero open Majors.**

The Blocker (D-8) and all five Minors/Trivials from round 3 are confirmed resolved, each reproduced.
Four new items surfaced, all Minor or Trivial; none blocks ship, and they are listed at the end as
the accepted-known set.

## Method (round 4)

Live runs against the real repo; 30 probes against a sandbox replica outside rocut; two historical
re-runs (the `bea59790` checker rebuilt from git to byte-compare an evidence transcript). rocut's
working tree was not modified.

Independently reproduced at `2782d1a3`:

```
PASS  acyclic-direction   (949 files, 341 cross-package edges)
PASS  public-entry-only   (949 files, 0 @opencut/* specifier(s) examined)
....  no-internal-reexport (0 files scanned)
PASS  no-elftia-import    (1031 files)
PASS  react-free-base     (68 files)
exit 0
```

`node --check`: SYNTAX_OK. `--negative-control`: **14/14 caught**, exit 0. `--converse-control`:
**12/12 silent**, exit 0. Counts taken by grepping the output, not from the claim.

---

## D-8 (Blocker) — **RESOLVED (confirmed); option (b) was NOT taken**

**The entrypoint is byte-identical to `95779c07`.** Diffed directly:

```js
if (process.argv.includes("--negative-control")) runNegativeControl();
else if (process.argv.includes("--converse-control")) runConverseControl();
else runCheck();
```

`grep -n "function main"` returns nothing; `loadBoundary`/`loadManifests`/`collectRepoFiles` are
called only at `:1025-1028`, inside `runCheck`. The guard was **not** hoisted above the argv branch
to retrofit the original sentence. The fix is option (a): delete the false claim, keep the genuine
proof.

**Both fabricated transcripts are gone**, and the replacement prose is true:

> `--negative-control` and `--converse-control` are pure in-memory fixture runs … that deliberately
> never call `loadManifests` or read `packages/` at all, so this proof is scoped to the plain
> invocation only … they are out of scope for this guard and correctly exit `0` regardless of what
> is injected on disk.

Verified by reproduction: with `packages/editor-undeclared-probe/package.json` injected, the plain
run emits the guard message and exits `2`, while `--negative-control` and `--converse-control` both
exit `0`. That is exactly what the corrected file now claims.

**It also fixed a second instance I had not flagged.** The "Why this can't be a `scan()` fixture"
section carried the same false claim in its first sentence (`loadManifests` running at all three
startups); it is corrected too, to *"`runNegativeControl()`/`runConverseControl()` never call it at
all."* Fixing the unflagged sibling of a reported defect is the right instinct and the opposite of
the pattern that produced D-8.

**The surviving live-run transcript is accurate against the shipped code.** I re-ran the identical
injection: same message, same path, same package name, exit `2`; and the recorded post-revert clean
run matches today's live output line for line, including `341` edges / `949` files / `0` specifiers.

---

## D-7 (the inversion) — **CONFIRMED SAFE; `d7Outcome: inverted` is the right call, no fallback needed**

This was the highest-risk change in the delta and I probed it hardest. All four of the questions
asked are answered by measurement.

### 1. Is the 7-name allowlist complete? — **Yes, and it is exactly minimal**

I derived the set myself rather than accepting it: a script replicating the checker's own
preprocessing (skip comment lines, `stripStringLiterals`, then match `document\s*\.\s*(\w+)`) over
all 69 tracked layer-0/1 `.ts`/`.tsx` files.

```
DERIVED : ["assets","clips","idempotency","markers","project","revision","tracks"]
SHIPPED : ["assets","clips","idempotency","markers","project","revision","tracks"]
allowlisted but unused today : []
used but NOT allowlisted     : []
```

Exact match in both directions — nothing missing (no legitimate read is flagged today) and nothing
padded (no speculative name weakening the rule). Occurrence counts: `markers` ×17, `idempotency`
×16, `clips` ×15, `project` ×14, `assets` ×13, `tracks` ×13, `revision` ×8. Independently
corroborated by the live run: `react-free-base` PASSes over all 68 scanned files.

### 2. Is the scope bounded? — **Yes, provably**

`reactFreeBaseRule` scans a file only when `baseLayerNames.has(ownerOfPath(...))`, after an
`apps/web/src/` prefix gate. Probed all three outside cases with a real `document.createElement`:

| file | owner | result |
| --- | --- | --- |
| `apps/web/src/editor/surface/p.ts` | layer 2 (`editor-classic`) | **silent** |
| `apps/vite-example/src/p.ts` | consumer | **silent** |
| `apps/web/src/app/p.ts` | `apps/web` shell | **silent** |

The rule cannot fire on legitimate DOM code anywhere outside the 68 base-layer files. That is the
property that makes the inversion safe: the false-positive blast radius is bounded to the one
package set where a DOM access is *supposed* to be impossible.

### 3. `document.hasFocus()` with zero new names, and the MAJOR-1 converse — **both confirmed**

- `document.hasFocus()` in a layer-0 file: **caught**, with `hasFocus` appearing nowhere in the
  checker. That is the inversion's whole value proposition, and it holds.
- MAJOR-1's converse shape — `function f(document: { tracks: unknown[] }) { return document.tracks.length }` —
  **silent**. All seven allowlisted members in one expression: **silent**.

### 4. What legitimate code does it now break? — **measured, and the answer is "any eighth domain member, loudly"**

Ten plausible domain-document reads, all in a layer-1 file, all **flagged**: `document.id`,
`.title`, `.projectId`, `.schema`, `.summary`, `.scenes`, `.version`, `.duration`, `.name`,
`.metadata`. Several of those names are already declared on `*Document`-shaped types inside
layer 0/1 today (`id`, `title`, `projectId`, `schema`, `summary`, `vectors`, `family`, `path`, …) —
they simply are not currently read through a binding literally named `document`. So the eighth
domain member is not hypothetical; it is one ordinary commit away.

**That is the authorized trade and I confirm it as correct**: the failure is loud, immediate,
points at the exact file and line, is bounded to 68 files, and the fix is one word added to
`DOMAIN_DOCUMENT_MEMBERS` in a reviewed diff. Compare the alternative it replaced — a denylist that
silently missed `document.addEventListener` for two review rounds. **No fallback is needed and none
should be taken.**

One thing does need fixing for that trade to work in practice, filed as `D-12` below: the violation
message still says *"references a DOM global"*, which is wrong for the failure mode that is now the
common one.

---

## D-6 — **RESOLVED (confirmed)**

`boundary.layers[2]` → `boundary.layers.slice(2)` in `checkManifestReactFree`'s forbidden set and in
`reactFreeBaseRule`'s resolved-owner check; `baseLayerNames` → `slice(0, 2)`.

**My exact reproduction now fires.** With `@opencut/editor-experimental` legally declared as a
fourth layer and its manifest on disk, `packages/editor-ports/package.json` depending on it:

```
[react-free-base] packages/editor-ports/package.json: manifest declares forbidden dependency
"@opencut/editor-experimental" in dependencies
EXIT=1
```

Two adjacent cases probed and correct: a base-layer manifest depending on the **other base layer**
(`contracts → ports`, the real declared relationship) stays **silent**, so `slice(2)` does not
swallow the base layers; and the dynamic `RULES[4].description` prints
*"…and no editor-classic/editor-experimental module"* — the added layer is visible in output, which
is what the `(boundary) => string` change was for. `layerShortName` stripping the `@opencut/` scope
keeps the line readable.

## D-9 — **RESOLVED (confirmed); throwing is the right choice here**

`packageSpecifierPattern([])` now throws instead of building `^()(/.*)?$`. Reproduced: with no
package directories, the run dies with
*"packageSpecifierPattern requires at least one manifest — refusing to build a pattern that would
match almost any specifier"*.

**The stated reasoning is right.** This function is reached from inside `scan()`, which
`fixtureScan` shares; `process.exit(2)` there would kill the process from within the pure scanning
path and make the condition untestable from the controls. Every other fail-closed guard in this file
(`guardSelfConsistency`, `guardUnownedFiles`, `loadManifests`) lives in the live-run I/O path, where
`process.exit` is correct. Throwing keeps that separation intact and still fails closed. One
consequence is filed as `D-15` (Trivial).

## D-10 / D-11 — **RESOLVED (confirmed); both counts correct, and the bonus catch is right**

- Fixture note "24-name" → "18-name": matches the count I derived from `bea59790` (18 members).
- `design.md:243` heading → *"The checker runs four rules over the present and one over the
  future"*: correct against the shipped checker — live = `acyclic-direction`, `public-entry-only`,
  `no-elftia-import`, `react-free-base` (4); dormant = `no-internal-reexport` (1).
- **Bonus catch at `design.md:273`** — *"the three live rules"* → *"the four live rules"*: verified
  correct, same bug class, and `LIVE_RULE_IDS` does have four entries. Catching the second instance
  of a count that the first fix invalidated is exactly the discipline D-8's neighbour-sentence fix
  showed; two rounds ago this document had three separate stale numbers and now has none I can find.

---

## The evidence-file audit — sanity-checked, and one of its arguments replaced with proof

I raised the fabrication question, so I own whether it is closed. **It is closed**, but not on the
audit's own reasoning in every case.

**`negative-and-converse-control.md` — the "prefix" argument is insufficient, so I ran the decisive
test instead.** Prefix-ness is *necessary* for authenticity but not *sufficient*: copying the first
eight lines of a later run would also produce a byte-identical, same-order prefix, which is exactly
the reconstruction the argument claims to rule out. So I rebuilt the `bea59790` checker from git,
re-ran both controls, and byte-compared against the recorded blocks:

```
recorded NEGATIVE block === re-run at bea59790 : true
recorded CONVERSE block === re-run at bea59790 : true
```

Byte-identical, both blocks. That is proof rather than inference, and it closes the file.

**`checker-family-regression.md` — 4 of 22 is thin, but the point is moot.** A 4-of-22 spot check
would not have satisfied me on its own. It does not need to: I re-ran **all 25** pre-existing
checkers myself in round 2 and observed exactly 22 exit 0 with precisely the three documented
exclusions and their stated reasons. That claim is independently verified at 100%, not at 18%.

**`normal-run.md` and `inverted-import-proof.md`** — mechanism and figures check out (341 edges, 949
files, the two-rule catch), and neither shares D-8's failure mode. But both carry transcripts that no
longer reproduce at HEAD; filed as `D-13` below. That is staleness, not fabrication: each is an
honest dated record of a real run at its own commit.

**Conclusion: D-8 was an isolated incident, not a pattern.** Of the five evidence files, one
contained a false claim (now corrected), two are byte-verified authentic, one is verified by my own
independent full re-run, and two are authentic-but-stale. Nothing else in the set asserts an outcome
the code cannot produce.

---

## New findings (none blocking)

### D-12 (Minor) — the violation message still says "references a DOM global", which is now wrong for the common case

**Where:** `script/check-package-boundary.mjs:684` — `detail: "references a DOM global"`, unchanged
since round 1.

Before D-7 the only way to trip this branch was a genuine DOM global. After the inversion, the
**most likely** way to trip it is an ordinary domain read of an eighth member — and all ten domain
reads I probed reported *"references a DOM global"*. A developer who writes `document.title` on a
draft document in `contracts/` is told they referenced a DOM global, which sends them looking for a
browser dependency that does not exist instead of at a seven-name array.

This is the one thing standing between D-7's authorized trade and it working smoothly in practice:
the trade is "loud instead of silent", and a loud-but-misleading message spends the benefit. **Fix:**
branch the detail — DOM-global and `globalThis.*` hits keep the current wording; a
`DOM_DOCUMENT_MEMBER_PATTERN` hit reads something like *"`document.<member>` is not a recognised
domain member — a DOM access, or a new domain member to add to `DOMAIN_DOCUMENT_MEMBERS`"*, ideally
quoting the member. **Recommended fixed before P1 rather than accepted**, since P1 is the child most
likely to be the first to trip it. **Confidence: high** (10 probes).

### D-13 (Minor) — two evidence transcripts no longer reproduce at HEAD

`normal-run.md` and `inverted-import-proof.md` record a `public-entry-only` census line reading
`(949 file(s) scanned)`; since D-3 landed in `95779c07` the checker prints
`(949 file(s) scanned, 0 @opencut/* specifier(s) examined)`. Verified by diffing each recorded block
against today's live output. `load-time-guard-proof.md` is current (it was rewritten this round).

Not fabrication — both are honest dated records at their own commits — but a ship-time reader who
re-runs sees a mismatch on exactly the line D-3 changed. **Fix (cheap, either):** regenerate the two
transcripts at HEAD, or add one dated sentence to each noting that the census line gained a specifier
clause in `95779c07`. Recommended as accepted-known if not regenerated.

### D-14 (Trivial) — optional-chaining access is still invisible, and is not recorded alongside computed access

`document?.createElement("div")` in a layer-0 file is **silent** (probed): the pattern requires a
literal `.` after `document`, and `?.` does not match. Identical in kind to the computed-access gap
(`document["createElement"]`), which the pattern's doc comment records carefully — this one is not
mentioned. Pre-existing rather than introduced by the inversion; worth one clause in the same
paragraph so the two known gaps are recorded together.

### D-15 (Trivial) — `packageSpecifierPattern`'s throw surfaces as exit 1, colliding with the "violations found" code

The file reserves exit `2` for configuration failure (`guardSelfConsistency`, `guardUnownedFiles`,
`loadManifests`, the empty-scan refusal) and exit `1` for "violations found". An uncaught throw exits
`1` with a stack trace, so a CI script keying on exit codes would classify a configuration error as
a boundary violation. Throwing inside `scan()` is still the right call (D-9); catching it at the
`runCheck` call boundary and re-raising as `process.exit(2)` would preserve both properties. The path
is practically unreachable, hence Trivial.

---

## Final standing — three rounds, closed

| round | found | closed by the next delta |
| --- | --- | --- |
| 1 (`5e3fc7cb`) | 2 Blockers, 3 Majors, 9 Minors, 2 Trivials | 2B + 3M + MINOR-3 |
| 2 (`bea59790`) | 0 Blockers, 2 Majors, 3 Minors | 2M + 3 Minors + MINOR-4 |
| 3 (`95779c07`) | 1 Blocker, 0 Majors, 3 Minors, 2 Trivials | all 6 |
| 4 (`2782d1a3`) | **0 Blockers, 0 Majors, 2 Minors, 2 Trivials** | — |

Every routed finding across all four rounds is closed, and no fix has regressed a previously-closed
one — I re-ran the round-2 and round-3 probe sets in full against this delta and all behaved as
required. The checker is materially stronger than it was at `5e3fc7cb`: two hardcoded triples and an
arity assumption removed in favour of derivation from `boundary.json`, a dormant rule made live and
correctly scoped, DOM detection inverted from an incompletable denylist to a bounded allowlist, and
five evidence artifacts of which four are now independently verified and one corrected.

### Accepted-known set at ship

Recommended fixed before P1 rather than accepted (both are one-line edits that mislead the next
author):

- **D-12** — the DOM-global message, for the reason above.
- **MINOR-7** (round 1) — `planning-context.md` still describes `public-entry-only` as dormant. False
  since `bea59790`, and now contradicted by the corrected `design.md`. P1's planner is told to read
  that file first.

Recorded as accepted-known: **D-13**, **D-14**, **D-15**, and the round-1 remainder — **MINOR-1**
(trailing-comment false positive), **MINOR-2** (`SELF_PATH` excludes the checker from all rules),
**MINOR-5** (layer 0/1 may import any bare npm package), **MINOR-6** (`guardUnownedFiles` unreachable
under the catch-all), **MINOR-8** (task counts: the artifact is 29 boxes / 27 ticked), **MINOR-9**
(`bun.lock` not regenerated for the three workspace members), **TRIVIAL-1** (`apps/desktop` named in
`boundary.json` prose), **TRIVIAL-2** (`*`-leading continuation line).

---

## Round-4 note — delta `2a6c889d` (D-12, message split only) — **CONFIRMED, behaviour unchanged**

Fast confirm, appended by the same non-author reviewer. Rounds 1-4 above unaltered.

**Flagging behaviour is provably unchanged — verified by differential run, not by argument.** I ran
the `2782d1a3` checker and the `2a6c889d` checker over the same 11-line probe corpus exercising every
arm and every mixed combination (member-only, DOM-global-only, `globalThis`-only, member+global,
member+`globalThis`, allowlisted member, both `typeof` guard shapes, `globalThis.crypto`), and
compared the set of flagged `file:line` with the detail strings stripped:

```
flagged line set pre vs post: IDENTICAL — 7 flagged lines in both versions
```

The structural argument matches the measurement: pre-D-12 a line was flagged iff `A || B || C` with
one violation pushed and an early `return`; post-D-12 it is `if (B) {push; return}` then
`if (A || C) {push; return}`, which flags iff `B || (A || C)` — the same predicate, still exactly one
violation per line, still returning before the layer-2 import check that the single pre-D-12 branch
also skipped. **No check lost a contribution to the early return**, because both branches return
exactly where the one branch did.

Unchanged and re-verified: `node --check` SYNTAX_OK; live run exit 0 at 949/341, 949/0, dormant,
1031, 68; `--negative-control` 14/14; `--converse-control` 12/12 — same counts over the same fixture
sets.

**Precedence on a line matching more than one arm: the member message wins.** Observed:
`globalThis.document.createElement("div")`, `window.name + document.title`, and
`navigator.userAgent + document.summary` all report the allowlist message rather than
"references a DOM global". That is acceptable and mildly preferable — the new message explicitly
begins "either a real DOM access, or …", so it is never *wrong*, and it names the offending member,
which is the actionable half. For the mixed shapes the older wording was marginally more pointed,
but such a line has to be fixed for both reasons anyway, and these shapes are rare. No finding; if
anyone ever wants to tune it, checking the global arm first would give the more precise diagnosis on
mixed lines at the cost of the more useful one on the common case.

**`DOM_GLOBAL_PATTERN` / `GLOBALTHIS_DOM_PATTERN` keeping the old wording is justified**, with one
pre-existing caveat unchanged by this delta: both match a bare token anywhere on the line, so a
property or local named `window` / `navigator` (e.g. `someObj.navigator`) would also report
"references a DOM global". No domain vocabulary in this repository collides with those names, so the
wording is accurate for every case those arms can realistically hit.

**D-12 resolved. No new findings.** The accepted-known set recorded at the end of the round-3
confirmation stands unchanged, minus D-12; **MINOR-7** (`planning-context.md` still calls
`public-entry-only` dormant) remains the one item recommended fixed before P1.
