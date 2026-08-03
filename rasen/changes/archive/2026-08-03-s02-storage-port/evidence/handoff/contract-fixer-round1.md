# C5 contract fixer — round 1 handoff

Date: 2026-08-01

Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`

Status: the first independent contract review was **rejected**, its listed
contract/matrix defects were repaired, and the fresh round-2 review is now
**ACCEPTED CLEAN** with `B 0 / Ma 0 / Mi 0 / T 0`. Task 3.11 is checked and the
contract gate permits production browser-store work to proceed.

Task 3.12 remains unchecked because the accepted review verified it **not
triggered**. It is not an unfinished implementation item; final task accounting
must classify it as a non-applicable hard-stop guard.

## Scope respected

This round changed only the public storage contract/reference implementation,
the shared conformance matrix and its tests/evidence, plus the pre-existing
browser RED entry point. It did not implement `BrowserProjectStore`, migration
mechanics, the coordinator, consumer rewiring, Host composition, or session
factory changes.

Other agents own the current storage-boundary script/tests/fixtures. Preserve:

- `script/check-storage-boundary.mjs`;
- `apps/web/src/services/storage/__tests__/`;
- `script/__tests__/`;
- `script/fixtures/c5-storage-boundary/`.

## Review findings repaired

1. **Hierarchical ordering and collisions.** In-memory pending mutations now use
   structural identities. Delimiter-shaped pairs such as `{ projectId: "a:b",
   key: "c" }` and `{ projectId: "a", key: "b:c" }` do not collide. Project
   remove, project/all clear, library namespace clear, and all clear wait for
   every earlier affected mutation. The exact shared matrix—not only a local
   test—probes these races while retaining distinct-key progress.
2. **Complete browser profile and binding.** `complete-browser` converts every
   skipped storage case to failure. A disposable declaration is accepted only
   when the tested store, cleanup store, identity, and cleanup identity are the
   same bound values. The browser RED entry uses `crypto.randomUUID()`, requires
   controls and that binding, checks converted skips as well as raw skips, and
   always runs cleanup.
3. **Mechanism-neutral errors.** `ProjectStoreError` has no raw `cause` and the
   in-memory clone failure message contains no platform exception/name/path.
4. **Migration evidence.** A `migrated` outcome must emit valid monotonic
   progress, end at `completed === total`, and remain idempotent. Positive
   fixtures report progress; a silent migrated negative fixture fails.
5. **Atomic project identity.** `record.id !== summary.id` is a precommit typed
   `conflict`; neither record nor summary is written.
6. **List aliases.** The shared attachment and library cases mutate list-returned
   nested values/body and reload. An intentionally aliasing store now fails the
   matrix.
7. **Formatting cleanup.** Review-cited churn outside storage was reverted in
   decision prose, barrel/non-storage conformance formatting, the in-memory
   factory, and existing graphics tests.

## RED then GREEN

Before the fixes, the focused review controls produced eight failures together:
attachment-before-remove, hierarchical clear, collision-shaped identities,
complete-browser skips, disposable binding, silent migration progress, raw
cause leakage, and record/summary mismatch. The aliasing-store control was then
run separately and failed because the shared matrix did not detect list aliases.

Current result:

```text
bun test apps/web/src/editor/ports/__tests__/conformance.test.ts
28 pass / 0 fail / 179 expectations
```

The primary in-memory storage matrix reports `18 passed / 0 failed / 1 skipped`.
The sole storage skip is the intentional portable, migration-free in-memory
case. It is forbidden by the complete-browser profile.

## Verification

All authoritative gates pass:

- `bun test apps/web/src/editor/ports` — 28 pass, 0 fail, 179 expectations;
- `node script/check-port-boundary.mjs` — PASS, 30 contract modules;
- `node script/check-port-boundary.mjs --negative-control` — PASS, every rule
  proves both detection and non-indiscriminate behavior;
- `node script/check-type-baseline.mjs` — PASS, three inherited diagnostics and
  no new identity;
- `git diff --check` — PASS;
- `rasen validate s02-storage-port --project rocut --strict --json` — PASS,
  zero issues.

Targeted ESLint still exits 1 on four inherited errors in unchanged lines: the
existing conformance case method and worker constructor positional-parameter
rules, the existing JSON parse assertion, and the existing `PORT_ROLES`
assertion. Do not treat those as this delta's regressions or expand scope merely
to silence them; the pinned type-baseline gate is green.

## Files in this repair delta

- `apps/web/src/editor/ports/project-store.ts`
- `apps/web/src/editor/ports/index.ts`
- `apps/web/src/editor/ports/in-memory/index.ts`
- `apps/web/src/editor/ports/conformance/index.ts`
- `apps/web/src/editor/ports/__tests__/conformance.test.ts`
- `apps/web/src/editor/ports/DECISIONS.md`
- `script/fixtures/c5-browser-store-conformance/browser-store-conformance.ts`
- `evidence/contract-implementation.md`
- `evidence/conformance-in-memory.md`
- this handoff

## Round-2 contract gate bookkeeping

The fresh independent review is recorded in
`evidence/contract-review-round2.md` as `ACCEPTED CLEAN`. It closes task 3.11 and
confirms that the round-1 repair constraints remain normative downstream.

Task 3.12 is deliberately left unchecked: the reviewer did not require
restoring the byte-exact C1 surface. Its unchecked box must not be reported as
remaining implementation work. It is a verified non-triggered, non-applicable
hard-stop guard.

## Next step

Proceed to the production BrowserProjectStore phase subject to tasks 5-6 and
their real-browser/migration/cleanup evidence. This acceptance does not
pre-accept those implementations.
