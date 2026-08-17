# C6/C7 Archive-Line vs Product-Line Reconciliation Plan — 2026-08-08

Task: reconcile the two S02 spines at the portfolio delivery boundary. **Execution deferred** per the
user's 2026-08-08 ruling ("暂时���用合并推送" — no merge/push yet). This document is the read-only
prep + merge plan.

## Topology (verified 2026-08-08)

- **merge-base:** `b59b883c` `chore(rasen): archive s02-storage-port (specs synced; ship 0dbdc0eb)`
  — clean common ancestor of both branches.
- **`main` (archive spine), HEAD `88547d38`:** 2 commits ahead of the merge-base, both rasen/-only:
  - `7defe908` chore(rasen): archive s02-session-disposal (C6)
  - `88547d38` chore(rasen): archive s02-headless-editing (C7)
- **`feat/session-runtime-host-ports` (product spine), HEAD `be9cfc4e`:** 42 commits ahead — all
  C0–C7 product code plus the C0–C5 "merge: integrate Cx archive metadata" merges. Does NOT yet carry
  C6/C7 archive metadata.
- **Conflict preview:** `git merge-tree --write-tree --name-only main feat/session-runtime-host-ports`
  → exit 0, merged tree `3d7c5e3a76db7665f5571723f72e40d2388c88ce`, **no conflicted paths**. The merge
  is mechanically clean (the two spines touch disjoint path sets: main = `rasen/changes/archive/**` +
  `rasen/specs/**`; product = product source + SOURCE_INVENTORY).

## Plan (deferred to portfolio delivery)

1. Merge `main` into `feat/session-runtime-host-ports` to bring C6/C7 archive metadata onto the
   product spine, mirroring the existing C0–C5 precedent (`merge: integrate Cx archive metadata`).
   Expected result: a conflict-free merge commit; the merged tree should equal `3d7c5e3a` (verify
   after the real merge).
2. At that point the product spine carries all product code AND all archive metadata (C0–C7).
3. Then run the final joint gate (full-suite, type, protected parity, strict spec validation) on the
   unified HEAD.
4. Portfolio delivery (single parent-level S02 delivery, including any push) remains the user's
   one-shot decision — not undertaken in this work wave.

## What is NOT needed

- No rebase of either branch onto the other — a plain merge preserves both histories and matches the
  established C0–C5 pattern.
- No cherry-pick — both archive commits are rasen/-only and merge cleanly.

## Status

Prepared 2026-08-08. Merge not executed (user: no merge/push this wave). Revisit at the portfolio
delivery boundary.
