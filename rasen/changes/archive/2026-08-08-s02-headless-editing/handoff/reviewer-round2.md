# C7 fresh Sol reviewer handoff — round 2

Date: 2026-08-05 (Asia/Shanghai)

Verdict: **BLOCKED — 1 Blocker / 1 Major**.

Do not ship. The 30-file authored identity is
`072b5fdf40f3d983c7407aae9d90e0bcd7a588803d07d21ff7785438cee65470` on exact base
`a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf` / tree
`885d307814260b77397c2c2677b9361fdfc5f5e2`.

## Sol fixer assignment

### R1 Blocker — exact Next root

Own only the Next proof producer/checker/tests needed to make an alias-only request incapable of
establishing the application root. Require a canonical resolved `module.resource`, record that real
identity as `entry.observed`, retain request strings only as provenance, and add a full
producer-to-checker negative whose root has no resource but exact rawRequest, real chunks, and all
required roots. Rebuild Next React control then a later clean artifact; execute clean and rerun the
cross-Host evaluator.

### R3 Major — runtime sensitivity

Own only the runtime probe/evaluator tests and minimal probe changes needed to demonstrate nonzero
sensitivity for every accepted zero: timeout, interval, RAF, global Worker/audio/object URL,
Host-mediated resources, graphics, WebGPU adapter, WASM instantiate paths, and React DOM
mount/mutation/root marker. Preserve server-no-DOM provenance. Rebuild both controls/clean Hosts
after all controls and rerun semantic/resource/static gates.

## Required handback

- focused failing reproductions before each fix and GREEN after;
- new authored digest and exact diff;
- final control/clean graph and runtime identities, with controls preceding clean builds;
- affected full Bun/type/static/WASM/Rust/protected/strict identities;
- ports/process cleanup;
- no task 12.8 claim and no Luna ship assignment;
- a new fresh non-author Sol reviewer after the fix round.

Closed and not to be re-opened without new evidence: R2 Vite facade, R4 inherited C3 isolation plus
Vite/Next parity, and R5 pre-commit provenance. Official SOURCE_INVENTORY remains a post-commit
Luna-xhigh ship leaf.

Primary evidence: `evidence/review-round2.md`, `evidence/verification-round2.md`, and the latest
rows in `evidence/scenario-realization-map.md`.

