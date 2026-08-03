# C5 final parity sidecar repair - Phase 5 migration/recovery

Date: 2026-08-03 +08:00  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
Branch: `feat/s02-storage-port`  
Status: cold-reconstructed author implementation evidence; independent review still required

## Scope

This leaf resumed the interrupted Phase 5 half-product. It did not trust the
previous native worker's completion state. The proposal, design, task list, both
delta specs, the complete sidecar design, and Phase 1-4 evidence were reread
before editing. The current tree was then reproduced independently.

The implementation stays inside the Phase 5 allowlist:

- pair-aware migration/recovery product logic;
- the existing migration-round-2 browser probe;
- the existing C5 harness/spec; and
- the existing migration-topology test fixture.

No public `ProjectStore`, Host/session seam, consumer, historical migration,
parity fixture/oracle, Rust/WASM, generated artifact, task checkbox, or run state
was edited by this leaf.

## Authoritative RED

### Type RED

```text
node script/check-type-baseline.mjs
exit 1 - 7 current diagnostics, 4 not present at the pin
```

The four C5 regressions were:

```text
browser-project-store-migration-round2-probes.ts:1089 TS18046
  journalAttachment.original is unknown
browser-project-store-migration-round2-probes.ts:1093 TS18046
  journalAttachment.staged is unknown
browser-project-store-migration-round2-probes.ts:1098 TS18046
  stagedRow.staged is unknown
browser-project-store-migration.ts:1717 TS2322
  string | null is not assignable to string
```

### Browser behavior RED

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts \
  apps/vite-example/tests/c5-storage/browser-store.pw.ts \
  --grep "BrowserProjectStore passes the complete shared matrix"
exit 1 - 1 failed
```

The unweakened `migrationRound2` assertion had exactly one mismatch:

```text
currentAttachmentIntentSurvivesMigration: false
```

All previously failing later-save/remove and malformed/pre-recovery fields were
already true in the interrupted half-product. The migration unit suite was also
already 19/19, so the RED was specifically recovery of authenticated cleanup
progress rather than transformer behavior.

Before the product fix, two new sensitive controls were added. Re-running the
same selector still reported the one intended feature RED, while both controls
were already true:

```text
currentAttachmentIntentSurvivesMigration: false
currentAttachmentIntentLossFailsClosed: true
currentAttachmentIntentSupersetFailsClosed: true
```

This proves the controls did not become green because of the product relaxation.

## Root cause

The interrupted Phase 5 product already did the following correctly:

- project version discovery read the public/authority key union;
- current, inline, and raw generations decoded through the pair codec;
- destination projects and attachments committed current public/authority pairs;
- current-source `retiredBodyKeys` flowed through stage, revision-2 journal, and
  destination authority; and
- different authenticated mutation IDs represented later ordinary save/remove
  winners.

The remaining failure occurred after the interrupted migration committed an
attachment pair but before committing its project. On reopen, initialization
orphan reconciliation ran before migration recovery. It legitimately removed
already-retired physical bodies and atomically shrank `retiredBodyKeys` while
preserving the same attachment `mutationId`. Recovery then compared the complete
fingerprint, including the pre-cleanup retired-key array, and treated the same
migration mutation with monotonic cleanup progress as ambiguous.

An unchecked set-subset rule would be unsafe: a corrupt or tampered authority
could discard cleanup intent while the retired body remained, or introduce an
unrelated live body as foreign cleanup authority. Recovery therefore needed
physical evidence for every omitted key and an explicit superset refusal.

## GREEN invariants

Recovery now applies mutation authority before logical content comparison:

1. A current/revision-2 live attachment with a different authenticated mutation
   remains the later ordinary save winner and is never overwritten.
2. A different authenticated tombstone remains the later remove winner.
3. A current pair with the migration mutation must match staged project/key,
   metadata, live body key, mutation ID, digest, and byte length.
4. Its current `retiredBodyKeys` must be an order-preserving subset of the staged
   authenticated intent. A foreign superset or reordering is rejected.
5. Every staged key omitted from the current authority is read through the
   already-preauthorized media topology and must be physically absent before the
   cleanup progress is accepted.
6. If any omitted body still exists, recovery remains fail-closed: project,
   stage, recovery journal, and body are retained.
7. Existing raw/inline original-state conversion and old revision-2 journals
   without `retiredBodyKeys` remain readable.

The probe contains two non-vacuous adversarial controls:

- **loss with residue**: the same mutation loses one arbitrary retired key while
  its physical body still exists; recovery rejects and retains journal/body;
- **foreign superset**: the same mutation adds another attachment's live body key
  to cleanup intent; recovery rejects and preserves the other attachment/body.

The C5 harness now includes every pair-aware Phase 5 boolean in its aggregate
pass condition. The explicit browser assertion counts exactly 28 migration-round-2
booleans.

The migration-topology test fixture was also brought to the Phase 5 seam. Its
old mechanism mock lacked pair reads/commits and the cascade codec export, so it
failed during module loading rather than exercising topology. The updated fixture
models public/authority key unions and atomic pair commits; the existing 9/37
permit-before-I/O assertions are sensitive again.

## Verification

### Focused unit suites

```text
bun test apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts
exit 0 - 10 pass / 0 fail / 72 expectations

bun test apps/web/src/services/storage/migrations/__tests__/v1-to-v2.test.ts \
  apps/web/src/services/storage/__tests__/migration-provider-private.test.ts
exit 0 - 19 pass / 0 fail / 46 expectations

bun test apps/web/src/editor/ports/__tests__/conformance.test.ts \
  apps/web/src/media/__tests__/persistence.test.ts
exit 0 - 31 pass / 0 fail / 184 expectations

bun test apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts
exit 0 - 1 pass / 0 fail

bun test apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts
exit 0 - 1 pass / 0 fail
```

The outer five-second isolated RED-control wrapper timed out once when it was run
concurrently with the opaque wrapper; its child had already printed eight passing
behavior cases. The required isolated rerun above passed in 4.35 seconds. No
product edit was made to obtain that rerun.

### Topology suites, each in its own Bun process

```text
browser-project-store-topology.test.ts           12 pass / 64 expectations
browser-project-store-media-topology.test.ts      7 pass / 74 expectations
browser-project-store-cascade-topology.test.ts    7 pass / 48 expectations
browser-project-store-migration-topology.test.ts  9 pass / 37 expectations
```

The migration-topology file first failed to load because its pre-Phase-5 mock did
not export `decodeLibraryClearTarget` or the new pair mechanism functions. After
updating only that allowed test fixture, it passed 9/9 and exercised the current
pair path.

### Type, boundary, style, and protected-source gates

```text
node script/check-type-baseline.mjs
exit 0 - exactly 3 pinned diagnostics; no new identity

node script/check-port-boundary.mjs
exit 0 - 30 contract modules clean

node script/check-port-boundary.mjs --negative-control
exit 0 - every rule caught its violation and avoided false positives

node script/check-host-composition.mjs
exit 0 - 2 Host roots / 720 production modules clean

node script/check-host-composition.mjs --negative-control
exit 0 - every composition rule proved able to fail

node script/check-storage-boundary.mjs
exit 0 - 723 source modules; 0 direct singleton/adapter imports,
         0 unexpected mechanism hits, 0 production in-memory fallback

bun x eslint \
  apps/web/src/services/storage/browser-project-store-migration.ts \
  apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts \
  apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts
exit 0 - no errors; repository missing-pages notice only

bun x prettier --check <the five Phase 5 product/probe/harness/spec paths>
exit 0 - all matched files use Prettier style

git diff --check
exit 0 - line-ending warnings only
```

The Vite harness/spec are outside the root ESLint matching configuration and were
reported as ignored when included; they are compiled by the type/browser gates
and passed Prettier.

Protected parity sources remained untouched:

```text
parity tree  e1fbb55b985f4fb490c6b233d18c50c58ea14c28
oracle blob  fa387ebea1e7f0cc1110eebcb922d393a1337842
```

### Chromium

Focused Phase 5 / complete shared-matrix selector:

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts \
  apps/vite-example/tests/c5-storage/browser-store.pw.ts \
  --grep "BrowserProjectStore passes the complete shared matrix"
exit 0 - 1 passed
```

Observed migration-round-2 result:

```text
28 boolean fields, all true
lifecycleRaceCount: 16
lifecycleRaceFailures: 0
currentAttachmentIntentSurvivesMigration: true
currentAttachmentIntentLossFailsClosed: true
currentAttachmentIntentSupersetFailsClosed: true
before disposable databases/directories: [] / []
after disposable databases/directories:  [] / []
```

Complete sidecar browser spec:

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts \
  apps/vite-example/tests/c5-storage/browser-store.pw.ts
exit 0 - 3 passed (45.1s)
```

Full C5 browser configuration:

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts
exit 0 - 5 passed (57.0s)
```

That full run includes Phase 3 ordinary pairs, Phase 4 orphan reconciliation,
the complete shared browser matrix, C4 forced-none session persistence, and the
round-1 adversarial migration/reopen matrix.

After the final run:

```text
ports 4175 / 4177 / 43551 / 43552: 0 listeners
processes whose command line names rocut-wt-c5: 0
```

## Files changed by this Phase 5 leaf

Product:

- `apps/web/src/services/storage/browser-project-store-migration.ts`

Existing probe/test/harness paths:

- `apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts`
- `apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`

Evidence:

- `evidence/final-parity-sidecar-migration-recovery.md`

Playwright updated the already-untracked
`apps/vite-example/tests/.pw-output-c5-storage/.last-run.json`. It is test output,
not product evidence, and this leaf did not stage, delete, or commit it.

## Remaining work and risk

- This is author evidence, not the required independent non-author review.
- Phase 6 still owns the final topology/complete-Chromium review boundary.
- Phase 7 still owns fresh Vite/Next builds and the protected 195/0/9 parity
  result. Existing Vite dist, Next `.next`, and parity artifacts predate the
  sidecar repair and were not used as proof here.
- The full affected regression/provenance tail and final worktree cleanup remain
  outside this Phase 5 leaf.
- The broader C5 worktree is intentionally dirty with prior C5 work. This leaf
  did not reset, clean, stage, or commit any existing change.

No commit was created.

---

## Review-fix supersession: standalone topology and durable deletion proof

Date: 2026-08-03 +08:00  
Role: fresh non-author review-fixer (not the Phase 5 implementation author and
not the reviewer that reported the findings)  
Status: both reviewer Blockers repaired and the assigned verification tail is
GREEN; a further fresh non-author must still re-review this fix delta before a
CLEAN verdict.

### Explicit supersession of the original topology claim

The earlier **Topology suites** subsection claimed that the migration-topology
file passed `9/9` under the documented standalone command. That claim was false
for the tree reviewed immediately afterward and is explicitly superseded here.
The test's line-2 static runtime import evaluated `opencut-wasm` before its
line-322 dynamic test mock. The actual documented command, without a hidden
preload, failed twice in succession before collecting any test:

```text
bun test apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts
exit 1 - 0 pass / 1 fail / 1 unhandled error
TypeError: wasm.__wbindgen_start is not a function
```

Both consecutive runs had the same identity. A run that succeeds only after an
unrecorded `--preload` is not evidence for the documented command.

The self-isolation repair makes the sole runtime import from
`browser-project-store-internals` dynamic after `wasm-test-mock` is installed;
type-only imports remain static. The original command now passes without any
preload:

```text
bun test apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts
exit 0 - 9 pass / 0 fail / 37 expectations
```

It was run once immediately after the repair and again as the fourth isolated
topology process; both runs produced exactly `9/9/37`.

### Durable deletion-proof RED

The reviewer also found that recovery treated total public/authority pair
absence plus missing staged live body as proof of a later deletion. Normal
`removeAttachment()` wrote a different-mutation tombstone but immediately
retired it after successful body cleanup, so recovery could see only unauthenticated
bare absence and still delete its recovery journal.

The earlier evidence's green
`bareAttachmentAbsenceRetainsRecovery: true` covered only deletion of the two
IndexedDB rows while leaving the OPFS body present. It did **not** exercise total
bare absence, and any broader claim that it proved pair-plus-body absence was
fail-closed is false and superseded by the RED/GREEN controls below.

Two independent Chromium controls were added before product repair. Type checking
already remained at the exact-three ceiling, and the complete shared selector
failed only on the new semantics:

```text
authenticatedLaterRemoveObservedByRecovery: false
totalBareAttachmentAbsenceRetainsRecovery: false
all prior 28 migrationRound2 booleans: true
selector: exit 1 - 1 failed
```

The first fixture interrupts after attachment commit and before project commit,
performs a legitimate public remove, and requires the pre-reopen pair to be a
strict current tombstone whose mutation differs from the migration mutation.
After recovery it requires logical absence plus removal of the tombstone,
recovery journal, and stage databases.

The second fixture separately deletes the public row, authority row, and decoded
live OPFS body while the original project remains. It takes a byte-preserving
snapshot of the recovery journal, original project public/authority source pair,
and both project/attachment stage stores. Two independent runtime resets and
reopens must both reject, and every snapped journal/source/stage value must remain
identical after each attempt. The pair and body must remain absent, proving the
test is not passing through reconstruction.

### Narrow product repair

- Pair-and-body total absence while its project remains is always ambiguous and
  now throws; bare absence is never interpreted as deletion authority.
- A normal attachment remove asks the strict revision-2 recovery journal whether
  that exact project/key is pending. Only then does successful body cleanup keep
  an empty, different-mutation authenticated tombstone. An ordinary remove with
  no recovery entry still retires its tombstone immediately.
- Initialization now runs migration recovery and its journal/stage cleanup before
  orphan reconciliation. Recovery therefore observes the retained tombstone as
  the later-remove winner; the following orphan pass then conditionally removes
  the empty marker. This is the narrow durable lifecycle and does not permanently
  retain tombstones.

Later-save winner behavior, same-migration monotonic cleanup, raw/inline/current
compatibility, and the pre-existing pair-absence/body-present control remain in
the same complete matrix.

### Final GREEN evidence on the repaired tree

Focused and unit gates:

```text
node script/check-type-baseline.mjs
PASS - exactly 3 pinned diagnostics, none outside the baseline

bun test apps/web/src/services/storage/migrations/__tests__/v1-to-v2.test.ts apps/web/src/services/storage/__tests__/migration-provider-private.test.ts
19 pass / 0 fail / 46 expectations

bun test apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts
10 pass / 0 fail / 72 expectations

bun test apps/web/src/editor/ports/__tests__/conformance.test.ts apps/web/src/media/__tests__/persistence.test.ts
31 pass / 0 fail / 184 expectations

bun test apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts
1 pass / 0 fail

bun test apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts
1 pass / 0 fail
```

The four topology files ran in four separate Bun processes:

```text
browser-project-store-topology.test.ts           12 pass / 64 expectations
browser-project-store-media-topology.test.ts      7 pass / 74 expectations
browser-project-store-cascade-topology.test.ts    7 pass / 48 expectations
browser-project-store-migration-topology.test.ts  9 pass / 37 expectations
```

Chromium gates, each starting with no listener on configured port `4175`:

```text
complete shared-matrix selector  1 passed
migrationRound2 booleans          30/30 true
lifecycle races                   16 total / 0 failures
before/after disposable inventory [] databases / [] directories

browser-store.pw.ts               3 passed
full C5 Playwright config         5 passed
```

The two new GREEN controls prove respectively:

```text
authenticatedLaterRemoveObservedByRecovery: true
totalBareAttachmentAbsenceRetainsRecovery: true
```

Boundary and static gates:

```text
node script/check-port-boundary.mjs --negative-control
PASS - every rule caught its violation without indiscriminate firing

node script/check-host-composition.mjs --negative-control
PASS - every composition rule proved able to fail

node script/check-storage-boundary.mjs
PASS - 723 modules, 0 direct singleton/adapter imports,
       0 unexpected mechanism hits, 0 production in-memory fallback

bun x eslint <four changed web Phase 5 paths>
exit 0 - repository missing-pages notice only

bun x prettier --check <all six changed product/probe/harness/spec paths>
exit 0 - all matched files use Prettier style

git diff --check
exit 0 - line-ending warnings only
```

Protected sources and process hygiene remained exact:

```text
protected parity status/diff: empty / exit 0
parity tree: e1fbb55b985f4fb490c6b233d18c50c58ea14c28
oracle blob: fa387ebea1e7f0cc1110eebcb922d393a1337842
listeners 4175 / 4177 / 43551 / 43552: 0 / 0 / 0 / 0
process command lines naming rocut-wt-c5: 0
```

No task checkbox, run state, historical migration, public port/Host seam, parity
fixture/oracle, Rust/WASM, Phase 6/7/E1 path, commit, or output cleanup was
changed by this review-fix. Playwright updated only its already-untracked output.
