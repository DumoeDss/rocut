# Review report — round 2 delta (F1/F2/F3 fix confirmation)

Reviewer: r08-reviewer, 2026-08-18 ~23:2x–23:4x, worktree `rocut-wt-s08` at fixer
(r08-impl-b) handoff. Scoped to the three round-1 minors. Fresh backups taken before
mutations; all three mutated files restored sha256-verified byte-exact
(`b1b5f433…` target-registry.ts, `5aa7dfdd…` host.ts, `983c4e23…` ensure.ts before
and after); tree returned to the fixer's 14-file handoff set.

## Verdict: SHIP

## F1 — conversion-moment stamp: implemented correctly, direction sound

`parseEntry`'s legacy branch now stamps `startedAt: Date.now()` (the conversion
moment) and keeps `legacyStartedAt` (target-registry.ts ~296–315; D5 carries the
rationale). Two-layer behavior:

- **In-memory**: `classifyEntry` still hits the legacy branch first (unverified while
  pid lives / dead once pid gone) — identical to round 1's tolerant read.
- **After write-back + re-read** (the F1 vector: any register/remove/patchEntry
  rewrites the whole index): the entry re-reads as a normal numeric entry with the
  conversion-moment stamp → pre-boot check is false → the **pid leg decides**, and it
  precedes the probe.

The lead's specific question — can the stamp manufacture the OPPOSITE failure (dead
daemon reading unverified)? **No.** A genuinely-dead legacy daemon fails the pid leg
immediately (`ESRCH` ⇒ dead) and `target reap` fires on the same invocation — no
probe wait, no delay. The stamp only changes the pid-ALIVE case: a still-running
pre-contract daemon probes `/health` on an old daemon (no such route → 401 → null) ⇒
**unverified, fail-closed** — exactly the M3 reap-on-positive-evidence direction.
The single case that moved from "reapable" (round-1 `0` sentinel) to "retained" is
dead-daemon + pid recycled by an unrelated process + port answering nothing (refused)
— there is no positive evidence of death there (no ESRCH, no foreign id), so
unverified is the correct conservative verdict; a squatter that positively answers a
foreign id still reaps. Reboot-after-conversion is also covered: stamp < new boot
time ⇒ pre-boot ⇒ dead. The stamp is the honest bound, as the comment claims.

Tests: round-1 legacy-read test extended with the stamp assertion + new "legacy
write-back does not manufacture death" test (real register round-trip, converted
entry stays unverified, on-disk form numeric + ISO preserved).

## F2 — unverified incumbent occupies the basename: implemented correctly

`deriveTargetId` now suffixes when `verdict !== "dead"` (host.ts) — live OR
unverified occupies; only confirmed-dead frees. New test uses a refused-port
incumbent (alive pid, inconclusive probe — the live-but-slow shape) and asserts the
newcomer gets the digest suffix and the incumbent's row + secret are untouched. The
existing live-incumbent and dead-reuse tests are unchanged and still green. Design
D2 ruling (line ~147) and the Risks bullet (~334) added as claimed. Residual (new,
accepted): a permanently-unverified zombie incumbent permanently forces the suffix
for a same-basename project — acceptable because the suffix is deterministic per
project, routing is by project path, and the zombie is visible in `target reap`
output with remediation.

## F3 — log pointer both modes: implemented correctly

Timeout error now appends `; daemon log: <path>` when `--log` was passed, and
`; no daemon log was captured (stdio discarded) — re-run with --log <file> to
capture one` otherwise (ensure.ts). Pointer only, never content. Both modes have
test assertions (extended no-log test + new `--log` test).

## Mutations re-run (red on exactly the intended guards)

- **M-F1** (`startedAt: 0` sentinel restored): exactly the 2 F1 guards red (extended
  legacy-read + new write-back test), 26 pass.
- **M-F2** (live-only suffix check restored): exactly the new F2 test red, 27 pass
  (live-incumbent and dead-reuse tests stay green under the mutant).
- **M-F3** (pointer neutralized): exactly the 2 F3 guards red (extended timeout test
  + new `--log` test), 4 pass.

All restorations hash-verified; full suite re-run green afterwards.

## Gates

- `bun test apps/cli/src` — **78/78 pass** (305 expect calls).
- `bun test packages/editor-contracts packages/editor-automation packages/editor-ports`
  — **198/198 pass**.
- `apps/cli` `tsc --noEmit` — clean (reviewer-added, cheap insurance before a PR).

## Ship readiness

Round-1 verdict was SHIPPABLE with 3 minors; all three are now fixed with real
guards, mutation-falsified, direction-verified against the reap ruling. No new
findings at Blocker/Major severity. **SHIP.**
