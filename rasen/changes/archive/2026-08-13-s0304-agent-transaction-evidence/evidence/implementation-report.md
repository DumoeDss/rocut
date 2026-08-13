# T4 implementation report — published vectors + dual-Host Agent evidence

## Closure identity

| item | value |
| --- | --- |
| Final build marker | `t4-final-source-20260813-a`, both Hosts |
| Source manifest | `pre-browser-source-hashes.sha256`, 31 paths, frozen before the cycle |
| Post-run re-hash | **31 / 31 equal**, unbroken — no source edit landed inside this cycle |
| Artifact manifest | `artifact-hashes.sha256`, 8 emitted artifacts |
| Write set | **32 files.** The 32nd is disclosed below and is deliberately outside the frozen 31 |
| Vite Host | owned `vite preview` on `127.0.0.1:4173`, `reuseExistingServer: false` |
| Next Host | owned `next start` on `127.0.0.1:3017`, `reuseExistingServer: false` |
| Tasks | **47 / 48**; 8.7 deferred with cause |

This is the second final-source cycle. The first (`t4-final-source-20260812-a`) is superseded:
independent review returned PASS WITH FINDINGS, and the fixes changed `runner.ts`, which is in
the emitted graph, so the whole browser leg was re-run against the new bytes rather than
re-hashed. The review disposition is at the end of this report.

## Verification ledger

| gate | result |
| --- | --- |
| Vector suites | **67 pass / 0 fail / 727 expectations / 9 files** |
| Contracts + Surface suites | **160 pass / 0 fail / 1,595 expectations / 22 files** |
| `check-type-baseline.mjs` | PASS — no diagnostic outside the pinned baseline set |
| Vite typecheck | PASS (`tsc --noEmit`, exit 0) |
| Changed-file ESLint | 0 problems on `contracts/vectors` and `surface/evidence` |
| `check-transaction-boundary.mjs` | clean — 52 contract modules + 3 published vector files; `--negative-control` clean |
| `check-agent-evidence.mjs` | clean — **9 rules per Host** + cross-Host identical-plan rule; converse control 9/9 evaluated; negative control 9/9 proven able to fail; unknown flag exits 2 |
| `check-storage-boundary.mjs` | clean **after T4 classified its own localStorage use** — see "The gate T4 broke" |
| `check-distributable-boundary.mjs` | **2,943 modules, 10/10 exclusions clean** (644 web + 15 example host + 2,280 dependencies + 4 other) — identical to the 08-12 cycle, so the review fixes added no module |
| `check-react-singleton.mjs` | clean — 3 manifests, lock, 2,943 emitted modules |
| Surface CSS / portal / private-drag / surface-boundary | clean |
| port / session-resource / reference / next-imports / host-composition / emitted-runtime-assets / runtime-asset-boundary | clean |
| `check-editor-singleton.mjs` | **FAIL, pre-existing and not T4's** — see below |
| `check-session-state-boundary.mjs` | **FAIL, pre-existing red T4 adds two rows to** — see below |
| Agent spec, Vite / Next | **1/1 each** |
| R2 Surface matrix, Vite / Next | **2/2 each** — one unexplained failure in six runs, recorded below |
| Full parity, Vite / Next | 1/1 each — **27 / 18 / 9** |
| c5-storage (incl. C4 forced-none) | 5/5 |
| `rasen validate --strict` | `items[0].valid: true`, 0 issues |

Two checkers are not standalone gates and were not counted: `check-asset-manifest.mjs` exits 2
without a live preview server, and `check-headless-graph.mjs` exits 2 without its seven required
arguments.

## Dual-Host Agent evidence

Both Hosts, marker `t4-final-source-20260813-a`, distinct project ids, verified by reading the
ledgers rather than trusting the gate's summary line:

- **9 declared steps, 9 executed**, and the declared plans are byte-identical across Hosts.
- Per-step ledgers identical across Hosts — same revision deltas, watcher counts, durable saves
  and assertion counts. **87 assertions**, and this is now gated rather than eyeballed: the
  per-step counts are pinned in `agent-drivers.test.ts` (where a live Node run must reproduce
  them) and again in `check-agent-evidence.mjs` (where both Hosts must reproduce them).
- Committed **revision 6**.
- **Reopen after a real page reload**: 48 assertions, observed revision 6 = expected 6,
  `verdict: passed`, on both Hosts.
- **Stale control**: expected 5 vs observed 6, `verdict: failed`, `"reopened revision 6 != committed 5"`,
  on both Hosts. This is the assertion proving the reopen check *can* fail.
- `consoleErrors: []` and `attachmentBytesClaimed: false` on both.

The runner's own numbers are read off the run, not declared: durable engine 29 declared / 29
applicable / 29 executed / 316 comparisons / 0 skipped; in-memory fake 29 / 16 / 16 / 227 / 13,
where the 13 skips are asserted to equal *exactly* the set of vectors carrying a `requires`.

**The two screenshots per Host are not evidence and are not offered as any.** `01-agent-apply.png`
and `02-agent-reopen.png` are byte-identical within each Host: the page shows the shared harness
chrome and no agent state, because task 6.3 deliberately routes the ledger to a `data-testid`
element the driver parses instead of relying on pixels. They are retained as run receipts only.

## Why this evidence is not vacuous

Independent review found that the first version of this section rested on three failure codes
with **no test coverage at all**, two of which appeared covered by assertions that were
arithmetic tautologies over object literals the test had just written — both would have passed
with the runner's rules deleted. That is corrected here, and the correction is measured rather
than asserted.

`deriveFailureCodes(report)` is now a pure exported function holding every report-level rule, and
`runTransactionVectors` calls it. Three of those rules guard states no valid corpus and no
conforming target can reach, so judging a constructed report through the shipped rule is what
makes them testable at all.

**Mutation-measured.** With `zero-comparison`, `count-drift` and `false-skip` each replaced by a
no-op inside `deriveFailureCodes`, **exactly four tests fail and no others**:

| code | how it is exercised | fails on deletion |
| --- | --- | --- |
| `zero-comparison` | **live** — a step-less scenario vector is recorded `passed` with 0 comparisons and the run verdict is still `failed`; plus a constructed report through the rule | 2 tests |
| `count-drift` | constructed report through the rule, with the converse asserted on a real run | 1 test |
| `false-skip` | real skipped results from a real run, re-judged against a target that advertises what they name | 1 test |

The remaining rules were already live: `refused-empty-scan` (empty corpus and empty filter match),
`unsupported-family` (non-seedable target), `coverage-incomplete` (contract member with no
covering vector), `vector-failed` (the whole mutation matrix).

- A missing Host is a failure, not a skip — `check-agent-evidence` reported
  `"only 0 of 2 Hosts executed"` before the browser leg ran, which is how it should behave.
- **Mutation matrix**: six deliberately broken wrappers each fail an *exactly* declared id set
  (`toEqual`, never "at least one"), and each expected set is **derived from a corpus property**
  rather than typed out, so a vector added later joins the set automatically instead of silently
  weakening the control. All six now assert only non-emptiness on that derived set; the placement
  wrapper previously pinned it at exactly 5, which would have made a later placement vector fail
  the control instead of widening it — the derivation claim was true of five cases and stated of
  six.
- Every failed vector must carry a non-empty detail string, so a wrapper cannot pass by failing
  silently.
- **Conforming-variant control**: reversed `createdIds`/`changedIds` order, extra optional fields,
  resolution on a later microtask — passes every vector, so the corpus cannot over-constrain
  implementations into copying the reference.
- Coverage is derived by intersecting the parsed corpus with the contract's own exported
  `OPERATION_KINDS` / `TransactionErrorCode` / `TransactionEngineIssueCode`, with a converse
  control that injects a synthetic member and must make the gate fail.
- A published report can be re-judged: `deriveFailureCodes(report)` is asserted to reproduce
  `report.failureCodes` on both a passing and a failing run.

## Disclosed weaknesses in this evidence

1. **`false-skip` is unreachable from `runTransactionVectors` today, and the review's suggested
   fix for it is not possible.** The reviewer asked for a stub target that advertises a capability
   and then skips a vector requiring it. No such target can exist: the runner decides the skip and
   the false-skip check against one `advertised` set captured from a single probe, so the two
   cannot contradict each other within a run. The rule is a report-level invariant — it guards a
   published report and any future runner that reads capabilities per target. It is exercised
   against real skipped results with only the advertised list altered, and it is proven to fail on
   deletion, but no live run produces it.
2. **`count-drift` is likewise unreachable from a valid corpus** and is asserted through the rule,
   with the converse (`not.toContain`) asserted on a real run.
3. **The 87-assertion Host↔Node equality is enforced by two pinned copies of the same map**, one
   in `agent-drivers.test.ts` and one in `check-agent-evidence.mjs`, coupled by convention rather
   than by a shared file. Either side drifting fails loudly and in one obvious place; they cannot
   drift together silently, but nothing mechanically proves the two literals are equal.
4. **Task 8.8's falsification sweep** enumerated every `SHALL`/`MUST` line across all 17 canonical
   specs (262 lines) and reconciled them against the touch set, reading surrounding scenarios only
   for the four named specs — not ~5,000 spec lines end to end. **8.10 is a self-audit of the
   author's own diff.**
5. **One unexplained Surface-matrix failure on the Next Host.** The first run after the rebuild
   failed; the error context was destroyed by Playwright's output cleaning before it was read, and
   it did not reproduce in five subsequent runs — including a fresh Next rebuild followed
   immediately by a run, which was the condition under which it first failed. The spec observes
   none of the attributes T4 changed (`data-scenario`/`data-phase` are read only by `agent.pw.ts`),
   and it has known order-sensitive drag steps that cost R2 three cycles. Recorded as a flake with
   no diagnosis rather than as a pass.
6. **Running the R2 Surface matrix resurrects an archived change's directory.** The reporter path
   in `playwright.surface.config.ts` still points at `rasen/changes/s0304-surface-css-react-a11y/`,
   which was archived on 08-12. The run recreates that directory and writes throwaway evidence into
   it. Nothing is corrupted — the committed archive under `rasen/changes/archive/` is untouched and
   the recreated directory is in `.git/info/exclude` — but had R2 not been archived, a T4 regression
   run would have overwritten R2's live evidence. This is the same hazard as review finding T3,
   through a different door, and it is not fixed here: the fix is in the frozen 31 and would cost
   another full browser cycle.

## The gate T4 broke, and how it is closed

`check-storage-boundary.mjs` was **green before T4 and red because of T4**. The sole offender was
T4's own `agent-evidence-run.ts`, which uses `localStorage` at two lines to carry the agent
commitment across the reopen reload. Neither the 08-12 gate list nor the independent review
included this checker, so it shipped red into review unnoticed.

It is closed by classification, not exemption:

- The commitment genuinely cannot live in the store under test — recording the committed revision
  there would make the reopen assertion circular — and `agent.pw.ts` manipulates that exact key to
  drive the stale control.
- Adding the file to the existing `LOCAL_PREFERENCE_FILES` map would have labelled evidence state a
  "shell/UI preference", which is false. A separate `EVIDENCE_LOCALSTORAGE_FILES` map carries its
  own rule, its own reporting line and its own truthful reason.
- The classification is **exact per file and proven so**: replacing the entry with the containing
  directory prefix makes the checker fail again, and a new summary rule fails any classification
  that nothing exercised, so a stale exemption cannot sit there unnoticed.

**This is the 32nd file in T4's write set and it is deliberately outside the frozen 31.** It was
edited after the browser cycle. It is a Node checker that appears **0 times** in
`apps/vite-example/dist/module-graph.json` and is imported by no bundle and no test, so it cannot
have affected the artifacts, and the 31-path manifest still verifies 31/31 against the bytes that
produced them. Re-freezing it into the manifest would have made a post-cycle edit look like a
pre-cycle one — the same misrepresentation the 08-12 incident was recorded to avoid.

## Pre-existing reds, in nobody's set

Neither is repaired here, and neither is T4's to repair.

**`check-editor-singleton.mjs`** fails `command-module-count:40/39`: `EXPECTED_COMMAND_MODULES = 39`
while 40 modules under `apps/web/src/commands` extend `Command`. That directory and that script are
both untouched by T4, and **R2's gate set did not include this checker either**, so it was already
red when R2 shipped. Bumping the constant would mean T4 vouching for a command module it did not
write.

**`check-session-state-boundary.mjs`** reports 13 unclassified module-level mutable singletons.
**Eleven are in six files T4 did not write** (`contracts/draft/classification.ts`,
`contracts/engine/engine.ts`, `contracts/engine/evaluator.ts`, `contracts/in-memory/index.ts`,
`surface/embedding/surface-evidence-seams.tsx`, `surface/embedding/surface-transaction-binding.ts`).
Two are T4's: `TICK_FIELDS` and `REQUIREMENTS` in `contracts/vectors/loader.ts`, both module-level
read-only `Set` lookup tables of exactly the shape the pre-existing `PROJECT_PATCH_KEYS` rows
already have. T4 follows the surrounding pattern rather than inventing a classification the
contract layer does not have. Removing T4's two rows would leave the gate red at 11 and would cost
a rebuild of both Hosts plus another browser cycle, because `loader.ts` is in the frozen 31 and in
the emitted graph.

Both need an owner, not another note.

## Review disposition

Independent non-author review of the 08-12 cycle returned PASS WITH FINDINGS: one major, four
minors, one trivial. All six are addressed.

| # | finding | disposition |
| --- | --- | --- |
| T1 (major) | three failure codes with no coverage; two tautological tests | **Fixed** — `deriveFailureCodes` extracted and exported; live control added for `zero-comparison`; mutation-measured (see above). The reviewer's alternative — striking the three from the argument — was rejected as weakening |
| T2 | placement wrapper pinned its derived set at `toBe(5)` | **Fixed** — `toBeGreaterThan(0)`, matching the other five, so a later placement vector joins the set |
| T3 | unrecognised `PARITY_SPEC` silently became `"surface"` | **Fixed** — `resolveSpec` throws and names the accepted set; verified with `PARITY_SPEC=agnet`. Unset still means `"surface"` |
| T4 | `data-scenario`/`data-phase` were defaults on the surface path | **Fixed** — `reported` starts `null` and both branches publish it, so the attributes are always a fact a run asserted. First paint is unchanged on both Hosts, so hydration parity is preserved |
| T5 | "87 assertions, matching the Node drivers exactly" was unasserted | **Fixed** — pinned per step on both sides; weakness 3 above records the residual coupling |
| T6 (trivial) | the re-frozen manifest silently changed meaning | **Fixed** — the manifest carries a header stating exactly what it freezes, and this cycle re-froze *and* re-ran together |

## Process incident, 08-12 cycle — closed

The 08-12 cycle froze its manifest at 22:53:01 and a source edit landed at 22:56:41, breaking hash
equality at 30/31. The cause was shared: the LEAD began a frozen cycle without telling the
implementer to hold, and the implementer edited on despite seeing browser artifacts appear on disk.
It was recorded rather than quietly re-hashed. **This cycle had a single mutating actor throughout
and closed 31/31 unbroken.** The one post-cycle edit is disclosed above with its bundle
independence proven rather than asserted.

## Plan defect found during implementation

**Task 3.1's signature was unsatisfiable as written.** `runTransactionVectors({corpus, open, filter?})`
cannot also produce the coverage report: two of the three contract member sets are type-only unions
with no runtime representation, the spec forbids restating them inside the vectors module or the
corpus, and the runner may not touch the file system. Resolved with a required
`contract: ContractSurface` argument derived by a pure parse of the contract's own source, bound to
reality two ways — against the exported `OPERATION_KINDS` *value*, and against exhaustive
`Record<Union, true>` literals the compiler rejects if a member is missing or invented.

## What T4 does not claim

- **Not T1's engine semantics** — atomicity, invocation ordering, save-failure atomicity, dry-run
  purity, placement policy. The vectors exercise them; T1's requirements own them.
- **Not T2's Draft semantics.** The scenario opens no Draft (LEAD ruling, recorded in `design.md`).
- **Not T3's ground** — UI commit routing, interleaved UI/automation revision ordering, routed
  undo/redo, duplicate/stale legacy-save suppression.
- **Asset metadata only**, never attachment bytes — asserted per run.
- **Not a package export.** "Published" means committed, versioned, digest-manifested and consumable
  from a checkout. An export path is downstream work (LEAD ruling).

## Deferred task

**8.7 — regenerate `SOURCE_INVENTORY.{md,json}`.** Deliberately not done before the commit. The
generator inventories **tracked** files only, so regenerating first yields an inventory containing
**zero** T4 files while folding in unrelated pre-T4 drift — the committed inventory is already stale
at HEAD and does not list `app/surface-evidence/page.tsx` or `contracts/domain.ts`. It was run, the
diff read, and reverted. **Regenerate after the ship commit.**

## Parity

**27 / 18 / 9** against the 08-12 cycle's 29 / 20 / 9 and R2's final 28 / 19 / 9.

All 18 semantic rows are inside the T3 idempotency envelope: 16 are the `key` and `fingerprint` of
the eight `__opencutTransaction.idempotency` entries, which carry per-run UUIDs, and 2 are
`createdIds` ordinal positions. **Zero semantic rows outside that envelope.** The whole movement
from 20 to 18 is in the ordinal rows, which have now run 2, 3, 3, 4, 4, 3, 4, 2 across pairings with
no source, build or host change explaining it. The nine incidental rows are the documented
zoom/one-frame set. The mechanism and its remaining blind spot — the one-frame rule matches on
value, not on cause — are documented in the archived R2 change's `parity-nondeterminism-control.md`;
T4 adds no new parity claim.
