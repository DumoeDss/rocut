# Handoff - C5 residual fixer round 1

Date: 2026-08-02  
Findings: M4, M5, m1, m2 / test gaps 7, 8, 10  
State: done, green, uncommitted

## What changed

- Browser project, attachment, and library reads now reject every present
  malformed current row as typed, mechanism-neutral `corrupt`; recognized
  legacy data remains distinct from current-envelope decoding.
- Duplicate project creation uses `Promise.allSettled`, waits for late saves,
  and cleans every fulfilled duplicate before reporting the failure.
- All seven public Browser read paths recheck active cancellation after awaited
  readiness/I/O and before publishing a result.
- A real-Chromium residual probe covers six corrupt list/load paths and seven
  I/O-dispatched-then-aborted paths.
- The stale `EditorHost` header now matches the completed session composition.

## Invariants for the next session

- Envelope presence is authoritative. Never reinterpret a malformed current
  envelope as legacy data, and never silently filter a present corrupt row.
- Absence remains non-error; raw legacy fallback remains limited to explicitly
  recognized legacy shapes, especially the exact `user-sounds` row.
- Preserve mechanism-neutral, payload-free `ProjectStoreError` metadata.
- Do not move duplicate diagnostics ahead of awaited cleanup, and do not derive
  the cleanup set before every creation attempt has settled.
- Every new public Browser read must recheck cancellation after its last awaited
  storage boundary and immediately before result publication.
- Keep the post-dispatch pause test-only; it proves timing but must not become a
  production scheduling dependency.

## Verification snapshot

- RED: duplicate isolated runner **3 pass / 1 fail**; residual Chromium
  corrupt paths **0/6**, active-abort paths **0/7**.
- GREEN duplicate wrapper: **1/1**.
- GREEN Chromium: **1/1**, store **19/19**, migration **16/16**, cascade
  **9/9**, corrupt paths **6/6**, active-abort paths **7/7**, no leftover DBs.
- Type baseline: **PASS**, exact 3 inherited diagnostics.
- Positive boundaries: port/storage/Host/session **PASS**; negative controls
  **PASS**, including **19/19** C5 storage rejection fixtures.
- Focused ESLint and Prettier, whole-tree diff check, and strict Rasen
  validation: **PASS**.

Full evidence: `evidence/fix-residual-round1.md`.

## Files and ownership notes

The exact nine-file product/test write set is enumerated in the evidence file.
Shared Browser store/harness surfaces also contain other C5 fixers' migration,
cascade, and shared-queue work; preserve those fields and probes. This fixer did
not edit migration, cascade, shared queue, library coordinator, protected
session files, task/review/cleanup documents, and created no commit.

