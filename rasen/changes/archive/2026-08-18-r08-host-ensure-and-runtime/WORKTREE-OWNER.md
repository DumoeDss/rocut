# Worktree ownership handshake (Portfolio R)

**Execution worktree:** `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-s08`
(rocut repo, branch feat/s08-host-ensure-and-runtime from main 00ef74cc)

One writer at a time. This file is the authority — not messages, not reports.

## Rules (imported from elftia S08, binding)

1. Before writing ANYTHING to the execution worktree, read this file. Not named as OWNER = do not write.
2. Owners append their release INSIDE the current block and set OWNER: none. Owners NEVER restructure; ONLY the LEAD edits the current block's structure.
3. The LEAD assigns by editing the current block. A cue message is not ownership.
4. Never restore from a backup predating your own SINCE.
5. The CURRENT block (OWNER line != "none") is the only assignment; history banners are records.

## Current owner

```
OWNER:   none
SINCE:   2026-08-18 23:50   (assigned by LEAD — ship: commit + PR to rocut main + merge
         + sync the rocut main checkout)

RELEASE (r08-shipper, 2026-08-18 21:16 +0800): SHIPPED.
Commit 670b71a5 (14 files, +3224/-126, explicit paths, no .tmp/.bun-install swept),
pushed, PR https://github.com/DumoeDss/rocut/pull/15, all 4 CI checks green
(ubuntu 2m03s / windows 5m20s / macos 5m41s / sdk-examples 4m37s), merged --merge
→ ce9f1438. Main checkout fast-forwarded 00ef74cc..ce9f1438; untracked scratch
(.rasen/, .tmp-digest-check.ts, .tmp-probe/) untouched. Ship log:
evidence/ship-log.md. Worktree branch feat/s08-host-ensure-and-runtime left as-is
post-merge.

PRIOR OWNER RELEASED: 2026-08-18 ~23:45 (by r08-reviewer, reviewer) — round-2 delta
VERDICT SHIP: F1/F2/F3 all SOUND (F1 manufactures no opposite failure — ESRCH precedes
the probe, dead legacy daemons reap same-invocation), 3/3 mutations re-verified,
78/78 + 198/198 green.
SINCE:   2026-08-18 23:20   (assigned by LEAD — scoped round-1 delta confirmation:
         verify F1/F2/F3 as implemented, re-run the three mutations, one suite count.
         Last gate before the R PR.)

RELEASE (r08-reviewer, 2026-08-18 ~23:45): round-2 delta review COMPLETE — verdict
**SHIP**. F1 conversion-moment stamp verified directionally (dead legacy daemon
fails the pid leg immediately — reap fires same invocation; live pre-contract daemon
reads unverified/fail-closed; reboot-after-conversion still caught by the pre-boot
leg; no opposite failure manufactured). F2 verdict!=="dead" occupation rule verified
(zombie-incumbent residual accepted, noted in the delta report). F3 pointer both
modes verified. Mutations M-F1/M-F2/M-F3 each red on exactly the intended guards;
all restorations sha256-verified; tree = fixer's exact 14-file handoff; 78/78 cli +
198/198 packages + tsc clean. Delta report at
evidence/review-report-round2-delta.md. Ready for the R shipper.

PRIOR OWNER RELEASED: 2026-08-18 ~23:15 (by r08-impl-b, fixer) — F1 conversion-moment
stamp (fail-closed + self-healing legacy convergence), F2 unverified-incumbent occupies
basename, F3 --log pointer both modes. 3/3 mutations falsified, 78/78 + 198/198 green.
SINCE:   2026-08-18 22:40   (assigned by LEAD — review round-1 minors: F1 legacy-write
         conversion, F2 unverified-incumbent collision, F3 ensure log pointer)

PRIOR OWNER RELEASED: 2026-08-18 ~22:35 (by r08-reviewer, reviewer) — round 1 VERDICT
SHIPPABLE, 0B/0M/3m/4n, items 1-6 all SOUND, mutations re-verified, untested packer
legs exercised by the reviewer. Tree byte-identical to r08-impl's 14-file handoff.
SINCE:   2026-08-18 21:55   (assigned by LEAD — verify + review round 1)

RELEASE (r08-reviewer, 2026-08-18 ~23:00): review round 1 COMPLETE — verdict
SHIPPABLE (0 Blocker / 0 Major / 3 Minor / 4 nits), report at
evidence/review-report.md in this change dir. Mutations M3/M4/M6/M9 re-falsified
(each red on exactly the intended tests; M3 = reader test + 6 dependents, matches
disclosed count); all restorations sha256-verified byte-exact; tree returned to the
implementer's exact 14-file handoff set and suite re-verified green (75/75 cli,
198/198 packages, tsc clean, pack gated 3/3). Reviewer also empirically confirmed
the bun-1.2.2 code-""/errno-4040/4048 mapping on this machine, the curl-zero-byte
SSE claim against a live daemon, and exercised the untested packer legs (surface
copy-when-present, dirty-refusal, surface-absent refusal) — all probe artifacts
cleaned up. New minors for a possible fix round: F1 legacy write-back conversion
weakens the pid-gated reap; F2 deriveTargetId overwrites an unverified (slow, not
dead) same-basename incumbent; F3 ensure timeout error omits the --log pointer.

PRIOR OWNER RELEASED: 2026-08-18 ~21:50 (by r08-impl, implementer) — 25/25 tasks,
9/9 mutations falsified (incl. a real bun<=1.2.2 win32 kill(0) code-"" bug found and
fixed via dual code/errno check), bun gates green (75 cli + 198 packages), pack
determinism reproduced + smoke round-trip. Evidence in evidence/ (ensure transcript,
bundle manifest, cross-contract doc).
SINCE:   2026-08-18 19:40   (assigned by LEAD — apply stage, 25 tasks / 5 groups)

PRIOR STATE: bun install done (REAL_EXIT_CODE:1 from the known `opencut` preinstall
wasm leg — deps complete, apps/cli tests 30/30 green; wasm rebuild recipe in project
memory if the bundle path needs it). Planner complete: 4 artifacts, 25 tasks, all four
decisions made (detached ensure + bounded wait; --mode auto REMOVED loudly; wasm lazy
via splitting; auto narrowed to exactly-one-live-else-error). CRITICAL fix in scope:
startedAt string→number (the registry is currently unreadable by landed elftia C1).
NOTE:    bun install running in background (bun@1.2.18 per lockfile compat memory).
         Planner stage is read-only. Change artifacts live in the MAIN checkout's
         rasen/changes/ (the registered project root), NOT the worktree.

RELEASE (r08-impl, 2026-08-18 ~21:00): ALL 25 tasks done, tasks.md 25/25 ticked.
NOT committed (per instructions — user/LEAD decides). Worktree dirty set:
  M .gitignore, apps/cli/src/{host,main,target-registry}.ts, bun.lock, package.json
  ?? apps/cli/src/ensure.ts, apps/cli/src/host-activity.ts,
     apps/cli/src/__tests__/{target-registry,host-health,ensure,cli-verbs}.test.ts,
     script/pack-runtime.mjs, script/__tests__/pack-runtime.test.mjs
Gates: bun test apps/cli/src = 75/75 (baseline 30 + 45 new); editor-contracts/
automation/ports = 198/198; apps/cli tsc --noEmit clean; dist-runtime/ packed,
determinism reproduced, smoke round-trip green. PRE-EXISTING FAIL (disclose-only):
check:packages exit 1 — frame-proof.test.ts imports undeclared subpath
@opencut/editor-classic/timeline/types; verified identical at base 00ef74cc via
git show. Evidence in rasen/changes/r08-host-ensure-and-runtime/evidence/:
b1-source-cli-ensure-transcript.txt, runtime-bundle-manifest.json,
cross-contract-elftia-reader.md. Known deviations for review: (a) SSE activity
test exercises the exported revisionEventWriter seam + structural wiring assert
(bun 1.2.2 clients cannot consume bun-server SSE — verified pre-existing vs
pre-S08 host); (b) packer has --allow-dirty escape (dev/test artifact marking)
plus esbuild .mjs outExtension rejected by 0.27.3 → post-build entry rename;
(c) pidAlive also accepts errno -4040 as ESRCH — bun ≤1.2.2 win32 reports
code "" (node/bun≥1.2.18 give proper codes; real bug found by real-spawn test).

RELEASE (r08-impl-b, 2026-08-18 ~23:55): review round-1 minors ALL THREE FIXED, each
mutation-falsified one at a time (exact red, revert, green); gates green. F1:
parseEntry's legacy branch stamps the CONVERSION moment (Date.now()) instead of the
startedAt:0 sentinel — an index rewrite (register/remove/patchEntry) can no longer
manufacture pre-boot death for a still-running pre-contract daemon; rationale in
parseEntry + design D5; mutation restore-0 → exactly the two legacy tests red.
F2: deriveTargetId suffixes unless the incumbent is positively dead (verdict !==
"dead": live OR unverified OCCUPIES the basename; only confirmed-dead frees it) —
the unverified incumbent's row + secret survive a same-basename newcomer; mutation
restore live-only → exactly the new collision test red; design D2 + Risks now state
the slow-probe window. F3: ensure's timeout error carries the --log pointer (the
path when --log was passed; "no daemon log was captured … re-run with --log <file>"
when not; never content); mutation neutralize-pointer → exactly the two timeout
tests red. Gates: bun test apps/cli/src 78/78 (75+3 new, 305 expect), packages trio
198/198, apps/cli tsc --noEmit clean; packer untouched (gated pack test not re-run —
not required, no packer file changed). check:packages frame-proof failure
PRE-EXISTING at base (review N7, disclose-only). tasks.md group 6 (6.1–6.3) ticked;
design.md D2/D5/Risks updated. NOT committed. Worktree dirty set unchanged — the
same 14 files as the round-1 handoff.
```
