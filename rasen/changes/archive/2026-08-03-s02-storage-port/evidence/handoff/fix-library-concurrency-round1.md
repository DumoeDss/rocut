# Handoff — C5 library concurrency fixer round 1

Date: 2026-08-02  
Finding: B2 / test gap 2  
State: done, uncommitted

## What changed

- Added cross-session library-operation arbitration to
  `SessionPersistenceCoordinator`, keyed by the stable injected `ProjectStore` object.
- Added `mutateLibraryRecord`, whose shared critical section contains the complete fresh
  load → decode → mutate → opaque overlay → save transaction-shaped sequence.
- Rewired saved sounds and custom presets to atomic/coordinated logical-record mutation.
- Kept each session's live sounds/preset StoreApi isolated; only committed durability is shared.
- Classified the weak, payload-free, bounded arbitration registry in the session-state ownership
  fixture.
- Added deterministic complete-session tests for sounds union, presets union, queued failure
  recovery, reload from both sessions, and different-namespace non-blocking.

## Design invariants for the next session

- Do not turn the arbitration registry into a data owner. Its values must remain in-flight
  Promise tails only.
- Do not key it by a browser database name or expose a provider identity through the port. The
  stable Host-injected `ProjectStore` object is the boundary-safe identity used by this change.
- Keep the durable load inside the shared critical section; serializing only the final save
  recreates the lost-update bug.
- Keep record keys bounded and delete the weak entry when the pending map becomes empty.
- Same namespace clear and record writes must order; unrelated namespaces must not interlock.
- Failure must reject the caller, publish no uncommitted local payload, and leave later queued
  work runnable.

## Verification snapshot

- RED before implementation: 10 pass / 2 fail / 65 assertions; only the second sound/preset
  survived.
- GREEN isolated suite: 12 pass / 0 fail / 69 assertions.
- Normal session wrapper: 1/1 pass.
- Opaque round-trip wrapper: 1/1 pass.
- Type baseline: exact 3 inherited diagnostics, PASS.
- Session ownership: 10/10 factories, 10/10 keys, 52 classified modules, PASS.
- Storage boundary: 716 modules, PASS.
- Host composition: 2 roots / 713 modules, PASS.
- Port boundary: 30 modules, PASS.
- Focused ESLint, Prettier, and five-file diff check: PASS.
- Strict Rasen validation: valid, 1/1.

Full evidence: `evidence/fix-library-concurrency-round1.md`.

## Files in this fixer scope

1. `apps/web/src/editor/persistence/session-persistence-coordinator.ts`
2. `apps/web/src/sounds/sounds-store.ts`
3. `apps/web/src/timeline/components/graph-editor/custom-presets-store.ts`
4. `apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts`
5. `script/fixtures/session-state-ownership.json`

No commit was created. Do not use the full shared-worktree diff to infer this fixer's authorship:
other C5 fixers are editing their own files concurrently. At handoff time, whole-tree
`git diff --check` had only unrelated trailing whitespace in
`apps/web/src/core/managers/save-manager.ts`; this fixer's focused five-file diff check was clean.
