# C7 review-cycle status after Sol fix round 1

Date: 2026-08-05 (Asia/Shanghai)

Accepted base: `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf` / tree
`885d307814260b77397c2c2677b9361fdfc5f5e2`. Product work remains uncommitted. This is the fixer
handoff, not an independent clean-review verdict.

## Round-1 finding dispositions

| Finding | Prior severity | Sol fixer disposition | Fresh evidence | Independent status |
| --- | --- | --- | --- | --- |
| R1 Next collector could borrow entrypoint files without exact root/concatenated-owner emitted membership | Blocker | Fixed: exact root or concatenated owner must own non-empty chunk-graph membership and intersect the named entrypoint; unconditional emitted membership removed | Plugin RED/GREEN matrix `4/4`; final clean Next graph passes with `15` modules / `2` exact files | Pending task 12.6 re-review |
| R2 Vite evidence did not bind the executable HTML facade to the exact entry chunk | Blocker | Fixed: producer records final emitted closure, checker rereads real `headless.html`, digest and module scripts, and requires the exact entry script | Graph suite includes missing/altered/wrong-script controls; final clean Vite graph passes with `14` modules / `5` files | Pending task 12.6 re-review |
| R3 Resource/store/React zero claims were literal rather than pre-load runtime observations | Major | Fixed: probe installs before subject import and observes ordered lifecycle, exact Host/store binding, fallback, timers/RAF/Worker/audio/object URL/WebGPU/WASM, React DOM/server strategy and final resources | Probe/evaluator/fixture coverage; final Vite and Next reports; cross-Host evaluator pass | Pending task 12.6 re-review |
| R4 C3 WebGPU failure was not isolated from the accepted base and Next parity was not replayed correctly | Major | Isolated: exact base and current WebGPU fail at the same migration-observation assertion; current WebGL passes. Fresh protected Vite and root-base Next parity both pass | Base/current marker `c7-r4-base-isolation-20260805`; Vite parity `1/1`; Next parity `1/1` | Pending reviewer acceptance of inherited-oracle attribution |
| R5 Patch/provenance/architecture/SBOM records were incomplete | Major | Fixed for pre-commit scope: `PATCHES.md` P-273 and `BOUNDARIES.md` observed C7 boundary added; SBOM deterministically regenerated; reference boundary passes | SBOM `1359` npm / `80` wasm crates and D-1..D-5 dispositions; final SBOM tracked diff zero | Pending re-review; official `SOURCE_INVENTORY.md` regeneration is deferred until the ship commit because its generator ignores untracked authored files |

No finding is self-closed by the fixer. Task 12.6 must give the post-fix delta, this report, raw final
graphs/results, and prior reports to a fresh non-author Sol reviewer. Blocker/Major closure belongs to
that reviewer.

## Final post-fix evidence

- Focused C7 suite: `52 pass / 0 fail / 81 expectations` across eight files.
- Full Bun: `442 pass / 8 inherited placement failures / 2 inherited loader errors / 1,375
  expectations / 450 tests / 83 files`. This is the prior `430/8/2` identity plus exactly `12`
  passing tests and `17` expectations; the six named `ZERO_MEDIA_TIME` failures and two loader-error
  identities are unchanged.
- Final Vite control/clean graphs: `6c6bff36...` rejected for five injected React identities;
  `eeda71ec...` accepted. Final Vite runtime report SHA-256 `c607648e...` passes.
- Final Next control/clean graphs: `c2332f85...` rejected solely for injected React;
  `b32ac37f...` accepted. Final Next runtime report SHA-256 `2cfd5148...` passes.
- Both final runtime reports contain a five-event pre-load probe, exact same-store identity, no
  fallback, actual edit/reopen/opaque/attachment proof, zero resource/React/GPU observations, no
  errors, and complete owned cleanup. Cross-Host evaluation passes.
- Vite typecheck passes. The pinned type gate reports only the exact three inherited diagnostics.
- Session-state/resource/port/storage/Host/runtime-asset/reference/Next-import boundaries pass.
- `bun run check:wasm` passes the self-built/path/license/wiring and exact `38/58/609` API gates;
  Rust is `12/12`.
- Protected editor-port/session/parity/type/Rust/GPU/compositor/generated identities equal the
  baseline and protected `git diff --quiet` exits `0`.
- Rasen strict validation: child `1/1`, main specs `14/14`, zero issues.
- Scenario map: `scenario-realization-map.md` has `62` unique rows for all `14` requirements; four
  delivery/review scenarios remain explicitly pending.

## Authored scope after fixes

The final authored product/tool/docs set is `30` files (`7` tracked modifications and `23` untracked
additions). Its reproducible SHA-256 is
`072b5fdf40f3d983c7407aae9d90e0bcd7a588803d07d21ff7785438cee65470`, computed over sorted
UTF-8 repository-relative path bytes, NUL, raw file bytes, NUL. Generated `dist-c7-*` and
`.next-c7-*` outputs are excluded.

Exact authored paths are listed in the round-1 supplement to `final-manifest.md`. The official
source inventory must be regenerated only after those currently untracked paths are committed.

## Remaining gates

1. Fresh non-author Sol re-review of the post-fix delta and prior findings (task 12.6).
2. Reviewer-directed affected-gate replay if any new fix is accepted; otherwise task 12.7 evidence
   is already complete for this round.
3. Only after clean review and task 12.8: separate Luna-xhigh local ship, LEAD integration and fresh
   integrated gates/spec sync, then a different Luna-xhigh archive leaf.

No commit, push, PR, integration, spec sync, source-inventory regeneration, or archive occurred in
this fixer leaf.

## Fresh non-author round-2 disposition

The fresh reviewer closes R2, R4, and R5 for the pre-commit scope, but the cycle remains
**BLOCKED — Blocker: 1 / Major: 1**:

- R1 remains false-positive capable because `rawRequest`/request identities can establish the exact
  Next root even when `module.resource` is absent. A complete alias-only producer-to-checker
  counterexample passes.
- R3 remains incomplete because the probe has no nonzero sensitivity control for each accepted
  timer/RAF/global resource/WebGPU/WASM/React zero.

See `review-round2.md`, `verification-round2.md`, and `../handoff/reviewer-round2.md`. Tasks
12.6-12.8 remain unchecked; another Sol fix and fresh non-author Sol re-review are required before
Luna-xhigh ship.

## Sol fix round 2 handoff to a third reviewer

This section records implementer disposition only; it does not amend the independent round-2
verdict above.

| Open round-2 finding | Fixer disposition | New falsification/sensitivity evidence | Review status |
| --- | --- | --- | --- |
| R1 Blocker: alias/request identity could establish the Next root without resolved resource identity | Root identity now derives only from normalized, query/hash-stripped `module.resource`; request/userRequest/identifier remain provenance only. | Full producer-to-checker alias-only envelope with no resource is rejected; plugin suite `5/5`. Final Next clean/control graphs use actual resolved roots. | Pending fresh Sol-xhigh review |
| R3 Major: accepted zero observations lacked complete nonzero sensitivity | Probe/evaluator publish and validate ordered provenance plus distinct global, Host, React and compositor/GPU fields. A proof-only callable genuinely triggers each installed path; browser React uses a real root/mutation, server records explicit no-DOM absence. | Evaluator suite exercises every clean field, provenance order, installed-but-unexercised failure and fabricated React failure. Final Vite/Next sensitivity controls pass and clean artifacts report every field zero. | Pending fresh Sol-xhigh review |

During affected-gate replay, the resource boundary caught direct platform acquisition in the
session fixture. The trigger was moved to `script/fixtures/c7-headless-runtime-sensitivity-control.ts`
and passed into the fixture as a proof-only callable; no product-source exemption or static rule was
added. The final post-boundary artifacts are Vite control `...-10`, Vite clean `...-3`, Next control
`...-5`, and Next clean `...-3`, with exact identities in `review-round2-fixes.md`.

Final fixer replay: focused `90/0/123`; full Bun `480/8 inherited/2 inherited loader errors/1,417`;
all eight static boundaries, Vite/type baseline, formatting/ESLint, WASM `38/58/609`, Rust `12/12`,
protected identities, cross-Host execution and strict Rasen `1/1 + 14/14` pass. Exact superseded
generated outputs were reclaimed only after durable all-file identity records; current round-2 and
ordinary/parity artifacts remain.

Required next action: assign a third fresh non-author Sol-xhigh reviewer the accepted base, all
prior review reports, this complete post-fix delta, `review-round2-fixes.md`, the four final raw
runtime JSON files and final graph files. Tasks 12.6-12.8 remain reviewer-owned and unchecked. No
commit, ship, integration, spec sync or archive occurred here.

## Third fresh non-author review — final cycle disposition

The third Sol-xhigh reviewer accepted both round-2 fixes and reconfirmed all earlier closures.
Final cycle verdict: **CLEAN — Blocker 0 / Major 0 / Minor 0 / Trivial 0**.

- R1 exact-root false acceptance is closed by resolved-resource-only root selection and a complete
  alias-only/no-resource producer-to-checker rejection.
- R3 runtime proof is field-complete and sensitivity-backed for every global, Host, React,
  WebGPU/WASM, and derived compositor/GPU field.
- Focused C7 is `90/0/123`; full Bun is `480 pass / 8 inherited fail / 2 inherited loader errors /
  1,417 expectations`; all affected static/type/format/Rust/WASM/protected/strict gates pass.
- Scenario state is `59 PASS / 0 FAIL / 0 UNVERIFIED` pre-delivery plus the three causally later
  delivery scenarios explicitly `PENDING`.
- Tasks 12.6-12.8 are complete. Tasks 13.1-13.10 remain pending for separate Luna ship, LEAD
  integration/spec sync, and different Luna archive leaves.

Canonical details are in the round-3 supplements to `review-report.md`,
`verification-report.md`, and `scenario-realization-map.md`. No commit or delivery action occurred
in review.
