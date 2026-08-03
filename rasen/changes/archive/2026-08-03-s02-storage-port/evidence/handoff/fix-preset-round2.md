# Handoff — C5 custom-preset publication fixer round 2

Date: 2026-08-02  
Finding: M5 / new test gap 7  
State: done, uncommitted

## Result

Custom presets now use a StoreApi-local generation/mutation barrier. A load may publish success,
failure, or final loading state only if its captured generation is still current. Save/remove
invalidate an in-flight load at call time before entering the existing mutation tail. Therefore
an older load cannot overwrite a later committed save or resurrect a later committed removal.

The shared library coordinator, persistence mechanisms, Host, and session contracts were not
changed. The counter is closure state owned by one custom-presets store instance, not shared
mutable process state.

## Tests and gates

- RED: 12 pass / 2 fail / 75 assertions. Old load replaced a saved preset with `[]` and restored
  `remove-me` after deletion.
- GREEN: 14 pass / 0 fail / 78 assertions.
- Normal isolated wrapper and opaque-roundtrip wrapper: 1/1 each.
- Existing queued failure-recovery and cross-session arbitration tests remain green.
- Type baseline: exact 3 inherited diagnostics, PASS.
- Session-state boundary: 10/10 factories, 10/10 keys, 52 modules, PASS.
- Storage boundary: 718 modules, PASS.
- Host composition: 2 roots / 715 modules, PASS.
- Port boundary: 30 modules, PASS.
- Focused ESLint and Prettier: PASS.
- Whole-tree whitespace-aware diff check: PASS, conversion warnings only.
- Strict validation after evidence/handoff write: valid, 1/1.

Full evidence: `evidence/fix-preset-round2.md`.

## Files

1. `apps/web/src/timeline/components/graph-editor/custom-presets-store.ts`
2. `apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts`

No commit was created. Do not infer authorship from the full shared-worktree diff because the
other round-2 fixers are working concurrently.
