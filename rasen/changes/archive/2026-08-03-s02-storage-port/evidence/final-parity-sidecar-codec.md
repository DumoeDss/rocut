# C5 final parity sidecar repair — Phases 1–2 codec evidence

Date: 2026-08-02 +08:00  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
Branch: `feat/s02-storage-port`  
Scope: final parity repair design Phases 1–2 only

This evidence covers the pure current/legacy record codec and derived private
store names. It does not claim that `BrowserProjectStore` uses the new pair
format yet, and it does not replace the blocked final regression evidence.

## RED record-format contract

The first direct invocation exposed the inherited Bun/WASM loader defect before
any contract test ran:

```text
bun test apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts
exit 1 — 0 pass / 1 fail / 1 unhandled error
TypeError: wasm.__wbindgen_start is not a function
```

That output was not accepted as the codec RED. The test was isolated through the
existing `wasm-test-mock` before dynamically importing the storage modules; no
product file was changed for this isolation. The authoritative pre-product RED
was then:

```text
bun test apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts
exit 1 — 0 pass / 9 fail / 9 expect() calls
```

The nine named failures were:

1. derived private authority store names;
2. exact ordinary C4 project public row with no duplicated document;
3. own-root-id and non-projectable opaque reconstruction;
4. exact C4 media projection plus complete private logical metadata;
5. generic attachment metadata with an id-only public row;
6. current sidecar precedence over provider-owned envelope-looking fields;
7. absent-sidecar fallback to inline C5 and then C4 raw rows;
8. malformed/mismatched/incomplete pair fail-closed behavior; and
9. strict current deletion authority-only tombstones.

Each failure identified the not-yet-implemented current pair/private-name
function. Product implementation began only after this output was captured.

## GREEN implementation and focused tests

The implemented pure interface is:

- `projectAuthorityStoreName(projectsStore)` →
  `${projectsStore}-project-authority`;
- `attachmentAuthorityStoreName(mediaStore)` →
  `${mediaStore}-attachment-authority`;
- `createCurrentStoredProject({ record, summary })`;
- `decodeStoredProjectPair({ publicRow, authorityRow })`;
- `createCurrentStoredAttachment(...)`;
- `createCurrentStoredAttachmentTombstone(...)`;
- `decodeStoredAttachmentPair({ projectId, publicRow, authorityRow })`; and
- `CurrentStoredRecordPair`, carrying one public row (or `null` for a deletion)
  and one private authority row.

Project authority revision 1 is compact for ordinary plain records: it carries
identity, schema version, summary, and root-id reconstruction state, but not a
second copy of the normal project document. Non-projectable opaque values use the
fallback authority payload. Attachment authority revision 1 carries the complete
logical metadata and body authority. Decoded current attachments report
`revision: "current"`; legacy raw and old inline revision-1/revision-2 decoding
remain readable through the pre-existing compatibility functions.

The exact normal media public projector writes `size` from `byteLength`, omits
`mimeType`, `fps`, `hasAudio`, body authority, and implementation envelopes, and
uses `{ id: key }` for metadata that cannot conservatively be recognized as a C4
media record. Current sidecars take precedence over envelope-looking provider
data. Authority shapes, identities, pair presence, public attachment projections,
digests, lengths, and tombstones are strict-decoded; mismatches return `null`.
Inputs and decoded outputs are structured-clone isolated.

The first GREEN invocation hit one transient Bun 1.2.2 process segmentation
fault before producing test output. Re-running the identical command immediately
passed 9/9. No source change was made between the crash and the passing rerun.
After adding the defensive-clone and write-identity assertions, the final result
was:

```text
bun test apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts
exit 0 — 10 pass / 0 fail / 70 expect() calls
```

Affected compatibility tests:

```text
bun test apps/web/src/editor/ports/__tests__/conformance.test.ts apps/web/src/media/__tests__/persistence.test.ts
exit 0 — 31 pass / 0 fail / 184 expect() calls

bun test apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts
exit 0 — 1 pass / 0 fail

bun test apps/web/src/services/storage/migrations/__tests__/v1-to-v2.test.ts apps/web/src/services/storage/__tests__/migration-provider-private.test.ts
exit 0 — 19 pass / 0 fail / 46 expect() calls
```

For completeness, the requested three-file conformance/opaque/media command was
also tried first. Its conformance and media assertions passed, but the opaque
test's outer five-second `Bun.spawnSync` wrapper timed out under the combined
load: 31 pass / 1 wrapper fail / 1 wrapper error. Running that intentionally
isolated test alone completed in 2.80 seconds and passed 1/1 as recorded above.
This was resource contention in the isolation wrapper, not a codec assertion
failure.

## Static gates and scope checks

```text
node script/check-type-baseline.mjs
exit 0 — exactly 3 current diagnostics, all inside the pinned baseline set;
         no new diagnostic identity

bun x eslint apps/web/src/services/storage/browser-project-store-internals.ts apps/web/src/services/storage/browser-project-store-records.ts apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts
exit 0 — 0 errors (the repo-level missing-pages configuration notice is informational)

bun x prettier --check apps/web/src/services/storage/browser-project-store-internals.ts apps/web/src/services/storage/browser-project-store-records.ts apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts
exit 0 — all matched files use Prettier style

git diff --check
exit 0
```

A focused `rg` over the three touched product/test paths found no IndexedDB,
OPFS, file-system, or idb-helper call. Historical migration files were read but
not edited. No browser, build, full-suite, parity, mechanism, cascade, migration
or topology test was run or changed in this phase.

## Files changed in Phases 1–2

- `apps/web/src/services/storage/browser-project-store-internals.ts`
  - adds the two derived private store-name functions only;
- `apps/web/src/services/storage/browser-project-store-records.ts`
  - adds pure project/attachment pair encoding, strict current decoding,
    conservative C4 media projection, tombstone support, and three-generation
    fallback while preserving all old inline/raw APIs;
- `apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts`
  - adds the focused record-format contract; and
- this evidence file.

No task checkbox, run state, canonical review/proposal/design/spec/documentation,
public port, Host, consumer, parity fixture/oracle, mechanism, cascade, migration,
Rust/WASM, or generated artifact was edited.

## Phase 3 handoff and residual work

Phase 3 can consume `CurrentStoredRecordPair` directly in purpose-specific
IndexedDB helpers. It still must:

1. create/open the derived project and attachment authority stores through the
   existing database upgrade path;
2. add readonly pair reads/lists and atomic readwrite pair commits/deletes;
3. rewire ordinary project/attachment operations to the new codec without
   changing `ProjectStore`, Host/session, queue, staging, cancellation, topology,
   or post-commit cleanup semantics; and
4. add real failure-injection and browser raw-row tests proving no half-pair can
   become visible.

`createStoredProject`, `createStoredAttachment`, and their current callers still
write old inline C5 envelopes. That is intentional at the end of Phase 2: old
stage/migration compatibility and ordinary store wiring have not been changed.
Cascade/orphan repair, migration/recovery adaptation, topology reservation,
complete Chromium, protected parity, and the affected regression tail remain
Phases 4–7.

## Preserved outputs and processes

The retained verification artifacts were not staged, deleted, regenerated, or
timestamp-mutated by this phase:

- `apps/vite-example/dist-c5-final-20260802-155342` — last write remains
  `2026-08-02T16:02:46.0514009+08:00`;
- `apps/web/.next` — last write remains
  `2026-08-02T16:11:26.3895725+08:00`; and
- `apps/vite-example/tests/parity-artifacts` — last write remains
  `2026-08-02T16:28:40.3609860+08:00`.

Ports 4175, 4177, 43551, and 43552 each had zero listeners after verification.
The final Win32 process inventory contained zero command lines referring to the
C5 worktree.
