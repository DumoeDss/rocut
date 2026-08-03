# Handoff — C5 cascade control-plane and library clear fixer

Date: 2026-08-02  
Findings: review-round2 B1 / M4 / test gaps 1 and 6  
State: done, verified, uncommitted

## What changed

- Moved cascade tombstones and clear journals out of opaque project rows into a
  dedicated maintenance object store in the projects database.
- Made a valid current project envelope authoritative and preserved a literal
  provider field named `__opencutProjectCascade` unchanged.
- Split maintenance keys into disjoint typed tombstone/journal namespaces and
  bound each tombstone key exactly to its project scope.
- Restricted project tombstone targets to the exact media database/directory for
  that project; retained prefix inventories only for store-wide clear journals.
- Kept project save/remove/projects-clear state and maintenance intent atomic
  within one projects-database transaction.
- Made a library namespace clear one IndexedDB transaction, including legacy
  `saved-sounds` / `user-sounds` cleanup.
- Added a durable `clearLibrary` step to the store-wide clear journal so a failure
  after the project commit resolves with a retryable warning and converges after
  runtime reset/new wrapper.
- Added six real-Chromium RED/GREEN probes for opaque forgery, exact target
  ownership, second-delete rollback, post-project-commit library failure, and
  cross-reload retry.

## Invariants for the next session

- Provider project data is never a cascade control plane. Do not scan or filter
  ordinary project rows for maintenance-looking private fields.
- Keep the dedicated maintenance object store and typed key namespaces. A project
  save may delete only `projectTombstoneKey(projectId)`, never a raw project ID or
  a journal-shaped key.
- Decoder key/scope binding and exact project target validation are both required.
  A same-prefix target is insufficient for a project tombstone.
- Store-wide journals may act only on their captured configured-prefix inventory;
  project tombstones may not borrow that authority.
- The projects-database transaction is the first logical commit for remove/clear.
  Post-commit media/library failure must leave durable intent and must not turn the
  already-committed public operation into an ambiguous rejection.
- Namespace clear must stay one read-write transaction. The legacy `user-sounds`
  row belongs to the same `saved-sounds` transaction.
- Completed project tombstones intentionally remain target-free to prevent later
  attachment recreation. A later explicit save removes only its typed tombstone.
- Keep maintenance diagnostics mechanism-neutral and payload-free.

## Verification snapshot

- First real-Chromium RED: all six new round-2 booleans false.
- Final Chromium matrix: 1/1 pass; store 19/19, migration 16/16, cascade round 1
  9/9, round 2 6/6, corruption 6/6, active read abort 7/7.
- Focused conformance/storage/Host/session tests: 33/33, 179 assertions.
- Vite typecheck and pinned type baseline: PASS (3 inherited diagnostics only).
- Storage, Host, port, and session-state boundaries: PASS.
- Focused ESLint/Prettier, CR-at-EOL diff check, and strict Rasen validation: PASS.
- Port 4175: no listener; generated Playwright last-run output removed.

Full evidence: `evidence/fix-cascade-round2.md`.

No commit was created. Shared files also contain other round-2 fixers' work. Do not
infer authorship from the full worktree diff, and preserve migration lifecycle,
initialization, preset, coordinator, and residual probe fields during integration.
