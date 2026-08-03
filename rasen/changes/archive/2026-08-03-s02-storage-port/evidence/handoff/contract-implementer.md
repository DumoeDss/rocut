# C5 contract implementer handoff

Date: 2026-08-01

Round-2 gate update (2026-08-02):
`evidence/contract-review-round2.md` is `ACCEPTED CLEAN` with
`B 0 / Ma 0 / Mi 0 / T 0`, so task 3.11 is now checked and supersedes the
pre-review status below. Task 3.12 is verified not triggered, not an unfinished
implementation item; final task accounting must classify it as a non-applicable
hard-stop guard.

Role scope completed: tasks 3.1-3.10 and 4.1-4.12.

Task 3.11 is now checked following the independent round-2 acceptance. Task
3.12 intentionally remains unchecked as the verified non-triggered,
non-applicable hard-stop guard described above.

## Product files changed by this role

- `apps/web/src/editor/ports/project-store.ts`
- `apps/web/src/editor/ports/index.ts`
- `apps/web/src/editor/ports/in-memory/index.ts`
- `apps/web/src/editor/ports/conformance/index.ts`
- `apps/web/src/editor/ports/__tests__/conformance.test.ts`
- `apps/web/src/editor/ports/DECISIONS.md`

No BrowserProjectStore, migration implementation, coordinator, consumer, Host,
session factory, C6 disposal, protected fixture, Rust, generated WASM,
provenance, inventory, run-state, portfolio, commit, or PR change was made by
this role.

## Contract downstream implementers must match

- Attachment identity is `{ projectId, key }`; the value is opaque `metadata`
  plus an `ArrayBuffer body`.
- Library identity is `{ namespace, key }`; the value adds `schemaVersion` and
  opaque `data`.
- `inspect()` differentiates available/unknown-estimate, available/zero,
  unavailable, and unsupported.
- Missing records return `null`. Failures use `ProjectStoreError` and one of
  `aborted`, `quota-exceeded`, `unavailable`, `corrupt`, or `conflict`.
- Operations accept optional `AbortSignal`. A pre-aborted operation does no work;
  an abort/failure before commit preserves the prior value; a mutation must not
  report cancellation after commit.
- `remove(project)` and `clear(projects)` cascade attachments only. Library
  namespace clear and all clear are explicit separate scopes.
- Inputs, outputs and lists are defensive structured clones. JSON-only cloning
  fails the matrix because `Date` and `Map` are exercised.
- Mutations serialize per durable key while distinct keys make progress.

## Shared matrix adapter seam

Use the exported `runProjectStoreConformance` with a
`ProjectStoreConformanceFixture`. For a complete browser run, the fixture must
supply:

- the production `store`;
- structural test-only controls for `setInspection`, `failNext`, and
  `pauseNext`; these are adapter-fixture plumbing and must not appear on the
  public `ProjectStore`; and
- `disposableMigration: { identity, prefix }`, with the randomized identity
  strictly under the declared disposable prefix, together with
  `exerciseMigration: true`.

The existing untracked RED browser fixture still uses the older
`runPortConformance({ exerciseMigration: true })` call. The BrowserProjectStore
implementer should update that fixture to provide the controls and disposable
identity, not copy or weaken the matrix. A complete browser storage run should
have zero skipped store cases.

## Verification

- port tests: 19 pass / 0 fail / 152 expectations;
- complete in-memory store matrix: 16 pass / 0 fail / one explicit no-migration
  skip;
- former attachment/library RED selectors: 4 pass / 0 fail;
- type baseline: exactly three inherited diagnostics, no new identity;
- port-boundary positive and negative controls: PASS;
- `git diff --check`: PASS.

Detailed evidence: `evidence/contract-implementation.md` and
`evidence/conformance-in-memory.md`.
