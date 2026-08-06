# C6 fix-round 3 reviewer handoff

Date: 2026-08-04 +08:00  
From: fresh non-author Sol reviewer (`/root/c6_sol_fix3_review`)  
To: LEAD / next implementation-fix owner

## Decision

**Do not ship, integrate, sync, archive, or mark verification complete.**

The current verdict is **NOT CLEAN — 3 Blocker / 2 Major / 2 Minor**. The authoritative review is `evidence/review-fix-round-3.md`.

## Required next fixes, in order

1. Repair same-session resume evidence/behavior. Fresh Vite and Next ordinary controls both fail all six cycles with `postResumeActivity=false`, despite all five residual series being zero. Preserve the existing missing-CREATED and Worker/GPU leak polarities.
2. Replace the resource boundary's regex/name heuristic with alias/computed/destructuring/value-flow-aware semantics. Add the eight exact counterexamples from the review as negative tests. Independently anchor and verify closure artifact digests.
3. Make renderer lifecycle join active exporter settlement. `session.suspend()`/project drain/dispose must remain pending while a held capture/export is still in flight, not merely invalidate later publication.
4. Dispose the local Mediabunny `Input` when `getPrimaryAudioTrack()` rejects before ownership transfers to `AudioManager.inputs`.
5. Restore the session-state boundary (12 violations), then the port boundary (one C6-test internal import).
6. Format/lint the exact final changed/untracked source list. Retain or clean generated outputs only under explicit authorization.

## Fresh evidence that should be preserved

- Vite: `apps/vite-example/dist-c6-review-fix3-sol-20260804-1`, marker `c6-review-fix3-sol-vite-20260804-1`; ordinary browser log `apps/vite-example/c6-review-fix3-sol-vite-browser-oracle-20260804-2.log`.
- Next: `apps/web/.next-c6-review-fix3-sol-20260804-1`, marker `c6-review-fix3-sol-next-20260804-1`; ordinary browser log `apps/web/c6-review-fix3-sol-next-browser-oracle-20260804-3.log`.
- Full Bun confirmation: `c6-review-fix3-sol-full-bun-20260804-2.log` — 360 pass / 8 inherited fail / 2 inherited loader errors / 1,222 expectations / 368 tests / 71 files.
- First Bun sample `c6-review-fix3-sol-full-bun-20260804-1.log` contains one transient child-Bun segmentation fault; isolated replay passed, and the second full run restored exact identity.
- C3 reviewer artifact: `apps/vite-example/dist-c6-review-fix3-sol-c3-20260804-1`; WebGL passes. WebGPU repeats the already-attributed base migration-wait red twice after capacity assertions and is not a C6 finding.
- All reviewer-owned server processes are stopped. Ports `4173`, `4175`, `4337`, `4338`, and `4340`–`4346` are free.

## Acceptance state

- 59 scenarios: **47 PASS / 9 FAIL / 3 UNVERIFIED**.
- 137 tasks: **108 checked / 29 unchecked**; tasks were not edited.
- Exact protected HEAD/tree and protected identities remain unchanged.
- Second full Bun run, type, Vite/Next build, parity, WASM, asset, host-composition, storage, singleton, Next-import, reference, strict Rasen validation, and `git diff --check` gates pass.
- Ordinary Vite/Next browser, session-state boundary, port boundary, Prettier, and ESLint gates fail.

The next non-author review must rebuild both Hosts under new unique markers, run all three browser controls for at least six cycles per Host, rerun the eight boundary counterexamples, prove exporter terminal settlement and audio-input rejection cleanup, and repeat the two ordinary/negative static ownership gates before considering CLEAN.
