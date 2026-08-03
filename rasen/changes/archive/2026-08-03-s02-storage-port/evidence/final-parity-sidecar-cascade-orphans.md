# C5 final parity sidecar repair - Phase 4 cascade/orphan reconciliation

Date: 2026-08-02 +08:00  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
Branch: `feat/s02-storage-port`  
Status: author implementation evidence; Phase 3 independent re-review was CLEAN

## Scope

Phase 4 replaces the temporary Phase 3 rule that skipped every media database
containing an attachment authority row. Project save/remove/projects-clear/all-clear
public-authority atomic transactions remain unchanged. No migration/recovery product
logic, historical migration, public port, Host/consumer, parity oracle, Rust/WASM,
task state, or run state was edited.

The agreed test seam is the external `BrowserProjectStore` plus the existing real
Chromium disposable IndexedDB/OPFS probe seam. All test identities are randomized,
prefix-validated, and cleaned in `finally`.

## RED

The first vertical slice seeded one media database containing:

- a current live sidecar with exact body key `.c5-body-current-live`;
- an old inline live envelope with exact body key `.c5-stage-inline-live`;
- a C4 raw row whose key/body key is `.c5-body-raw-live`;
- unreferenced `.c5-stage-*` and `.c5-body-*` candidates; and
- an unreferenced arbitrary provider filename.

Against the Phase 3 bridge, the focused Chromium test failed with exactly:

```text
orphanUnreferencedCandidatesDeletedAfterValidation: false
```

The three live bodies and arbitrary unknown file were already preserved. This
isolated the bridge's leak-safe early exit from live-set compatibility.

The second vertical slice seeded authenticated two-key `retiredBodyKeys` on one
live authority and one deletion authority, injected one cleanup failure for each,
and reopened twice. Before retired-intent implementation, Chromium failed with:

```text
orphanLiveRetiredIntentShrinksOnReopen: false
orphanDeletionRetiredIntentShrinksOnReopen: false
orphanRetiredIntentRetryConverges: false
```

No product code was changed before each corresponding RED was captured.

## GREEN algorithm

Initialization now performs orphan reconciliation in four ordered stages:

1. Inventory every media database and obtain/register the existing whole-media
   topology permit for every target. No attachment pair store or OPFS directory is
   opened before this complete permit pass.
2. For each permitted database, read the complete public/authority key union in one
   pair-list operation. Decode every pair before accepting that database. Current
   live sidecars, old inline live envelopes, and raw rows contribute their exact
   body key to one complete live set. Current live/deletion authorities also
   contribute authenticated cleanup intent.
3. Build every valid database's OPFS file inventory and immutable reconciliation
   plan. A malformed, authority-only, or mismatched current pair records a logical
   `corrupt` diagnostic and creates no deletion plan for that database. Planning
   continues for independently valid databases. No physical deletion occurs until
   the entire media inventory has been permitted and planned.
4. Execute only validated plans. Delete unreferenced `.c5-stage-*` / `.c5-body-*`
   candidates after subtracting the complete live set. Delete an arbitrary filename
   only when it appears in authenticated `retiredBodyKeys`, again after subtracting
   the live set. Shrink live/deletion intent, or retire an empty deletion tombstone,
   only through the existing exact expected-authority CAS.

The CAS compares the complete authority record, including `mutationId`, and checks
live/public-present versus deletion/public-absent state. A later same-key save
therefore wins over stale cleanup. A deletion tombstone remains logical absence
while physical cleanup is incomplete.

## Data-loss invariants proved in Chromium

- Current sidecar, inline envelope, and raw legacy generations all contribute the
  exact body key to one live set.
- A valid live body beginning with either internal prefix is preserved.
- Prefix candidates are deleted only after the entire pair union decodes.
- Unknown arbitrary files are untouched unless authenticated by retired intent.
- Live and deletion retired intent retries after reload, shrinks after partial
  success, and converges on the next reload.
- Complete expected-authority/mutation CAS prevents stale cleanup from replacing or
  deleting a later same-key save.
- A deletion tombstone remains absent through cleanup failure and retires only after
  cleanup succeeds.
- Malformed, authority-only, and mismatched current pairs each cause zero deletion
  in their own database and emit fixed-shape mechanism-neutral `corrupt`
  diagnostics.
- Those invalid databases do not block cleanup in an independently valid database.
- Legacy-only behavior remains compatible: a raw stage-prefixed live key survives,
  an unreferenced body candidate is removed, and an arbitrary legacy file survives.
- The residual result has an explicit fixed count of 42 boolean fields.

## Focused browser verification

```text
bun x playwright test --config=playwright.c5-storage.config.ts browser-store.pw.ts --grep=Phase.3.ordinary
exit 0 - 1 passed (19.6s); test body 15.5s

bun x playwright test --config=playwright.c5-storage.config.ts browser-store.pw.ts --grep=Phase.4.orphan
exit 0 - 1 passed (18.5s); test body 14.2s
```

Both runs use the shared browser-store matrix and finish with empty randomized
disposable database/directory inventories.

## Focused unit/static verification

```text
bun test apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts
exit 0 - 10 pass / 0 fail / 72 expect() calls

bun test apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts
exit 0 - 1 pass / 0 fail

bun test apps/web/src/editor/ports/__tests__/conformance.test.ts apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts apps/web/src/media/__tests__/persistence.test.ts
exit 0 - 32 pass / 0 fail / 184 expect() calls

bun test apps/web/src/services/storage/migrations/__tests__/v1-to-v2.test.ts apps/web/src/services/storage/__tests__/migration-provider-private.test.ts
exit 0 - 19 pass / 0 fail / 46 expect() calls
```

The four topology files ran in separate Bun processes and remained green:

```text
browser-project-store-topology.test.ts           12 pass / 64 expects
browser-project-store-media-topology.test.ts      7 pass / 74 expects
browser-project-store-cascade-topology.test.ts    7 pass / 48 expects
browser-project-store-migration-topology.test.ts  9 pass / 37 expects
```

Static gates:

```text
node script/check-type-baseline.mjs
exit 0 - exactly 3 pinned diagnostics; no new identity

node script/check-storage-boundary.mjs
exit 0 - 723 modules; zero unexpected mechanism/singleton/fallback hits

bun x eslint <Phase 4 product/probe paths>
exit 0 - no errors; missing-pages notice only

bun x prettier --check <Phase 4 product/probe/harness/spec paths>
exit 0 - all matched

git diff --check
exit 0
```

## Complete C5 residual is exactly Phase 5

The unweakened complete-browser selector was run after Phase 4:

```text
bun x playwright test --config=playwright.c5-storage.config.ts browser-store.pw.ts --grep=BrowserProjectStore.passes.the.complete.shared.matrix
exit 1 - 1 failed (20.9s); test body 13.8s
```

It failed at the existing migration-round-2 assertion with exactly five false
Phase 5 fields and no Phase 4/cascade/orphan delta:

```text
malformedPreRecoveryTombstoneRejects
originalProjectLaterRemoveWins
originalProjectLaterSaveWins
stagedProjectLaterRemoveWins
stagedProjectLaterSaveWins
```

Phase 5 still owns migration destination pair commits and pair-aware recovery
precedence. Phase 4 does not claim those fields green.

## Files changed by Phase 4

Product:

- `apps/web/src/services/storage/browser-project-store.ts`

Existing probes/harness/spec:

- `apps/web/src/services/storage/browser-project-store-residual-probes.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`

Evidence:

- `evidence/final-parity-sidecar-cascade-orphans.md`

No commit was created. This is author evidence and does not substitute for an
independent Phase 4 review.
