# C5 strategy attempt 4 - centralized physical topology policy

Date: 2026-08-02  
Branch/worktree: `feat/s02-storage-port` / `rocut-wt-c5`  
Mode: report-only planner; no subagents, product/task/run-state edits, commit, or final verification  
Inputs: attempt-3 design/review, attempt-4 topology audit F1-F3/T1-T10, current product implementation, and the complete cascade round-2 probe  
Disposition: **centralized topology policy selected; F1 Blocker and F2/F3 Majors remain open until implementation and independent non-author confirmation**

## Strategy accounting and material change

Attempt 3 made cascade targets exact and independently authorized, but exact
authorization does not prove physical isolation. Attempt 4 changes the material
variable from persisted target identity to the complete mutation topology:

- object-store operations conflict by exact `(database, store)` pair;
- cascade media and migration cleanup conflict by whole database name;
- cascade OPFS cleanup conflicts by exact root directory name;
- the same rules must hold for current plans and persisted historical retry.

This extra attempt follows a broadened, evidence-backed Blocker/Major set after
the default strategy budget was already exhausted. It is not a CLEAN verdict
and does not reset author-versus-verifier requirements.

## Findings this design must close

- **F1 Blocker:** a certified media target may equal the projects or library
  database, and cascade deletes the entire database.
- **F2 Major:** migration stage/legacy cleanup authority can overlap a live
  projects, library, media, or stage database and then delete it wholesale.
- **F3 Major:** a configured library exact pair, or media access inside the
  projects database, can alias the public project store or one of four durable
  control stores. Attempt 3's library-binding self-erasure is one instance.

The implementation must preserve attempt-3 exact journal authorization. The new
policy is an additional necessary proof: **authorized target AND safe physical
topology**, never one in place of the other.

## Physical model

For an identity, define:

```text
PDB = projectsDatabase
PS  = projectsStore
C   = PS + "-cascade-maintenance"
O   = PS + "-media-ownership"
A   = PS + "-library-clear-bindings"
G   = PS + "-migration-maintenance"

LDB/LS = libraryDatabase/libraryStore
SP     = PDB + "-c5-projects-stage"
SA     = PDB + "-c5-attachments-stage"

MDB(binding, project)  = mediaDatabasePrefix + projectId
MDIR(binding, project) = mediaDirectoryPrefix + projectId
```

Mutation granularity is load-bearing:

| Resource | Largest production mutation |
| --- | --- |
| `(PDB, PS/C/O/A/G)` | row or whole object-store transaction, never intended whole-PDB delete |
| `(LDB, LS)` | row, prefix-selected rows, or whole `LS` clear; never intended whole-LDB delete |
| `MDB` | whole database delete during cascade |
| `MDIR` | recursive exact root-directory delete during cascade |
| `SP`, `SA`, legacy timeline DB | whole database delete during migration cleanup |

## Formal design comparison

### Candidate A - centralized pure topology policy (selected)

Create one deep internal module, `browser-project-store-topology.ts`. Its
interface owns canonical internal/stage names and accepts a discriminated
physical-operation request. Its implementation classifies store pairs,
whole-database targets, exact OPFS roots, owner identity, and cross-domain
aliases, returning a normalized permit or throwing one internal topology
conflict.

- **Seam:** between decoded/authorized logical plans and existing IndexedDB/OPFS
  mechanisms.
- **Dependencies:** topology reasoning is in-process and pure. IndexedDB and
  OPFS remain local-substitutable dependencies behind the existing browser
  mechanisms; no new adapter seam is justified.
- **Depth:** callers learn one policy object and one `authorize` operation, while
  construction, granularity, pairwise aliasing, canonical naming, and error
  classification remain hidden.
- **Leverage:** the same implementation covers static identity, attachment
  registration, clear/remove precommit, cascade retry, migration planning, and
  migration retry.
- **Locality:** new protected domains and name changes are updated once. Durable
  media/library codecs remain in their current modules.
- **Write cost:** one new product module plus narrow calls at existing planning
  and retry seams. No public port or new persistence format is required.

### Candidate B - operation-local guards

Add direct comparisons independently to constructor validation, library binding
preparation, media registration, project removal, projects/all clear, cascade
retry, migration staging, early stage cleanup, and migration journal retry.

This looks smaller by file count but is a shallow design. Every caller must know
the five control stores, two stage databases, current/historical target rules,
and deletion granularity. The deletion test reproduces that knowledge across at
least eight sites. It is especially likely to validate new plans but miss
historical retry or to let migration naming drift. It is rejected.

### Candidate C - make media cleanup store-scoped

Replace `deleteDatabase(MDB)` with `clear(MDB, mediaStore)`. This removes the
largest media collision but changes established cleanup semantics, preserves
unknown/stale stores in each media database, and still leaves OPFS recursive
aliasing, library/control-store aliases, and migration whole-database deletes.
It would still need Candidate A, so it is not the minimum safe repair.

### Candidate D - new global durable topology registry

Register every projects, library, media, migration, and OPFS claim in a new
control store before any use. This could distinguish arbitrary same-origin
owners across every historical configuration, but introduces a new persisted
codec, migration/upgrade policy, atomic registration requirements, and another
control store that must itself be protected. The current adapter already has
complete durable media ownership and retained library-clear descriptors for the
tested historical paths. A new registry is not the minimum attempt-4 fix.

Candidate A is the smallest design that covers all current call paths without
changing deletion semantics or creating a new durable state machine.

## Selected module and exact internal interface

The names below are illustrative TypeScript but normative in shape and
responsibility:

```ts
export interface BrowserStorageTopologyNames {
	readonly project: {
		readonly database: string;
		readonly stores: {
			readonly public: string;
			readonly cascade: string;
			readonly mediaOwnership: string;
			readonly libraryClearBindings: string;
			readonly migrationMaintenance: string;
		};
	};
	readonly migrationStages: {
		readonly projects: { readonly database: string; readonly store: "staged-projects" };
		readonly attachments: { readonly database: string; readonly store: "staged-attachments" };
	};
}

export interface MediaPhysicalClaim {
	readonly fingerprint: string;
	readonly projectId: string;
	readonly database: string;
	readonly directory: string;
}

export interface LibraryPhysicalClaim {
	readonly database: string;
	readonly store: string;
}

export type BrowserStorageTopologyRequest =
	| { readonly kind: "static-identity"; readonly context: TopologyContext }
	| {
			readonly kind: "media-access";
			readonly candidate: MediaPhysicalClaim;
			readonly knownMedia: readonly MediaPhysicalClaim[];
			readonly knownLibraries: readonly LibraryPhysicalClaim[];
			readonly context: TopologyContext;
	  }
	| {
			readonly kind: "cascade-cleanup";
			readonly media: readonly MediaPhysicalClaim[];
			readonly library: readonly LibraryPhysicalClaim[];
			readonly knownMedia: readonly MediaPhysicalClaim[];
			readonly knownLibraries: readonly LibraryPhysicalClaim[];
			readonly context: TopologyContext;
	  }
	| {
			readonly kind: "migration-cleanup";
			readonly databases: readonly MigrationDatabaseClaim[];
			readonly directories: readonly MigrationDirectoryClaim[];
			readonly knownMedia: readonly MediaPhysicalClaim[];
			readonly knownLibraries: readonly LibraryPhysicalClaim[];
			readonly context: TopologyContext;
	  };

export interface BrowserStorageTopology {
	readonly names: BrowserStorageTopologyNames;
	authorize(request: BrowserStorageTopologyRequest): BrowserStorageTopologyPermit;
}

export function createBrowserStorageTopology(
	identity: BrowserStorageIdentity,
): BrowserStorageTopology;

export function isBrowserStorageTopologyConflict(error: unknown): boolean;
```

`BrowserStorageTopologyPermit` is a frozen normalized copy of the exact request
targets, discriminated by request kind. Cascade and migration cleanup iterate
the permit's targets, not the pre-validation input. This prevents name
re-derivation between check and execution. The existing projects-control-plane
mutation queue remains the concurrency fence.

The internal conflict contains only a stable reason enum such as
`reserved-store-pair`, `protected-database`, or `ambiguous-physical-owner`; it
does not contain physical names in its public message. Callers translate it to
`ProjectStoreError { code: "unavailable", operation, scope }`. Retry diagnostics
use a fixed topology phase and `retryable:false` because blind repetition under
the same topology cannot change the decision.

No topology adapter is introduced. There is only one implementation, it is pure
in-process logic, and tests cross this internal seam directly plus the outer
`BrowserProjectStore` interface in Chromium.

## Canonical name ownership

The topology module becomes the single owner of `C/O/A/G`, `SP/SA`, and their
stage store names. Existing helpers such as `cascadeMaintenanceStoreName` may be
temporarily re-exported for probe compatibility, but their implementation must
delegate to `topology.names`; no second string literal remains.

Legacy timeline target shape/prefix classification also moves behind the
topology module or a single helper it owns. Migration policy still proves that
a legacy target belongs to the requested project; topology proves that the
result is physically disjoint from live domains.

## Exact topology rules

### Reserved exact store pairs

The projects database owns this complete reserved set:

```text
(PDB, PS)
(PDB, C)
(PDB, O)
(PDB, A)
(PDB, G)
```

The configured library pair may not equal any reserved pair. A media access
may not use `PDB` at all, so its `mediaStore` name is irrelevant once the
database collision is detected.

`LDB === PDB` remains legal when and only when `LS` is distinct from every
reserved store. Library operations are exact-store scoped and no permitted
project operation deletes `PDB` after this policy is applied. This positive
case must be pinned in Chromium to prevent an over-broad name-only guard.

### Whole-database reserved sets

For a cascade media database deletion, the protected set is:

1. `PDB` - always; it contains public projects and all durable control stores.
2. the current `LDB` and every strictly decoded retained library claim supplied
   by the library-binding module - always; cascade media deletion would erase
   every store, exceeding library authority even during `clear(all)`.
3. `SP` and `SA` - always; migration may need them for staged recovery and
   cleanup owns them as whole databases.
4. the legacy timeline database namespace owned by migration - media may not
   claim or delete it, even when no migration is currently running.

For a migration whole-database deletion, the protected set is:

1. `PDB`;
2. current and retained library database claims;
3. every current or retained media database claim;
4. `SP` and `SA`, except that the matching canonical `stage-database` claim may
   delete itself after the full plan proves no library/media claim aliases it.

A legacy migration target may never equal either stage database. A stage target
must be exactly canonical; a legacy target must separately pass the existing
project/policy codec. The entire migration delete set is authorized before the
first delete, not target-by-target.

`libraryDatabase`, both stage databases, and `projectsDatabase` are therefore
explicitly protected from media deletion. Stage databases are also protected
from library use at static identity validation: `LDB === SP` or `LDB === SA` is
rejected regardless of `LS`, because later stage cleanup deletes the whole
database.

### Exact media database and OPFS ownership

The logical media owner key is the exact pair `{fingerprint, projectId}`.

- Two different owner keys may not claim the same database name.
- Two different owner keys may not claim the same OPFS root directory name.
- Equality in either destructive dimension is enough to reject; an equal
  database with different stores is still one whole-database collision, and an
  equal directory with different databases is still one recursive-directory
  collision.
- A retry of the same owner and exact physical tuple remains legal and
  idempotent.
- Duplicate or conflicting current/historical claims fail before certificate
  writes, logical commit, or cleanup I/O.

`knownMedia` is produced by the existing strict ownership state: binding-scoped
owners plus exact descriptors, with current candidates added before a write.
The policy does not reinterpret raw rows. `knownLibraries` contains the current
identity plus strictly decoded retained library-clear descriptors.

This protects exact aliases among BrowserProjectStore-owned current/historical
roots. Arbitrary same-origin OPFS roots with no durable adapter claim cannot be
distinguished from legacy bytes using the current state model; claiming that
scope would require Candidate D. Attempt 4 must not advertise protection for an
unregistered external root.

## Call-site seams and ordering

### 1. Static identity / initialization

`BrowserProjectStore` creates the pure topology object once. Before the first
`idbGetAll`, object-store creation, cascade retry, ownership certification, or
migration call, initialization authorizes `static-identity`.

This rejects library aliases to `PS/C/O/A/G` and `LDB=SP/SA` with zero storage
side effects. All public methods already await initialization, so they inherit
the same gate. Directly callable migration entry points repeat the static gate;
they do not assume construction through the outer adapter.

### 2. Attachment registration and first access

`registerMediaOwner` is the single required seam for attachment list/load/save/
remove and migration attachment access. Before descriptor/owner/certificate,
attachment metadata, IndexedDB media database, or OPFS access:

1. derive the exact candidate and fingerprint;
2. run the static protected-database check;
3. strictly read existing ownership state;
4. authorize `media-access` against every known claim;
5. only then put descriptor/owner and access physical media.

`refreshMediaOwnership` performs one full topology authorization over all
inventory-discovered claims before it backfills owners or writes a coverage
certificate. It may not bless `PDB`, `LDB`, `SP/SA`, a legacy timeline DB, or a
cross-binding exact DB/directory alias merely because the prefix parses.

### 3. Project removal precommit

Before `idbCommitProjectRemoval`, derive the current media target, read the
known ownership claims, and authorize a one-target cascade plan. Refusal occurs
before project-row delete and tombstone put. The current v1 tombstone format may
remain; safety comes from both precommit and retry authorization.

### 4. Projects/all clear precommit

`planMediaClear` authorizes all current/historical media claims as one set
before returning. After library target preparation, the cascade manager runs
one cross-domain `cascade-cleanup` authorization before abort recheck and before
the logical clear transaction. Thus a library pair alias or media-library
whole-database alias cannot commit a journal/tombstone first.

### 5. Cascade retry/reload

After strict journal codec plus media certificate and library descriptor
validation, `cleanup` authorizes the complete decoded media/library set and
obtains a permit. No database or directory is deleted and no library store is
cleared until the complete preflight succeeds. It executes only permit targets.

An unsafe historical row is retained with a fixed
`project-cascade-topology-conflict`, `unavailable`, nonretryable diagnostic.
Earlier safe targets in the same journal are not partially deleted.

### 6. Migration planning and staging

Split the current migration loop into read/transform/plan and mutate phases:

1. read and transform every candidate in memory, derive all legacy and stage
   cleanup claims, and collect every media registration candidate;
2. strictly collect current/historical media and library claims;
3. authorize the complete migration plan;
4. only then register media owners, write stage rows, or persist recovery/
   cleanup intent.

This is required for batch atomic refusal: a topology conflict in candidate N
cannot leave stage/owner writes from candidates 1..N-1.

The early pre-recovery `cleanupStageDatabases` path consumes the already
authorized stage permit. It does not reconstruct raw names after a failure.

### 7. Migration retry/reload

`readRecoveryJournal` and `readCleanupJournal` retain their strict codecs. After
decoding, but before writing/merging cleanup intent, registering media, or
deleting a target, authorize the entire recovery/cleanup target set against
current and retained claims. `retryPendingCleanup` no longer validates and
deletes one row at a time; a single unsafe target prevents every delete and
journal rewrite.

The retained diagnostic is `migration-cleanup-topology-conflict`,
`unavailable`, nonretryable. Recovery/cleanup records remain available for an
explicit repair rather than being weakened into a syntactic allowlist.

## State and commit semantics

```text
NEW CURRENT OPERATION
  -> static + exact target + full-plan topology authorization
     -> conflict: reject, zero durable/physical mutation
     -> permit: existing logical commit / physical operation proceeds

PERSISTED HISTORICAL JOURNAL
  -> strict codec/authentication
  -> full topology authorization
     -> safe permit: exact idempotent retry, then journal completion
     -> conflict: no physical I/O, no journal rewrite, retained diagnostic
```

### Same-project-ID behavior

- **New/current conflict:** refusal precedes media owner registration and any
  remove/clear logical commit. No tombstone or journal exists. After reopening
  with a collision-free identity, saving the same project ID succeeds. This is
  the only convergence claim required of the new guard.
- **Historical unsafe cascade journal:** the logical remove/clear already
  committed before attempt 4 existed. The journal is not deleted, rewritten to
  current config, or declared complete. `pendingCleanupForProject` continues to
  reject same-ID save with mechanism-neutral `unavailable`. If its target is
  intrinsically a protected database such as shared `PDB`, automatic
  convergence is impossible; an explicit audited repair/remapping tool would be
  required and is outside attempt 4.
- **Historical unsafe migration state:** the complete recovery/cleanup record is
  retained and no delete occurs. Recovery is not reported complete. A cleanup-
  only journal does not gain a new same-ID promise; its existing public-save
  semantics remain, while maintenance stays visibly unresolved. Do not report
  convergence merely because public project rows are readable.

This deliberately prefers retained unavailability to unauthorised deletion.

## Failure matrix

| Event | Required durable result | Required observation |
| --- | --- | --- |
| Static library/control or stage alias | no database/store creation | first operation refuses generically; raw sentinels unchanged |
| Current `MDB=PDB/LDB/SP/SA` at attachment first use | no owner/descriptor/certificate, media DB, metadata, or OPFS write | `unavailable` at attachment scope |
| Current unsafe project remove | project row remains; no tombstone | no database/directory delete; safe-wrapper same-ID save succeeds |
| Current unsafe projects/all clear | all projects/control/library state remains; no journal | no physical cleanup starts |
| Inventory discovers protected or duplicate claim | no backfill/certificate | certification remains unavailable; clear cannot commit |
| Historical cascade conflict | journal and all targets unchanged | nonretryable topology diagnostic; same-ID stays blocked |
| Cross-binding exact DB or directory alias | no target from the set executes | both owners' sentinels survive |
| Migration plan conflict before staging | source projects and live DBs unchanged; no stage/owner/recovery/cleanup writes | migration returns failed/unavailable |
| Historical migration journal contains one unsafe target after safe targets | entire journal retained unchanged | zero target deletes; no partial journal shrink |
| Safe same-owner historical retry | existing exact state | idempotent cleanup completes and journal is removed |

## Minimum product write set

No public `ProjectStore`, Host, session, or migration transformer interface
changes are required.

1. **New** `apps/web/src/services/storage/browser-project-store-topology.ts` -
   canonical internal/stage names, policy interface, normalized permits, exact
   database/store/directory classification, and internal conflict type.
2. `browser-project-store.ts` - construct/static gate before initialization I/O;
   pass topology to cascade/migration/ownership internals.
3. `browser-project-store-media-ownership.ts` - expose strictly decoded physical
   claims internally; validate current/discovered claims before writes and full
   clear plans before return.
4. `browser-project-store-library-clear-bindings.ts` - expose strict retained
   library claims and invoke the exact-pair/static policy; preserve attempt-3
   fingerprint authorization.
5. `browser-project-store-cascade-manager.ts` - removal precommit,
   projects/all cross-domain precommit, and full retry preflight; execute permit
   targets and preserve nonretryable conflict diagnostics.
6. `browser-project-store-cascade.ts` - delegate canonical maintenance-store
   naming only; no journal revision is required.
7. `browser-project-store-migration.ts` - delegate `G/SP/SA` naming, add complete
   pre-stage plan authorization, pass authorized stage cleanup, and preflight
   complete historical journals before any delete.
8. `browser-project-store-cascade-round2-probes.ts` - T1-T7/T10 cascade,
   library, current/historical media, OPFS, and same-ID cases using existing raw
   journal/sentinel/full-binding fixtures.
9. `browser-project-store-migration-round2-probes.ts` - T8/T9 stage and legacy
   migration collision cases at the migration-local seam.
10. `apps/vite-example/src/c5-storage-harness.ts` and
    `apps/vite-example/tests/c5-storage/browser-store.pw.ts` - explicit result
    aggregation/assertions.
11. A focused pure topology test beside the storage tests for exact-pair versus
    database-wide rules and duplicate-owner normalization.

`browser-storage-mechanisms.ts`, the public port, and persisted v3 codecs do not
need changes. IndexedDB/OPFS mechanisms continue to execute only after callers
hold a topology permit.

## Explicit real-Chromium result fields

Add semantic booleans, not one generic topology bit.

### Cascade round 2

```text
topologyLibraryReservedPairsRejectAtomically
topologySharedProjectsDatabaseSafeLibraryStoreWorks
topologyMediaProjectsDatabaseAccessRejectsWithoutAuthority
topologyMediaProtectedDatabasesRefuseRemoveAndClearPrecommit
topologyHistoricalProtectedMediaJournalFailsClosed
topologyHistoricalPhysicalAliasesFailClosed
topologyPrecommitRefusalAllowsSafeSameIdReuse
topologyHistoricalUnsafeJournalKeepsSameIdBlocked
topologyCollisionFreeCascadeStillConverges
```

- `topologyLibraryReservedPairsRejectAtomically` is table-driven over
  `PS/C/O/A/G`, including the attempt-3 `A` and certificate-erasing `O` crash
  windows. Every raw row/sentinel remains byte-identical and no clear journal is
  created.
- `topologyMediaProtectedDatabasesRefuseRemoveAndClearPrecommit` is table-driven
  over `PDB`, current/retained `LDB`, `SP`, and `SA`, covering remove, projects,
  and all where meaningful.
- `topologyHistoricalProtectedMediaJournalFailsClosed` proves the entire
  journal remains and no earlier safe target runs before the unsafe target.
- `topologyHistoricalPhysicalAliasesFailClosed` has separate exact-database and
  exact-OPFS-directory subcases across distinct owner keys.
- The two same-ID fields intentionally distinguish new precommit convergence
  from historical retained blockage.

### Migration round 2

```text
topologyStageCleanupAliasesRefuseBeforeMutation
topologyLegacyCleanupAliasesRefuseBeforeMutation
topologyHistoricalMigrationJournalFailsClosedWithoutPartialCleanup
```

- Stage cases include `SP=LDB` and `SA=current MDB` with pre-recovery and
  postcommit-cleanup faults.
- Legacy cases table exact timeline targets against `PDB`, current/retained
  `LDB`, and current/retained `MDB`.
- Assertions snapshot source projects, all `PS/C/O/A/G` control rows, both stage
  databases, library rows, media metadata/body, cleanup/recovery journals, and
  OPFS entries as applicable.

The positive control keeps collision-free production/disposable identities and
same-owner exact retry green. Existing 24 cascade-round2 fields, migration
lifecycle fields, attempt-2/3 matrices, corrupt-row checks, and abort checks all
remain mandatory.

## Acceptance commands

From `apps/vite-example`, the authoritative real-browser gate is:

```text
bunx playwright test --config playwright.c5-storage.config.ts
```

The focused browser iteration command is:

```text
bunx playwright test --config playwright.c5-storage.config.ts tests/c5-storage/browser-store.pw.ts
```

From repository root, also run the focused topology/unit storage tests, direct
Vite TypeScript, repository type baseline, focused ESLint/Prettier over every
touched file, the four architecture boundary checks used by C5, and whitespace
diff check. Record the exact commands, exit codes, assertion counts, Chromium
version, and `git rev-parse HEAD^{tree}` in implementation/verification evidence.

Planning artifact validation is:

```text
rasen validate s02-storage-port --project rocut --strict
```

Planner result: **exit 0** - `Change 's02-storage-port' is valid`; Rasen resolved
project `rocut` at `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut`.

## Exit gate

This design does not close F1-F3. Closure requires:

1. implementation of the centralized policy and every call-site ordering rule;
2. all explicit Chromium topology fields and retained C5 matrices green;
3. focused type/lint/format/boundary evidence against the same tree; and
4. an independent non-author reviewer/verifier confirming zero side effects,
   historical fail-closed behavior, and no over-rejection of safe shared-PDB
   library stores.

Until then: **F1 Blocker open; F2/F3 Majors open; attempt 4 design complete but
not verified**.
