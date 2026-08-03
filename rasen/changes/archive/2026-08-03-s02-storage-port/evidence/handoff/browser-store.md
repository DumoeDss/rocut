# C5 BrowserProjectStore and migration handoff

Date: 2026-08-02
Role: C5 APPLY leaf implementer C
Status: sections 5 and 6 implemented and verified; no commit created

## Delivered

`apps/web/src/services/storage/` now contains a real `BrowserProjectStore` with:

- project record/summary CRUD over the configured projects IndexedDB identity;
- attachment metadata plus OPFS body CRUD with staged bodies, an explicit
  metadata commit point, prior-value preservation, and best-effort orphan
  cleanup;
- durable library CRUD with structural namespace/key isolation and legacy saved
  sounds compatibility;
- availability/capacity inspection and project/library/all clear semantics;
- defensive structured cloning of every public mutable value and binary body;
- mechanism-neutral public errors and payload-free diagnostics;
- pre-abort and precommit failure/cancellation semantics; and
- hierarchical mutation serialization matching the shared in-memory contract.

The browser migration is keyed by durable storage identity, coalesces concurrent
wrappers, retries a failed attempt, stages and re-reads transformed values,
commits only after validation, and deletes legacy/staging databases only after
committed readback. Postcommit cleanup failure remains a successful migration,
emits retryable diagnostics, and is retried on a later call without rerunning
transformation.

`V1toV2Migration.run()` no longer deletes legacy timeline databases during
transformation. Its real-name discovery helper is exported for the owning
browser migration. `IndexedDBAdapter` closes open databases so exact legacy
deletion cannot be silently blocked, and blocked deletion now rejects.

## Browser harness

Dedicated C5 files under `apps/vite-example` load the one shared conformance
matrix in a real Chromium page. The factory uses randomized, prefix-validated
disposable database/directory identities and exact resolved cleanup. The harness
also runs migration probes for no-op, real v1 success, failure preservation and
retry, wrapper coalescing, missing opt-in, undefined-name regression, and
postcommit cleanup diagnosis/retry.

Final browser result:

```text
Chromium 151.0.7922.34 / CDP 1.3
store: 19 passed, 0 failed, 0 skipped
migration probes: all true
database inventory: [] before, [] after
page/console errors: 0
Playwright: 1 passed
```

See `evidence/conformance-browser.md` and `evidence/migration.md` for exact
identities, commands, environment, and cleanup proof.

## Gates

- type baseline: PASS, exactly three pinned inherited diagnostics and no new
  identity;
- Vite example typecheck: PASS;
- focused conformance plus v1 migration unit tests: `46 pass / 0 fail`;
- targeted ESLint: PASS;
- strict Rasen validation: PASS;
- real Chromium Playwright: PASS; and
- diff/format checks: PASS.

A deliberately broader `bun test ... apps/web/src/services/storage` observation
was not green: it reported `121 pass / 2 fail / 1 loader error`. The failures
are the pre-existing C5 aggregate RED wrapper while consumer/Host integration is
still unfinished (opaque StorageService round-trip, production Host store, and
direct persistence importers); the loader error is the known Bun
`wasm.__wbindgen_start` test-loader issue. Do not represent that broad command as
a passing gate. The C5 browser leaf's focused tests and real-browser suite are
green.

## Integration notes

- No product file outside `apps/web/src/services/storage/**` was edited by this
  leaf. The Vite harness/config/test are dedicated conformance support.
- Shared port/conformance, coordinator, RED fixtures, boundary scripts, Hosts,
  and consumers visible in the worktree belong to the other C5 leaves.
- Production Host composition must instantiate/reuse this store explicitly;
  this leaf did not edit either Host.
- The public store remains schema-neutral; OpenCut migration types stay behind
  the storage implementation.
- No user-profile storage was opened or deleted, no browser process/server is
  left running, and the Playwright output artifact was removed.
- No commit was created. The parent APPLY wave should integrate/review the
  shared worktree, then continue sections 8–12.

