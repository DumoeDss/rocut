# History rewrite record (F1, review round 1)

Reviewed-mandated remediation for the credential blob: exactly one reachable
blob (`81cbbc85`, `evidence/logs/gate-1-launch-debug.log` at `cb70b8c5`)
carries live credentials; e226b109 redacted only the HEAD copy. The rewrite
collapses `cb70b8c5` + `e226b109` into one clean commit N1 by content-
identical replay, so no reachable ref carries the credential bytes.

**Safety sha (pre-rewrite HEAD): `9ab57cc79907e92eebc0f126948e81edc477abd2`**

Recoverability is via reflog only, deliberately: a named backup branch would
keep the credential blob reachable and pushable, defeating the remediation.
If the rewrite must be undone before reflog expiry:
`git reset --hard 9ab57cc79907e92eebc0f126948e81edc477abd2`.

## Procedure

1. Working tree verified tracked-clean (`git status --porcelain` minus
   untracked = 0 lines; the untracked set is the lead's planning dirs and
   this file, which survive checkout/rebase untouched).
2. `git checkout --detach 66add22f` (the change's base).
3. `git merge --squash e226b109` — stages the redacted tree.
4. `git commit` with cb70b8c5's original message plus an honest note that
   the gate-1 debug log was captured with the whole env inherited under
   `DEBUG=pw:channel` and was redacted before this commit ever existed — no
   credential material in any reachable blob. This commit is N1: parent
   `66add22f`, tree identical to `e226b109`.
5. `git rebase --onto <N1> e226b109 feat/s05-community-beta` — replays the
   ten commits `282bf5dc..9ab57cc7` onto N1. Content-identical replay; zero
   conflicts expected, abort and report if any appears.

## Post-verification (results appended below after execution)

a. `git diff 9ab57cc7 feat/s05-community-beta` must be EMPTY (final tree
   unchanged).
b. `git rev-list --objects --all | grep 81cbbc85` must be empty (blob
   unreachable from refs; reflog-only reachability expected and acceptable).
c. Commit count beyond base: 12 before, 11 after.
d. `node script/check-package-boundary.mjs` still green (tree-intact
   sanity).

## Results

(executed — filled in below)

Executed. N1 = `8d3de9c6f046fec877af13b2711f34f0884af2af` (parent `66add22f`,
tree identical to `e226b109` — `git diff --stat e226b109 8d3de9c6` empty;
carries the redacted blob `c44c0c94`, not `81cbbc85`). Rebase replayed
10/10 commits with zero conflicts. The four mandated verifications:

- (a) `git diff 9ab57cc7 feat/s05-community-beta` → **0 lines (EMPTY)** —
  final tree unchanged.
- (b) `git rev-list --objects --all | grep 81cbbc85` → **0 hits** — the
  credential blob is unreachable from any ref. Reflog-only reachability
  remains on this machine until expiry, which affects nothing pushed.
- (c) commits beyond base: **11** (was 12).
- (d) `node script/check-package-boundary.mjs` → **REAL_EXIT_CODE:0**,
  clean.

New hash map (old → new): cb70b8c5+e226b109 → `8d3de9c6`; the ten replayed
commits are listed in the fixed-output section below and were propagated to
every stale reference in evidence/, implementation-report.md, and
BOUNDARIES.md in the same editing pass as the round-1 fixes.
