# Handoff — C5 cascade and same-identity wrapper fixer

Date: 2026-08-02  
Findings: B3 / M3 / test gaps 3 and 6  
State: done, uncommitted

## What changed

- Added an internal project tombstone and clear-cleanup journal format.
- Made project remove and project/all clear commit project invisibility atomically
  before deleting attachment databases/directories.
- Made post-commit physical cleanup idempotent, durable across runtime reset/new
  wrapper, and non-throwing after the logical commit.
- Added mechanism-neutral cleanup warnings and refusal of non-owned targets.
- Retained completed tombstones so attachment writes invoked after remove/clear
  cannot recreate orphan media; a safe later project save may replace them.
- Shared `BrowserMutationQueue` by `durableIdentityKey` using a weak, finalizer-cleaned
  registry, and bounded the initialization-run map to in-flight work only.
- Added real Chromium failure injection and two-wrapper scheduling probes, including
  both invocation orders for attachment write versus remove/project-clear/all-clear.

## Invariants for the next session

- The projects object-store transaction is the logical commit point. Do not move
  physical media deletion before the tombstone/journal commit.
- A post-commit cleanup failure must leave its durable record and resolve the user
  operation with a retryable warning; a pre-commit failure must reject without
  deleting media.
- Keep journal target validation exact to the configured media prefixes. Never act
  on a target merely because a stored journal names it.
- Keep cleanup diagnostics payload-free and mechanism-neutral. Do not attach raw
  exceptions, database names, directories, or attachment metadata.
- Keep the shared queue registry payload-free and weak/bounded. The key is the
  internal durable identity, not a new public port field.
- Preserve both race directions: earlier attachment then remove/clear must remove
  it; earlier remove/clear then attachment must reject the later write.
- Completed tombstones are intentionally hidden by list/load and ignored by schema
  version/migration discovery. An explicit project save may overwrite one only
  after pending cleanup for that project has cleared.

## Verification snapshot

- First RED: real Chromium failed the injected mid-cascade case with destructive
  `removeEntry`/`InvalidModificationError` behavior and no recoverable journal.
- Final Chromium matrix: 1/1 pass; store 19/19, migration 16/16, cascade 9/9,
  corruption 6/6, active read abort 7/7.
- Focused conformance/storage/Host/session tests: 33/33, 179 assertions.
- Vite typecheck and pinned type baseline: PASS (3 inherited diagnostics only).
- Storage, Host, port, and session-state boundaries: PASS.
- Focused ESLint/Prettier and CR-at-EOL diff check: PASS.
- Port 4175: no listener after teardown; generated Playwright last-run output removed.

Full evidence: `evidence/fix-cascade-round1.md`.

No commit was created. Shared files also contain migration and residual-fixer work;
do not infer authorship from the full worktree diff and do not overwrite those
fields/tests during final integration.
