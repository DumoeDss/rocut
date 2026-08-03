# C5 ProjectStore contract implementation

Date: 2026-08-01

Product worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`

Scope: tasks 3.1-3.10 and the task 3.11 independent contract-review gate. Task
3.12 remains unchecked because the hard stop was verified not triggered; it is
a non-applicable guard rather than unfinished implementation work.

## Materialized C1 risk and chosen shape

The existing project-only `ProjectStore` could not express media attachment
bytes/metadata, saved-sound and graph-preset libraries, support/capacity checks,
or clear/cascade operations. The forcing inventory and rejected alternatives are
now recorded in `apps/web/src/editor/ports/DECISIONS.md` section 7.

The implementation deepens `EditorHost.store` in place. It does not add a
`MediaStore`, `StoragePort`, storage context, factory argument, hidden Host
property, singleton, browser mechanism type, or editor schema dependency.

## Public contract

`apps/web/src/editor/ports/project-store.ts` now exports:

- `ProjectAttachment`, scoped by `{ projectId, key }`, with opaque metadata and
  an `ArrayBuffer` body;
- `LibraryRecord`, scoped by `{ namespace, key }`, with schema version and opaque
  data;
- `ProjectStoreInspection` and `ProjectStoreCapacity`, distinguishing
  `available` with a real zero-byte estimate, `available` with an unknown
  estimate, `unavailable`, and `unsupported`;
- `ProjectStoreError` with the stable codes `aborted`, `quota-exceeded`,
  `unavailable`, `corrupt`, and `conflict`, plus logical operation/scope context;
- optional `AbortSignal` inputs on reads and replaceable/destructive mutations;
  and
- attachment/library CRUD and list operations, `inspect`, and scoped `clear`.

`remove({ id })` removes the project record, its summary, and only that project's
attachments. Library namespaces and other projects survive. `clear(projects)`
cascades to all project attachments, `clear(library)` affects one namespace, and
`clear(all)` removes both classes.

All new public types are re-exported through the existing
`apps/web/src/editor/ports/index.ts` surface. No second public persistence role
was introduced.

## Defensive-copy and commit semantics

The in-memory implementation uses `structuredClone`, not JSON round-tripping,
for records, summaries, opaque project data, attachment metadata/bodies, library
values, and list/load results. The matrix proves `Date`, `Map`, nested unknown
fields, and every attachment byte survive, while caller mutations in both input
and output directions do not alter durable state.

Uncloneable opaque values are mapped to a typed `corrupt` error before commit;
the public error retains no raw platform cause, database/path detail, or
platform exception text. A project save whose record and summary IDs differ
fails precommit with stable `conflict` classification and writes neither half.
Pre-aborted operations do no work. Injected quota/unavailable/corrupt/conflict
failures and a cancellation released at the pre-commit gate all leave the prior
attachment visible. Mutation queues serialize one logical key while allowing a
distinct key to complete independently. Queue identities are structural rather
than delimiter-joined strings. Project removal and project/all clear are
hierarchical barriers for affected record/attachment work; namespace/all clear
are barriers for affected library work. Invocation order therefore cannot leave
an earlier attachment or library write behind a later clear/remove.

List results are covered independently from load results: the shared matrix
mutates attachment metadata/body and library data returned from list operations,
then reloads to prove no durable alias exists.

## Independent review round 1

The first independent contract review rejected the initial implementation with
two major and three minor findings plus one test and one cleanup finding. The
repair round added failing controls before implementation for hierarchical
ordering, collision-shaped identities, required browser skips, disposable
store/cleanup binding, missing migration progress, raw platform causes,
record/summary ID mismatch, and aliased list values. The first eight controls
failed together; the alias negative matrix failed separately. All now pass.

The browser RED entry point now requests a randomized identity beneath
`c5-disposable-`, requires the actual fixture store/control/cleanup binding, runs
the `complete-browser` profile, and rejects any required storage skip. It still
intentionally imports the not-yet-implemented browser conformance fixture from
task 5.10; this round did not implement or wire `BrowserProjectStore`.

The unrelated formatting churn cited by review was removed from the existing
decision prose, barrel formatting, non-storage conformance cases, in-memory
factory, and graphics tests. Storage-contract changes remain intentionally
visible.

## Boundary controls (task 3.10)

| Command | Exit | Result |
| --- | ---: | --- |
| `node script/check-port-boundary.mjs` | 0 | PASS; 30 contract modules, zero editor-schema/store/mechanism/resource/timer leaks |
| `node script/check-port-boundary.mjs --negative-control` | 0 | PASS; every rule caught its violation and the non-violation converses remained accepted |
| `node script/check-storage-boundary.mjs` | 0 | PASS at this intermediate phase; unchanged provisional inventory of 736 source files |

The three still-red final storage-boundary controls (private context, singleton,
production in-memory fallback) belong to tasks 10.5-10.7 and are not represented
as green here. Their captured RED state remains in `evidence/failing-controls.md`.

## Verification

| Command | Exit | Result |
| --- | ---: | --- |
| `bun test apps/web/src/editor/ports` | 0 | 28 tests, 0 failures, 179 expectations; primary store matrix 18 pass / 0 fail / 1 explicit portable migration skip |
| isolated C5 attachment/library selectors | 0 | 4 pass, 0 fail, 5 unrelated selectors skipped; the four former missing-method REDs are green |
| `node script/check-type-baseline.mjs` | 0 | exactly three diagnostics, all in the inherited pinned set; no new identity |
| `git diff --check` | 0 | no whitespace error |
| `rasen validate s02-storage-port --project rocut --strict --json` | 0 | strict validation PASS, zero issues |

Targeted ESLint over the five changed port TypeScript/test files exits 1 only on
four inherited errors in unchanged lines (`prefer-object-params` in the existing
generic conformance case method and worker constructor, the existing JSON parse
assertion, and the existing `PORT_ROLES` assertion). The pinned type-baseline
gate remains the authoritative regression check and passes with no new
diagnostic identity; those unrelated lint errors were not churned in this round.

## Independent review round 2 acceptance

`evidence/contract-review-round2.md` records `ACCEPTED CLEAN` with finding tally
`B 0 / Ma 0 / Mi 0 / T 0`. Task 3.11 is therefore checked. The accepted review
explicitly permits production browser-store work to proceed without restoring
the byte-exact C1 surface or creating a parallel persistence seam.

Task 3.12 remains unchecked and is verified not triggered. It is not an
unfinished implementation item; final task accounting must classify it as a
non-applicable hard-stop guard.

The exact in-memory matrix tally and case inventory are in
`evidence/conformance-in-memory.md`.
