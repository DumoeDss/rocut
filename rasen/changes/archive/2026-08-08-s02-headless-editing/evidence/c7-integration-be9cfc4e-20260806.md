# C7 Integration Verification: `be9cfc4e`

Date: 2026-08-06 (Asia/Shanghai)

Reviewer: fresh non-author Sol integration verifier. Product/source, specs, Git history, run-state, and generated evidence outside this report were not edited.

## Identity and verdict

- Integration worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-s02`
- `HEAD`: `be9cfc4e1ec2c4d49cf4490c61928ab5bdf86bb6`
- `HEAD^{tree}`: `c1b151191025f7bfc2fd04fb27ae15bd71177f93`
- parent: `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf`
- tracked index clean; only the pre-existing generated C6/C7 outputs and `.rasen/` are untracked.

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:0

## Integration-sensitive gates

### Headless Next controls and clean runtime

- React control command: `node script/run-c7-headless-host.mjs --host next --output apps/web/.next-c7-integration-be9cfc4e-react-control --base /c7-integration-next-react-control --marker c7-integration-be9cfc4e-next-react-control --head be9cfc4e1ec2c4d49cf4490c61928ab5bdf86bb6 --tree c1b151191025f7bfc2fd04fb27ae15bd71177f93 --entry apps/web/src/app/c7-headless/route.ts --proof-control react`
- Result: exit `0`; exact graph rejected by the intended `forbidden.react-family` rule (`19` modules, one named violation), server probe completed with `0` React mounts, and owned process/port cleanup passed.
- Clean command: `node script/run-c7-headless-host.mjs --host next --output apps/web/.next-c7-integration-be9cfc4e-clean --base /c7-integration-next-clean --marker c7-integration-be9cfc4e-next-clean --head be9cfc4e1ec2c4d49cf4490c61928ab5bdf86bb6 --tree c1b151191025f7bfc2fd04fb27ae15bd71177f93 --entry apps/web/src/app/c7-headless/route.ts --proof-control neutral`
- Result: exit `0`; graph `16` emitted modules, graph SHA-256 `5e69eb92bbfd70af24371cef0578f008ae3b539c5667257fbd36c722e2e9feec`, module-set SHA-256 `9a70c69023daa90e5b5e0a27899688a803600358241c3e19c2c37ab3b0945d07`, file-set SHA-256 `800dc6eef8003468059c4579748927330e70ac358d0023d2e4e72bd0ad72d192`, HTTP `200`, semantic edit/reopen/opaque/attachment/disposal checks pass, zero runtime resources, and exact owned cleanup passed.
- Cross-Host command: `node script/check-headless-semantic-result.mjs --vite apps/vite-example/dist-c7-integration-be9cfc4e-vite-clean/integration-runtime-report.json --next <temporary Next report>`; exit `0`, equal project identity `c7-headless-project` and edited value `C7 headless edit`, with distinct Vite/Next graph identities.

### Vite graph and clean runtime

- Existing fresh Vite integration runtime report was reused as authorized by the checkpoint: `apps/vite-example/dist-c7-integration-be9cfc4e-vite-clean/integration-runtime-report.json`, status `passed`, marker `c7-integration-be9cfc4e-vite-clean`, graph `15` modules, graph SHA-256 `f15aabbc67df197e859bf1aa6923d97be29a7db082690edf95a05b260280870a` on checker replay, zero forbidden rules, zero mounts/navigation/errors, and complete owned cleanup.
- Checker replay: `node script/check-headless-graph.mjs apps/vite-example/dist-c7-integration-be9cfc4e-vite-clean/c7-headless-graph.json --host vite --producer vite-rollup --entry apps/vite-example/src/headless-entry.ts --marker c7-integration-be9cfc4e-vite-clean --head be9cfc4e1ec2c4d49cf4490c61928ab5bdf86bb6 --tree c1b151191025f7bfc2fd04fb27ae15bd71177f93`; exit `0`.

## Ordinary Host and regression gates

The previously accepted fresh ordinary Vite/Next Host, storage, runtime, disposal, C3-C6, and focused C7 evidence was reused without rerunning, per the supplied checkpoint. The integration tree contains the same product changes and was independently covered by the full-suite, boundary, type, protected-identity, and strict-validation gates below.

- Checkpoint-focused C7 result reused exactly: `90 pass / 0 fail / 123 expectations` across eight files.

- `bun run --cwd apps/vite-example typecheck`: exit `0`.
- `node script/check-type-baseline.mjs`: exit `0`; exactly the three pinned inherited diagnostics, no new diagnostic.
- Boundary/static gates all exit `0`: `check-port-boundary` (`53` contract modules, `266` frozen attributable closure), session-resource, session-state (`10/10` factories and registry keys), storage (`738` modules), Host composition, runtime assets, reference, distributable, and `git diff --check`.
- `bun run check:wasm`: exit `0`; self-built artifact, path, license/wiring, and exact `38` JS exports / `58` binary exports / `609` imports.
- Unfiltered `bun test`: exit `1`, `480 pass / 8 fail / 2 loader errors / 1,417 expectations / 488 tests / 83 files`; the eight failures and two loader errors are the exact inherited identities, with no new red identity.
- `rasen validate s02-headless-editing --type change --strict --no-interactive --project rocut --json`: `1/1` valid, `0` issues.
- `rasen validate --specs --strict --no-interactive --project rocut --json`: `14/14` valid, `0` issues.

## Protected identity confirmation

- ports tree `efe499db6bec7afb8c35ac1a2aaa5fe851fac667`
- public session-types blob `c67d9822a2a6c994be14f367e6980fbbaa6e454b`
- parity fixture tree `e1fbb55b985f4fb490c6b233d18c50c58ea14c28`
- type fixture blob `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8`, SHA-256 `0f7cc855fc8f5c7edd68b2c371bae993fe8e713d2ffd4ef21956de72bd387622`
- `rust/wasm` tree `d782b046c0f39e85b8a5ed518b42389214c211e5`
- `rust/crates/gpu` tree `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2`
- `rust/crates/compositor` tree `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34`
- generated JS SHA-256 `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1`
- generated WASM SHA-256 `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`
- protected tracked diff exit `0`.

## Tasks and durable findings

Tasks `13.5` and `13.6` are checked in `tasks.md`. No source, spec, history, or run-state mutation was made.

1. The exact Next per-entry collector is React-sensitive: the injected control is rejected by `forbidden.react-family`, while the clean closure has zero forbidden modules.
2. Independent Vite and Next clean runs preserve the same deterministic edit/reopen, opaque-provider, attachment, and disposal semantics while retaining distinct Host/build/graph identities.
3. Integration preserves the inherited full-suite red identity exactly; no new failure or loader identity appeared.

## Test evidence

- scope: integrated C7 focused/graph/runtime plus boundary, type, WASM, strict-validation, and full Bun regression gates
- rationale: covers the merge-sensitive headless closures, shared migration/persistence behavior, ordinary Host boundaries, protected artifacts, and inherited-red identity required by tasks 13.5-13.6
- command: exact commands recorded above; full-suite command `bun test`
- result: pass with the documented inherited reds only
- tree: `c1b151191025f7bfc2fd04fb27ae15bd71177f93`
