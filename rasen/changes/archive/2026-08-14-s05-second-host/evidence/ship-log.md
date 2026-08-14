# Ship Log: s05-second-host

**Date:** 2026-08-15
**Mode:** local
**Branch:** feat/s05-community-beta
**Commit:** 4a7d31f754d352ec7d34e53d7ccdd6588a12906e (pre-ship-log HEAD; this ship adds one further commit carrying this file, the round-2 review note, the ship-gate logs, and the 10.4 tick)
**Tree:** fce40f24bd94b83aac3180c46bb0f26cb4ed1833 (pre-ship-log HEAD tree)
**Status:** Committed (delivery deferred to portfolio level)

## Delivery mode and why

`local`. This is child P2 of the 7-child decomposed portfolio for Slice
`05-community-beta-second-host` (workstream `opencut-agent-editor-sdk`). Per
the portfolio's decomposition contract, children accumulate commits on the
shared branch `feat/s05-community-beta` and the portfolio delivers once, as
a single PR, after every child completes. Pushing or opening a PR from this
child individually would fragment that delivery, so this ship commits
locally only. No `git push`, no `gh pr create`, no `rasen archive` was run.

## Scope shipped

13 commits since base `66add22f` (`git rev-list --count 66add22f..HEAD` = 13,
re-verified at ship time), 106 files changed, +10006/−108
(`git diff 66add22f..HEAD --stat`). Delivers the change described in
`rasen/changes/s05-second-host/{proposal.md,design.md,tasks.md}` and its two
delta specs (`specs/sdk-desktop-reference-host/spec.md` NEW,
`specs/sdk-package-boundary/spec.md` MODIFIED — both UNSYNCED by design;
spec sync belongs to the archive stage). `tasks.md`: 48/48 `[x]` after this
ship ticks 10.4 (see Pre-Flight).

### Per-group summary with commits

| Commit | Group / content |
|---|---|
| `8d3de9c6` | Gate 1 — Electron substrate proven (install, launch, scheme), boundary baseline captured. This is N1, the rewritten credential-clean first commit (see Credential incident). |
| `a5f88311` | Group 2 — checker derives consumer roots (`ownerOfPath()` over declared `packages/boundary.json`), third consumer declared, census grows; a deep import from the new Host proven to fail the check. |
| `6ae1aa46` | Group 3 — `apps/electron-host` skeleton boots the real editor over `opencut://app` (BOOT PROOF PASSED, REAL_EXIT_CODE:0). |
| `eb178157` | Group 4 — `FilesystemProjectStore` over a narrow preload bridge, byte I/O in main; conformance oracle 33 passed / 0 fail; five storage red-controls pass. |
| `4ceb7fb8` | Group 5 — desktop composition: runtime assets over the privileged scheme, module workers from `blob:` URLs, CSP boot gate — zero CSP violations, zero console errors. |
| `a91f35f7` | Group 6 — `surface-evidence` entry + C6 disposal dispatch; attributed CSP relaxation (`connect-src blob:`); EVIDENCE ENTRIES PROOF PASSED, REAL_EXIT_CODE:0. |
| `2fb1f70c` | Group 7 — parity on the third Host: electron run 4 `1 passed (37.0s)` with all ten ledger entries asserted; vite `1 passed (38.2s)` and next `1 passed (39.2s)` regressions green. |
| `fbc6c8cc` | In-flow fix — type the hidden file input in the electron import branch (group-7 follow-up). |
| `0d4fab63` | Group 8 — agent + disposal oracles on the desktop Host: agent scenario `1 passed (4.5s)`, committed revision 6, 48 committed values, zero console/page errors; nine ledger predicates re-derived by hand — all nine PASS; C6 disposal oracle PASSED. |
| `6da899db` | Group 9 — checker scope audit (all 27 `script/check-*.mjs`, two-class table, no silence), frozen-signature control (4/4 surfaces byte-identical to `66add22f`), third-consumer docs. |
| `485eafdb` | Ship-discipline close-out — EOL audit; C6 oracle re-proven on the rebuilt dist (`C6 ORACLE PROOF PASSED`, REAL_EXIT_CODE:0). |
| `f09063e0` | Review round 1 fixes — F1–F7 including the credential history rewrite; CSP header on 404/403 responses; tallies aligned. |
| `4a7d31f7` | Review round 2 micro-fixes — F8 (false TS2352 claim deleted; single `as` cast) + F9 (census method annotation). Round-2 verdict: CLEAN. |

## Pre-Flight Results

- Verification: `evidence/review-report.md` present — two rounds. Round 1
  found F1 (Blocker — credential blob reachable), F2 (Major — incident
  disclosure/rule), F3 + F4 (Minor — census derivation, spec migration
  wording), F5 + F6 + F7 (Trivial — cast disposition, CSP on error
  responses, tallies); all fixed in `f09063e0`, F1 via the history rewrite.
  The round-1 fix-verification sweep then found F8 (Minor — a false
  compile-necessity sub-claim inside F5's disposition) and F9 (Trivial —
  missing method annotation on the census figure), fixed in `4a7d31f7`.
  Round 2 (loop-termination check at `4a7d31f7`): both micro-fixes
  reproduced fixed, sweep clean, no new defects — **verdict CLEAN, no
  findings; cleared to ship.** The reviewer's round-1 re-review section and
  the round-2 note are committed by this ship, unmodified (round 1's section
  set the precedent).
- Tasks: 48/48 complete. 10.4 (standDown signals) is satisfied vacuously:
  no worker was ever parked — `<changeRoot>/signals/` does not exist and
  `signals/.state/` does not exist — so there is no live heartbeat that
  could make a later archive ESTALE. The checkbox is ticked by this ship
  with this justification recorded here.

## Oracle verdicts (evidence-cited)

- **Parity (third Host)** — `evidence/parity-electron-vs-vite-20260815.md` and
  `evidence/parity-vite-vs-next-regression-20260815.md`; runs in
  `evidence/logs/group-7-parity-electron-run4.log`, `group-7-parity-vite-regression.log`,
  `group-7-parity-next-regression.log`. Electron `1 passed (37.0s)` with all
  ten ledger entries asserted; both browser-Host regressions `1 passed`.
- **Agent** — `evidence/group-8-agent-ledger-predicates.md` +
  `evidence/agent-ledger-electron.json` +
  `evidence/logs/group-8-agent-electron.log`: `1 passed (4.5s)`, committed
  revision 6, 48 committed values, zero console/page errors; the nine ledger
  predicates re-derived by hand against the fresh electron ledger: all nine
  PASS.
- **Disposal (C6)** — `evidence/logs/group-8-c6-oracle.log` PASSED, and
  re-proven on the rebuilt dist in
  `evidence/logs/group-10-c6-oracle-rebuilt-dist.log`: `C6 ORACLE PROOF
  PASSED`, REAL_EXIT_CODE:0 (the cycle-1 durable-reopen timer race is
  disclosed in-run and non-blocking per Group 6).
- **Frozen signatures** — `evidence/frozen-signature/README.md`: all four
  S03+S04-frozen surfaces byte-identical to base `66add22f` via the
  stat-cache-immune `git show`-blob + `cmp` method; zero differences — a
  stricter bar than P1's move baseline, since this change moved nothing.
- **Checkers** — `evidence/group-9-checker-scope-audit.md`, sweep at
  `evidence/logs/group-9-all-checkers.log`: all 27 checkers classified
  follows-source / deliberately-scoped with named reasons; every nonzero
  exit dispositioned inline. One pre-existing named red
  (`check-emitted-runtime-assets` exit 1, `relative-next-static-escape` in a
  Next build predating the base commit) — proven pre-existing by build
  timestamp and a byte-empty checker diff vs base.
- **Boundary checker** — green at the rewrite (rewrite-record item d), green
  in the round-1 sweep, and re-run fresh by this ship's gate (below).

## Accepted-known at ship

- **F5 — `hostName` single cast** (`surface-evidence-main.tsx`):
  `SurfaceEvidenceHarness` declares `hostName: "next" | "vite"` — born dual,
  frozen for this change (task 6.1 forbids harness edits; the spec's
  harness-sharing requirement freezes it independently), so the electron
  mount passes `{"electron" as "next" | "vite"}` at the call site with a
  comment naming the reasoning. Value-truthful: the prop is a label recorded
  verbatim into the evidence ledger (`host: "electron"` in the runtime
  entries) and the harness does not branch on it. Round 1's claim that the
  double-cast form was compile-required (TS2352) was disproven and deleted
  (F8); the single `as` cast now in tree compiles clean under both the
  app's TS 5.9.3 and the root 6.0.3. If the union is widened later, the cast
  deletes cleanly. Nothing else is open at ship.

## Credential incident (SEC-1 / review F1) — resolved by history rewrite

One reachable blob (`81cbbc85`, `evidence/logs/gate-1-launch-debug.log` at
the original first commit) carried live credentials, captured because
`_electron.launch` inherited the whole env under a channel debug flag.
Remediation: the original first two commits were collapsed by
content-identical replay into clean N1 `8d3de9c6` (parent `66add22f`, tree
identical to the redacted state, natively-redacted blob `c44c0c94`); the ten
later commits replayed with zero conflicts; the final tree is unchanged
(`git diff 9ab57cc7 feat/s05-community-beta` — empty) and the credential
blob is unreachable from any ref. **Safety sha (pre-rewrite HEAD):
`9ab57cc79907e92eebc0f126948e81edc477abd2`** — recoverability is reflog-only
by design, because a named backup branch would keep the credential bytes
reachable and pushable. Full procedure and the four mandated verifications:
`evidence/rewrite-record.md`. Standing rule recorded in BOUNDARIES.md §12
and at the capture site: future Electron evidence captures pass an explicit
minimal `env` to `_electron.launch`, and a redaction commit never redacts
history — if credential bytes reach a commit, the remediation is a rewrite
or rotation, not an amended file.

## Test Gate

- Required scope: the delivered delta since the verify-stage oracle battery
  is two review-fix commits (`f09063e0`: CSP header on error responses in
  `electron/main.cjs` + evidence text; `4a7d31f7`: single cast in
  `surface-evidence-main.tsx` + evidence text). The verify-stage oracles
  (parity ×3 hosts, agent, disposal, conformance, storage controls, boot
  gates, 27-checker sweep) ran at the round-fix parents' content and are
  cited above; the reviewer re-ran the boot gate after the CSP fix
  (`evidence/logs/review-r1-boot-gate-csp-error-responses.log` — BOOT PROOF
  PASSED, REAL_EXIT_CODE:0) and the app typecheck after the cast fix
  (`evidence/logs/review-r2-typecheck.log` — REAL_EXIT_CODE:0). Since then
  only markdown evidence changed. Proportionate fresh re-verification at the
  ship state, run by this ship:
- Commands (logs committed as
  `evidence/logs/ship-gate-boundary-checker.log` and
  `evidence/logs/ship-gate-typecheck.log`):
  - `node script/check-package-boundary.mjs` → **REAL_EXIT_CODE:0**
  - `node apps/electron-host/node_modules/typescript/bin/tsc --noEmit -p
    apps/electron-host/tsconfig.json` (app TS 5.9.3, scoped include;
    transitively checks the imported `@opencut/*` package sources including
    the round-2 cast site) → **REAL_EXIT_CODE:0**
  - Typecheck harness note, recorded in the gate log: the ROOT
    `tsconfig.json` is not a typecheck gate — no `jsx`/`skipLibCheck`/include
    (a root run yields 4309 errors repo-wide, including `--jsx is not set`
    on every `.tsx` and the deliberately broken `script/fixtures/**`
    negative-control trees). The reviewer's round-2
    `tsc --noEmit -p tsconfig.json` REAL_EXIT_CODE:0 is reproducible only
    from `apps/electron-host/`; attempt 3 in the gate log reproduces it from
    the repo root as `-p apps/electron-host/tsconfig.json`.
- Diff sanity scan (this ship): 0 added TODO/FIXME/XXX/HACK markers and no
  added secret-pattern lines in `git diff 66add22f..HEAD`.
- Tree: `fce40f24bd94b83aac3180c46bb0f26cb4ed1833` (pre-ship-log HEAD tree;
  the ship commit adds only evidence/planning markdown, no code).

## Notes for the portfolio delivery (parent = 05-community-beta-second-host)

- **This child's branch history was rewritten mid-child** (credential
  remediation; N1 = `8d3de9c6`). Any portfolio-level record that pinned
  pre-rewrite shas must read `evidence/rewrite-record.md`'s hash map. The
  safety sha `9ab57cc7` is reflog-only and expires with the reflog.
- The `specs/` delta is UNSYNCED by design — `specs/sdk-desktop-reference-host`
  (NEW) and `specs/sdk-package-boundary` (MODIFIED) belong to the
  archive-stage spec sync, not ship.
- Review round 2's append to `evidence/review-report.md` (now 400 lines) is
  committed by this ship step, same as round 1's section was.
- Nothing was pushed: `origin/feat/s05-community-beta` does not exist (the
  branch has never been pushed; its configured upstream `origin/main` is
  behind-only). At ship time `git rev-list --left-right --count
  origin/main...HEAD` = `0 62` (0 behind, 62 ahead — this child's 13 plus
  the earlier portfolio children's 49); the ship commit makes it 63.

## Archive
**Date:** 2026-08-14T23:30:11.391Z
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\changes\archive\2026-08-14-s05-second-host
**Transaction:** e46d898a-015e-4673-8bec-6ce6019f0a4f
