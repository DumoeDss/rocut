# C5 browser storage conformance

Date: 2026-08-02

## Real browser gate

Command, run from `apps/vite-example` in the C5 worktree:

```powershell
bunx playwright test --config playwright.c5-storage.config.ts
```

Exit: 0. Playwright reported `1 passed` in 4.4 seconds. The page also asserted
that no uncaught page error or browser-console error occurred.

Environment observed through a browser-level CDP session:

- Playwright browser: Chromium `151.0.7922.34`;
- CDP product: `Chrome/151.0.7922.34`, protocol `1.3`;
- JavaScript engine: `15.1.206.8`;
- ephemeral browser PID: `64276` during the run; and
- browser PID exited and Vite port `4175` was closed after the run.

## Exact shared matrix result

The browser harness imports the exported `runPortConformance` matrix through
`script/fixtures/c5-browser-store-conformance/browser-store-conformance.ts`. It
uses the `complete-browser` profile and does not copy or weaken browser cases.

| Port | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| store | 19 | 0 | 0 |

The fixture additionally rejects a report containing either an ordinary store
skip or a `required complete-browser case skipped` conversion. All project,
attachment, library, inspection/capacity, typed failure, cancellation,
hierarchical scheduling, clear/cascade, and migration cases therefore ran.

The final randomized conformance identity was
`c5-disposable-64da423f-10ca-42ab-989e-5bc849fcb371`. The fixture requires an
exact binding among this identity, the store under test, and its cleanup object.

## Storage identities and cleanup

The production implementation retains the configured real storage layout:

- projects: database `video-editor-projects`, object store `projects`;
- attachment metadata: database prefix `video-editor-media-`, object store
  `media-metadata`;
- attachment bodies: OPFS directory prefix `media-files-`; and
- durable library data: database `video-editor-saved-sounds`, object store
  `saved-sounds`.

Browser conformance never opens those unqualified developer-profile targets.
Every test database and OPFS directory is derived from a randomized identity
under `c5-disposable-`. Destructive cleanup first resolves inventory, verifies
both the exact identity and prefix, rejects `undefined`, and then deletes only
those resolved targets.

The final real-browser run recorded `beforeDatabases: []` and
`afterDatabases: []`. The temporary Playwright output file was removed after
verification. No browser profile, database, OPFS artifact, screenshot, trace,
video, server, or browser process remained.

## Supporting gates

- `node script/check-type-baseline.mjs` — exit 0; exactly the three pinned
  inherited diagnostics, no new diagnostic identity.
- `bun run typecheck` in `apps/vite-example` — exit 0.
- targeted ESLint over the browser-store and touched migration mechanism files
  — exit 0 (the repo's informational missing Pages-directory message remained).
- `bunx prettier --check` over the C5 browser files — clean after formatting.
- `git diff --check` over the browser-store/harness write set — exit 0; only the
  existing Windows line-ending notice for two tracked storage files.

