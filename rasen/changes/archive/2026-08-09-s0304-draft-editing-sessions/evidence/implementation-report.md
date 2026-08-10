# T2 Draft editing implementation evidence

Date: 2026-08-09
Branch: `feat/s0304-draft-editing-sessions`
Base: `f2e36b9b9ced88f3bee9514d5fa5f37febdd8abd`

## Review-cycle tested source binding

- Review-fix source commit: `fc6f8c0efda2699d8ef437409a6a35b0c05abc32`
- Exact tested Git tree: `fd4080dbebfb3907134c9df412314ca5ce6d39ba`
- Parent implementation commit: `cbfb4f6852f30baff4427fac0df1486a9db53b1a`
- The focused gates, both Host builds, both parity runs, and comparator below ran
  while `HEAD` and `HEAD^{tree}` had exactly those values and the tracked worktree/index
  were clean. The later evidence-only commit changes only T2 task/evidence files; it is
  not part of the tested source tree. This binding uses Git identities and output
  digests, not filesystem timestamps.

## Implemented scope

- Added the Host-neutral Draft contract, manager, exhaustive operation classification,
  retention preflight, review reducer, inverse planner, generic conformance runner, and
  focused tests exclusively under `apps/web/src/editor/contracts/draft/**`.
- The manager captures a bounded revision sandwich, shares one injected parent engine,
  evaluates every call through T1's evaluator on a private savepoint, and publishes only
  through one expected-revision parent apply after retention succeeds.
- A successful approval returns one immutable receipt and one compensating batch. Every
  T0 operation kind, update pre-image, track cascade, clean undo, and stale undo is covered.
- Manual and auto modes are fixed. Terminal calls, sibling conflicts, immediate-category
  forgery, provider rejection/throw, retention failure, and parent store failure are
  structured and leave prohibited state untouched.

## Completed verification

| Command                                                                                                                                                                   | Result                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun test apps/web/src/editor/contracts/draft/__tests__/draft.test.ts apps/web/src/editor/contracts/engine/__tests__/engine.test.ts`                                      | PASS — 22 tests, 128 expectations, 0 failed. T2 generic report: 19 passed, 0 failed, 1 deliberate zero-assertion skip.                                                                                                                              |
| `node script/check-transaction-boundary.mjs`                                                                                                                              | PASS — 28 tracked + uncommitted contract modules scanned, including all 10 new Draft modules.                                                                                                                                                       |
| `node script/check-transaction-boundary.mjs --negative-control`                                                                                                           | PASS — every forbidden rule caught and every converse control remained uncaught.                                                                                                                                                                    |
| `node script/check-type-baseline.mjs`                                                                                                                                     | PASS — 3 current diagnostics, none outside the pinned baseline; fixture not regenerated.                                                                                                                                                            |
| `bun run build` (`apps/vite-example`)                                                                                                                                     | PASS — Vite 7.3.6 transformed 2,893 modules and built in 38.63 s; only the existing dynamic-import/chunk-size warnings.                                                                                                                             |
| `bun run build` (`apps/web`)                                                                                                                                              | PASS — Next 16.1.3 compiled in 24.2 s and generated all 19 static pages; `/api/sounds/search` remained a dynamic route and the known missing-Freesound-environment failure did not reproduce under the documented nine process-scoped placeholders. |
| `bun run test:parity` (`apps/vite-example`, Vite Host)                                                                                                                    | PASS — 1 scenario passed in 49.7 s (scenario 43.6 s).                                                                                                                                                                                               |
| `PARITY_HOST=next`, `PARITY_BASE_URL=http://127.0.0.1:3100`, `bun run test:parity`                                                                                        | PASS — Next 16.1.3 returned HTTP 200; 1 scenario passed in 48.8 s (scenario 45.2 s); exact PID 14888 exited and port 3100 had zero listeners afterward.                                                                                             |
| `node script/diff-parity-snapshots.mjs apps/vite-example/tests/parity-artifacts/vite/snapshot-vite.json apps/vite-example/tests/parity-artifacts/next/snapshot-next.json` | PASS — 0 semantic / 9 incidental differences across 195 leaf values; no output file and no oracle re-baseline.                                                                                                                                      |
| `rasen validate s0304-draft-editing-sessions --strict --project rocut --json`                                                                                             | PASS — 1 change passed, 0 failed, 0 issues.                                                                                                                                                                                                         |
| `bunx prettier --check ...` and `rg 'JSON\\.stringify'` over Draft conformance/tests                                                                                      | PASS — owned files formatted; zero JSON equality oracles remain.                                                                                                                                                                                    |

### Host/parity output digests

| Artifact/procedure                  | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| Vite normalized snapshot            | `a49213df4f9d4f55b36f0a34dddd24238cc7e6bb588f5f7742a1909b157fd9bd` |
| Next normalized snapshot            | `0e3813b4fccc2eb3a8b5a3b04b2d8adafb17a3e5408e03cd17d9011147fd3ed6` |
| Vite Playwright result              | `64838693c95eae1311c335fdfde3b2a096c76e43be47ac2e57f2fd54a1a5fb7e` |
| Next Playwright result              | `1891196c3a4e1256294ee97b47519c1a7d2e9a10d5b920b8797f187d94ecd5fc` |
| Committed comparator                | `a63f88b8dcc2a8023945d287bed8bfa1f72d32717fb15f376510201dbbabe71c` |
| Ephemeral exact-process Next runner | `ebf16d4d7880738ad841fd3b3165896003162121ee43f715b81b042f0ba86287` |

## Capability falsification sweep

Every current `rasen/specs/*/spec.md` was strictly decoded and every SHALL/MUST token
was inspected against the additive T2 product delta. The main capability set contains
16 specs and 330 assertions; no assertion was falsified. The T2 delta contributes 20
additional assertions, covered by the Draft conformance/focused tests.

| Capability                            | SHALL/MUST | Falsification result                                                                                                                                 |
| ------------------------------------- | ---------: | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser-persistence-boundary`        |         22 | PASS — no browser store, storage mechanism, migration, or persisted schema path changed.                                                             |
| `developer-reproducibility`           |          6 | PASS — no toolchain/instructions path changed; both documented Host builds and parity commands ran successfully.                                     |
| `editing-parity-fixture`              |          7 | PASS — both production Hosts passed the same scenario; comparator reported 0 semantic differences without re-baselining.                             |
| `editor-session-runtime`              |         35 | PASS — no session, core, command-context, React surface, or lifecycle path changed.                                                                  |
| `headless-editing`                    |         20 | PASS — no headless entry, Host evaluator, graph checker, or accepted evidence path changed.                                                          |
| `host-port-contract`                  |         30 | PASS — no `ports/**`, Host contract, or in-memory/browser port implementation changed.                                                               |
| `host-service-boundary`               |          7 | PASS — no endpoint, service availability, or Host composition path changed.                                                                          |
| `inherited-defect-repair`             |          6 | PASS — no existing distributable source or defect oracle changed.                                                                                    |
| `next-free-distributable-boundary`    |          7 | PASS — Vite production build remained green and Draft source imports only T0/T1 contract modules.                                                    |
| `runtime-asset-delivery`              |         13 | PASS — no Worker, asset-manifest, public path, or runtime delivery source changed.                                                                   |
| `self-built-wasm-artifact`            |         10 | PASS — no Rust, generated JS/WASM, declaration, or artifact-selection path changed.                                                                  |
| `session-resource-disposal`           |         35 | PASS — Draft state is in-memory and acquires no session resource class; no disposal owner/harness changed.                                           |
| `session-state-isolation`             |         23 | PASS — no session stores, compositor owner, migration view, or browser harness changed.                                                              |
| `transaction-automation-api`          |         64 | PASS — frozen T0/T1 source is unchanged; combined focused suite, boundary/negative control, and type ceiling all pass.                               |
| `upstream-provenance`                 |         25 | PASS — no upstream source, license, patch log, SBOM, defect record, or pinned fixture changed.                                                       |
| `wasm-api-surface`                    |         20 | PASS — no Rust/generated WASM/API declaration or runtime-query surface changed.                                                                      |
| T2 `transaction-automation-api` delta |         20 | PASS — snapshot/isolation, savepoints, lifecycle/review, one-batch apply/undo, classification/retention, and run-local conformance are all executed. |

## Additive scope proof

- Branch `feat/s0304-draft-editing-sessions` remained at dependency base
  `f2e36b9b9ced88f3bee9514d5fa5f37febdd8abd` before the T2 commit.
- Tracked worktree and index deltas were both empty. The complete untracked product
  inventory contained exactly 10 files, all under
  `apps/web/src/editor/contracts/draft/**`; there were zero product files outside that
  prefix.
- Relative to the base, there was no tracked delta in the frozen T0 root/T1 engine,
  `ports/**`, session, commands, Surface, either Host source, Rust, generated WASM,
  `script/fixtures/type-baseline.json`, parity fixture, or comparator.
- Build/parity output remained ignored/generated. The unrelated untracked Rasen
  changes and `.rasen/**` orchestration state are outside the T2 commit allowlist.

## Text and diff integrity

- Strict `UTF8Encoding(false, true)` decoding passed for all 20 T2-owned files: 10
  Draft source/test files and 10 change/review artifacts.
- Every file is UTF-8 without BOM and uses LF consistently. No file contains U+FFFD,
  typical mojibake sequences, NUL bytes, trailing whitespace, or the scanned private
  key/provider-token patterns.
- All product files are new in the allowed additive subtree, so there is no unrelated
  whole-file rewrite. The tracked worktree remained empty and `git diff --check`
  passed. The same scan is rerun after the final evidence/task edits and on the staged
  commit delta.

## Apply completion

All 46 planned and review-repair tasks are complete. The implementation is apply-ready
for independent re-review; this author report does not self-certify review findings as
resolved.

## Review-cycle round 3 repair evidence

Round 3 removes the round-2 whole-document compensation strategy without changing the
frozen T0/T1 contract or engine implementation:

- The T2-private planner now retains the longest recoverable base-order prefix for each
  collection, emits direct inverse updates where T1 patches can express the pre-image,
  and recreates only the smallest suffix required by a missing/reordered entity, asset
  replacement, or own-property removal. Clip repair is closed over recreated parents.
- The exact compensation batch is evaluated against the projected post-forward content
  with the same provider policy list before the parent engine is called. Rejection or
  throw returns `compensation-rejected` / `compensation-failed`, proves the projected
  result equals the captured base, and leaves durable state untouched.
- A provider policy that rejects every non-`update-marker` operation observes only one
  marker update in stage evaluation, compensation preflight, forward apply, and undo.
  A second policy that rejects the inverse value blocks the Draft before parent apply.
- The exact-order/absent-property regression now restores the same base with 14
  operations and no asset operation, versus the previous 24-operation full-content
  rebuild. A deterministic 8,000-marker case returns exactly one inverse operation for
  one changed field and restores first/middle/last ordering; it uses no wall-clock pass
  criterion.
- Generic error evidence preserves Map entries, Set members, Date timestamps, RegExp
  source/flags/lastIndex, nested cycles, and custom data properties as tagged frozen
  snapshots. Original container mutation cannot affect the snapshot, evidence-owned
  accessors remain unread, and known `TransactionError` / `ProjectStoreError` prototype
  semantics remain intact.

Focused verification after these repairs: Draft + engine Bun suites PASS with 26 tests,
180 expectations, and zero failures; Draft conformance reports 20 passed, zero failed,
and one deliberate zero-assertion skip. `node script/check-type-baseline.mjs` remains
green at the pinned ceiling of 3 diagnostics. Final boundary, strict Rasen, encoding,
format, and diff checks are recorded in the round-3 handoff/commit result rather than
the reviewer-owned `evidence/review-cycle-report.md`.

## Post-cap strategy attempt 1 repair evidence

The first material-change strategy after the three-round cap closes M1/M2/M3 without
changing T0/T1 public types, engine methods, commands, Hosts, or Rust:

- T1 durable apply and T2 compensation preflight now share
  `projectCommittedTransactionDocument`. Given an accepted evaluated document, batch,
  result, and canonical fingerprint, it preserves the complete document and appends
  exactly the forward keyed replay entry that durable apply commits. T2 derives its
  compensation base from that projection rather than a content-only reconstruction.
- The public deterministic-policy regression requires the forward `:apply` ledger
  entry for every undo. Compensation preflight and the later real undo observe
  structurally equivalent documents, including the same revision, key, fingerprint,
  result, and restored content; the published undo succeeds. The independent policy
  that rejects the inverse still terminates approval before parent apply, with zero
  save/watch and unchanged durable revision/content.
- Private-data comparison now records paired left-to-right and right-to-left weak-map
  mappings. Repair planning promotes an insufficient minimal patch to one complete
  entity pre-image graph and clones the planned operation array as one graph. Public
  distinct-to-shared and shared-to-distinct regressions both apply successfully and
  restore the base alias topology exactly through the published undo.
- Prettier write scope for M3 is limited to the three reported artifacts: `design.md`,
  this implementation report, and the T2 transaction delta spec. The original exact
  ten-file round-3 check and the complete post-strategy changed-file check both pass.

Post-strategy verification: Draft + engine Bun suites PASS with 27 tests, 190
expectations, and zero failures; Draft conformance remains 20 passed, zero failed, and
one deliberate zero-assertion skip. The transaction boundary scans 29 modules clean;
every negative control remains sensitive. TypeScript 5.9.3 remains at exactly three
pinned diagnostics. Strict Rasen validation passes with zero issues; strict UTF-8/no
BOM, Prettier, and diff checks pass for the owned source and artifacts.

## Post-cap strategy attempt 2 repair evidence

Strategy 2 replaces both mechanisms left incomplete by Strategy 1:

- The native engine no longer owns a discoverable/configurable Symbol. Its exact
  committed-state closure is registered only in module-private `WeakMap` state and
  yields detached captures through an explicit port. A public wrapper is a distinct
  object and must inject that port (or a provider implementation) deliberately.
  Missing capability fails at open; a capture that throws or no longer matches fails
  again at approval before retention, compensation preflight, or durable parent apply.
  No committed-base path reconstructs an empty ledger.
- A plain method-for-method wrapper with a supplied capture preserved one pre-existing
  keyed entry plus the Draft forward entry. The same deterministic policy observed
  identical revision/key/fingerprint/result metadata during compensation preflight and
  actual undo; the undo succeeded and restored the prior value. The same wrapper
  without the port returned `committed-state-unavailable`, and a port forced offline
  after staging left revision/content unchanged.
- Graph equality now registers both object directions before `Object.is`. Alias repair
  uses one document-wide traversal and expands only entities participating in an alias
  conflict. T1 evaluation and T2 approval clone each operation array as one graph and
  avoid per-entity re-cloning, so references shared across operation patches survive
  the atomic batch. Two tracks, clips, assets, and markers were exercised together in
  both distinct-to-shared and shared-to-distinct directions; the direct oracle counted
  reference identities after forward apply and undo. A separate non-circular oracle
  proved a shared cycle nested through `Map` and `Set` survives an unrelated edit and
  undo.
- Scope expansion remains bounded: the cross-collection topology case emitted exactly
  ten necessary inverse operations (six updateable entities plus two asset delete/create
  pairs), while the existing 8,000-marker ordinary field edit still emitted exactly one
  `update-marker` inverse.

Final Strategy-2 verification:

| Check                                     | Result                                                                                                                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused/adversarial Draft + engine suites | PASS — 32 tests, 240 expectations, 0 failed; generic Draft conformance remains 20 passed / 0 failed / 1 deliberate skip.                                                                                                          |
| Wrapper/capability/ledger probes          | PASS — no public-engine Symbol; missing/open and failed/approval paths fail closed; supplied wrapper capture sees identical prior + forward metadata during preflight and undo.                                                   |
| Alias topology probes                     | PASS — identity-shortcut negative control, two entities in each of four collections in both shared/distinct directions, cyclic Map/Set aliases, and published undo all pass direct identity assertions.                           |
| Minimal/bounded compensation              | PASS — 8,000-marker local edit returns one inverse; the eight-entity cross-collection repair returns the exact bounded ten-operation plan.                                                                                        |
| Transaction boundary + negative control   | PASS — 29 modules scanned; both rules clean and every forbidden/converse control remains sensitive.                                                                                                                               |
| Type baseline                             | PASS — TypeScript 5.9.3, exactly 3 current diagnostics, none outside the pinned set.                                                                                                                                              |
| Strict Rasen validation                   | PASS — 1 change, 0 failed, 0 issues.                                                                                                                                                                                              |
| Exact-file Prettier and diff              | PASS — all 14 owned source/artifact files formatted; owned `git diff --check` clean.                                                                                                                                              |
| UTF-8/text integrity                      | PASS — all 14 owned files strictly decode as UTF-8 without BOM, U+FFFD/mojibake, NUL, or stray CR.                                                                                                                                |
| Scope                                     | PASS — only T2 Draft source/tests/artifacts and the necessary T1-internal clone/evaluator/engine/projection files; no public T0/T1 barrel/types, commands, ports, sessions, Hosts, Rust, siblings, run-state, or reviewer report. |

The final commit/tree identities are returned in the fixer handoff because a commit
cannot self-record its own content hash without changing that hash.

## Post-cap strategy attempt 3 repair evidence

Strategy 3 closes the two remaining Strategy-2 Major mechanisms without widening the
public T0/T1 barrel or weakening wrapper fail-closed behavior:

- Native capture registration is now owned by `engine.ts`, the same module that
  constructs the native engine. Its `WeakMap` and duplicate-rejecting one-time setter
  are private closures. The construction module exports only `openTransactionEngine`
  and a read-only native binder; `projection.ts` exports only the pure commit
  projection. A compile-only module-key assertion and runtime namespace assertions
  fail if either internal module gains any unreviewed value export, independent of a
  writer's eventual name.
- Native Draft creation prefers the construction-owned capture over a supplied port.
  An adversarial port with the correct revision/content but an empty prior ledger was
  never called; compensation preflight and actual undo observed identical native
  revision/key sets, the published undo succeeded, and the prior marker value was
  restored. The frozen native port rejected method replacement. A wrapper remained a
  distinct unbound object, required its explicit port, and retained the manager's
  once-bound capture even after the caller replaced the original port property.
- Graph equality and repair-owner inspection no longer terminate on a first-seen
  identical object. Both record the pair and traverse its descendants; only an
  already-recorded matching pair terminates a cycle. The traversal covers plain
  objects/arrays, Map keys and values, Set members, Date/RegExp custom data, typed-array
  backing buffers, and native-container own data. Nested distinct-to-shared collapse is
  rejected in both comparison directions for every adversarial container.
- A direct repair-path regression shares an identical outer container between the two
  documents, hides a later alias collapse beneath it, and proves both affected markers
  receive compensation. Applying that plan restores two structurally equal but
  referentially distinct values using direct `toBe`/`not.toBe` identity assertions,
  never the production comparator or a circular JSON oracle. Separate isomorphic and
  split-cycle controls prove the recorded-pair termination behavior.

Final Strategy-3 verification:

| Check                                     | Result                                                                                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused/adversarial Draft + engine suites | PASS — 35 tests, 276 expectations, 0 failed; generic Draft conformance remains 20 passed / 0 failed / 1 deliberate skip.                                                                                                        |
| Compile/runtime capture boundary          | PASS — no exported registry writer or unreviewed runtime export; forged native port called 0 times; frozen binder rejects replacement; wrapper stays unbound and its explicit manager port is bound once.                       |
| Native/wrapper ledger equivalence         | PASS — deterministic policies observed equivalent prior + forward state during preflight and real undo; both published undo paths restored the exact prior value.                                                               |
| Graph equality and repair                 | PASS — identical plain/array/Map/Set/Date/RegExp/typed-array containers traverse descendants; both directions reject alias collapse; cycles terminate; direct repair oracle restores distinct identities.                       |
| Prior T2 guarantees                       | PASS — cross-collection shared/distinct repair, cyclic Map/Set topology, one-operation 8,000-marker inverse, wrapper loss/mismatch failure, TOCTOU gate, conformance, engine tests, and exact undo remain green.                |
| Transaction boundary + negative control   | PASS — 30 modules scanned; both rules clean and every forbidden/converse control remains sensitive.                                                                                                                             |
| Type baseline                             | PASS — TypeScript 5.9.3, exactly 3 current diagnostics, none outside the pinned set; compile-only capture-boundary assertions are included.                                                                                     |
| Strict Rasen validation                   | PASS — 1 change, 0 failed, 0 issues.                                                                                                                                                                                            |
| Scope                                     | PASS — only T2 Draft source/tests/artifacts and necessary T1-internal construction/projection code; no commands, ports, sessions, Hosts, Rust, siblings, run-state, or reviewer-owned `review-cycle-report.md` is in the delta. |

No implementer-known Blocker, Major, Minor, or Trivial remains after these checks. The
two repaired findings still require fresh non-author confirmation before the review
cycle can be declared clean.
