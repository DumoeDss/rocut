# C5 strategy attempt 4 - physical topology and alias audit

Date: 2026-08-02  
Branch/worktree: `feat/s02-storage-port` / `rocut-wt-c5`  
HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Mode: dispatched read-only inventory; no subagents, product/task/run-state edits,
prior-report edits, test writes, commit, or CLEAN verdict

## Scope and notation

This audit inventories the physical storage topology reached by the current
`BrowserProjectStore`, cascade, migration, media-ownership, library-clear,
control, mechanism, and Chromium harness code. It records which caller-valid or
historically authorized identities can collapse two logical domains onto the
same physical database, object store, or OPFS directory.

Notation:

```text
PDB       = identity.projectsDatabase
PS        = identity.projectsStore
LDB / LS  = identity.libraryDatabase / identity.libraryStore
MDB(p,b)  = b.mediaDatabasePrefix + projectId
MDIR(p,b) = b.mediaDirectoryPrefix + projectId

C = PS + "-cascade-maintenance"
O = PS + "-media-ownership"
A = PS + "-library-clear-bindings"
G = PS + "-migration-maintenance"

SP = PDB + "-c5-projects-stage"
SA = PDB + "-c5-attachments-stage"
```

`validateStorageIdentity` checks only that every string is nonempty and does
not contain `undefined` (`browser-project-store-internals.ts:108-116`). It has
no database/store/directory disjointness rule. Media target validation proves
that a target was derived from a certified binding and project ID
(`browser-project-store-media-ownership.ts:272-302,685-699`); library target
validation proves exact descriptor equality
(`browser-project-store-library-clear-bindings.ts:164-193`). Neither proves
that the exact physical target belongs exclusively to its logical domain.

## 1. Projects database inventory

All five stores below are in `PDB`. `openDatabaseStores` creates a missing
store on first access (`browser-storage-mechanisms.ts:38-90`). The four suffix
stores are mutually distinct from `PS` and from each other by construction, but
caller-selected `LS` or `mediaStore` can equal any of them when its database is
also `PDB`.

| Store | Role/content | Ordinary mutation granularity | Destructive mutation |
| --- | --- | --- | --- |
| `PS` | Public project envelopes keyed by project ID | row `put` on save; row `delete` on remove | whole-store `clear` for `clear(projects/all)` inside the logical commit transaction |
| `C` | Project tombstones and v1/v2/v3 clear journals | row `put`/`delete`; project save deletes one tombstone | whole-store `clear` and replacement during projects/all logical commit |
| `O` | Retained media binding descriptors, owner rows, coverage certificates, legacy binding state | row/batch `put`; read-all strict codec | no intentional clear or GC |
| `A` | Retained exact library-clear authorization descriptors | descriptor `put`; exact-key read | no intentional clear or GC |
| `G` | `migration-recovery` and `postcommit-cleanup` journals | two fixed-key `put`/`delete` operations | no intentional store clear |

Relevant naming sites are `cascadeMaintenanceStoreName`
(`browser-project-store-cascade.ts:131-133`), `mediaOwnershipStoreName`
(`browser-project-store-media-ownership.ts:96-98`),
`libraryClearBindingStoreName`
(`browser-project-store-library-clear-bindings.ts:42-44`), and
`cleanupJournalStore` (`browser-project-store-migration.ts:1321-1323`).

Project removal atomically deletes one `PS` row and puts a tombstone in `C`.
Projects/all clear atomically clears `PS`, clears/repopulates `C`, and, for all
scope, puts the descriptor in `A`
(`browser-storage-mechanisms.ts:253-344`). These are store/row operations, not
database deletion. The later cascade is what deletes whole media databases.

## 2. Library inventory

The exact library target is `(LDB, LS)`. Current records use encoded
`c5-library:<namespace>:<key>` keys; legacy saved sounds use `user-sounds`.

| Operation | Physical mutation |
| --- | --- |
| save/remove record | one row `put` / one row `delete` in `(LDB, LS)` |
| `clear(library namespace)` | one readwrite transaction deleting only matching encoded keys, plus `user-sounds` for the saved-sounds namespace (`browser-project-store.ts:1264-1278`) |
| `clear(all)` physical phase | whole-object-store `idbClear(LDB, LS)`, never whole `LDB` (`browser-project-store-cascade-manager.ts:372-382`) |

The all-clear target is authorized by a retained descriptor in `(PDB, A)`, but
the binding codec permits `LDB=PDB` and `LS` equal to a public or control store.
The current identity also permits `LDB` to equal a media, stage, or legacy
database.

## 3. Media inventory

For each project ID and each current or retained historical media binding:

| Target | Contents | Ordinary mutation | Cascade mutation |
| --- | --- | --- | --- |
| `MDB(p,b)` / `b.mediaStore` | attachment metadata/tombstones keyed by attachment key | row `put`; reads; tombstones replace rows | **whole `MDB(p,b)` database deletion**, regardless of what other object stores it contains |
| root OPFS `MDIR(p,b)` | temporary `.c5-stage-*` files and committed `.c5-body-*` files | file write/read/delete | **recursive deletion of the whole root directory** |

The exact names are concatenations with an unconstrained project ID
(`browser-project-store-internals.ts:259-270`). Cascade performs
`indexedDB.deleteDatabase(name)` and recursive `removeEntry(name)` only after
authorization preflight (`browser-project-store-cascade-manager.ts:351-382`;
mechanisms at `browser-storage-mechanisms.ts:589-597,722-730`). The media store
name is not part of the deletion granularity: a certified media target deletes
every object store in the derived database.

`refreshMediaOwnership` inventories every origin database/directory whose name
starts with a binding prefix, derives the suffix as a project ID, records it as
an owner, and then certifies the binding
(`browser-project-store-media-ownership.ts:343-401,630-667`). Consequently, if
`PDB` or `LDB` starts with the configured media prefix, the inventory process
can itself bless that live database as media ownership rather than reject the
overlap.

## 4. Migration, staging, and legacy targets

| Physical target | Store/content | Normal access | Cleanup mutation |
| --- | --- | --- | --- |
| `SP` | `staged-projects` | staged project row `put`/read | whole database deletion |
| `SA` | `staged-attachments` | staged attachment rows `put`/read | whole database deletion |
| `(PDB, G)` | recovery and cleanup journals | fixed-key row `put`/read/delete | no intentional database/store clear |
| `video-editor-timelines-<projectId>` | legacy `timeline` store | read through legacy adapter | whole database deletion after intent |
| `video-editor-timelines-<projectId>-<sceneId>` | legacy `timeline` store | read through legacy adapter | whole database deletion after intent |
| `video-editor-media-<projectId>` | legacy `media-metadata` store | read for media type; may also be the current default media DB | not placed in the migration cleanup journal |
| `media-files-<projectId>` | legacy/current default OPFS directory | allowed by the legacy-target validator | no live BrowserProjectStore migration cleanup caller currently emits a directory target |

Stage names are derived at `browser-project-store-migration.ts:129-134`; stage
rows are written at `:510-525`; cleanup targets are assembled at `:686-709`.
Both normal postcommit cleanup and early pre-recovery failure cleanup delete the
entire stage databases (`:1292-1315,1443-1451`). Legacy timeline allowlisting is
string-shape/project-policy validation only (`:175-200,1413-1438`) and cleanup
again deletes the entire database.

The older `migrations/runner.ts` path additionally names
`video-editor-meta`, but no current production caller of `runStorageMigrations`
was found. It is excluded from the live C5 graph above.

## Mutation-granularity summary

```text
project/library/media records      -> row put/delete
library namespace clear            -> selected row deletion in one store transaction
projects/all logical clear         -> whole PS/C store clears in one PDB transaction
all library physical clear         -> whole LS store clear
cascade media cleanup              -> whole MDB database + whole OPFS directory deletion
migration stage/legacy cleanup     -> whole database deletion
```

The safety boundary therefore cannot be expressed only as “the target tuple is
authentic.” Every whole-database/whole-directory target also needs a topology
ownership/disjointness invariant.

## Exact reachable alias families

### Current caller-valid identities

The constructor accepts all of these exact equalities:

1. `MDB(p,current) = PDB` for any existing/caller-provided `p` satisfying the
   concatenation, including an inventory-derived owner when `PDB` starts with
   the media prefix.
2. `MDB(p,current) = LDB`.
3. `MDB(p,current) = SP` or `SA`, or another application's/database domain.
4. `LDB=PDB` with `LS` equal to `PS`, `C`, `O`, `A`, or `G`.
5. `LDB=MDB(p,current)` with `LS=mediaStore` or another store in that database.
6. `LDB=SP/SA` with `LS=staged-projects/staged-attachments`.
7. `MDIR(p,current)` equal to any pre-existing root OPFS directory name.

If a media database is `PDB`, caller-selected `mediaStore` may additionally be
`PS/C/O/A/G`, causing ordinary attachment rows to share or overwrite logical
and control rows before any cascade. Likewise, `LDB=PDB, LS=PS` lets a library
save overwrite a project whose ID equals the encoded library key; strict
read-all codecs diagnose other mixed-row cases only after contamination.

### Retained historical authority

- v2/v3 media journals retain exact targets backed by descriptors/certificates
  in `O`. A previously valid binding can therefore make
  `MDB(p,old)=PDB/LDB/SP/SA` under the reopening wrapper's current topology.
- v1 project tombstones recompute the current exact media names; v1 clear
  journals accept any database/directory name under the current prefixes
  (`browser-project-store-cascade-manager.ts:580-616`). Neither revision checks
  protected topology.
- v3 library journals retain exact `(database, store)` targets backed by `A`.
  They can name any of the public/control/stage/media stores above.
- migration cleanup journals retain stage targets or syntactically allowed
  legacy timeline targets. A configured `PDB`, `LDB`, current media DB, or stage
  DB can have the same exact string as one of those target names.
- Across historical media bindings, two different `(fingerprint, projectId)`
  pairs can derive the same exact database or directory. Target deduplication
  keys by fingerprint/project ID, not solely by physical name; retry validation
  re-derives each name but does not reject that cross-binding physical alias.

## Fail-closed stage audit

Legend: **OPEN** means no topology refusal; **CONDITIONAL** means a strict row
codec may notice already mixed data, but the alias itself is not rejected;
**LATE CLOSED** means retry stops only after an earlier operation destroyed its
authorization; **N/A** means the path has no cascade logical-clear phase.

| Exact alias family | Construction | First use | Logical clear precommit | Retry preflight |
| --- | --- | --- | --- | --- |
| `MDB(p,b)=PDB` | **OPEN** | **OPEN** when `mediaStore` is distinct; **CONDITIONAL** row-codec failure when it aliases `PS/C/O/A/G` | **OPEN**; remove writes a tombstone, and projects/all can certify the derived target | **OPEN** for exact v1 or certified v2/v3; then whole `PDB` is deleted |
| `MDB(p,b)=LDB` | **OPEN** | **OPEN** with a distinct media store; **CONDITIONAL** if metadata/library rows mix | **OPEN**; projects scope does not treat `LDB` as protected | **OPEN**; whole `LDB` is deleted |
| `MDB(p,b)=SP/SA` | **OPEN** | **OPEN** with distinct stores | **OPEN**; no stage/recovery cross-check | **OPEN**; cascade runs before migration recovery during initialization and can delete required stage state |
| historical `MDB/MDIR` equals another live binding's exact target | **OPEN** | **OPEN**; inventory rejects only a presently ambiguous prefix match, not every retained exact overlap | **OPEN**; authorization is per fingerprint/project | **OPEN**; whole database/directory is removed |
| `(LDB,LS)=(PDB,A)` | **OPEN** | **OPEN**; exact descriptor reads ignore unrelated library rows | **OPEN**; descriptor is atomically put, then the authorized store is cleared | initially **OPEN**; after a post-clear crash it becomes **LATE CLOSED** because the descriptor is gone, permanently retaining the journal |
| `(LDB,LS)=(PDB,O)` | **OPEN** | **CONDITIONAL** after library rows contaminate the strict ownership codec | **OPEN** while uncontaminated; physical library clear erases media certificates | initial preflight **OPEN**; a later retry with media targets fails after authority was erased |
| `(LDB,LS)=(PDB,PS/C/G)` | **OPEN** | **CONDITIONAL** once strict project/library/cascade reads see mixed rows | **CONDITIONAL** if contamination is already visible; otherwise no topology rejection | **OPEN**; exact descriptor authorizes the store clear. `C` is cleared only after all media work, while `G` may lose migration journals |
| `(LDB,LS)` equals media/stage/legacy data store | **OPEN** | **CONDITIONAL** if strict codecs encounter the other domain's rows | **OPEN** absent visible contamination | **OPEN**; exact library descriptor authorizes whole-store clear |
| migration `SP/SA = LDB` or a current media DB | **OPEN** | **OPEN**; staging creates/uses its fixed store in the aliased DB | **N/A**; no protected-database comparison before cleanup intent or early-failure cleanup | **OPEN**; exact stage name is allowlisted, then the whole database is deleted |
| migration legacy timeline target = `PDB/LDB/MDB/SP/SA` | **OPEN** | **OPEN**; legacy read validates only the legacy name form/policy | **N/A** | **OPEN**; journal decode repeats the same syntactic allowlist and deletes the whole database |
| `MDIR(p,b)` equals unrelated live OPFS root | **OPEN** | **OPEN**; file keys can coexist or collide | **OPEN** | **OPEN**; recursive root-directory deletion |

The current system therefore fails closed against forged or malformed target
records, but not against an authentic target whose physical name aliases a
protected domain. Row-codec rejection is not a substitute: it occurs only after
co-location has already been used and does not protect distinct stores inside a
whole database deletion.

## Most dangerous aliases

1. **`MDB(p)=PDB`** - remove/project clear deletes every project plus all four
   durable control stores. Cleanup can then recreate an empty `PDB`, masking the
   fact that unrelated projects and authorization history were lost.
2. **`MDB(p)=LDB`** - removing one project or `clear(projects)` deletes the whole
   library database even though no library clear was authorized.
3. **migration `SP/SA` or a legacy timeline cleanup target equals
   `PDB/LDB/current MDB`** - early failure or journal retry deletes live data at
   whole-database granularity; the syntactic allowlist still passes.
4. **`(LDB,LS)=(PDB,A)`** - all-clear erases its own library authorization;
   post-library/pre-journal crash becomes permanently non-convergent, as
   reproduced in strategy-attempt-3 review.
5. **`(LDB,LS)=(PDB,O)` or an historical `MDIR` equals a live directory** - the
   first erases media certificates needed by a retained v3 journal; the second
   recursively deletes another binding's bytes. Neither exact-name path has a
   protected-topology guard.

## Durable findings

### F1 - Blocker: certified media targets can delete the projects or library database

The cascade uses whole-database deletion, while media certification proves only
prefix/project derivation. A caller-valid current identity or retained binding
can make the derived database exactly `PDB` or `LDB`. Construction, logical
precommit, and retry all accept it. Project removal or projects clear can then
destroy unrelated projects, control authority, or all libraries. This is a
direct data-loss path, not only a recovery availability issue.

### F2 - Major: migration cleanup authority is not disjoint from live databases

Stage target authorization compares only against the two names derived from
`PDB`; legacy target authorization checks only the fixed legacy name shape and
disposable project policy. Neither rejects equality with `LDB`, a current media
database, or (for a configured legacy target) `PDB`. Both the early-failure
stage cleanup and journal retry delete whole databases. Custom migrations are
policy-constrained, but the accepted path can still delete live target-domain
data.

### F3 - Major: public/library/media stores may alias durable control stores

The strategy-attempt-3 `A` self-erasure is one instance of a broader missing
store-topology invariant. `LS` or `mediaStore` can equal `PS/C/O/A/G` when the
database is `PDB`. Outcomes range from row overwrite and late codec corruption
to erased retry authorization. Authentic descriptor validation does not reject
these layouts.

## Recommended Chromium test matrix

Each negative test should use randomized disposable names, place byte-distinct
sentinels in every protected domain, inject a fault where relevant, reset
runtime, and assert both logical and physical state. The expected contract is
either construction/first-use rejection before any write, or atomic precommit
refusal before any logical or physical clear.

| ID | Configuration/event | Required assertion |
| --- | --- | --- |
| T1 | `MDB(project)=PDB`, then remove that project | refuse before project/tombstone commit; another project plus `C/O/A/G` sentinels remain byte-identical |
| T2 | `MDB(project)=LDB`, then remove and separately `clear(projects)` | refuse; every library store/sentinel survives and no cascade journal is committed |
| T3 | seed a certified historical v3 media journal whose exact DB now equals reopening `PDB` or `LDB` | retry preflight refuses before any database/directory deletion; journal and all sentinels remain |
| T4 | historical old/new media bindings derive the same DB and, separately, the same OPFS directory | reject ambiguous physical ownership before commit/retry; neither binding's sentinel is deleted |
| T5 | `(LDB,LS)=(PDB,A)`, all-clear, post-library/pre-journal fault | precommit refusal with all state intact, or proven convergent retry with same-ID save unblocked |
| T6 | `(LDB,LS)=(PDB,O)` with at least one media target and the same crash window | media certificates and journal authority remain; reload converges or precommit refuses |
| T7 | `LS=PS`, `LS=C`, and `LS=G`, including a project ID equal to an encoded library key | no row overwrite, no cross-domain namespace deletion, and no loss of control journals |
| T8 | `SP=LDB` and `SA=current MDB`; inject pre-recovery failure and postcommit cleanup failure | stage cleanup must not delete library/current attachment sentinels; intent remains recoverable |
| T9 | syntactically valid legacy timeline target exactly equals `PDB`, `LDB`, or current `MDB` | migration refuses before staging/intent/cleanup; source and target sentinels survive |
| T10 | collision-free production/disposable identities and exact same-tuple historical retry | preserve all existing green behavior; exact idempotent retry remains allowed |

Existing Chromium coverage proves forged target rejection, descriptor tamper,
changed-binding exact retry, legacy boolean handling, cardinality, and ordinary
crash idempotence. No existing probe found by this audit makes a media database
equal `PDB/LDB`, aliases a library/media store with `PS/C/O/A/G`, aliases a
migration cleanup target with a live database, or exercises cross-binding exact
OPFS-name overlap.

## Recommended invariant boundary

No single constructor-only check is sufficient because media names depend on
project IDs and historical journals. Enforce the same topology policy at:

1. identity construction/initialization for directly knowable database/store
   relationships;
2. first target derivation/registration for every current project ID;
3. logical clear precommit over the complete proposed target set; and
4. every historical journal retry before the first physical operation.

At minimum, a whole-database delete target must be rejected when it equals
`PDB`, `LDB`, either migration stage DB, or another protected/current target
whose deletion is not part of that exact logical operation. Within `PDB`,
public and all four control store names must be reserved against library/media
store use. Physical duplicate media database/directory targets across retained
bindings need an explicit ownership rule keyed by physical name, not only by
fingerprint/project ID.

This document is an inventory and risk report only. It intentionally does not
declare attempt 4 or the review cycle CLEAN.
