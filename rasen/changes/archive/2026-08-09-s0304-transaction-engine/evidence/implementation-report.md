# T1 transaction-engine implementation and review-fix evidence

Date: 2026-08-09
Branch: `feat/s0304-transaction-engine`

## Bound source state

- Initial implementation commit: `748bc5f086ae80397e35d2b0b2b32df1031a7995`
- Review-fix commit: `74ba49bc40ee94d7dfb22fe3e588e612f5a4da44`
- Tested source tree: `e6aac72507dbaea8a6d4db7444026ba8e09e4b9b`
- Repair delta: `748bc5f086ae80397e35d2b0b2b32df1031a7995..74ba49bc40ee94d7dfb22fe3e588e612f5a4da44`
- Repair delta size: 12 files, 1,074 insertions, 315 deletions.
- The independent round-1 report remains unchanged at `evidence/review-report.md`.

The checks below ran with `HEAD` at the review-fix commit and `HEAD^{tree}` at
the tested source tree above. The later evidence-only commit is not part of the
tested product tree.

## Round-1 finding-to-fix mapping

| Finding | Repair in `74ba49bc...` | Focused proof on `e6aac725...` |
| --- | --- | --- |
| F1 — canonical fingerprints merged omitted and explicit `undefined` | `clone.ts` now uses a type-tagged canonical encoding, preserves `undefined`, sorts object keys, distinguishes `-0`, and rejects unsupported values, sparse arrays, accessors, symbols, cycles, and non-finite numbers. | `canonical replay distinguishes an omitted patch from explicit clearing` proves unequal fingerprints and a same-key `duplicate` collision; cycle and `NaN` controls reject. |
| F2 — accepted writes could fail on reopen | New shared `invariant.ts` validates documents for both evaluator candidates and decoded state. The adapter also decodes and validates the encoded replacement before save; empty idempotency keys and non-reopenable entity values reject before persistence. | `accepted entity, update, and keyed values survive every reopen` and `non-reopenable entity and idempotency values are rejected before save` cover the positive round-trip and zero-save rejection paths. |
| F3 — null project bypassed the base placement policy | `placement.ts` no longer returns early for a null project. Positive duration, relation, lane, source-bound, and collision checks remain unconditional; time-bearing clips/markers without a validated frame rate receive `timebase-misaligned`. | `projectless documents enforce base placement and require a frame rate` rejects a zero-duration projectless clip and persists no clip. |
| F4 — provider policy could mutate the commit candidate | `evaluator.ts` passes each provider a deeply cloned and deeply frozen disposable placement context, clones provider issues, and commits only the untouched evaluator candidate. | T1 conformance case `provider policy receives a frozen disposable candidate` proves the provider sees frozen state and its mutation cannot change the committed duration. |
| F5 — optional features could overwrite base capability truth | `types.ts` excludes every reserved base name from optional features; `engine.ts` rejects collisions at runtime and spreads immutable base values after provider features. | T1 conformance case `reserved base capability names are rejected`; capability case still proves literal provider features and `cross-engine-cas: false`. |
| F6 — zero-assertion T1 cases passed vacuously | T1 conformance now counts assertions per case and records a zero-assertion case as skipped. | Combined conformance: **34 total / 32 passed / 0 failed / 2 skipped**. The skips are T0's intentional `SkipCase` and T1's deliberate zero-assertion control. |
| F7 — placeholder environment did not cover `next start`, and Host/parity evidence was stale | `apps/vite-example/README.md` now exports all placeholders inside one subshell that runs both build and `exec bun run start`. The final-tree Host/parity rerun below uses the same values for build and start. | Both production builds pass; Next returns HTTP 200 on port 3100; both parity runs pass; comparator reports 0 semantic / 9 incidental across 195 leaves. |

## Focused engine, conformance, and boundary gates

| Command | Result |
| --- | --- |
| `bun test apps/web/src/editor/contracts/engine/__tests__/engine.test.ts` | PASS — 11 tests, 57 expectations, 0 failed. |
| Embedded T0 + T1 conformance report | PASS — **34 total / 32 passed / 0 failed / 2 skipped**; T0 intentional skip + T1 zero-assertion control. |
| `node script/check-transaction-boundary.mjs` | PASS — 18 contract modules scanned; no forbidden editor-internal import or storage mechanism literal. |
| `node script/check-transaction-boundary.mjs --negative-control` | PASS — every forbidden rule was caught and every converse control remained uncaught. |
| `node script/check-type-baseline.mjs` | PASS — 3 current diagnostics, all within the pinned baseline set; the fixture was not regenerated. |
| Strict UTF-8/BOM/mojibake scan of both updated evidence files | PASS — strict UTF-8, no BOM, no replacement/mojibake markers, and no trailing whitespace. |
| `git diff --check` | PASS. |
| `rasen validate s0304-transaction-engine --strict --project rocut --json` | PASS — 1 item passed, 0 failed, 0 issues. |

## Final-tree Host build and parity evidence (F7)

The following placeholder environment was process-scoped for both the Next
production build and the subsequently started production server:

```powershell
$env:DATABASE_URL='postgresql://opencut:opencut@localhost:5432/opencut'
$env:BETTER_AUTH_SECRET='supersecret'
$env:NEXT_PUBLIC_SITE_URL='http://localhost:3100'
$env:UPSTASH_REDIS_REST_URL='https://your-upstash-redis-url'
$env:UPSTASH_REDIS_REST_TOKEN='your-upstash-redis-token'
$env:NEXT_PUBLIC_MARBLE_API_URL='https://placeholder.example.com'
$env:MARBLE_WORKSPACE_KEY='placeholder'
$env:FREESOUND_CLIENT_ID='placeholder'
$env:FREESOUND_API_KEY='placeholder'
```

| Working directory | Command | Result |
| --- | --- | --- |
| `apps/vite-example` | `bun run build` | PASS — production Vite build completed in 36.58 s; only existing chunk-size/dynamic-import warnings. |
| `apps/web` | `bun run build` | PASS — Next 16.1.3 production build compiled and generated all 19 static pages; only workspace-root and placeholder-secret-strength warnings. |
| `apps/web` | `bun run start -- -p 3100` | PASS — port 3100 was free before launch; `http://127.0.0.1:3100/` returned HTTP 200. |
| `apps/vite-example` | `bun run test:parity` | PASS — 1 scenario passed in 46.6 s (scenario 41.1 s). |
| `apps/vite-example` | `$env:PARITY_HOST='next'; $env:PARITY_BASE_URL='http://127.0.0.1:3100'; bun run test:parity` | PASS — 1 scenario passed in 44.0 s (scenario 41.6 s). |
| repository root | `node script/diff-parity-snapshots.mjs apps/vite-example/tests/parity-artifacts/vite/snapshot-vite.json apps/vite-example/tests/parity-artifacts/next/snapshot-next.json` | PASS — **0 semantic, 9 incidental, 195 leaf values**; no output-file argument was supplied. |

Both ledgers record assertions for all ten interactions. The Next listener was
the newly launched `next start -p 3100` process on PID 55416. It was stopped
after the comparator, PID 55416 no longer existed, and port 3100 was released.
The unrelated VS Code listener on port 3000 remained PID 32524 throughout.

## Scope and review status

- The repair commit changes the engine implementation/tests and the documented
  Host procedure; it adds no runtime caller and does not wire the engine into
  either Host.
- The F7 rerun changed only ignored/generated parity and build artifacts; no
  product source or parity oracle was edited.
- All seven round-1 findings now have a repair and exact-tree gate evidence.
  **Independent reviewer confirmation is pending. This fixer does not certify
  the cycle CLEAN and does not mark any finding independently resolved.**
