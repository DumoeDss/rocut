## 1. Engine interface and durable document seam

- [x] 1.1 Create the additive `apps/web/src/editor/contracts/engine/**` module layout and an `engine/index.ts` entry point without editing T0's frozen root `contracts/index.ts`
- [x] 1.2 Define `TransactionEngine`, discriminated validation/dry-run outcomes, stable issue codes, and typed base/optional capability records using only T0 contract and `@/editor/ports` types
- [x] 1.3 Define `TransactionDocumentAdapter` and the decoded engine-document shape containing contract entities, revision, and canonical idempotency entries; validate record/summary/project identity invariants at the seam
- [x] 1.4 Implement the transaction-native document adapter/fixture for conformance, including opaque overlay preservation and structured `ProjectStoreError { code: "corrupt", operation: "load-project" }` on invalid persisted state

## 2. Pure evaluator and placement policy

- [x] 2.1 Implement deterministic deep cloning and a canonical operation fingerprint that sorts object keys while preserving array and operation order
- [x] 2.2 Implement the pure batch reducer over a working document for all T0 create/update/delete operation kinds, with created/changed ID collection and no mutation of committed input
- [x] 2.3 Add exhaustive attributable validation for empty batches, duplicate IDs, missing relations, invalid updates/deletes, unsupported operations, and expected-revision/idempotency conflicts
- [x] 2.4 Implement the non-replaceable base placement policy: positive duration, project-frame alignment, same-track half-open collision detection, lane compatibility, and known source-duration bounds
- [x] 2.5 Compose optional provider placement policies after the base policy so they can add typed issues but cannot waive any base rejection

## 3. ProjectStore-backed transaction engine

- [x] 3.1 Implement `openTransactionEngine` to load one `ProjectRecord`, decode and validate it through the supplied adapter, and expose one object satisfying all four frozen T0 interfaces
- [x] 3.2 Implement defensively cloned `read` methods plus `revision`, `supportedOperations`, typed `capabilities`, and unsubscribe-safe `watch` behavior
- [x] 3.3 Implement the non-poisoning per-engine invocation queue and the exact idempotency-before-expected-revision evaluation order
- [x] 3.4 Implement apply's working-copy protocol: evaluate every operation, encode one candidate record/summary, await exactly one `ProjectStore.save`, then and only then publish state/revision/idempotency and notify watchers once
- [x] 3.5 Persist revision, canonical fingerprints, and original keyed results through the document adapter so reopen preserves monotonic revision, exact replay, and different-operation collision semantics
- [x] 3.6 Implement `validate` and `dryRun` on the shared evaluator, ordered after earlier queued commits, proving they never save, reserve keys, change committed reads/revision, or notify watchers
- [x] 3.7 Preserve structured error ownership: operation/placement failures become T0 `TransactionError`, store failures remain mechanism-neutral `ProjectStoreError`, and every failure path leaves the queue usable

## 4. Engine conformance and focused tests

- [x] 4.1 Add `engine/conformance/runTransactionEngineConformance(factory)` with per-case pass/fail/skip reporting and compose T0's unchanged `runTransactionConformance` against each engine target
- [x] 4.2 Add fresh-store tests for one-save atomicity, delayed concurrent invocation order, a rejected middle batch, save-failure non-publication, and queue recovery
- [x] 4.3 Add reopen tests for persisted revision, same-key canonical replay without save/watch, different-operation duplicate rejection, and independent unkeyed batches
- [x] 4.4 Add validation/dry-run tests covering multi-issue outcomes, stale expected revision, unreserved idempotency keys, queued base-revision coherence, and equality with a later real apply result
- [x] 4.5 Add placement tests for every base rule plus accepted adjacent intervals and proof that a provider policy cannot waive a base rejection
- [x] 4.6 Add adapter/feature tests for opaque sentinel retention, corrupt decode, all base capability values, literal optional feature keys, supported operations, and honest `cross-engine-cas: false`
- [x] 4.7 Add negative conformance targets proving lost opaque data, premature publication, dry-run mutation, or false capability advertising produces a named failed case rather than a vacuous pass

## 5. Verification and scope gates

- [x] 5.1 Run the focused Bun engine test/conformance suite and record the T0 and T1 case totals with zero failed executed cases
- [x] 5.2 Run `node script/check-transaction-boundary.mjs` and `node script/check-transaction-boundary.mjs --negative-control`; confirm the new engine files are scanned and every negative rule remains sensitive
- [x] 5.3 Run `node script/check-type-baseline.mjs` and confirm the diagnostic count does not exceed the pinned ceiling of 3; do not regenerate the fixture
- [x] 5.4 Build `apps/web` and `apps/vite-example` from the current T0 branch and confirm both Hosts remain green
- [x] 5.5 Run the established parity fixture on both Hosts and confirm its normalized editing snapshot is unchanged, because T1 wires no runtime caller
- [x] 5.6 Sweep all 16 current `rasen/specs/*/spec.md` capability specs (including `transaction-automation-api`; Direction's pre-T0 count was 15) for numbered SHALL/MUST assertions falsified by the diff and record the result
- [x] 5.7 Audit the product-source diff as additive-only `apps/web/src/editor/contracts/engine/**`: no T0 contract, `ports/**`, session, commands, Surface, Host root, Rust, generated WASM, type-baseline fixture, or parity-oracle edit
- [x] 5.8 Run `rasen validate s0304-transaction-engine --strict --project rocut --json` and resolve every artifact/spec error before implementation is reported complete
