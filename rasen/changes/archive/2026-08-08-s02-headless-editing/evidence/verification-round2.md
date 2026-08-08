# C7 verification report — fresh Sol round 2

Date: 2026-08-05 (Asia/Shanghai)

Accepted base: `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf` / tree
`885d307814260b77397c2c2677b9361fdfc5f5e2`

Implementation identity: uncommitted 30-file authored set,
`072b5fdf40f3d983c7407aae9d90e0bcd7a588803d07d21ff7785438cee65470`.

**VERIFY VERDICT: BLOCKED — Blocker: 1, Major: 1, Minor: 0, Trivial: 0.**

## Scorecard

| Dimension | Result |
| --- | --- |
| Functional headless API, migration, opaque/attachment fidelity, disposal | PASS |
| Vite executable emitted proof | PASS |
| Next exact-root emitted proof | FAIL — alias-only root accepted |
| Runtime resource/React truth | FAIL — each zero lacks a matching sensitivity control |
| Ordinary Vite/Next parity and C3 isolation | PASS WITH INHERITED WEBGPU ORACLE |
| Rust/WASM/API/license and protected identities | PASS |
| Full regression/type/static gates | PASS WITH EXACT INHERITED RED |
| Rasen strict validation | PASS — child 1/1, main specs 14/14 |
| Provenance | PASS for pre-commit review; source inventory remains post-commit |
| Delta scenarios | 54 PASS / 3 FAIL / 5 UNVERIFIED |

## Material failures

1. **Blocker — R1:** `headless-webpack-graph-plugin.ts` treats request/identifier aliases as the
   resolved root and hard-codes `entry.observed`. A no-resource, exact-rawRequest module with real
   chunks and complete required roots passes the producer and checker. Exact fix criteria and
   counterexample digests are in `review-round2.md`.
2. **Major — R3:** the probe test exercises only global timeout plus Host Worker/audio/object URL
   and graphics. Interval, RAF, global resource constructors, WebGPU, WASM, and React mount
   detectors lack nonzero sensitivity controls. Exact fix criteria are in `review-round2.md`.

## Gate identity

- Focused: `52/0/81`.
- Full Bun: `442 pass / 8 inherited fail / 2 inherited errors / 1,375 expectations / 450 tests /
  83 files`.
- Vite/Next final strict graphs and cross-Host runtime evaluator: PASS.
- Corrected React controls: both reject for intended React rules.
- Vite typecheck and exact pinned baseline: PASS.
- Eight static boundary checks, `git diff --check`, `bun.lock` diff: PASS.
- WASM `38/58/609`; Rust `12/12`: PASS.
- Exact base/current WebGPU: same line-88 race; current WebGL and both protected parity artifacts:
  PASS/isolation accepted.
- Protected paths/SBOM diff: zero; P-273 and BOUNDARIES section 6 present.
- Rasen: `1/1 + 14/14` strict-valid.
- Owned ports: released; unrelated inherited port 4174 preserved.

## Task truth

Tasks 12.6, 12.7, and 12.8 remain false. No product/test/tool change, commit, push, PR,
integration, main-spec sync, source-inventory regeneration, ship, or archive was performed by this
reviewer.

TEST EVIDENCE
- scope: complete C7 implementation and proof/regression/provenance surface
- rationale: independent round-2 acceptance against exact base and prior R1-R5 findings
- result: fail
- tree: `885d307814260b77397c2c2677b9361fdfc5f5e2`

