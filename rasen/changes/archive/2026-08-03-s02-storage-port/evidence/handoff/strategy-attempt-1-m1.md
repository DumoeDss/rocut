# Handoff - C5 strategy attempt 1 M1 implementer

Date: 2026-08-02  
Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`  
Branch/base: `feat/s02-storage-port` at uncommitted base `0ef35459`  
Full evidence: `evidence/strategy-attempt-1-m1.md`

## State

Preferred M1-A is implemented and green. M2 has not been started. Do not reopen
M1 by adding another project-row condition or by treating physical absence as a
delete; the durable protocol is now in place:

- attachment v2 save row = fresh mutation ID + SHA-256 body digest + byte length;
- remove = durable v2 tombstone, hidden from public list/load;
- migration stage/recovery = stable migration mutation ID plus exact
  original/staged metadata and body fingerprints;
- recovery = per-project and per-key state machine; later valid v2 save/remove
  wins in both original-project and staged-project phases;
- unexplained absence, malformed row, legacy mismatch, or digest mismatch keeps
  recovery and rejects retryably;
- staged project put remains last; recovery/stage deletion remains last;
- tombstones are deliberately retained unless replaced or removed by safe
  whole-project cascade.

The real Chromium RED first showed all four legal later winner axes false and
both ambiguity controls true. Final focused and full runs show all six true;
the full config is 3/3 green on Chrome 151. Store conformance remains 19/19 and
migration lifecycle races 16/16.

## Next action: implement M2 only

Follow `evidence/strategy-attempt-1-design.md` candidate M2-A and the planner
handoff. Add a third, independent media-ownership object store with logical
project owners and a verified coverage certificate. Registration must precede
every creation-capable media access, including reads, inside the existing shared
queue. Replace unsupported-enumeration-as-empty with capability-aware inventory.
Projects/all clear must union project, cascade tombstone, owner, and optional
enumerated orphan identities and derive exact DB/directory targets. Certified
ownership may proceed without `indexedDB.databases`; uncertified ownership must
reject before project/library commit when a complete sweep cannot run.

Use the existing cascade round-2 Chromium probes and shared harness for
acceptance evidence 5-7. Do not merge migration, cascade, and ownership stores;
do not expose physical names/tokens through the public port or diagnostics; do
not touch C6/C7/E1.

## Files M1 changed

- `browser-project-store-records.ts`
- `browser-project-store.ts`
- `browser-project-store-migration.ts`
- `browser-project-store-migration-round2-probes.ts`
- `c5-storage-harness.ts`
- `browser-store.pw.ts`

The test-only `beforeProjectCommit` hook is required to cover the original
project phase. `save-manager.ts` was only Prettier-normalized to remove a
pre-existing CR-at-EOL `git diff --check` failure discovered by the final gate.

## Green commands and cleanup

- Vite TypeScript: PASS
- focused C5 storage/negative suite: 21/21
- focused browser store: 1/1; 19/19 shared cases; all M1 axes true
- full C5 Chromium config: 3/3
- port/session/storage/Host boundaries: PASS
- strict Rasen validation: 1/1 valid, zero issues
- Prettier and strict diff: PASS
- Playwright output marker removed; port 4175 released; disposable browser
  identities/stages cleaned; no user profile touched
- commit: none

After M2, rerun the complete Chrome matrix, focused tests, type gate, all four
boundaries, strict diff and strict Rasen validation, then request a non-author
re-review of both round-3 Majors. C5 remains blocked for ship until that review
confirms both.
