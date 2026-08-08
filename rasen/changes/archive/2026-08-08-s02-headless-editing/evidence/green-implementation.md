# C7 implementation GREEN record

Date: 2026-08-05 (Asia/Shanghai)

## Implemented boundary

- `migration-gate.ts` owns the single React-free per-store migration promise, preserved `MigrationFailedError`, diagnostics/progress ordering, success memoization, and failure-only eviction. `create-session.ts` consumes and re-exports it for compatibility; the headless factory consumes the same function.
- `headless.ts` resolves a complete `EditorHost`, accepts no partial Host/fallback, mints immutable session/project identities, waits for migration, owns exactly one `SessionPersistenceCoordinator`, and exposes only `load`, `save`, and `dispose`. Its project type is derived from the coordinator's exact return type, avoiding a project-schema import through the session boundary while remaining the same detached `TProject` value.
- Admitted load/save operations serialize. Save ID mismatch fails before store I/O; failed saves do not poison retry. First disposal closes admission synchronously, joins prior work, destroys once, and all later disposal calls share the terminal promise. Post-disposal operations reject without touching the store.
- `headless-semantic-fixture.ts` uses a complete in-memory Host/store and deterministic project, nested opaque provider value, attachment metadata/body, timestamps, IDs, and digests. It performs a real local edit, explicit durable save, first disposal, new-owner reopen, and post-disposal rejection without React, navigation, network, filesystem, browser storage, or C6 resource ownership.
- Dedicated Vite and Next adapters execute that same fixture. Their graph producers emit one versioned envelope with exact root attribution, dependency edges, emitted membership, raw/normalized IDs, required roots, artifact/module digests, and Host/build/base identities.

## Focused GREEN

Command:

`bun test apps/web/src/editor/session/__tests__/headless-session.test.ts apps/web/src/editor/session/__tests__/headless-migration.test.ts apps/web/src/editor/session/__tests__/headless-browser-boundary.test.ts apps/web/src/editor/session/__tests__/headless-semantic-fixture.test.ts script/__tests__/c7-headless-graph.test.mjs script/__tests__/c7-headless-semantic-result.test.mjs`

Final result: exit `0`, `40 pass / 0 fail / 64 expectations` across six top-level files.

The direct migration inner process (`OPENCUT_HEADLESS_MIGRATION_ISOLATED=1`) is `6 pass / 0 fail / 16 expectations`: all four factory pairings join one delayed store run, distinct stores migrate independently, and failed creation retains error identity then retries.

The provider-private owner suite is `8 pass / 0 fail / 30 expectations`. The isolated browser-global sentinel passes with runtime-spelled throwing `window`, `document`, IndexedDB, and `navigator.storage`/OPFS accessors untouched. The semantic fixture passes with exact edit/reopen, opaque, attachment, durable-presence, and terminal results.

The graph suite is `16 pass / 0 fail / 17 expectations`; the semantic evaluator is `13 pass / 0 fail`. Both accepted Host envelopes replay through the final checker with `ok=true`, `exitCode=0`, complete required roots, non-empty emitted membership, valid file/module digests, and no forbidden issue.

## Regression GREEN adjacent to the extraction

- C5 port/store/opaque/topology/migration matrix: `67 pass / 0 fail / 443 expectations` across eight files, plus the conformance case totals printed by the adapter harness.
- C6 lifecycle/resource/runtime/storage matrix: `50 pass / 0 fail / 162 expectations` across 18 top-level files.
- C4 Host/runtime/asset/transcription/conformance matrix: `49 pass / 0 fail / 293 expectations` across six files.
- Host/port, storage, session-state, session-resource, runtime-asset, editor-singleton, distributable, emitted-asset, and reference boundaries all exit `0`; their negative controls prove the corresponding rules can fail.

Clean Host build, runtime, cross-Host, ordinary Host, type, WASM, full-suite, protected-identity, strict-validation, and process-cleanup facts are separated into `headless-hosts.md`, `ordinary-host-regression.md`, and `final-regression.md`.
