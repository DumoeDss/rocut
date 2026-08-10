# Pre-Landing Review: `s0304-transaction-engine`

- Mode: dispatched, report-only, independent Codex reviewer
- Reviewed commit: `748bc5f086ae80397e35d2b0b2b32df1031a7995`
- Dependency base: `333a239c391ed23d005c16447e1617c1f36b175d`
- Tested tree: `53c797fdd4e4ef85f004f2d5dd8a960b0d8b57a2`
- Exact diff: 17 added files, 3,101 insertions; product source is additive-only under `apps/web/src/editor/contracts/engine/**`
- Verdict: **FAIL — 4 Blocker, 3 Major, 0 Minor, 0 Trivial**

## Scope check

**REQUIREMENTS MISSING.** The delivered files stay inside the declared T1 product and planning touch sets, and no T2/T3/Surface/Host/Rust wiring was added. The durable engine shape is present, but the findings below falsify required idempotency, reopen, placement, feature-discovery, conformance, and verification-evidence behavior.

## Standards axis

- 4 Blocker: F1, F2, F3, F4
- 3 Major: F5, F6, F7
- Worst issue: F1/F2 can silently accept a successful durable commit whose retry or reopen semantics are wrong.

## Spec axis

- 4 Blocker: F1, F2, F3, F4
- 3 Major: F5, F6, F7
- Worst issue: explicit T1 guarantees that keyed operations remain distinct, committed documents reopen, and base placement cannot be bypassed are not met.

## Findings

### F1 — Blocker — Canonical fingerprints merge semantically different operations

**Evidence:** `apps/web/src/editor/contracts/engine/clone.ts:20-24` retains an `undefined` object property in the canonical intermediate, but `JSON.stringify` at `clone.ts:31-34` omits it. `evaluator.ts:533-548` therefore treats `{ patch: {} }` and `{ patch: { assetId: undefined } }` as the same keyed operation and returns the original result before re-evaluation. This is not the permitted object-key-order equivalence from `specs/transaction-automation-api/spec.md:51-54`: the latter patch clears an optional asset while the former does not.

**Independent reproduction:** a valid graphic clip was updated first with an empty patch and then replayed under the same key with `assetId: undefined`. The probe printed `fingerprintEqual: true`, returned revision `2` again, and left `assetStillAttached: true` instead of rejecting the changed operation as `duplicate`.

**Required fix:** use an unambiguous canonical encoding that tags `undefined` (and rejects or tags every other non-JSON value) before fingerprint comparison. Add keyed replay/collision tests for optional-field clearing, not only object-property insertion order. Classification: ASK/non-trivial.

### F2 — Blocker — Apply can durably write records that the same engine rejects on reopen

**Evidence:** runtime acceptance and decode validation disagree. Examples include `validTrack` accepting an empty string name (`evaluator.ts:46-53`) while `assertTrack` requires a non-empty name (`adapter.ts:68-75`), and apply accepting any string idempotency key (`evaluator.ts:533-538`) while persisted entries require a non-empty key (`adapter.ts:128-143`). `engine.ts:186-219` appends the entry and saves without validating the complete candidate through the same seam used on open.

**Independent reproduction:** both (a) `idempotencyKey: ""` with a valid create-track batch and (b) a valid typed `Track` whose `name` is `""` committed successfully; reopening each saved record failed with `ProjectStoreError:corrupt:load-project`. Similar mismatches exist for asset names/dimensions and marker optional fields.

This is durable self-corruption and violates the one-record revision/idempotency continuity and structured validation requirements (`spec.md:3-21`, `23-54`, `56-81`).

**Required fix:** define one shared runtime document/entity validator and use it for decoded state and the complete candidate before encode/save. Align the accepted idempotency-key domain explicitly with the frozen `string` contract. Add a table-driven test proving every accepted create/update/key value survives save and reopen. Classification: ASK/non-trivial.

### F3 — Blocker — A null project disables the entire non-replaceable base placement policy

**Evidence:** the public native seed defaults `project` to `null` (`native-adapter.ts:63-81`), and `evaluateBasePlacementPolicy` immediately returns no issues for a null project (`placement.ts:57-64`). The same engine nevertheless always advertises `"placement-policy": true` (`engine.ts:124-135`). This skips not only frame alignment but also positive duration, relation/lane checks, source bounds, and collision checks, contrary to the requirement that the base policy is always enforced (`spec.md:83-117`).

**Independent reproduction:** an engine opened from the default projectless shape committed a clip with `startTime=1` and `duration=0`; the probe reported revision `1` and one persisted clip.

The combined conformance test hides this path by deliberately choosing `project: null` for its T0 profile (`engine.test.ts:123-126`), which disables T1 placement while still reporting the T0 portion green.

**Required fix:** never use null project as a blanket placement bypass. Enforce project-independent rules unconditionally and either reject time-bearing placement without a validated frame rate or require a project for durable engine mutation. Make the T0-composition fixture exercise the real engine invariant rather than a policy-disabled profile. Classification: ASK/non-trivial.

### F4 — Blocker — Provider placement code can mutate the post-validation candidate and waive base rules

**Evidence:** `evaluator.ts:603-612` runs the base policy, then passes the same mutable candidate document to each provider policy. The candidate is returned for commit unchanged at `evaluator.ts:622-633`. `readonly` in `types.ts:101-113` is compile-time only; the object is neither frozen nor isolated. A provider can therefore change a base-valid clip after the base check and return no issue.

**Independent reproduction:** a provider policy changed a validated clip duration from `4000` to `0` and returned `[]`; apply committed successfully and a subsequent read printed `providerMutatedDuration: 0`.

This directly violates “provider policies MAY add rejections but MUST NOT waive a base rule” (`spec.md:83-85`, `113-117`) and persists base-invalid data.

**Required fix:** give providers a deeply frozen or disposable clone and commit only the untouched evaluator candidate, or rerun the base policy after provider execution against a protected candidate. Add a hostile/mutating provider negative conformance target. Classification: ASK/non-trivial.

### F5 — Major — Optional provider features can overwrite base capability truth

**Evidence:** `engine.ts:124-135` spreads `optionalFeatures` after the base feature values. Neither `OpenTransactionEngineOptions` (`engine.ts:29-38`) nor `TransactionEngineCapabilities` (`types.ts:17-34`) excludes reserved base names. Passing `{ "cross-engine-cas": true }` therefore changes the required honest `false` to `true`.

**Independent reproduction:** opening the current engine with that optional feature returned `capabilities()["cross-engine-cas"] === true` even though `ProjectStore` has no CAS token.

This violates `spec.md:119-138` and can cause callers to choose unsafe independent-engine concurrency.

**Required fix:** reject base-key collisions at runtime, exclude base names from the optional-feature type, and merge immutable base values last. Add a reserved-key collision test to the real engine target. Classification: ASK/non-trivial.

### F6 — Major — T1 conformance cannot detect vacuous passing cases

**Evidence:** `engine/conformance/index.ts:52-66` marks every callback that returns without throwing as passed; it has no assertion counter or `SkipCase` path. The only observed skip comes from inherited T0 conformance, and `engine.test.ts:234-238` explicitly assumes that is sufficient. A T1 case whose assertions are accidentally removed will silently pass, contrary to `spec.md:140-147` (“a case that executes no assertion MUST be skipped rather than passed”).

**Required fix:** reuse T0's assertion-accounting/skip mechanism or add equivalent per-case assertion tracking, then add a deliberate zero-assertion T1 case proving it is reported as skipped. Classification: ASK/non-trivial.

### F7 — Major — The documented placeholder environment does not reach `next start`, and the Host/parity evidence is not bound to the reviewed tree

**Evidence:** `apps/vite-example/README.md:128-145` prefixes placeholder assignments directly to `bun run build && bun run start`. Under POSIX shell semantics those assignments apply only to `bun run build`; they are absent from the second command. A read-only shell probe confirmed this (`T1_SCOPE=visible command1; command2` printed `second=absent`). The implementation report itself states that `next start` without those values returned an Internal Server Error (`implementation-report.md:32-40`), so the documented command reproduces the failure rather than the claimed passing rerun.

The local ignored artifacts do show one expected/zero unexpected tests for both Hosts and the official snapshot comparator currently reports `0 semantic, 9 incidental` across 195 leaves. However, `.next` was last written at 19:03, the Next parity result at 19:22, and the reviewed engine files at 19:25; no Host/parity tree fingerprint is recorded. Those artifacts therefore do not prove tasks 5.4/5.5 against tree `53c797f...`.

**Required fix:** document an environment scope that covers both processes (for example, export in a subshell), rerun both Host builds/parity after the final source edit, and record the exact tested Git tree with the result. Classification: ASK because it changes the acceptance procedure/evidence.

## Test coverage audit

```text
CODE PATH COVERAGE
==================
[+] open/decode/corruption
    ├── [★★★ TESTED] valid native open + invalid persisted revision sanitization
    └── [GAP]         accepted candidate values are not round-trip checked (F2)

[+] ordered durable apply
    ├── [★★★ TESTED] one save, delayed ordering, middle rejection, save failure, queue recovery
    └── [★★★ TESTED] watcher publication follows successful save

[+] idempotency
    ├── [★★★ TESTED] reopen replay, changed-operation collision, property-order equivalence
    └── [GAP]         semantically meaningful undefined/absent distinction (F1)

[+] validation / dry-run
    └── [★★★ TESTED] purity, multiple issues, stale revision, unreserved key, queued base

[+] placement
    ├── [★★★ TESTED] duration, alignment, collision, lane, bounds, relation, adjacency
    ├── [GAP]         projectless engine bypasses every rule (F3)
    └── [GAP]         provider mutates candidate after base validation (F4)

[+] feature discovery
    ├── [★★  TESTED] declared base values and one provider-* happy path
    └── [GAP]         reserved optional key overwrites a base guarantee (F5)

[+] reusable conformance
    ├── [★★★ TESTED] four named negative targets fail
    └── [GAP]         zero-assertion T1 case is reported as passed (F6)

USER FLOW COVERAGE
==================
[+] Existing UI command/parity flow
    └── [EVIDENCE GAP] engine is intentionally unwired; prior snapshots pass, but are not tied to the final tree (F7)
```

## Capability-spec falsification sweep

All 16 current `rasen/specs/*/spec.md` files were inspected by requirement and SHALL/MUST clause.

| Capability | Result against this exact diff |
|---|---|
| `transaction-automation-api` | **Falsified** by F1-F6 against the T1 delta and frozen T0 semantics |
| `developer-reproducibility` | Product source unaffected; the acceptance command relied on by T1 is not reproducible as written (F7) |
| `editing-parity-fixture` | No runtime path changed; passing ignored artifacts exist, but final-tree evidence is unproven (F7) |
| `browser-persistence-boundary` | No falsifying source change found |
| `editor-session-runtime` | No falsifying source change found |
| `headless-editing` | No falsifying source change found |
| `host-port-contract` | No port widening or mechanism leak; boundary checks pass |
| `host-service-boundary` | No falsifying source change found |
| `inherited-defect-repair` | No falsifying source change found |
| `next-free-distributable-boundary` | No runtime import/wiring change; F7 is evidence-only |
| `runtime-asset-delivery` | No falsifying source change found |
| `self-built-wasm-artifact` | No Rust/generated-WASM/source-resolution change |
| `session-resource-disposal` | No falsifying source change found |
| `session-state-isolation` | No session/store ownership change |
| `upstream-provenance` | No pin, patch-log, inventory, or baseline-fixture edit |
| `wasm-api-surface` | No Rust/generated-WASM/API edit |

## Verification evidence

| Command / probe | Result |
|---|---|
| `bun test apps/web/src/editor/contracts/engine/__tests__/engine.test.ts` | PASS — 7 tests, 32 expectations, 0 failed |
| `node script/check-transaction-boundary.mjs` | PASS — 17 contract modules scanned |
| `node script/check-transaction-boundary.mjs --negative-control` | PASS — every forbidden rule and converse control exercised |
| `node script/check-type-baseline.mjs` | PASS — 3 current diagnostics, no new diagnostic outside the pin |
| `rasen validate s0304-transaction-engine --strict --project rocut --json` | PASS — 1 change, 0 issues |
| `git diff --check 333a239c... 748bc5f...` | PASS |
| Official parity snapshot comparator, read-only/no output file | PASS on existing artifacts — 0 semantic, 9 incidental, 195 leaves |
| Bun stdin adversarial probes | Reproduced F1-F5 as described above |
| POSIX environment-scope probe | Reproduced F7: assignment prefix absent from second command |

The focused checks ran with `HEAD^{tree}` equal to the reviewed commit tree: `53c797fdd4e4ef85f004f2d5dd8a960b0d8b57a2`. The working tree had no tracked delta from the reviewed commit before this report was written; unrelated pre-existing untracked Rasen artifacts were preserved.

## Accepted-known candidates

None. All seven findings are Blocker/Major and require a fix plus independent re-review before ship. Explicit zero counts: **Minor 0, Trivial 0**.

## Durable findings

- The engine's correctness depends on one shared accepted-value invariant across evaluate, persist, and reopen; duplicated validators already diverged on valid strings and dimensions.
- Optional policy/feature hooks must be unable to mutate or overwrite base guarantees at runtime; TypeScript `readonly` alone does not enforce that boundary.
- The Next parity placeholders are valid values, but the documented shell scoping must cover both `build` and `start`, and acceptance evidence needs the exact Git tree fingerprint.
