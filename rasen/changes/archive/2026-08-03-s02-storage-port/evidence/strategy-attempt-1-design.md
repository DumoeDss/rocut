# C5 review-cycle strategy attempt 1 - design-level rework

Date: 2026-08-02  
Change: `s02-storage-port`  
Mode: report-only planner strategy; no product, task, or prior-evidence edits  
Review input: `evidence/review-round3.md`  
Open findings: round-3 M1 and M2  
Disposition: **strategy selected, findings still open until implementation and independent re-review**

## H.5/H.6 strategy accounting

This is strategy attempt **1/3** after the bounded review loop reached two
remaining Majors. The material variable is a design-level rework: both fixes add
durable evidence for facts that the current code attempts to infer from missing
state. This is not another test-only or condition-ordering retry.

- M1 currently infers attachment precedence from the project row and treats
  absence as validation failure.
- M2 currently represents unavailable database enumeration as an empty inventory
  and treats absence from that list as proof that no target exists.

The selected designs make attachment precedence and physical media ownership
explicit, persistent, and recoverable across runtime reset. The change remains
blocked for ship: H.6 forbids reporting clean while either Major is open.

## Inputs and constraints confirmed

- Migration recovery is stored in the dedicated migration-maintenance object
  store and runs inside the durable-identity shared `all-projects` queue.
- Cascade tombstones/journals are stored in a separate cascade-maintenance object
  store. Project removal and projects/all clear commit project invisibility and
  durable cleanup intent in one projects-database transaction before physical
  deletion.
- Attachment metadata is in a per-project IndexedDB database while bodies are in
  OPFS. A cross-database/OPFS atomic transaction does not exist.
- `saveAttachment` writes and validates a new body before the metadata-row put;
  that metadata put is its logical replacement commit. `removeAttachment`
  currently deletes metadata, then cleans the body best-effort.
- `indexedDB.open(name)` can create a missing database even for a logical read.
  Therefore reads as well as writes can create an untracked physical target.
- Never-created project IDs are legal attachment scopes in the existing
  conformance behavior. A solution cannot assume every media owner has a current
  project row.
- Migration, cascade, ownership, and shared-queue internals must remain separate
  implementation details. No database name, object-store name, OPFS path, token,
  or recovery shape may enter the public `ProjectStore` contract or diagnostics.

## Decision summary

| Finding | Preferred design | Why it wins |
| --- | --- | --- |
| M1 | Versioned attachment write epochs plus durable delete tombstones, with original/staged recovery fingerprints | Later precedence commits in the same media IndexedDB row as the logical attachment mutation. It removes the extra cross-database acknowledgement window and makes absence non-authoritative. |
| M2 | Independent durable media-owner registry plus a verified coverage certificate and an exact target planner | Known targets remain derivable without `indexedDB.databases()`, optional enumeration is reduced to legacy/orphan backfill, and an unproven inventory fails before logical clear. |

## M1 - migration recovery versus later same-key attachment mutation

### Current failure model

The recovery journal records original/staged project rows but no per-key
attachment lineage. Recovery branches on the project row. When that row equals
the staged project, it demands that every attachment still equal the migration
stage. A later successful replacement or removal does not alter the project row,
so recovery rejects forever. The inverse phase is also unsafe: if migration
failed after some attachment puts but before the project put, the project row is
still original and a blind recommit could overwrite a later attachment mutation.

Project-row equality is therefore necessary but insufficient in both recovery
phases.

### Candidate M1-A - attachment write epochs and delete tombstones (preferred)

#### Internal data model

Introduce a backwards-readable attachment envelope revision. This is physical
adapter data only.

```text
current attachment v2:
  id/key, projectId, bodyKey, opaque metadata,
  mutationId, bodyDigest, byteLength

attachment delete tombstone:
  id/key, projectId, mutationId, kind=deleted

migration recovery attachment fingerprint:
  key,
  original = absent | { exact stored-metadata snapshot, body digest, length },
  staged   = { exact stored-metadata snapshot, body digest, length },
  migrationMutationId
```

The metadata snapshot must be structured-clone safe and compared with the
existing structural comparator, not JSON stringify/parse. The body fingerprint
is a versioned SHA-256 digest plus byte length; raw body bytes remain in the
validated stage database, not in the recovery journal. Diagnostics expose none
of these values.

Every new ordinary save receives a fresh `mutationId`. Every staged migration
attachment receives a stable ID generated once during staging and retained in
the stage/recovery record. A remove commits a fresh-ID tombstone instead of
making the row physically absent. List/load decode tombstones as logical absence;
malformed tombstones remain typed `corrupt` rather than being silently filtered.

Tombstones must not be physically removed while an active migration recovery may
reference the key. They may be compacted only after recovery finalization (or
replaced by a later save). Keeping a small tombstone longer is safe; turning it
into unexplained absence is not.

#### Recovery state machine

First classify the destination project:

| Project state | Meaning | Attachment action |
| --- | --- | --- |
| exact original | project put has not committed; attachment puts may be none or partial | reconcile every migrated key, then put the staged project last |
| exact staged | project put committed after all migration attachment puts | reconcile every migrated key; do not rewrite the project |
| absent | a later committed project remove/clear wins | do not touch attachments; finalize this project's recovery evidence |
| different valid current project | a later project save wins | do not touch attachments; finalize this project's recovery evidence |
| different old/corrupt project | ordering is ambiguous | retain recovery and reject initialization with a mechanism-neutral retryable diagnostic |

For an original/staged project, classify each migrated attachment key:

| Attachment state | Project original | Project staged |
| --- | --- | --- |
| exact original fingerprint | write/validate staged attachment | ambiguous rollback/corruption; retain recovery |
| exact staged fingerprint and migration ID | accept/validate partial migration commit | accept/validate migration commit |
| valid v2 row with a different mutation ID and valid body digest | later save wins; preserve | later save wins; preserve |
| valid delete tombstone with a different mutation ID | later remove wins; preserve logical absence | later remove wins; preserve logical absence |
| physical absence without a matching tombstone | ambiguous; never infer delete | ambiguous; never infer delete |
| malformed row, digest mismatch, or unrecognized current/legacy state | ambiguous/corrupt; retain recovery | ambiguous/corrupt; retain recovery |

Recovery builds a per-key winner map. Validation checks the staged value only for
keys owned by migration and checks the selected later value/tombstone for
superseded keys. Attachment rows not present in the migration stage are outside
that stage and are preserved. Only after all projects and key winners validate
may recovery delete its journal and stage databases.

#### Commit points

1. **Migration recovery intent:** recovery journal and stage readback are durable
   before the first destination attachment put.
2. **Migration attachment:** the v2 metadata row put is idempotent and precedes
   the project-row put; project-row commit remains last.
3. **Later save:** body write and digest validation are precommit. The v2 metadata
   put carrying the fresh mutation ID is the logical commit. Old-body cleanup is
   postcommit and diagnostic-only.
4. **Later remove:** the delete tombstone put is the logical commit. Body cleanup
   is postcommit and retryable. Physical tombstone compaction is later
   maintenance, never part of the public success decision.

Because save/remove precedence is committed in the same media IndexedDB row as
the logical metadata mutation, recovery does not need a second acknowledgement
in the projects database. The shared queue still serializes live wrappers;
durable epochs/tombstones carry ordering across reload when runtime queue history
is gone.

#### M1 invariants

1. Physical absence is never accepted as proof of a later successful delete.
2. Recovery may write staged attachment state only over the recorded exact
   original or its own exact migration value, never over a different mutation ID.
3. A public later save succeeds only after its body is readable and its v2 row is
   committed. A public later remove succeeds at the tombstone commit.
4. Project destination state and every staged attachment key are reconciled; one
   cannot stand in for the other.
5. Different valid later mutations win regardless of whether failure occurred
   before or after the staged project-row put.
6. Corrupt/ambiguous state leaves recovery durable and fails loudly; recovery
   never repairs by guessing.
7. Migration and attachment tombstones remain internal, payload-free in
   diagnostics, and absent from the public port.

#### M1 failure matrix

| Failure/event | Durable state | Required recovery/result |
| --- | --- | --- |
| before recovery journal | sources/stage may exist; destination unchanged | abort migration and clean only validated stage artifacts |
| after journal, before any destination put | project and keys equal original | replay staged keys, put project last, validate, finalize |
| after some staged attachment puts, before project put | project original; keys are original/staged mix | preserve staged keys, write only exact-original keys, then put project |
| after project put, before readback | project staged; keys should be staged | validate staged keys; do not rewrite unexplained original/absent keys |
| later save fails before metadata put | old row remains; new body is only stage/orphan | normal recovery; best-effort orphan cleanup |
| later save metadata put succeeds | different valid mutation ID and digest | later save wins; recovery finalizes without overwrite |
| later remove tombstone put succeeds | valid later tombstone | later remove wins; recovery finalizes without resurrection |
| later remove body cleanup fails | tombstone plus orphan body | logical delete wins; retry orphan cleanup independently |
| later row exists but body/digest is invalid | ambiguous/corrupt | retain recovery; initialization rejects retryably |
| row is physically absent without tombstone | delete versus corruption cannot be distinguished | retain recovery; never infer precedence |
| later project remove/clear or different current save | project absent/different current | project-level later operation wins all staged keys |

### Candidate M1-B - recovery-local supersession write-ahead log

This is implementable without changing the durable attachment envelope. Give the
recovery record a run ID and store one migration-maintenance supersession record
per `{projectId,key}`. Before a later save/remove commits media metadata, persist
an intent containing the exact before fingerprint, the intended after
fingerprint (or delete), and whether the before state was migration-owned or an
already accepted later winner. The media mutation then commits. Recovery compares
the current state with both endpoints: after means the new mutation wins, before
means it did not commit and the prior disposition remains, anything else is
ambiguous. Sequential same-key operations replace the intent only after
reconciling the predecessor.

This design closes absence ambiguity and can recover a crash on either side of
the media commit. It is not selected because every ordinary attachment mutation
during recovery must coordinate an intent in the projects database and a commit
in the media database. That adds a second cross-database state machine, couples
normal attachment code directly to migration maintenance, and creates more
failure/reconciliation states than placing the precedence token in the same row
as the logical attachment commit. It remains the fallback if stored attachment
format/tombstones are rejected during implementation review.

## M2 - exact projects/all clear without database enumeration

### Current failure model

`listDatabaseNames()` returns `[]` both for a genuinely empty inventory and for
an unsupported `indexedDB.databases`. `commitProjectsClear` derives project IDs
from project/tombstone rows but uses only enumerated names as cleanup targets.
The atomic project clear can therefore commit a target-free journal while known
media metadata survives.

Known rows alone are also not a complete historical inventory: the port permits
attachments under never-created project IDs, and an IndexedDB logical read can
create a missing media database. A correct no-enumeration design needs a durable
owner set, not only a one-time rewrite from the current project table.

### Candidate M2-A - durable media-owner registry and coverage certificate (preferred)

#### Internal data model

Add a third, independently named internal projects-database object store owned by
physical media inventory, not by migration or cascade:

```text
media owner:
  key = exact encoded projectId
  revision = 1
  projectId = logical only

coverage certificate:
  revision = 1
  coverage = complete
```

Owner records contain no database/directory name. Cleanup always derives both
exact physical targets with `mediaDatabaseName(identity, projectId)` and
`mediaDirectoryName(identity, projectId)` and validates the round-trip identity.
The dedicated store avoids merging migration/cascade control planes and survives
the cascade store's project-clear transaction.

#### Registration rule

Before any operation can open/create a per-project media database or create an
OPFS directory, it durably registers the logical project ID. Registration is
write-ahead: a crash may leave a harmless false-positive owner, but can never
leave a physical target with no owner.

This includes logical reads because `indexedDB.open` can create a missing
database. Attachment list/load must therefore enter the existing shared queue
around owner registration plus media open (with their abort rechecks retained).
An earlier read/write completes and is included before `all-projects` clear; an
earlier clear commits first and its tombstone/journal prevents the later access
from recreating the just-cleared target. Migration performs registration from
inside its existing `all-projects` operation before legacy/current media access;
it must not recursively enter the queue.

The registry is internal durable ownership, not a second public port or a
process-global payload owner. Different wrapper objects still resolve the same
durable-identity queue.

#### Coverage certificate and optional enumeration

The registry proves all resources created after registration was introduced, but
an upgraded profile can contain older unregistered orphans. The `complete`
certificate may be written only after one successful sweep of both:

1. IndexedDB names when `indexedDB.databases()` is available; and
2. OPFS root directory names.

The sweep validates configured prefixes, derives every discovered project ID,
persists missing owner records, and writes the certificate in the owner store.
Until then, the registry is useful but not authoritative.

After certification, enumeration is optional defense-in-depth. When available,
newly discovered names are merged and backfilled; when unavailable, exact owner
derivation remains complete. If a certified inventory sweep later discovers an
unregistered owner, clear includes/backfills it and emits a fixed invariant-drift
diagnostic without exposing the name.

For a disposable identity, a fixture may establish coverage only after its
randomized prefix is proved empty by its controlled setup. Production must not
infer completeness from an empty project table or from a missing enumeration
API.

#### Clear target-planning state machine

1. **Collect:** read and strictly decode project rows, cascade tombstones, and
   media-owner rows. Any present malformed row is a precommit `corrupt` failure.
2. **Prove coverage:** read the coverage certificate and capability-aware
   inventory result (`available(names)` versus `unsupported`; errors remain
   errors). If coverage is incomplete, a full successful DB+OPFS sweep is
   required to backfill/certify. Unsupported/failed required enumeration is a
   precommit `unavailable` failure.
3. **Plan:** union project IDs, tombstone IDs, owner IDs, and optional enumerated
   orphan IDs. Derive the exact database and directory for every ID. Merge exact
   enumerated physical names and deduplicate. No target comes from unvalidated
   journal text.
4. **Recheck abort:** cancellation still wins only before the logical commit.
5. **Commit:** atomically clear project rows and install completed tombstones plus
   a clear journal containing the complete exact target plan (and `clearLibrary`
   for all-clear) in the existing projects/cascade transaction. The independent
   owner store is retained.
6. **Maintain:** delete exact databases/directories and optionally the library.
   Any failure after step 5 leaves the journal and resolves with the existing
   retryable diagnostic; initialization retries idempotently.

#### Mandatory precommit failures

Projects/all clear must reject before clearing project or library state when any
of these holds:

- an owner/project/tombstone row is present but cannot be strictly decoded or
  exactly bound to its key;
- an exact database/directory name cannot be derived and validated for a known ID;
- the owner registry lacks a complete-coverage certificate and either database
  enumeration is unsupported/fails or OPFS root enumeration fails;
- owner backfill/certificate persistence fails;
- the target plan or atomic cleanup-journal transaction fails;
- cancellation arrives before the existing logical commit point.

Missing `indexedDB.databases()` is therefore not itself fatal once certified
durable ownership exists. It is fatal precommit for an uncertified legacy
identity because successful all-clear cannot then be proven. The store may remain
otherwise available; the public error is operation-scoped `unavailable` and does
not name the missing browser API.

#### M2 invariants

1. Every creation-capable media access has a durable logical owner before opening
   the media database/directory.
2. The all-projects/all queue conflict covers registration, target snapshot, and
   logical clear; no in-flight access can fall between inventory and commit.
3. Exact targets are always derived for every project/tombstone/owner ID,
   regardless of optional enumeration.
4. Enumeration can add otherwise unreachable legacy/orphan targets but an
   unsupported API never means an empty inventory.
5. A coverage certificate is evidence produced by a complete sweep, not a default
   boolean inferred from current rows.
6. No physical deletion occurs before the project/tombstone/journal transaction.
7. Postcommit cleanup remains idempotent, journaled, retryable, and
   mechanism-neutral in diagnostics.
8. Migration, cascade, and media ownership keep independent stores and codecs;
   only the existing shared queue coordinates their operations.

#### M2 failure matrix

| Capability/failure/event | Before project commit | Required result |
| --- | --- | --- |
| certified owners; DB enumeration unavailable | exact targets derived from owners/project/tombstones | commit and clean exact targets; optional enumeration is not required |
| uncertified owners; DB enumeration unavailable | completeness cannot be proved | reject `unavailable`; project, media, and library remain unchanged |
| uncertified owners; complete DB+OPFS sweep succeeds | backfill owners and certificate durably | merge discovered orphans, then commit exact journal |
| inventory API exists but required sweep throws | no trustworthy complete set | reject precommit; never downgrade error to `[]` |
| certified owners; optional sweep throws | durable owner proof remains authoritative | proceed from exact owners, emit fixed internal drift/inspection warning if desired |
| owner registration fails before media open | no media target was opened/created | reject that attachment operation |
| crash after owner registration but before media open | harmless false-positive owner | future clear deletes nonexistent exact targets idempotently |
| attachment access starts before clear | shared queue makes clear wait | owner is included in target snapshot and physical data is deleted |
| clear starts before attachment access | access waits behind all-projects clear | tombstone/journal guard prevents recreation until an allowed later project save |
| journal transaction fails | project rows remain visible; no physical delete | reject precommit |
| physical DB/directory cleanup fails after commit | project rows invisible; journal retained | public operation resolves with retryable warning; reopen retries |
| all-clear library step fails after project commit | `clearLibrary` remains in journal | existing recoverable library-clear behavior is preserved |

### Candidate M2-B - strict capability gate with no owner registry

This smaller implementable option changes inventory to a tri-state result,
derives exact targets from current project/tombstone IDs, merges enumeration when
available, and rejects every projects/all clear before commit whenever database
enumeration is unavailable. It directly closes the false-success counterexample
and has a smaller code footprint.

It is not selected because clear would remain permanently unavailable in browsers
without `indexedDB.databases()`, even after all future media creation is under the
adapter's control. It also leaves creation-capable reads and legal never-created
attachment owners outside a durable known set. It is the safe fallback if the
owner registry cannot be implemented within this review-cycle strategy budget;
it must never be weakened to “derive current rows and assume no orphans.”

## Combined minimum implementation write set

The preferred designs can be implemented without public contract, Host,
consumer, library-coordinator, or protected-session edits. The minimum expected
product/test set is:

1. `apps/web/src/services/storage/browser-project-store-records.ts` - attachment
   v2/tombstone codecs and strict classification.
2. `apps/web/src/services/storage/browser-project-store-migration.ts` - recovery
   revision, original/staged fingerprints, per-key winner reconciliation.
3. `apps/web/src/services/storage/browser-project-store.ts` - save/remove commit
   tokens/tombstones, tombstone-hidden reads, queued ownership registration for
   creation-capable reads/writes.
4. `apps/web/src/services/storage/browser-project-store-media-ownership.ts`
   (new) - dedicated owner/certificate codec, registration, coverage/backfill.
5. `apps/web/src/services/storage/browser-project-store-cascade-manager.ts` -
   exact target planning, precommit capability gate, owner/project/tombstone union.
6. `apps/web/src/services/storage/browser-storage-mechanisms.ts` - capability-aware
   inventory result; no unsupported-to-empty coercion.
7. Existing round-2 migration and cascade Chromium probe modules - extend with
   later replace/remove recovery and no-enumeration clear cases rather than
   creating a parallel harness.
8. `apps/vite-example/src/c5-storage-harness.ts` and
   `apps/vite-example/tests/c5-storage/browser-store.pw.ts` - expose/assert the
   new axes.

`browser-project-store-control.ts` should change only if a deterministic failure
point is unavailable; the existing committed-readback hook is sufficient for M1,
and the M2 probe can temporarily mask `indexedDB.databases` inside its disposable
browser context.

## Required acceptance evidence after implementation

Testing is not the strategy, but the durable model is accepted only if these
state transitions are demonstrated in real Chromium:

1. Fail migration after destination puts, later replace the same attachment,
   reset runtime/new wrapper, initialize successfully, preserve the newer
   metadata/body, and remove recovery/stage evidence.
2. Repeat with later remove; initialization succeeds, the attachment remains
   absent, and migration never resurrects it.
3. Fail before the staged project-row put after at least one attachment put, then
   perform a later same-key save/remove; original-project recovery also preserves
   the later winner.
4. Exercise physical absence without a tombstone and a digest mismatch; recovery
   must remain durable and reject rather than guessing.
5. With a certified owner registry and `indexedDB.databases` masked, projects and
   all clear derive/delete every known DB/directory, then same-ID reuse exposes no
   old metadata/body.
6. With an uncertified registry and enumeration masked, clear rejects before the
   project transaction and all prior project/media/library state remains readable.
7. Preserve the existing complete Chromium matrix, lifecycle races, cascade
   journals, strict corrupt-row behavior, active abort semantics, type ceiling,
   and positive/negative storage boundaries.

An independent non-author reviewer must confirm both findings. Until then this
strategy attempt is **not** a clean review result.

