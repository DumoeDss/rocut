# Handoff - C5 strategy attempt 1 independent reviewer

Date: 2026-08-02  
Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`  
Base/current HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Full report: `evidence/strategy-attempt-1-review.md`

## Status

**STRATEGY ATTEMPT 1 NOT CONFIRMED - ATTEMPT 2 REQUIRED**

- Blocker: 0
- Major: 2
- Minor: 1
- Test-gap: 2
- Reviewer product/task/prior-evidence edits: 0
- Commit: none

All seven requested acceptance axes pass in Chromium. The original round-3 M1
and M2 are closed as stated. Do not regress their per-key precedence, loud
ambiguity, exact unchanged-identity cleanup, atomic refusal, or shared-queue
race coverage.

## Attempt-2 open items

1. **Pre-journal delete tombstone retry:** migration staging uses the
   attachment-only decoder, so a valid tombstone becomes `null` and every retry
   fails. Stage via the full record decoder, skip a valid tombstone as logical
   absence, and keep malformed input loud. Add Chromium: fail before recovery
   intent -> public remove -> runtime reset -> migration succeeds -> attachment
   remains absent.
2. **Certificate physical binding:** the complete certificate carries no media
   prefix/store/directory binding. With the same projects control plane but
   changed media prefixes, masked clear resolves, leaves the old DB, and old
   metadata/body resurfaces after same-ID save. Bind coverage durably; mismatch
   must fail precommit or clean every validated old/new binding. Never overwrite
   an old binding using only a new-prefix sweep.
3. **Standards cleanup:** remove the six focused ESLint errors and unused v1
   interface warning in the new M1 files.

## Preserve

- M1 original/staged later save/remove: 4/4 true.
- Physical absence/digest mismatch loud retention: 2/2 true.
- Certified unchanged-identity projects/all clear, owner-only targets, and
  same-ID reuse: true.
- Uncertified masked projects/all atomic refusal: true.
- Never-created-owner read/clear race: true.
- Full Chromium matrix 3/3 and C4 upgrade stress 10/10.
- Provider-private data and diagnostics remain payload-free; migration,
  cascade, and ownership control planes stay separate.

All disposable identities and generated Playwright output were cleaned, the
review Vite server is stopped, and port 4175 is free.
