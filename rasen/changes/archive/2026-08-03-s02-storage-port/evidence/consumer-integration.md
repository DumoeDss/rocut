# C5 Consumer Integration Evidence

Date: 2026-08-02  
Role: integration finalizer for tasks 8.13 and 8.14  
Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`  
Commit: none; the shared C5 worktree remains uncommitted

## Unified durable-failure audit

| Consumer family | Session diagnostics | Visible recovery state | No false success |
| --- | --- | --- | --- |
| Project manager / SaveManager | `EditorCore.reportPersistenceFailure` emits fixed text and `{ operation, code }` only | Generic toast descriptions retain the open data and direct the user to retry | create/load/save/list/delete/rename/duplicate reject; create publishes nothing before commit; failed auto-save remains dirty without retry spin; explicit flush rejects |
| Media manager / commands | Same session reporter; quota is a stable typed code | Quota guidance or generic retry/rollback toast | manager add returns its explicit `null` failure and publishes nothing; load/clear reject; optimistic command add/remove restores live state on failed durability |
| Scene manager | Same session reporter | Generic retry toast | durable load rejects and retains prior live scenes |
| Media processing | Failed capacity inspection reports through the owning editor | Generic import-not-performed toast | inspection rejection propagates; unavailable, unknown capacity and real zero capacity remain distinct |
| Saved sounds | Session store registry binds logical `{ library, operation, code }` to `session.diagnostics` | Generic retry toast plus `savedSoundsError`; failed clear keeps its dialog open | load/save/remove/clear reject and publish live state only after durable success |
| Custom presets | Same session-bound library diagnostics | Store error is rendered as an alert with a Retry control | load/save/remove reject and publish only after durable success |
| StorageProvider | Fixed `Durable editor storage operation failed` record with `{ operation, scope, code }` | Provider error state and toast use `Storage is unavailable. Retry the operation.` | refresh and clear reject; clear runs durable clear, project refresh and inspection in order and never exposes a refreshed success state after an intermediate failure |

Provider-private errors were exercised with sentinel messages/properties. Core, library and provider diagnostic assertions serialize the emitted record and prove the sentinel is absent. The application may still reject with the original typed error to its immediate caller; UI catches do not log or render that raw value.

The finalizer extracted `storage-provider-operations.ts` so the payload-free record and clear/reload/inspect failure ordering are directly testable, and added a real session-binding test proving saved-sound and preset failures reach the Host's recording diagnostics port. One unrelated unsafe scroll-event reconstruction in the edited sounds view was replaced by passing the original typed event; this made the targeted consumer lint gate clean.

## Combined focused consumer suite

Command:

```text
bun test apps/web/src/core/managers/__tests__/project-persistence-rewire.test.ts apps/web/src/core/managers/__tests__/media-persistence-rewire.test.ts apps/web/src/core/managers/__tests__/save-manager-persistence-failure.test.ts apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts apps/web/src/media/__tests__/persistence.test.ts apps/web/src/media/__tests__/processing-capacity.test.ts apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts apps/web/src/components/__tests__/storage-provider-operations.test.ts apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts apps/web/src/editor/ports/__tests__/conformance.test.ts
```

Result: **43 passed, 0 failed, 195 assertions across 11 files**.

The isolated suites hidden behind wasm-safe wrapper tests were also run directly where consumer evidence needed its internal count:

- sounds/presets/session binding: 8 passed, 0 failed, 58 assertions;
- project manager/session diagnostics: 3 passed, 0 failed, 15 assertions;
- media manager/commands: 2 passed, 0 failed, 14 assertions;
- C5 RED-to-green storage consumers: 9 passed, 0 failed, 26 assertions.

## Chromium C4 and adjacent legacy-clear gate

Command from `apps/vite-example`:

```text
bunx playwright test --config playwright.c5-storage.config.ts tests/c5-storage/browser-store.pw.ts tests/c5-storage/c4-forced-none.pw.ts
```

Result: **2 passed, 0 failed** in 17.8 seconds on Chromium/Chrome `151.0.7922.34`.

- BrowserProjectStore shared matrix: 19 passed, 0 failed, 0 skipped.
- `legacySavedSoundsClear: true`: raw legacy `user-sounds` was loaded once, namespace-cleared, absent from both port and raw database reads, and did not resurrect.
- Custom preset and unrelated library namespace private sentinels survived the saved-sounds clear.
- `beforeDatabases: []`, `afterDatabases: []`; cleanup proof contained all 11 disposable/legacy targets.
- C4 forced-none harness reached `data-status="ready"`, with an empty 14-item assertion-failure list, zero page errors and zero unhandled rejections. Its project fixture was seeded through `editorForSession(session).persistence` and its degraded thumbnail exit assertion remained true.
- Port 4175 had no listener after teardown.

This both confirms the earlier `handoff/legacy-clear-regression.md` and verifies it against the shared final consumer tree rather than relying only on the prior run.

## Static and type gates

- Targeted ESLint over all rewritten consumer/product/test files: exit 0, no errors; only the repository's informational missing-pages message.
- `node script/check-type-baseline.mjs`: PASS with exactly the three inherited diagnostics and no new identity.
- `bun run typecheck` in `apps/vite-example`: PASS.
- `node script/check-session-state-boundary.mjs`: PASS, 10/10 factories, 10/10 registry keys, 52 classified imperative modules.
- `git -c core.whitespace=cr-at-eol diff --check`: PASS; the explicit rule matches tracked CRLF blobs on this Windows checkout.
- `rasen validate s02-storage-port --project rocut --strict --json`: valid with no issues after tasks 8.13 and 8.14 were checked.

Tasks 8.13 and 8.14 have no remaining consumer-family red. The separate final storage-boundary script modernization remains section 10 work and was not changed here.
