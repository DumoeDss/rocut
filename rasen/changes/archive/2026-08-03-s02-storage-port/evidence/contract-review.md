# C5 pre-wiring contract review

Date: 2026-08-01

Reviewer scope: independent, report-only review of tasks 3-4 before any production
consumer is wired. Product worktree:
`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5` at base
`0ef35459f685d5d41a25d0ef959aff691b7519cd`.

## Verdict

**REJECTED — HARD STOP.** This is not `ACCEPTED CLEAN`.

- Task 3.11 must remain unchecked.
- Task 3.12 is **not** triggered: this review does not require preserving the
  byte-exact C1 interface and does not authorize a second port/context/singleton.
  The materialized C1 risk is real, and an in-place amendment of
  `EditorHost.store` is the correct architectural direction. The hard stop is on
  defects in the amended semantics and their proof, not on the amendment itself.
- Do not wire `BrowserProjectStore`, a coordinator, or a production consumer
  until the Major findings below are fixed and independently re-reviewed.

Finding tally: **B 0 / Ma 3 / Mi 2 / T 1**.

## Contract-direction ruling

The forcing evidence is valid. The C1 project-only surface cannot express the
existing media-body/metadata calls, durable saved-sound and graph-preset calls,
capacity/support queries, or cascade/clear behavior without retaining the
singleton, exposing editor schema through the Host, or introducing a second
persistence role. Deepening the existing role is preferable to each rejected
alternative.

The public shape is otherwise correctly placed:

- `EditorHostPorts.store` remains the only persistence role;
- no `MediaStore`, `StoragePort`, `StorageContext`, hidden Host property, new
  session/factory parameter, or singleton escape hatch entered the diff;
- project, attachment and library values use logical IDs, opaque data and
  portable `ArrayBuffer` bytes;
- the public port source imports no OpenCut project/media/sound/preset schema and
  names no IndexedDB, OPFS, database, object-store, or storage path;
- `inspect()` distinguishes a real zero-byte estimate from unavailable,
  unsupported, and available-with-unknown-estimate states; and
- the ordinary sequential cascade/isolation and structured-clone paths are
  implemented, not fixed-return stubs.

Those positives do not overcome the hard-stop findings.

## Findings

### [Ma1] Project cascade and clear are not ordered with child-key mutations

`InMemoryProjectStore` uses unrelated queue keys for project writes/removal
(`project:<id>`), attachment writes (`attachment:<projectId>:<key>`), library
writes (`library:<namespace>:<key>`), and every clear (`store:clear`). See
`apps/web/src/editor/ports/in-memory/index.ts:282-316`, `392-419`, `522-565`, and
`588-607`.

That makes the promised logical cascade false under an ordinary invocation race.
The following read-only stdin probe was run against the reviewed tree:

1. save project `race-project`;
2. pause `saveAttachment(race-project, late)` immediately before commit;
3. invoke and await `remove(race-project)`;
4. release the earlier attachment write.

Observed result:

```json
{"project":null,"attachmentBytes":[1]}
```

The earlier attachment invocation commits after the later project removal and
recreates an orphan. The same queue design permits project/all clear to race
project or attachment saves, and namespace/all clear to race library saves. This
violates invocation-order semantics and the requirement that removal/clear
cascade be one logical operation.

The string-concatenated queue IDs are also collision-prone: for example,
`{ projectId: "a:b", key: "c" }` and `{ projectId: "a", key: "b:c" }`
produce the same attachment queue key. Distinct logical keys can therefore block
one another despite the independent-progress requirement.

Required repair: define collision-free logical identities and a hierarchical
ordering/barrier rule. At minimum, project removal must serialize with every
attachment mutation in that project, project/all clear with all affected project
and attachment mutations, namespace clear with mutations in that namespace, and
all clear with every affected mutation. Add shared conformance races that pause
the earlier operation and prove the later destructive operation wins in
invocation order without leaving an orphan.

### [Ma2] The shared matrix can report PASS while required storage cases never ran

`ProjectStoreConformanceFixture.control` is optional
(`conformance/index.ts:67-74`). Capacity, injected failures and ordering use
`skip()` when it is absent, and `ConformanceReport.passed` is computed only from
the absence of `failed` results (`conformance/index.ts:282-285`). The current
browser RED fixture supplies neither `storeFixture` controls nor a disposable
migration identity (`script/fixtures/c5-browser-store-conformance/browser-store-conformance.ts:5-12`).

This is observable today: the no-control in-memory run printed overall `PASS`
with storage `13 passed / 0 failed / 4 skipped`; the skipped storage cases were
capacity, typed failure/commit preservation, ordering, and migration. A browser
adapter can therefore omit the exact capabilities that distinguish it from a
trivial CRUD adapter and still receive a green top-level report. That conflicts
with the requirement that the browser implementation run the same storage
matrix with no copied, weakened, or skipped cases.

The migration opt-in guard has the same trust gap. It validates only two caller-
supplied strings; nothing binds `disposableMigration.identity` to the actual
store passed in. A production-bound store plus a fabricated
`c5-disposable-*` label reaches `store.migrate()` after passing the current guard.
The final browser fixture may be written carefully, but the advertised adapter
seam does not itself establish that safety.

Required repair: add an explicit complete-browser conformance profile whose
required case set makes a skip fail the profile; update the browser fixture to
supply and bind controls plus a randomized disposable identity to the actual
constructed/cleaned store; assert zero skipped storage cases in its executable
entry point. Keep ordinary no-migration in-memory runs able to report an
intentional skip without allowing that weaker profile to be cited as complete
browser conformance.

Also strengthen the shared matrix so an alternate adapter cannot pass while
returning aliased list values: mutate attachment metadata/body returned by
`listAttachments()` and library data returned by `listLibraryRecords()`, then
reload/re-list and require durable state to remain unchanged. The implementation
currently clones these values, but the reusable proof does not cover every
claimed return/list direction.

### [Ma3] `ProjectStoreError` exposes the mechanism error it claims to hide

The public constructor accepts `cause?: unknown` and forwards it to `Error`
(`project-store.ts:127-150`). `clonePayload` already supplies the raw platform
exception (`in-memory/index.ts:69-82`). The reviewed probe for an uncloneable
library value returned:

```json
{"publicName":"ProjectStoreError","publicCode":"corrupt","causeName":"DataCloneError","causeMessage":"The object can not be cloned."}
```

Thus callers can inspect a platform error name/message through the public port.
The future browser mapper can likewise expose `QuotaExceededError`, IndexedDB
transaction failures, or filesystem details even though the design states that
platform error names remain inside the adapter and only stable code,
operation, and logical scope cross the seam.

Required repair: do not retain a raw platform exception on the public error.
Keep the raw cause inside the browser boundary for attributed diagnostics, and
surface only the stable code, operation, logical scope, and a sanitized
mechanism-neutral message through `ProjectStoreError`. Add a negative assertion
that the thrown public error contains no raw platform error object/name/path.

### [Mi1] Migration progress is collected but never checked

The migration case pushes `ctx.report()` values into `progress` and then never
asserts the array (`conformance/index.ts:1054-1059`). The passing migration
fixture in `__tests__/conformance.test.ts:43-57` never calls `ctx.report`, so a
silent migrated outcome passes. This weakens the shared migration claim and
should be repaired when tightening the complete-browser profile. Browser-specific
stage/read-back/source-preservation probes remain tasks 5-6 and were not expected
to exist at this gate.

### [Mi2] Project record/summary identity consistency is unspecified and untested

`save()` accepts independent `record.id` and `summary.id` values
(`project-store.ts:237-241`). The reference implementation stores them under
their respective IDs (`in-memory/index.ts:290-292`) while queueing only on
`record.id`. A mismatched call can make `load(record.id)`, `list()`, and
`remove(record.id)` disagree. This shape predates the C5 widening, but C5 now
formalizes cascade and durable ordering and should either require equal IDs or
map a mismatch to a stable pre-commit error; add the corresponding conformance
case.

### [T1] Unrelated formatting churn is harmless but obscures review

Parts of `DECISIONS.md`, `ports/index.ts`, and the non-storage conformance cases
were reformatted without semantic change. This is not a correctness issue, but
retaining only storage-related semantic edits would make the eventual landing
and provenance review easier.

## Verification performed

| Command/probe | Exit | Result |
| --- | ---: | --- |
| `bun test apps/web/src/editor/ports` | 0 | 19 pass / 0 fail / 152 expectations; primary in-memory storage 16 pass / 1 explicit migration skip |
| `node script/check-port-boundary.mjs` | 0 | 30 contract modules; all positive rules pass |
| `node script/check-port-boundary.mjs --negative-control` | 0 | every boundary rule catches its fixture and accepts its converse |
| `node script/check-storage-boundary.mjs` | 0 | expected intermediate/provisional state; 736 sources, one `BrowserHostAdapter` user |
| `bun test script/__tests__/c5-storage-boundary-red.test.mjs` | 1 | expected RED: 3 pass / 3 fail; private context, singleton, and in-memory fallback remain for tasks 10.5-10.7 |
| `node script/check-type-baseline.mjs` | 0 | exactly three current diagnostics, all inherited/pinned |
| `git diff --check` | 0 | no whitespace errors (only Git LF-to-CRLF warnings) |
| cascade-order stdin probe | 0 | reproduced orphan attachment after project removal |
| public-error stdin probe | 0 | reproduced raw `DataCloneError` through `ProjectStoreError.cause` |

The expected RED boundary controls are not treated as new findings at this
pre-wiring phase. The hard stop is the contract/reference/conformance behavior
above.

## Re-review gate

A fresh reviewer may mark task 3.11 and issue `ACCEPTED CLEAN` only after:

1. the hierarchical mutation/cascade race is fixed in the reference store and
   covered in the shared matrix;
2. the complete-browser profile cannot pass with a required storage case
   skipped and its disposable identity is bound to the real fixture store;
3. raw mechanism errors no longer cross through the public error; and
4. the affected port tests, positive/negative port boundary gates, type ceiling,
   `git diff --check`, and new negative race/alias controls all pass.

