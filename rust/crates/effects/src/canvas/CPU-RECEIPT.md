# Canvas numerical core — CPU-only receipt

Stage: production-oriented Rust material core, not a registered effect or completed
Canvas feature. The plan's Canvas row remains N. No shared registration, catalog,
pipeline or editor API files were changed by this task.

## Contract

- Strict version-1 numeric map: every configuration and active stroke field is
  required. Unknown fields, inactive slots, fractional integers and incomplete
  paths fail. Typed structs are the same numerical contract; no JS business logic.
- 120000 ticks/second; clip-local rational frame-floor requires integral ticks per
  frame, bounded numerator/denominator, and safe local ticks. Complete schedule,
  dimensions, input and full-duration work are validated even at negative times
  or with zero stroke opacity.
- At most 16 ordered-by-authorship linear strokes (chronological sorting is not
  required), each with 2–32 individually seeded bristles. Duplicate times are
  legal. Paths run over explicit start/end ticks, not inferred interaction.
- Anchored 6000-tick numerical intervals split at every exact start/end and final
  target residue. A start at 12001 has no contribution at 11999/12000; sampled
  16000 includes its past segment only. At the exact start there is no deposited
  duration yet. Rebuild always starts empty; seek order cannot change results.
- Grid 8–128 on each side, duration (0,60] seconds. Conservative full-duration
  budget is cells * (ceil(duration/6000) + 2*strokeCount + 1) *
  (8 + sum(bristleCounts)), at most 80000000 cell/bristle visits. Checked work and
  memory arithmetic precede replay allocation; oversize requests fail rather
  than reduce resolution. Resident current/scratch arrays cost 96 bytes/cell;
  source/output, allocation metadata and caller storage are excluded.
- Frozen input is exact-grid premultiplied linear RGBA. Bilinear clamp-to-edge
  sampling supplies actual pigment to separate bristle trails. Transparent holes
  admit no deposition or neighbour flux. Output alpha equals input alpha; RGB
  remains premultiplied, including partial alpha. Invalid hidden RGB is rejected.
- Coverage, premultiplied pigment, wetness and height are material state.
  Symmetric wet-neighbour flux conserves coverage/pigment/height; exponential
  drying removes wetness, not deposited mass. Woven warp/weft height plus paint
  ridges drive normals and directional diffuse/wet highlight lighting.
- Post-duration requests hold the authored final state. There is no wall-clock
  state, automatic gesture generation or static-only substitute for wet painting.

## Verification on 2026-10-10

Isolated native command (no Cargo, dependencies or GPU): pipe
`#[path = "<absolute rocut>/rust/crates/effects/src/canvas.rs"] mod canvas;`
to `rustc --edition 2024 --test - -C debuginfo=0 -C opt-level=1 -o
C:/tmps/canvas-cpu-sol-2ba167ea/canvas-tests.exe`, then execute it.

9 tests passed, 0 failed, 0 ignored. Tests cover off-grid causality and rational
floor, arbitrary seeks and tied strokes, seed/bristle changes and actual ridges,
drying versus retained mass, conservative diffusion/no-through edges,
premultiplied transparency, admission before negative/neutral execution,
strict DTO missing/unknown/inactive/fractional controls, final hold/input safety.
The entire isolated directory contains two files totaling 3890688 bytes.
Earlier standalone-root and path-module compilation attempts failed due to Rust
child-module lookup; explicit scoped child paths corrected the root cause. Those
failures are not represented as passing tests. Final compile had no warnings.

## Remaining integration and model limitations

Not yet connected: editing catalog/default authoring, renderer texture access,
WASM ABI, GPU material pass, Host, real UI/history, export or installed runtime.
No claim of optical GPU or end-to-end acceptance. The present source is a frozen
image sampled on the configured material grid. Video temporal sampling, source
identity/replay ownership, full-resolution resampling and production scheduling
must be explicit in the subsequent integration; do not reinterpret the input as
implicit live history. No high-order fluid solver, bristle elasticity, arbitrary
pressure curves or physically calibrated paint/optics is claimed. The conservative
budget is a logical bound, not a measured frame-time or peak-RSS guarantee.
