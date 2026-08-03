# Handoff - C5 review-cycle strategy attempt 1 planner

Date: 2026-08-02  
Mode: design-level H.5/H.6 rework, report-only  
State: strategy selected; M1/M2 remain open and block ship  
Full design: `evidence/strategy-attempt-1-design.md`

## Preferred implementation

### M1

Use attachment-envelope v2 write epochs plus durable attachment delete
tombstones. Extend migration recovery with exact original/staged metadata
snapshots and body digests. Reconcile every staged key independently of the
project row:

- exact original may be migrated only while the project row is original;
- exact migration stage is migration-owned;
- another valid mutation ID is a later save and wins;
- another valid tombstone is a later remove and wins;
- unexplained absence, malformed state, or digest mismatch is ambiguous and must
  retain recovery.

The later save metadata put and later remove tombstone put are their logical
commit points in the same media IndexedDB. This avoids adding a projects-DB
acknowledgement after the media commit.

### M2

Add an independent media-ownership object store containing logical project IDs
and a verified complete-coverage certificate. Register an owner before every
creation-capable media access, including reads that call `indexedDB.open`, and put
that registration/access under the existing durable-identity queue so
`all-projects` clear cannot miss an in-flight owner.

Clear unions project, cascade-tombstone, owner, and optional enumerated orphan
IDs; it derives the exact media DB and directory for every ID. Enumeration is
required only to certify/backfill an older incomplete registry. Without
`indexedDB.databases()`:

- certified registry: proceed from exact derived targets;
- uncertified registry: reject `unavailable` before the project transaction.

Never represent unsupported enumeration as an empty list.

## Non-negotiable commit points

1. Migration recovery/stage evidence precedes destination attachment writes.
2. Attachment save commits at its v2 metadata put after body validation.
3. Attachment remove commits at its tombstone put; body deletion is postcommit.
4. Owner registration precedes any media DB/directory open that can create state.
5. Projects/all clear commits only when the complete exact target journal and
   project invisibility are installed atomically in the projects database.
6. Physical cleanup and all-clear library cleanup remain journaled postcommit
   maintenance.

## Do not do

- Do not treat physical absence as a later attachment delete.
- Do not validate all attachments solely because the project row equals staged.
- Do not add a second projects-database supersession transaction unless the
  preferred same-row token/tombstone design is rejected.
- Do not derive only current project rows and assume there are no legal
  never-created attachment owners or legacy orphans.
- Do not let unsupported/failed enumeration collapse to `[]`.
- Do not merge migration, cascade, and ownership maintenance stores or expose any
  of their physical names through `ProjectStore`/diagnostics.
- Do not mark the review clean until a non-author re-review confirms both Majors.

## Minimum write set

- `browser-project-store-records.ts`
- `browser-project-store-migration.ts`
- `browser-project-store.ts`
- new `browser-project-store-media-ownership.ts`
- `browser-project-store-cascade-manager.ts`
- `browser-storage-mechanisms.ts`
- existing migration/cascade round-2 Chromium probes
- `c5-storage-harness.ts`
- `browser-store.pw.ts`

No public port, Host, consumer, library-coordinator, protected-session, task, or
existing review/evidence edit is required. Strategy attempt count is **1/3**; no
product fix or commit was created by this planner.

