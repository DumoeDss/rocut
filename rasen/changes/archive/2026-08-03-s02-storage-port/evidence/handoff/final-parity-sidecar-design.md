# C5 final parity repair: raw-row projection with private sidecars

## Purpose and ruling

The final C5 parity gate is blocked because the current browser adapter writes its
private `__opencutProjectStore` and `__opencutAttachmentStore` envelopes into the
same public IndexedDB rows that the C4 editor used. The protected parity reader is
intentionally reading those public stores. It now sees 408 leaves, 12 semantic
differences, and 15 incidental differences instead of the frozen C4 expectation of
195 leaves, zero semantic differences, and nine incidental differences.

The LEAD ruling is final:

- Repair the product persistence layout. Do not change, normalize, weaken, or add
  ignore rules to `apps/vite-example/tests/parity/**` or
  `script/diff-parity-snapshots.mjs`.
- Restore the exact ordinary C4 project and media row projections in the public
  stores.
- Move all C5-only record authority into private sidecar object stores.
- Keep the external `ProjectStore` interface and Host/session usage unchanged.
- Preserve portable conformance, provider-private round-trip, attachment
  all-or-previous semantics, old raw rows, old inline C5 envelopes, migration and
  recovery, and the attempt-4 topology policy.
- Use purpose-specific, internal IndexedDB pair transactions. Do not introduce a
  public/general storage-layout request union, a new external I/O port, or another
  Host storage seam.

This document is the implementation design. It does not declare the repair green.

## Intended module and seam

`BrowserProjectStore` remains the single production adapter at the existing
`ProjectStore` seam:

```text
ProjectStore (unchanged external interface)
    -> BrowserProjectStore
       -> private current/legacy record codec
       -> private purpose-specific IndexedDB pair transactions
       -> existing OPFS body mechanism
```

The browser record codec is an in-process module. IndexedDB and OPFS are
local-substitutable dependencies and continue to be verified with real browser
storage under randomized disposable identities. Neither internal seam is exposed
through `ProjectStore`, `EditorHost`, session creation, or a public browser layout
interface.

The deletion test for this module is positive: without it, every caller would need
to know C4 compatibility projection, three persisted generations, atomic pairing,
body-pointer commit rules, migration recovery, and topology order. All of that
complexity stays local to the browser adapter.

## Exact public row projections

### Project public row

For the normal OpenCut project payload, the public row in
`storageIdentity.projectsStore` is exactly the C4 projection:

```ts
{
  id: record.id,
  ...record.data,
}
```

The resulting ordinary row contains only the encoded project document plus the
IndexedDB key:

```text
id
metadata
scenes
currentSceneId
settings
version
timelineViewState (when present)
provider-private project fields (when present)
```

It does not contain `schemaVersion`, `summary`, `revision`, an authority pointer,
or any implementation-generated `__opencut*` field. The nested C4 metadata and
scene projections remain unchanged.

The normal OpenCut payload has no own root `id`; its logical identity is
`metadata.id`. A generic `ProjectStore` payload may have an own root `id`, may be a
non-record value, or may use an implementation-looking field name as legitimate
provider data. The private project sidecar handles these cases without changing
the common projection:

- Plain record without an own root `id`: public C4 row plus a compact normal-case
  sidecar. The project document is not duplicated in the sidecar.
- Plain record with an own root `id`: force the physical row key to `record.id` and
  record the original own-property presence/value in the sidecar. `load()` removes
  the physical key and restores the original opaque root `id` exactly.
- Array, primitive, `null`, or another non-projectable structured-clone value: the
  public row is `{ id: record.id }` and the fallback sidecar carries the complete
  opaque payload.

This fallback preserves generic conformance without making the ordinary project
save duplicate a potentially large timeline document.

### Media public row

For current OpenCut media metadata, the public row in
`storageIdentity.mediaStore` is exactly the C4 `MediaAssetData` projection:

```ts
{
  id: key,
  name: metadata.name,
  type: metadata.type,
  size: body.byteLength,
  lastModified: metadata.lastModified,
  width: metadata.width,
  height: metadata.height,
  duration: metadata.duration,
  thumbnailUrl: metadata.thumbnailUrl,
  ephemeral: metadata.ephemeral,
}
```

The projector must restore `size`; C5's current rewiring omitted it. It must omit
the C5-only flat derived fields `mimeType`, `fps`, and `hasAudio`. Those values are
still part of the logical attachment metadata returned through `ProjectStore`, but
they live only in the private attachment sidecar. Undefined optional C4 fields may
remain own properties as they were before JSON snapshotting; they do not produce
JSON leaves.

The public row must never contain `bodyKey`, `mutationId`, `bodyDigest`,
`byteLength`, a tombstone, or an implementation-generated
`__opencutAttachmentStore` field. Generic non-media attachment metadata remains
fully available through the sidecar even when no legacy media compatibility
projection applies.

The production-media recognizer and projector belong in the private record codec.
They must be conservative: a value is projected as legacy media only when its
required `id`, `name`, `type`, and `lastModified` fields are valid and its logical
key matches. Otherwise the public compatibility row is only `{ id: key }`; the
sidecar remains the complete authority. This avoids inventing a C4 raw shape for a
generic attachment.

## Private sidecar records

### Project sidecar

Derive one private project-authority store name from `projectsStore`; do not add a
public identity option. A representative logical record is:

```ts
type ProjectAuthorityV1 = {
	id: string;
	revision: 1;
	schemaVersion: number;
	summary: ProjectSummary;
	payload:
		| { kind: "project-row"; hadOwnRootId: false }
		| { kind: "project-row"; hadOwnRootId: true; rootId: unknown }
		| { kind: "opaque"; data: unknown };
};
```

The exact stored names may follow existing conventions, but the invariants are
fixed: identity is authenticated, normal project data is not duplicated, every
opaque exception is reconstructable, and the record is strict-decoded and
defensively cloned.

### Attachment sidecar

Derive one attachment-authority store name from `mediaStore` inside the same
per-project media database. Do not widen `BrowserMediaBinding`; the derived store
is already covered by the binding's whole-database ownership.

```ts
type AttachmentAuthorityV1 =
	| {
			id: string;
			revision: 1;
			kind: "attachment";
			projectId: string;
			key: string;
			metadata: unknown;
			bodyKey: string;
			mutationId: string;
			bodyDigest: string;
			byteLength: number;
			retiredBodyKeys: readonly string[];
	  }
	| {
			id: string;
			revision: 1;
			kind: "deleted";
			projectId: string;
			key: string;
			mutationId: string;
			retiredBodyKeys: readonly string[];
	  };
```

The complete logical metadata is stored here. This is intentionally different
from the compact project sidecar: attachment metadata is small, and a full copy
keeps generic Map/Date/provider-private values, a conflicting metadata `id`, and
the C5-only derived fields exact without complicating the public C4 projector.
`retiredBodyKeys` is authenticated cleanup intent, not live data: an ordinary
replace/delete commits the prior body key into the new authority row before
post-commit cleanup. Successful cleanup removes only the matching entries with a
mutation-aware conditional update. Decoders may treat the absent field on an
earlier revision-1 row as an empty list, but current encoders always write it.

## Decode precedence and compatibility

Every project or attachment read resolves formats in this order:

1. **Current sidecar pair.** If a valid authority row exists, it is the current
   format. Decode the paired public row using the sidecar. A live sidecar without
   its public row, a mismatched identity, or an invalid strict shape is `corrupt`.
   A deletion sidecar resolves as absent.
2. **Old inline C5 envelope.** With no sidecar, an own
   `__opencutProjectStore`/`__opencutAttachmentStore` field is decoded by the
   existing strict revision-1/revision-2 compatibility decoder. Malformed inline
   envelopes fail closed; they do not fall through to legacy raw decoding.
3. **C4 raw row.** With no sidecar and no reserved inline envelope, use the
   existing legacy project/media decoder. Legacy media body keys remain the
   logical attachment key.

Current sidecar precedence is important: a provider may legitimately persist a
field named `__opencutProjectStore` or `__opencutAttachmentStore`. When a current
sidecar exists, such a field is opaque provider data, not an implementation
envelope.

Do not eagerly rewrite current-version inline C5 rows during initialization. They
remain readable and are converted atomically on their next normal save. This
avoids an unrequested startup migration, storage amplification, and another
topology mutation path.

## Purpose-specific atomic helpers

Extend the private browser mechanism module with named operations for the actual
use cases. Do not create a general public `LayoutRequest`, store-union dispatcher,
transaction description language, or injectable external I/O port.

Required logical helpers are:

- read one project public/authority pair in one readonly transaction;
- list all project public/authority rows in one readonly transaction;
- commit project public row + authority row + cascade tombstone removal in one
  readwrite transaction;
- delete project public/authority rows + write cascade tombstone in one readwrite
  transaction;
- clear project public/authority stores + replace cascade maintenance rows, with
  the existing optional library-binding store in the same transaction;
- read one attachment public/authority pair in one readonly transaction;
- list all attachment public/authority rows in one readonly transaction;
- commit attachment public row + authority row in one readwrite transaction;
- delete attachment public row + commit its deletion authority in one readwrite
  transaction;
- remove a completed attachment deletion authority after physical cleanup.

The helpers may use small internal pair/result types. They are implementation
details, not new seams for callers. `openDatabaseStores()` remains responsible for
one-time object-store creation/upgrades and platform-error mapping.
Every mutating helper receives the request signal and performs the final abort
check after `openDatabaseStores()` resolves, synchronously immediately before
creating its readwrite transaction. A caller-side check before the async open is
not sufficient; abort during open/upgrade is still pre-commit and must leave the
previous aggregate intact.

## Operation ordering, commit points, and errors

### Project save

1. Validate matching record/summary identity and structured-clone inputs before
   I/O.
2. Await initialization and the existing mutation queue.
3. Retry/inspect pending cascade state and reject a blocked same-id save.
4. Run `beforeCommit`, including cancellation/fault controls.
5. Atomically write public project row and project sidecar while deleting the
   project's cascade tombstone.
6. Report success only after the IndexedDB transaction completes.

### Attachment save

1. Clone metadata/body before I/O.
2. Await initialization and the attachment mutation queue.
3. Check the project cascade guard.
4. Register/authorize the complete current and retained media/library topology
   before any media database open/upgrade or OPFS access.
5. Preserve the existing candidate/stage body write and readback validation. The
   previous sidecar pointer remains authoritative throughout this phase.
6. Run `beforeCommit`.
7. Atomically write the exact C4 public metadata row and the new live attachment
   sidecar. This transaction completion is the replacement commit point.
8. Remove the stage body. After commit, remove the previous body when its key
   differs. Cleanup failure emits a mechanism-neutral retryable diagnostic and
   does not turn a committed replacement into a reported cancellation/failure.

Before step 7, a failure or abort leaves the complete previous attachment or
absence visible. After step 7, readers see the complete new metadata/body pair.
No reader may combine public metadata from one mutation with a body pointer from
another.

### Attachment remove

Read the current pair, run `beforeCommit`, then atomically delete the public row
and write a deletion sidecar. The logical attachment is absent at that commit
point. Physical body cleanup runs after commit; once it succeeds, the deletion
sidecar can be removed. A retained tombstone or orphan is retried during
initialization without making the deleted attachment visible again.
When only part of a deletion cleanup succeeds, the replacement tombstone remains
public-absent and contains only the unfinished `retiredBodyKeys`. Conditional
resolution distinguishes that state from a live authority/public-present pair
and compares the exact expected authority/mutation before shrinking or retiring
intent.

### Error mapping

- Pre-aborted or pre-commit cancellation: `aborted`, previous value intact.
- Quota/platform failures: existing mechanism-neutral mapping.
- Topology refusal: `unavailable` with logical operation/scope only.
- Malformed sidecar, mismatched pair, invalid body digest/length, or ambiguous
  three-generation state: `corrupt`.
- Transaction conflict/version failure: existing `conflict` mapping.
- Post-commit cleanup failure: retryable diagnostic; never expose a raw database,
  store, path, body key, topology reason, payload, or cause.

## Cascade integration

The current cascade manager owns the project commit point and must be changed as a
unit with the pair helpers:

- `commitProjectSave`: public project put + project-authority put + same-project
  maintenance tombstone delete in one transaction.
- `commitProjectRemoval`: public project delete + project-authority delete +
  project cleanup tombstone put in one transaction.
- `commitProjectsClear`: clear public project and project-authority stores, clear
  and replace cascade maintenance rows in one transaction.
- `commitProjectsClearWithLibraryBinding`: perform the same project/authority/
  maintenance mutation and validate/write the existing exact library binding in
  that one transaction.

Media cascade continues to delete the complete per-project media database and
OPFS root. Because attachment authority is inside that owned media database, no
new cleanup target or journal field is needed.

## Topology integration

Add the derived project-authority store to
`BrowserProjectTopologyStoreNames`. `projectReservedStorePairs()` already derives
exact reserved pairs from all project store names, so a library may not claim the
new internal `(projectsDatabase, projectAuthorityStore)` pair. A distinct library
store may still share `projectsDatabase`.

Do not add the attachment-authority store to the public storage identity or to a
new topology claim. Media ownership is whole-database plus exact OPFS root; the
authority store is an implementation detail within the already authorized media
database. All attachment pair opens/upgrades remain after the existing
`media-access` permit.

The project sidecar does not change migration-stage database ownership. The two
canonical stage databases, all current/retained media and library claims, and
legacy transformer source preauthorization remain as in the clean attempt-4
topology design.

## Orphan cleanup

Initialization orphan cleanup must build its live body-key set from:

- all valid current live attachment sidecars;
- all readable old inline C5 attachment envelopes;
- legacy raw rows only for their legacy key-equals-body-key behavior.

It may remove only:

- authenticated `retiredBodyKeys` carried by the current authority row; and
- unreferenced `.c5-stage-*` or `.c5-body-*` candidates after subtracting the
  complete live set.

It must never delete an arbitrary legacy filename unless that exact key is
present in authenticated cleanup intent. A stage-prefixed key can be valid live
legacy data and therefore is not deletable merely because of its prefix.
Deletion sidecars contribute no live body key, but retain their cleanup intent
until every target is removed. Retiring an intent or tombstone must compare the
expected mutation ID/current authority and confirm the public row is still
absent, so a later same-key save cannot be erased. A malformed pair produces a
diagnostic/fail-closed outcome for that media database; it does not broaden the
deletion set or prevent already validated independent databases from cleaning.

## Migration, stage, destination, and recovery

Do not edit historical migration transformers under
`apps/web/src/services/storage/migrations/`. Their additive-only policy remains in
force.

The browser migration orchestrator may adapt physical source/destination codecs,
but the current migration order remains:

1. authorize complete current/retained and legacy source/cleanup topology;
2. transform and discover using only the frozen permit;
3. stage project and attachment logical values;
4. read back and validate stage;
5. persist recovery and cleanup intent;
6. commit attachments, then project;
7. read back and validate destination;
8. retire recovery intent and retry cleanup.

Project version discovery reads the public/project-authority key union and
decodes each physical pair before consulting `record.schemaVersion`. A valid
current sidecar whose public projection is only `{ id }` is not version 0.
Likewise, attachment discovery reads public/attachment-authority pairs only
after the complete frozen migration topology permit succeeds. Any live half-pair
or mismatched pair is corrupt; a valid deletion authority is absent logical
data, not a legacy raw attachment.

Keep the existing private stage and recovery journal revision/wire shape readable.
Stage databases may continue to hold old inline-envelope logical values; they are
private migration state, not the public C4 stores. At destination commit:

- decode the staged project envelope, produce its C4 public row and current
  project sidecar, and commit that pair atomically;
- decode each staged attachment envelope, produce its C4 public media row and
  current attachment sidecar, and commit that pair atomically;
- keep the staged/recovery mutation ID, body digest, body length, and selected
  existing body key in the sidecar.

Revision-2 recovery journals may add an optional sibling `retiredBodyKeys`
field. Old journals default it to `[]`; new values must be non-empty strings,
unique, absent from the live `bodyKey`, and identical in the stage row and
journal. Current-source cleanup intent flows through stage and journal into the
destination authority. Raw/inline sources default to no retired keys.

Recovery must compare decoded logical states/fingerprints rather than assuming
that the destination raw row equals the staged inline envelope. Its input matrix
is:

- original C4 raw destination;
- original or staged old inline C5 destination;
- staged current public+sidecar destination;
- a later normal current save/remove that must win according to existing
  mutation-ID and project-state rules.

Recovery compares attachment mutation authority before logical contents. A
different current live/tombstone mutation wins as a later save/remove even if
its contents equal an older snapshot. The migration mutation is accepted only
when its decoded logical fingerprint and body digest/length match the staged
value. A physical half-pair, bare attachment absence while its project remains,
or a non-current unmatched value is ambiguous and retains journal, stage, and
sources.

Existing revision-2 recovery journals remain valid. When an old journal carries
raw or inline `storedProject`/`storedMetadata`, decode it through the compatibility
codec and compare it to the current pair's logical value. Do not rewrite an old
journal merely to upgrade its representation. Ambiguous state remains fail-closed
and retains sources, stage, and journal for retry/diagnosis.

Project version discovery/listing must read current project sidecars when present,
then fall back to inline and raw version rules. A current sidecar project is never
mistaken for an old migration candidate merely because its public row contains
only the C4 `version` field.

## Affected-area allowlist

The implementation author may edit only the following product areas without a
new LEAD ruling:

- `apps/web/src/services/storage/browser-project-store-internals.ts`
- `apps/web/src/services/storage/browser-project-store-records.ts`
- `apps/web/src/services/storage/browser-storage-mechanisms.ts`
- `apps/web/src/services/storage/browser-project-store.ts`
- `apps/web/src/services/storage/browser-project-store-cascade-manager.ts`
- `apps/web/src/services/storage/browser-project-store-topology.ts`
- `apps/web/src/services/storage/browser-project-store-migration.ts`
- existing browser-store conformance/residual/migration/cascade probe modules only
  where required to expose the new regression results

The test allowlist is:

- a new focused record-codec test under
  `apps/web/src/services/storage/__tests__/`
- the existing four `browser-project-store-*-topology.test.ts` files
- existing storage conformance/migration/recovery tests and C5 storage Playwright
  harness/spec files, only for the new raw-row and compatibility assertions

The implementation may write one new repair evidence/handoff artifact under this
change after verification. It must not edit:

- `apps/web/src/editor/ports/project-store.ts` or any other public port/session
  type;
- Host composition or consumer persistence code, including
  `apps/web/src/media/persistence.ts`;
- historical files below `apps/web/src/services/storage/migrations/`;
- `apps/vite-example/tests/parity/**`;
- `script/diff-parity-snapshots.mjs`;
- Rust/WASM, generated WASM, C6/C7/E1 behavior, task ticks, run state, canonical
  review evidence, or unrelated docs.

Any required path outside this allowlist is a stop-and-escalate condition.

## Short dispatched implementation order

Each phase is intentionally small enough for one author and a separate verifier.
Do not combine all phases into a single blind rewrite.

### Phase 1: RED record-format contract

Add pure focused tests that fail against the inline-envelope implementation:

- normal project public row is byte-for-byte/deep-equal to the C4 fixture and has
  no implementation-generated envelope;
- own-root-id and non-record project payloads reconstruct exactly;
- media public row restores `size`, omits `mimeType`/`fps`/`hasAudio`, and has no
  C5 envelope;
- full logical attachment metadata, including derived and provider-private fields,
  round-trips from the sidecar;
- current sidecar, old inline envelope, and C4 raw precedence is explicit;
- provider-owned `__opencut*` fields survive when a current sidecar exists;
- malformed or mismatched pairs fail closed.

Do not change product code until the RED identities are captured.

### Phase 2: GREEN codec and private names

Implement the project/media compatibility projectors, strict sidecar codecs,
derived store names, and compatibility decoders. Keep this phase pure/in-process;
do not yet rewire normal store operations. Re-run Phase 1 and existing opaque
codec/conformance unit tests.

### Phase 3: RED/GREEN atomic pair mechanisms and ordinary operations

Add failure-injection/browser tests for half-pair prevention, then implement the
purpose-specific read/list/save/remove helpers and rewire ordinary project and
attachment methods. Preserve queue order, topology-before-I/O, staging, abort, and
post-commit cleanup semantics.

At the end of this phase, shared portable/browser conformance and raw-row browser
probes must both pass.

### Phase 4: Cascade and orphan repair

Extend project save/remove/projects-clear/all-clear transactions to include
project authority. Update orphan cleanup to use live sidecars plus inline/legacy
compatibility. Verify retry, reload, later save, same-id reuse, and exact clear
behavior.

### Phase 5: Migration and recovery repair

Adapt destination commits and recovery comparisons to logical pairs without
changing historical migrations or journal compatibility. Run actual v1,
current-version no-op, old inline envelope, recovery interruption, later
save/remove, and topology preauthorization cases.

### Phase 6: Topology and complete Chromium gate

Reserve the project-authority store pair, prove a safe same-project-database
library store still works, and prove no media sidecar access can occur before the
whole-database permit. Run focused then complete C5 Chromium with empty disposable
inventories before and after.

### Phase 7: Protected parity and affected tail

Create fresh Vite and Next outputs from the repaired tree. Run the unchanged Host
scenario against both, then run the unchanged diff oracle. Acceptance is exactly
195 leaves, zero semantic differences, and nine incidental differences. Any other
count is a product finding; do not edit the oracle.

After parity passes, rerun the affected type/boundary/full-regression tail from
`handoff/final-verification-plan.md`; earlier Phase-A results are stale for files
touched by this repair.

## Exact verification commands

All unit and browser commands use this product cwd unless a different cwd is
stated:

```text
E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5
```

### Focused unit and static commands

```powershell
bun test apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts
bun test apps/web/src/editor/ports/__tests__/conformance.test.ts apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts apps/web/src/media/__tests__/persistence.test.ts
bun test apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts
bun test apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts
bun test apps/web/src/services/storage/__tests__/browser-project-store-media-topology.test.ts
bun test apps/web/src/services/storage/__tests__/browser-project-store-cascade-topology.test.ts
bun test apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts
bun test apps/web/src/services/storage/migrations/__tests__/v1-to-v2.test.ts apps/web/src/services/storage/__tests__/migration-provider-private.test.ts
node script/check-port-boundary.mjs --negative-control
node script/check-host-composition.mjs --negative-control
node script/check-storage-boundary.mjs
node script/check-type-baseline.mjs
```

`c5-storage-red-controls.test.ts` and each topology file run in their own Bun
process as shown; do not combine their module mocks into one process.

### Chromium commands

First prove the configured port has no listener. Do not reuse or kill a foreign
listener:

```powershell
Get-NetTCPConnection -LocalPort 4175 -State Listen -ErrorAction SilentlyContinue
```

With no output from that check, run serially:

```powershell
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts
```

Acceptance includes every shared browser-store case, all migration/cascade/
topology booleans, all lifecycle races, the new raw-row/format matrix, and empty
randomized disposable database/directory inventories before and after.

### Fresh protected parity commands

Use a unique `<run-id>` and `<marker>`. Build Vite from
`apps/vite-example`:

```powershell
$env:OPENCUT_PUBLIC_BASE='/'
$env:C4_VITE_OUT_DIR="E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5/apps/vite-example/dist-c5-sidecar-<run-id>"
$env:VITE_C4_BUILD_MARKER='<marker>'
bun run build
bun run preview -- --port 43551 --strictPort --host 127.0.0.1
```

Record and retain the owned preview PID. In a second shell, from
`apps/vite-example`:

```powershell
$env:PARITY_HOST='vite'
$env:PARITY_BASE_URL='http://127.0.0.1:43551/'
$env:PARITY_NO_WEBSERVER='1'
$env:OPENCUT_PUBLIC_BASE='/'
$env:C4_VITE_OUT_DIR="E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5/apps/vite-example/dist-c5-sidecar-<run-id>"
bun run test:parity
```

Build Next from `apps/web` after generating the required ignored Content
Collections input exactly as recorded in `final-verification-plan.md`:

```powershell
bun run build
```

Assemble `public` and `.next/static` only into the fresh standalone app directory,
then start from `apps/web/.next/standalone/apps/web`. Load the nine required
environment names from `apps/web/.env.example` without logging values, then:

```powershell
$env:PORT='43552'
$env:HOSTNAME='127.0.0.1'
$env:OPENCUT_PUBLIC_BASE='/'
$env:OPENCUT_NEXT_DIST_DIR='.next'
$env:C4_BUILD_MARKER='<marker>'
$env:NEXT_TELEMETRY_DISABLED='1'
node server.js
```

Record the owned Next PID. In another shell, from `apps/vite-example`:

```powershell
$env:PARITY_HOST='next'
$env:PARITY_BASE_URL='http://127.0.0.1:43552/'
$env:PARITY_NO_WEBSERVER='1'
$env:OPENCUT_PUBLIC_BASE='/'
bun run test:parity
```

From the product root, run the protected oracle unchanged:

```powershell
node script/diff-parity-snapshots.mjs apps/vite-example/tests/parity-artifacts/vite/snapshot-vite.json apps/vite-example/tests/parity-artifacts/next/snapshot-next.json E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rasen/changes/s02-storage-port/evidence/parity-final-diff.md
```

Acceptance is exit zero with exactly:

```text
195 leaf values
0 semantic differences
9 incidental differences
```

After each owned server, stop only the recorded process tree and prove ports
43551/43552 are clear. Also prove the protected tree/blob remains unchanged:

```powershell
git status --short --untracked-files=all -- apps/vite-example/tests/parity script/diff-parity-snapshots.mjs
git diff --exit-code 0ef35459f685d5d41a25d0ef959aff691b7519cd -- apps/vite-example/tests/parity script/diff-parity-snapshots.mjs
git rev-parse 0ef35459f685d5d41a25d0ef959aff691b7519cd:apps/vite-example/tests/parity
git hash-object --path=script/diff-parity-snapshots.mjs script/diff-parity-snapshots.mjs
```

Required identities remain parity tree
`e1fbb55b985f4fb490c6b233d18c50c58ea14c28` and oracle blob
`fa387ebea1e7f0cc1110eebcb922d393a1337842`.

## Rollback and dead ends

If a phase fails, revert only that phase's uncommitted author delta with a reviewed
inverse patch; do not reset the dirty C5 worktree, discard another worker's files,
or edit protected fixtures. Retain the RED identity and failure logs for the next
attempt.

Rejected approaches:

- **Ignore C5 fields in parity.** This blesses a public row expansion from 195 to
  408 leaves and hides duplicated real Host differences. The protected oracle is
  correct.
- **Make inline UUIDs deterministic.** This removes only randomness; it leaves the
  duplicate project/media representation and the wrong public shape.
- **Keep envelopes but teach the snapshot to strip them.** This changes the oracle
  instead of the product and would no longer detect a future persistence leak.
- **Put attachment authority in a central/project database.** Metadata and the
  body pointer could not commit atomically with the per-project public media row.
- **Overwrite a fixed OPFS body key before metadata commit.** A failed metadata
  commit can expose old metadata with new bytes, violating all-or-previous.
- **Copy the complete project into its sidecar.** It is correct but doubles every
  ordinary project write and document footprint; use the compact normal case plus
  opaque fallback.
- **Introduce a general public layout transaction union or external I/O port.** It
  widens the interface callers must learn and creates a shallow second storage
  seam. Purpose-specific private helpers provide the needed atomicity.
- **Bulk-convert inline envelopes at startup.** It adds a new unrequested mutation
  path, write amplification, and recovery/topology surface. Convert on the next
  normal save.
- **Rewrite historical migrations or old recovery journals.** Historical
  migrations are additive-only, and old persisted intent must remain readable and
  fail closed.
- **Move `mimeType`, `fps`, or `hasAudio` back into the public media row.** They are
  useful logical metadata but were not part of the C4 raw projection. Keep them in
  the attachment sidecar and restore `size` in the public row.

## Completion gate and first next action

The repair is complete only when a non-author verifier confirms all of the
following on the same tree:

- external `ProjectStore` and Host/session seams are unchanged;
- current project/media public rows match C4 exactly;
- generic opaque and provider-private values still round-trip;
- attachment failure/cancellation remains all-or-previous;
- raw, inline-envelope, and sidecar generations all decode correctly;
- cascade, migration/recovery, topology, and orphan cleanup remain fail-closed;
- focused unit/static and complete Chromium gates pass with empty disposable
  inventories;
- protected parity reports exactly 195/0/9 with the protected sources unchanged;
- no file outside the affected-area allowlist changed without a new LEAD ruling.

The implementation successor's first action is Phase 1 only: add and run the
focused RED record-format tests, recording the exact failures before touching the
browser-store implementation.
