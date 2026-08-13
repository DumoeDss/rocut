# Review Cycle: `s0304-transaction-engine`

Rounds: 2/3

Tier: A — fresh, role-isolated Codex round-2 reviewer. The reviewer did not
author `cfa4e04932a40da86167cc29e2b9c7439d94ea44` or either earlier fix.

Status: **CLEAN — F6 AND M1 RESOLVED (0 Blocker / 0 Major / 0 Minor / 0 Trivial)**

## Round 1 source and exact re-review scope (historical)

- Initial implementation: `748bc5f086ae80397e35d2b0b2b32df1031a7995`
- Round-1 source fix: `74ba49bc40ee94d7dfb22fe3e588e612f5a4da44`
- Evidence commit: `25fb9266825d53c2214e03c8832d699c39adf6fe`
- Exact delta read: `748bc5f086ae80397e35d2b0b2b32df1031a7995..25fb9266825d53c2214e03c8832d699c39adf6fe`
- Re-reviewed HEAD: `25fb9266825d53c2214e03c8832d699c39adf6fe`
- Independently tested content tree: `84ef1d3fc5b8c20cbdb8a48e44cbecc5d2bd92d7`
- Tracked state before this report edit: clean. Pre-existing untracked Rasen
  runtime/planning directories were preserved.

The reviewer read every changed hunk in the 15-file delta, including the engine
implementation, conformance runner, tests, README, and evidence-only commit.
Fixer claims in the prior version of this report were treated only as a list of
claims to falsify, never as proof.

## Round 1 disposition

| Finding | Severity | Independent evidence | Confirmed by (non-author) | Disposition |
| --- | --- | --- | --- | --- |
| F1 — canonical fingerprints merged missing and explicit `undefined` | Blocker | Type-tagged canonical encoding was diff-read. An independent stdin probe proved nested missing versus explicit `undefined` differ, reordered object keys remain equal, and same-key changed operations reject. | Independent Codex reviewer | **Resolved** |
| F2 — accepted values could persist a record that failed reopen | Blocker | Shared invariant is used by evaluation, candidate validation, decode, and pre-save reopen validation. Independent probes reopened accepted track/marker/key values and proved empty key/name reject before save while the store remains reopenable. | Independent Codex reviewer | **Resolved** |
| F3 — null project bypassed all base placement rules | Blocker | The null-project early return is gone. An independent projectless probe rejected `startTime=1`, `duration=0` with both `non-positive-duration` and `timebase-misaligned`, and persisted no clip. | Independent Codex reviewer | **Resolved** |
| F4 — provider policy could mutate the committed candidate | Blocker | Providers receive a cloned, deeply frozen disposable context. A hostile provider observed frozen state, `Reflect.set` returned false, and the committed duration remained 4000. | Independent Codex reviewer | **Resolved** |
| F5 — optional features could overwrite `cross-engine-cas: false` | Major | Reserved keys are excluded by the public type, rejected at runtime, and base features merge last. Independent runtime probes observed `cross-engine-cas=false` and a `TypeError` for a reserved collision. | Independent Codex reviewer | **Resolved** |
| F6 — conformance could report zero-assertion cases as passed | Major | A single run reports the intended 32 passed / 0 failed / 2 skipped, but the counter is module-global (`conformance/index.ts:63-92`). Two concurrent runner invocations deterministically produced 32/0/2 for run 1 and **33/0/1 for run 2**, where `T1: zero-assertion control is skipped` was incorrectly `passed`. The same delta also narrowed `runTransactionEngineConformance` to `TransactionEngineConformanceFactory<"provider-ripple-edit">`; an in-memory TypeScript consumer probe with `TransactionEngineConformanceFactory<"provider-custom-feature">` failed with TS2345. This violates the reusable, implementation-agnostic conformance requirement. | Independent Codex reviewer | **REOPENED — Major** |
| F7 — README environment scope and final-tree Host/parity evidence | Major | README now exports all nine placeholders in one subshell and runs `build` plus `exec ... start` inside it. On tree `84ef1d3f...`, both production builds passed; Next returned HTTP 200; Next and Vite parity each passed; the exact Next PID and port 3100 were released; the comparator reported 0 semantic / 9 incidental over 195 leaves with all ten interactions asserted on both Hosts. | Independent Codex reviewer | **Resolved** |

Initial counts: **4 Blocker / 3 Major / 0 Minor / 0 Trivial**.

After independent re-review: **0 Blocker / 1 Major / 0 Minor / 0 Trivial**.

## Round 1 open finding and required repair (historical; resolved in round 2)

### F6 — Major — assertion accounting is not run-local and the runner is no longer generic

Move assertion accounting into each `Cases` instance (or pass a per-case
assertion context) so concurrent `runTransactionEngineConformance` calls cannot
overwrite one another. Restore the generic runner signature so arbitrary literal
provider feature factories remain accepted. Add two negative controls:

1. run two complete conformance matrices concurrently and require the deliberate
   T0 and T1 zero-assertion cases to be skipped in both reports; and
2. compile a consumer using a literal feature other than
   `provider-ripple-edit`.

This was non-trivial source/test work and required a Codex fixer followed by a
different non-author reviewer. At the end of round 1, shipping remained blocked.

## Round 1 independent command evidence (historical)

| Scope | Exact command / probe | Result on `84ef1d3f...` |
| --- | --- | --- |
| Focused engine suite | `bun test apps/web/src/editor/contracts/engine/__tests__/engine.test.ts` | PASS — 11 tests, 57 expectations, 0 failed. |
| F1–F6 sequential adversarial probe | PowerShell UTF-8 here-string piped to `bun -`; imported the public engine/conformance entry points and exercised nested fingerprints, save/reopen, projectless placement, hostile provider mutation, reserved capability collision, and skip names | PASS — sequential conformance 32 passed / 0 failed / 2 skipped. |
| F6 concurrency negative control | Two `runTransactionEngineConformance(factory)` calls under `Promise.all` in a `bun -` stdin probe | **FAIL as expected** — second report 33 passed / 0 failed / 1 skipped; its T1 zero-assertion case was `passed`. |
| F6 generic consumer negative control | TypeScript compiler API, in-memory source importing the public runner and passing `TransactionEngineConformanceFactory<"provider-custom-feature">` | **FAIL as expected** — TS2345 against the hard-coded `provider-ripple-edit` parameter. |
| Contract boundary | `node script/check-transaction-boundary.mjs` | PASS — 18 modules, no violation. |
| Boundary sensitivity | `node script/check-transaction-boundary.mjs --negative-control` | PASS — all forbidden and converse controls behaved as expected. |
| Type baseline | `node script/check-type-baseline.mjs` | PASS — 3 current diagnostics, none outside the pin. |
| Strict Rasen validation | `rasen validate s0304-transaction-engine --strict --project rocut --json` | PASS — 1 item, 0 issues. |
| Whitespace | `git diff --check 748bc5f086ae80397e35d2b0b2b32df1031a7995..25fb9266825d53c2214e03c8832d699c39adf6fe` | PASS. |
| Vite production build | `bun run build` in `apps/vite-example` | PASS — 2,893 modules; existing warnings only. |
| Next production build | `bun run build` in `apps/web` with all nine placeholder variables in the process environment | PASS — 19 pages generated. |
| Next production start | `node <resolved next/dist/bin/next> start -p 3100` from a bounded `bun -` orchestrator with the same placeholders | PASS — HTTP 200; PID 58116 terminated and port 3100 released. |
| Next parity | `PARITY_HOST=next PARITY_BASE_URL=http://127.0.0.1:3100 bun run test:parity` | PASS — 1 scenario, 43.3 s. |
| Vite parity | `bun run test:parity` | PASS — 1 scenario, 45.6 s. |
| Snapshot comparator | `node script/diff-parity-snapshots.mjs apps/vite-example/tests/parity-artifacts/vite/snapshot-vite.json apps/vite-example/tests/parity-artifacts/next/snapshot-next.json` | PASS — 0 semantic, 9 incidental, 195 leaves; all ten interactions asserted on both Hosts. |
| Final identity/state | `git rev-parse HEAD^{tree}` plus `git diff --quiet` | `84ef1d3fc5b8c20cbdb8a48e44cbecc5d2bd92d7`; tracked clean before this report edit. |

## Round 1 non-author confirmation (historical)

The re-reviewer is a Codex reviewer distinct from the authors of `74ba49bc...`
and `25fb9266...`. No fixer self-certification was accepted. F1–F5 and F7 are
independently confirmed; at that point, F6 was independently falsified and
remained open.

## Round 2 source and exact re-review scope

- Round-1 evidence/base commit: `25fb9266825d53c2214e03c8832d699c39adf6fe`
- Round-2 fix commit and reviewed HEAD: `cfa4e04932a40da86167cc29e2b9c7439d94ea44`
- Exact source/test delta read: `25fb9266825d53c2214e03c8832d699c39adf6fe..cfa4e04932a40da86167cc29e2b9c7439d94ea44`
- Exact changed files: `apps/web/src/editor/contracts/engine/conformance/index.ts` and `apps/web/src/editor/contracts/engine/__tests__/engine.test.ts`
- Independently tested commit tree: `9a553eec8ef14f3e0bbd93c19b50fd134b7d2708`
- Delta size: 2 files, 163 insertions, 87 deletions
- The pre-existing modified report and all unrelated tracked/untracked work were
  preserved; no source, test, planning, run-state, commit, branch, delivery, or
  archive mutation was performed by the reviewer.

The reviewer read the complete two-file delta and both complete final files,
then traced the public factory/runner types and runtime capability path. Fixer
claims were used only as hypotheses to falsify, never as proof.

## Round 2 disposition

| Finding | Severity | Independent evidence | Confirmed by (non-author) | Disposition |
| --- | --- | --- | --- | --- |
| F6 — assertion accounting was shared across runs and the runner was narrowed to one provider feature | Major | `Cases.check` now creates one assertion counter and assertion closure per case; there is no module-global counter. Ten repeated focused invocations (20 total tracked concurrency/custom-feature tests) passed. A separate three-matrix `Promise.all` probe ran one arbitrary-feature factory with no witness, a `true` witness, and a `false` witness; every report was 32 passed / 0 failed / 2 skipped and both T0/T1 zero-assertion controls remained skipped. An in-memory TypeScript 5.9.3 consumer probe compiled arbitrary-feature one-argument and witnessed calls with zero diagnostics while `@ts-expect-error` negative controls proved undeclared and reserved feature names are rejected. | Fresh Codex round-2 reviewer | **Resolved** |
| M1 — the tracked no-witness regression assertion never invoked the runner | Minor | Initially, `engine.test.ts:366-372` only asserted that a wrapper was a `Function`. Commit `09757f5a...` now awaits that wrapper, asserts the no-witness report passes, and asserts the named base-capability case itself is `passed`; the witnessed report and exact 32/0/2 assertion remain intact. The fresh non-author reran this focused test and the complete engine file. | Fresh Codex round-2 reviewer | **Resolved** |

Final counts: **0 Blocker / 0 Major / 0 Minor / 0 Trivial**.

Review-cycle termination is **CLEAN** with no open finding. M1 was recorded when
found, fixed by the LEAD as a permitted trivial inline change, and independently
confirmed by a non-author before being closed.

## Round 2 independent command evidence

| Scope | Exact command / probe | Result on `cfa4e049...` / tree `9a553eec...` |
| --- | --- | --- |
| Focused engine/conformance suite | `bun test apps/web/src/editor/contracts/engine/__tests__/engine.test.ts` | PASS — 13 tests, 71 expectations, 0 failed. |
| Repeated concurrency/custom-feature regression | Ten PowerShell iterations of `bun test apps/web/src/editor/contracts/engine/__tests__/engine.test.ts --test-name-pattern 'isolates assertion accounting\|runs conformance with an arbitrary literal provider feature'` | PASS — 10/10 iterations; 20 tests passed, 0 failed. |
| Runtime witness and concurrent isolation probe | UTF-8 PowerShell here-string piped to `bun -` from `apps/web`; a fresh generic factory ran three matrices concurrently through the public runner: omitted witness, `{ "provider-custom-feature": true }`, and `{ "provider-custom-feature": false }` | PASS — each matrix 32 passed / 0 failed / 2 skipped; both named zero-assertion controls skipped in all three; capability case passed in all three. |
| Public generic type probe | TypeScript compiler API 5.9.3, one in-memory consumer source (no temp file) importing the public runner/factory; positive omitted/true/false calls plus `@ts-expect-error` controls for an undeclared provider key and reserved `cross-engine-cas` | PASS — 0 diagnostics; both negative controls were consumed, so neither unsafe call type-checked. |
| Type baseline | `node script/check-type-baseline.mjs` | PASS — 3 current diagnostics, none outside the pinned baseline set. |
| Contract boundary | `node script/check-transaction-boundary.mjs` | PASS — 18 modules, no violation. |
| Boundary sensitivity | `node script/check-transaction-boundary.mjs --negative-control` | PASS — every forbidden rule was caught and every converse control remained clean. |
| Exact delta whitespace | `git diff --check 25fb9266825d53c2214e03c8832d699c39adf6fe..cfa4e04932a40da86167cc29e2b9c7439d94ea44` | PASS. |
| Exact delta unsafe-cast scan | Added-line scan for `as unknown as`, `as any`, `any` annotations, `@ts-ignore`, and `@ts-nocheck` | PASS — no match. The deliberate runtime reserved-key negative control uses `Reflect.set` without weakening the exported type. |
| Strict change validation | `rasen validate s0304-transaction-engine --strict --project rocut --json` | PASS — 1 item, 0 issues. |
| Report encoding/whitespace | Strict `.NET UTF8Encoding(false, true)` decode, BOM/mojibake scan, trailing-whitespace scan, then `git diff --check` | PASS — strict UTF-8, no BOM, no suspect marker, no trailing whitespace, no diff-check error. |
| Final identity/state | `git rev-parse HEAD`, `git rev-parse HEAD^{tree}`, `git status --short --branch` | Commit `cfa4e049...`; tree `9a553eec...`; only this already-authorized evidence report is tracked-modified, and all pre-existing untracked work remains present. |

## Bounded F1–F5/F7 regression audit

The round-2 delta changes only the conformance runner and its focused test. Blob
identity was checked between `25fb9266...` and `cfa4e049...` for every prior
repair surface:

| Prior finding | Guarded file(s) | Round-2 result |
| --- | --- | --- |
| F1 canonical fingerprint | `engine/clone.ts` | Blob unchanged; focused canonical replay/collision test passed. |
| F2 reopen invariants | `engine/invariant.ts`, adapter/evaluator paths exercised by the focused suite | Guarded invariant blob unchanged; accepted/rejected reopen tests passed. |
| F3 projectless placement | `engine/placement.ts` | Blob unchanged; projectless placement test passed. |
| F4 provider mutation isolation | `engine/evaluator.ts` | Blob unchanged; frozen disposable candidate conformance remained green. |
| F5 reserved/base feature truth | `engine/types.ts`, `engine/engine.ts` | Both blobs unchanged; reserved-key runtime control, generic type controls, and true/false witness probes passed. |
| F7 Host environment procedure | `apps/vite-example/README.md` | Blob unchanged. No product runtime or Host procedure changed in round 2, so the already-recorded final-tree Host/parity evidence was not expensively rerun. |

## Round 2 non-author confirmation

The round-2 reviewer is a fresh Codex reviewer distinct from the author of
`cfa4e049...`. No fixer self-certification was accepted. F6 is independently
confirmed resolved at both runtime and type boundaries; F1–F5/F7 remain closed.

## Final trivial-delta non-author re-review

- Parent: `cfa4e04932a40da86167cc29e2b9c7439d94ea44`
- Reviewed commit/HEAD: `09757f5a5deb7805811ef25720037525a828177c`
- Independently tested content tree: `7ee951df54769f5d3e85e2c463c3817a8660be1b`
- Exact delta: `cfa4e04932a40da86167cc29e2b9c7439d94ea44..09757f5a5deb7805811ef25720037525a828177c`
- Scope: one test file, 9 insertions / 1 deletion; no production, conformance
  implementation, planning, run-state, Host, delivery, or archive change.

The exact delta was read in full. `reportWithoutFeatureWitness` is produced by
an awaited one-argument public-runner call. Its `passed` flag and the named
`T1: base and configured optional capabilities are honest` result are asserted,
so the base-capability-only path must execute and cannot pass merely because a
wrapper exists. The separate witnessed call remains executed and retains its
exact `{ passed: 32, failed: 0, skipped: 2 }` and capability-case assertions.

| Final check | Result |
| --- | --- |
| `bun test apps/web/src/editor/contracts/engine/__tests__/engine.test.ts --test-name-pattern 'runs conformance with an arbitrary literal provider feature'` | PASS — 1 focused test, 5 expectations, 0 failed; both unwitnessed and witnessed matrices executed. |
| `bun test apps/web/src/editor/contracts/engine/__tests__/engine.test.ts` | PASS — 13 tests, 72 expectations, 0 failed. |
| `git diff --check cfa4e04932a40da86167cc29e2b9c7439d94ea44..09757f5a5deb7805811ef25720037525a828177c` | PASS. |
| Exact changed-file audit | PASS — only `apps/web/src/editor/contracts/engine/__tests__/engine.test.ts`. |
| `rasen validate s0304-transaction-engine --strict --project rocut --json` | PASS — 1 item, 0 issues. |
| Final report integrity | PASS — strict UTF-8 decode, no BOM/mojibake marker/trailing whitespace, and working-tree `git diff --check` clean. |
| Final identity/state | HEAD `09757f5a5deb7805811ef25720037525a828177c`; tree `7ee951df54769f5d3e85e2c463c3817a8660be1b`; only the authorized review-cycle report is tracked-modified and all pre-existing untracked work remains present. |

The final reviewer did not author `09757f5a...`. M1 is independently closed;
F1–F7 remain closed; the final review-cycle verdict is **CLEAN**.
