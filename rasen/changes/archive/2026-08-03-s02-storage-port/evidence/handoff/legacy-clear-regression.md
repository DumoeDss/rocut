# C5 legacy saved-sounds clear regression

Date: 2026-08-02

Status: complete, uncommitted, real Chromium verified.

## Scope

This follow-up changes only the existing BrowserProjectStore browser-conformance
probe, C5 harness result aggregation and Playwright assertion:

- `apps/web/src/services/storage/browser-project-store-conformance.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`

No BrowserProjectStore implementation, coordinator, consumer, Host, task
checkbox or delivery state was changed.

## Regression exercised

The disposable browser probe writes the genuine legacy saved-sounds row into
the configured library database/store under raw key `user-sounds`. The row is
read once through `loadLibraryRecord({ namespace: "saved-sounds", key:
"user-sounds" })` to prove that the legacy fallback is active.

The same store also writes:

- `graph-presets/custom-preset`, with a provider-private nested sentinel; and
- `unrelated-library/same-key`, with an independent provider-private sentinel.

It then executes `clear({ scope: { kind: "library", namespace:
"saved-sounds" } })` and proves all five postconditions in the real browser:

1. loading `saved-sounds/user-sounds` returns `null`;
2. listing the saved-sounds namespace returns zero records;
3. a raw database read of key `user-sounds` returns `null`, so the fallback
   cannot resurrect it;
4. the custom-preset record and its private sentinel are unchanged; and
5. the unrelated namespace record and its private sentinel are unchanged.

The harness exposes the result as `legacySavedSoundsClear: true` and includes it
in the overall pass gate.

## Browser result

Command, from `apps/vite-example`:

```text
bunx playwright test --config playwright.c5-storage.config.ts tests/c5-storage/browser-store.pw.ts
```

Result:

- Chromium/Chrome `151.0.7922.34`;
- 1 Playwright test passed, 0 failed, 1.7 seconds test time / 6.6 seconds total;
- shared BrowserProjectStore matrix: 19 passed, 0 failed, 0 skipped;
- all migration probes true, including `legacySavedSoundsClear`;
- page/console errors: zero;
- `beforeDatabases: []`, `afterDatabases: []`;
- cleanup proof: 11 resolved targets, comprising seven disposable identities
  and four explicit legacy database targets;
- no listener remained on port 4175 after Playwright teardown.

The clear-regression identity for this run was
`c5-disposable-24c6bb32-7cb4-44f1-836c-a5dcedfeb6a4`; its configured databases
were removed by the prefix/identity-validated cleanup path.

Additional gates:

- Vite example TypeScript check: PASS;
- pinned type baseline: PASS, exactly three inherited diagnostics and no new
  identity;
- `git diff --check`: PASS.
