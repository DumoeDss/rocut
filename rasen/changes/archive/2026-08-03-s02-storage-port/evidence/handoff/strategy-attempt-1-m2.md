# Handoff — C5 strategy attempt 1 M2 implementer

Date: 2026-08-02  
Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`  
Branch/base: `feat/s02-storage-port` at uncommitted base `0ef35459`  
Full evidence: `evidence/strategy-attempt-1-m2.md`

## State

Preferred M2-A is implemented and green. Preferred M1-A remains intact and green.
Both round-3 Majors now require independent non-author review before C5 can ship.

The durable M2 protocol is now:

- independent `${projectsStore}-media-ownership` object store;
- strictly key-bound logical owner rows plus a complete-coverage certificate;
- certificate only after one successful full IndexedDB-name and OPFS-root sweep;
- explicit `available(names)` versus `unsupported` database enumeration;
- write-ahead owner registration before every creation-capable public,
  initialization, and migration media access;
- attachment reads register and access media inside the shared durable queue;
- projects/all clear unions strict project, cascade tombstone, owner, and optional
  enumerated orphan IDs, then derives exact DB/directory targets;
- certified registry proceeds without enumeration; uncertified/masked registry
  rejects before project/media/library mutation;
- owner registry survives clear while cascade journal cleanup stays postcommit,
  idempotent, and retryable.

## Do not regress

- Never convert unsupported or failed enumeration to `[]`.
- Never write the coverage certificate from project rows alone or from an
  incomplete capability sweep.
- Never open/create a current media DB/directory before its logical owner is
  durable.
- Keep registration and the following media access in the existing shared queue;
  migration is already inside `all-projects` and must not recursively queue.
- A project tombstone must stop attachment reads/removes from recreating empty
  media targets. Explicit project save is the operation that reopens that scope.
- Treat malformed project/cascade/owner state and failed coverage/backfill/
  derivation/journal work as precommit failures.
- Keep media ownership, cascade, and migration object stores/codecs separate.
- Preserve M1 v2 mutation IDs, body digests, delete tombstones, per-key recovery,
  and physical-absence ambiguity behavior.
- Keep the public projects store creation first during initialization. Moving a
  maintenance-store upgrade ahead of it reintroduces Chromium's first-open
  `InvalidStateError: blocked` race.

## Verification snapshot

- Initial real-Chromium RED: all five new M2 axes false.
- Final combined Chromium config: 3/3; store 19/19, lifecycle 16/16, M1 6/6,
  cascade round 1 9/9, cascade round 2 including M2 11/11, corrupt 6/6,
  active abort 7/7, C4 and migration-round1 green.
- C4 first-store ordering stress: 5/5 consecutive clean repeats.
- Focused tests: 48/48, 216 expectations.
- Vite typecheck and pinned type baseline: PASS.
- Storage, Host, port, and session-state boundaries: PASS.
- Focused ESLint/Prettier, CR-at-EOL diff check, and strict Rasen validation:
  PASS.
- Generated Playwright status removed and port 4175 released.

No public port, Host, consumer, library coordinator, protected session/task, or
review report was edited. No commit was created.

Next action: dispatch an independent reviewer for both round-3 M1 and M2. Do not
declare the review cycle clean before that reviewer confirms both.
