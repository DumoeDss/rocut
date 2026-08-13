# T4 ship log — s0304-agent-transaction-evidence

**Local-only delivery. Nothing pushed.** The parent portfolio
(`s0304-transaction-api-and-react-surface`) is delivered as one user-approved push after all
nine children are archived; a partial portfolio is never pushed.

| item | value |
| --- | --- |
| Branch | `recovery/s0304-ui-commit-routing-final` |
| Implementation commit | `b8decbeb` — 49 files, +10,076 / −26 |
| Base | `8c8e5839` (R2 archive) |
| Build marker | `t4-final-source-20260813-a`, both Hosts |
| Tasks | **48 / 48** |
| Mode | commit + archive, local; no push, no PR |

## What shipped

The published transaction-vector corpus, loader, coverage gate and runner; the Host-neutral
Agent scenario with two Node drivers; one Playwright spec driving both production Hosts through
the existing `/surface-evidence` entry across a real page reload; and three checkers
(`check-agent-evidence` new, `check-transaction-boundary` extended, `check-storage-boundary`
classified).

Write set: **32 files.** 31 are covered by the frozen source manifest, which re-verified
**31 / 31 equal** after the browser runs. The 32nd, `script/check-storage-boundary.mjs`, was
edited after the cycle and is deliberately outside the freeze — it is a Node checker appearing
0 times in `apps/vite-example/dist/module-graph.json`, so it cannot have affected the artifacts.
The reasoning is recorded in `implementation-report.md` under "The gate T4 broke".

## Staging

Explicit pathspecs, never `git add -A` from the repo root — `.rasen/` is not gitignored and
would sweep ~87 run-state files:

```
git add -- apps script
git add -f -- rasen/changes/s0304-agent-transaction-evidence
```

`.rasen/` was verified absent from the index before committing (0 staged entries).

## Gate results at ship bytes

| gate | result |
| --- | --- |
| Vector suites | 67 pass / 0 fail / 727 expectations / 9 files |
| Contracts + Surface suites | 160 pass / 0 fail / 1,595 expectations / 22 files |
| Type baseline / Vite typecheck / changed-file ESLint | PASS / PASS / 0 problems |
| `check-transaction-boundary` + negative control | clean |
| `check-agent-evidence` + converse + negative controls | clean, 9 rules per Host |
| `check-storage-boundary` | clean (classification proven exact by mutation) |
| `check-distributable-boundary` | 2,943 modules, 10/10 exclusions clean |
| `check-react-singleton` / surface CSS / portal / private-drag | clean |
| Agent spec, Vite / Next | 1/1 each |
| R2 Surface matrix, Vite / Next | 2/2 each |
| Full parity, Vite / Next | 1/1 each — 27 / 18 / 9, all semantic rows inside the T3 idempotency envelope |
| c5-storage | 5/5 |
| Source manifest re-hash | 31 / 31 equal |
| `rasen validate --strict` | `items[0].valid: true`, 0 issues |

Two checkers are red and neither is T4's to repair: `check-editor-singleton` (40/39, pre-existing,
also red when R2 shipped) and `check-session-state-boundary` (13 rows, 11 in six files T4 did not
write). Both need an owner. Details in `implementation-report.md`.

## Task 8.7 — source inventory, and what its regeneration absorbed

Run **after** the implementation commit, because `script/generate-source-inventory.mjs`
inventories tracked files only. The inventory records drift against the donor pin
`cf5e79e9`; the pin's own 1,069-file list is unchanged.

Regenerating moved the drift section, and **most of the movement is not T4's**:

| section | before | after | newly listed | of which T4 | left by earlier changes |
| --- | --- | --- | --- | --- | --- |
| modified inherited files | 186 | 205 | 19 | **0** | 19 |
| added files | 127 | 229 | 102 | **26** | 76 |

T4 accounts for 26 of the 121 newly-listed entries. The other 95 are drift from earlier changes
that never regenerated the inventory — including R2's `app/surface-evidence/page.tsx` and the
`actions/` and `components/ui/` sets. They are folded in here because a stale inventory is worse
than a current one, not because T4 authored them. Anyone attributing that diff should read this
table first.

## Review

Independent non-author review of the previous cycle returned PASS WITH FINDINGS: one major
(T1), four minors, one trivial. All six are addressed; the disposition table is in
`implementation-report.md`. The T1 fix is mutation-measured: with the three rules replaced by
no-ops, exactly four tests fail and no others.

**Not independently reviewed:** this session's own delta — the T1 fix, the five minor fixes and
the `check-storage-boundary` classification — was authored and verified by the same actor. The
prior review covered the 08-12 bytes.

## Archiving

`rasen archive s0304-agent-transaction-evidence --yes` at 48/48, followed by a pathspec commit —
`rasen archive` does not self-commit. The `## Archive` heading below is written by the archive
transaction itself and is reserved for it.

## Archive
**Date:** 2026-08-13T04:15:58.277Z
**Outcome:** archived at E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut\rasen\changes\archive\2026-08-13-s0304-agent-transaction-evidence
**Transaction:** f4270bd3-30a0-4918-876f-77713571c384
