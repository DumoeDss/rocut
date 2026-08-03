# C5 final parity sidecar repair — Phase 3 ordinary pairs

Date: 2026-08-02 +08:00  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
Branch: `feat/s02-storage-port`  
Scope: final parity sidecar design Phase 3, plus the explicitly approved minimum
project-transaction slices pulled forward from Phase 4

This evidence follows `final-parity-sidecar-codec.md`. It covers purpose-specific
IndexedDB pair mechanisms, ordinary project/attachment operations, raw physical
layout probes, and the project public/authority transaction axis required for
shared-store coherence. It does not claim migration/recovery or complete orphan
reconciliation is repaired.

## RED

The authoritative browser RED was run before product pair wiring:

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts
exit 1 — 1 failed
```

The new physical probe reported exactly five false results:

```text
projectPairCommitIsAtomic: false
attachmentPairCommitIsAtomic: false
exactCurrentPublicRows: false
authorityStateIsPrivate: false
legacyRowsConvertOnNormalSave: false
```

`legacyRowsReadWithoutRewrite` and
`providerOwnedEnvelopeFieldsSurvive` were already true. Thus the RED separated
the missing physical/transaction conversion from compatibility behavior that
must remain intact.

During GREEN, complete-browser execution exposed three real cross-phase boundary
failures rather than test noise:

1. project remove deleted only the public row and left an authority-only half;
2. projects/all clear cleared only public rows and left authority-only halves;
3. the legacy orphan scanner interpreted a current C4 public media row as a
   legacy `bodyKey === key` row and deleted the live `.c5-body-*` after reopen.

The LEAD explicitly approved pulling the complete project transaction authority
axis into this phase. Remove now performs public delete + authority delete +
cascade tombstone put atomically. Projects clear and all clear now clear public +
authority + maintenance atomically; the same-PDB library-binding variant includes
all four stores in the same transaction. Failure injection against the
maintenance put proves rollback leaves both project halves unchanged.

The orphan finding was handled only by an approved fail-closed bridge: after the
existing media topology permit, any row in the attachment-authority store causes
zero orphan deletion for that media database. Legacy-only scanning is unchanged.
This is intentionally leak-safe temporary behavior, not completed Phase 4 orphan
reconciliation.

## GREEN implementation

`browser-storage-mechanisms.ts` now provides purpose-specific helpers for:

- one/all project public-authority pairs;
- one/all attachment public-authority pairs;
- atomic project save/remove/clear/all-clear transactions;
- atomic attachment live commit and public-delete/deletion-authority commit; and
- conditional attachment cleanup-authority resolution.

Pair lists expose the union of public and authority keys, including each raw key,
so callers can distinguish absence from a malformed public-only or authority-only
half. Reads use one readonly transaction and commits use one readwrite
transaction. Synchronous request failure explicitly aborts before awaiting the
transaction outcome.

Ordinary `BrowserProjectStore` project list/load/save and attachment
list/load/save/remove now use the current pair codecs. Raw and old inline rows are
read without rewrite and convert only on a later normal save. Current sidecars
take precedence over provider-owned `__opencut*` fields. Current attachment body
length/digest is verified on read.

The attachment authority amendment adds authenticated `retiredBodyKeys` to live
and deletion authorities. Newly written rows always carry it; already-created
revision-1 authority rows without the field decode as an empty list. Duplicate,
empty, non-string, or live-current-key entries fail closed. Replace/delete commits
the previous current and pending retired keys atomically before cleanup, including
arbitrary legacy/inline names. Successful cleanup resolves intent through an
exact-current-authority compare-and-swap; stale cleanup cannot erase or overwrite
a same-key later save. Failed cleanup retains the remaining authenticated keys for
the next ordinary mutation or Phase 4 reconciliation.

Final abort checks occur immediately before pair transactions, after awaited
topology/control work. Media authority is never inspected or opened before the
existing whole-media-database permit. Project authority is part of the static
reserved project-store pairs.

## Browser proof

The final Phase 3 focused gate uses the real Chromium C5 harness, the shared
browser store matrix, raw IndexedDB rows, real OPFS bodies, and disposable
inventories:

```text
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts --grep "Phase 3 ordinary"
exit 0 — 1 passed (31.1s); test body 20.2s
```

It proves:

- project save, project remove, projects clear, and all clear cannot publish a
  public/authority half when authority or maintenance put fails;
- successful remove/clear leaves neither project half;
- attachment metadata/body remains all-or-previous on authority put failure;
- current project/media public rows are exact C4 projections and body/logical
  authority exists only in the derived stores;
- raw and inline project/attachment generations remain readable, do not rewrite
  on read, and convert on later normal save;
- provider-owned envelope-looking fields survive;
- arbitrary retired legacy body keys survive cleanup failure and converge through
  another already-open wrapper;
- stale cleanup intent cannot erase a later same-key save;
- deletion cleanup failure remains logically deleted and converges on retry;
- reopen preserves current live bodies; malformed authority causes zero orphan
  deletion under the temporary fail-closed bridge; and
- disposable database/directory inventories are empty before and after.

The unchanged complete C5 test was also run after ordinary/cascade/orphan safety
repairs. It now reaches the migration result assertions and has exactly five false
Phase 5 fields:

```text
malformedPreRecoveryTombstoneRejects
originalProjectLaterRemoveWins
originalProjectLaterSaveWins
stagedProjectLaterRemoveWins
stagedProjectLaterSaveWins
```

No ordinary-pair, cascade-half, or orphan-deletion exception remains before that
assertion. Complete C5 is deliberately not claimed green until Phase 5 adapts
migration destination/recovery comparison to logical pairs.

## Focused/static verification

```text
bun test apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts
exit 0 — 10 pass / 0 fail / 72 expect() calls

bun test apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts
exit 0 — 1 pass / 0 fail

bun test apps/web/src/editor/ports/__tests__/conformance.test.ts apps/web/src/media/__tests__/persistence.test.ts
exit 0 — 31 pass / 0 fail / 184 expect() calls

bun test apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts
exit 0 — 1 pass / 0 fail

bun test apps/web/src/services/storage/migrations/__tests__/v1-to-v2.test.ts apps/web/src/services/storage/__tests__/migration-provider-private.test.ts
exit 0 — 19 pass / 0 fail / 46 expect() calls
```

Topology tests were run as separate Bun processes:

```text
browser-project-store-topology.test.ts           12 pass / 64 expects
browser-project-store-media-topology.test.ts      7 pass / 74 expects
browser-project-store-cascade-topology.test.ts    7 pass / 48 expects
browser-project-store-migration-topology.test.ts  9 pass / 37 expects
```

The direct topology test was changed to load the existing WASM test mock before
its runtime topology import. This removes the inherited
`wasm.__wbindgen_start is not a function` loader failure; no product behavior is
mocked by that adjustment. The cascade topology mechanism mock now exposes the
new pair-list and authority transaction arguments.

```text
node script/check-type-baseline.mjs
exit 0 — exactly 3 current diagnostics, all pinned; no new identity

node script/check-storage-boundary.mjs
exit 0 — one ProjectStore role, zero unexpected mechanism hits, no fallback

bun x eslint <Phase 1-3 changed web storage/test paths>
exit 0 — no errors (missing-pages notice informational)

bun x prettier --check <Phase 1-3 changed paths>
exit 0 — all matched

git diff --check
exit 0
```

Ports 4175, 4177, 43551, and 43552 each had zero listeners after verification;
the final process inventory had zero command lines referring to the C5 worktree.

## Independent review refix (2026-08-02)

The independent Phase 3 review returned **NO-GO** with one major and two minor
findings. This section records the bounded refix; it does not claim independent
closure or replace the reviewer's required re-review.

### Review findings and RED

The major finding was a cancellation gap inside the purpose-specific commit
helpers. Callers checked `AbortSignal` before entering the helper, but each helper
then awaited database open/upgrade before creating its transaction. A cancellation
in that interval could still publish a write. A deterministic physical seam now
attaches to the matching `IDBFactory.open()` success event, aborts after
open/upgrade has resolved, and verifies both typed rejection and byte/row-equivalent
pre-commit state for all six paths:

- project save;
- project remove;
- projects clear;
- all clear with the library binding transaction;
- attachment save; and
- attachment remove.

The second finding was deletion-tombstone partial cleanup. When one of two retired
body removals succeeded and one failed, the compare-and-swap incorrectly required
a public row whenever the replacement authority was non-null. Deletion authority
has no public row, so the authenticated retry intent could not shrink.

The third finding requested an explicit sensitive authority-only live-half
regression at the external `BrowserProjectStore` list/load seam. That read path was
already fail-closed through pair-union enumeration, but it previously lacked a
dedicated isolated control.

Before the product fix, the focused browser RED failed with exactly these new
false fields:

```text
postOpenProjectSaveAborted: false
postOpenProjectRemovalAborted: false
postOpenProjectsClearAborted: false
postOpenAllClearAborted: false
postOpenAttachmentSaveAborted: false
postOpenAttachmentRemovalAborted: false
partialDeletionCleanupShrinksIntent: false
```

`partialDeletionCleanupRetryConverges` was already true, while both isolated
authority-only list/load controls were true. This separated the missing commit
and tombstone behavior from the already-correct pair-union read behavior.

### Fix

Each purpose-specific pair commit helper now accepts the caller's signal and,
after `openDatabaseStores()` returns, synchronously calls
`throwIfBrowserStoreAborted()` immediately before `database.transaction(...)`.
There is no `await` or other scheduling point between that final check and
transaction creation. The signal is passed through project cascade save/remove/
clear/all-clear and direct attachment save/remove. Post-commit cancellation
semantics are unchanged.

Attachment cleanup CAS now derives the required public-row presence from the
exact expected authority kind: live attachment authority requires a public row;
deletion authority requires public absence whether the replacement is a smaller
tombstone or `null`. The existing exact structured equality check of the complete
expected authority remains in force, including its mutation ID. A two-key probe
proves the successfully removed key is deleted from `retiredBodyKeys`, the failed
key remains authenticated, and a later retry removes the remaining body and
authority tombstone.

The isolated authority-only live-half probe seeds a valid live authority/body
without its public row and proves both `BrowserProjectStore.listAttachments()`
and `loadAttachment()` return mechanism-neutral typed `corrupt` failures. Public-
key-only listing therefore cannot hide this malformed sensitive half.

### Refix verification

```text
bun x playwright test --config playwright.c5-storage.config.ts browser-store.pw.ts --grep "Phase 3 ordinary"
exit 0 - 1 passed (23.9s); test body 16.5s

bun test apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts
exit 0 - 10 pass / 0 fail / 72 expect() calls

bun test apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts
exit 0 - 1 pass / 0 fail

bun test apps/web/src/editor/ports/__tests__/conformance.test.ts apps/web/src/media/__tests__/persistence.test.ts
exit 0 - 31 pass / 0 fail / 184 expect() calls

bun test apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts
exit 0 - 1 pass / 0 fail

bun test apps/web/src/services/storage/migrations/__tests__/v1-to-v2.test.ts apps/web/src/services/storage/__tests__/migration-provider-private.test.ts
exit 0 - 19 pass / 0 fail / 46 expect() calls
```

Topology processes remained independently green at 12/64, 7/74, 7/48, and
9/37 (tests/expectations). `node script/check-type-baseline.mjs` remained exactly
three pinned diagnostics with no new identity. `node script/check-storage-boundary.mjs`
scanned 723 modules and remained clean. Focused ESLint had zero errors, focused
Prettier matched, and `git diff --check` exited zero.

This is implementation evidence only. The independent reviewer has not yet
re-reviewed this delta, so Phase 3 remains without independent closure until that
review occurs.

## Files and scope

Product files changed through Phases 1-3:

- `browser-project-store-internals.ts`
- `browser-project-store-records.ts`
- `browser-storage-mechanisms.ts`
- `browser-project-store.ts`
- `browser-project-store-cascade-manager.ts`
- `browser-project-store-topology.ts`

Existing probes/tests/harness changed only to expose the new raw layout and
failure results:

- `browser-project-store-residual-probes.ts`
- `browser-project-store-migration-round2-probes.ts` (test-only current tombstone
  tamper compatibility)
- `browser-project-store-records.test.ts`
- `browser-project-store-topology.test.ts`
- `browser-project-store-cascade-topology.test.ts`
- `c5-storage-harness.ts`
- `browser-store.pw.ts`

No public `ProjectStore`, Host/session seam, consumer persistence, historical
migration transformer, parity fixture/oracle, Rust/WASM, generated WASM, task
checkbox, run state, canonical review artifact, or unrelated document was edited.

## Residual Phase 4+

Phase 4 still owns full sidecar-aware orphan reconciliation. It must authenticate
the union of current sidecars, old inline envelopes, and raw rows; subtract the
complete live set before deleting either stage- or body-prefixed names; retry
retired body intent; and replace the temporary any-authority-row early exit.

Phase 5 still owns migration destination pair commits, pair-aware discovery and
recovery comparisons, and the five failing later-save/remove/malformed-tombstone
cases above. Phase 6 still owns the stronger schema/version pre-permit browser
matrix. Protected parity and the affected tail remain Phase 7.

Retained build/parity outputs were not regenerated or timestamp-mutated:

- Vite dist: `2026-08-02T16:02:46.0514009+08:00`
- Next `.next`: `2026-08-02T16:11:26.3895725+08:00`
- parity artifacts: `2026-08-02T16:28:40.3609860+08:00`
