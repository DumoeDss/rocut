# Canvas source/static-config identity — CPU supplement

2026-10-10; supplements rather than rewrites CPU-RECEIPT.md. Canvas remains N.

## Reproduced gap and narrow fix

The new `shading_rejects_source_and_static_configuration_substitution` test first
failed against the earlier implementation: `one-bit source replacement accepted`.
Same dimensions and legal premultiplied pixels did not establish state identity.

Each rebuilt state now owns the complete source pixel snapshot and complete
CanvasConfig. `shade` checks every source f64 and every configuration field using
exact `to_bits()` equality, including signed zero. No digest is used as a substitute
for byte identity. Equal copied input is accepted; even one bit of changed valid
input or config is rejected. Source mutation outside the state does not change the
owned snapshot; shading with the original copy still produces the original output.

The complete numerical config, including lighting, is static for a state.
Changing illumination requires a new rebuild under this contract. This is an
explicit conservative choice, not an animation API or an implicit visual-model
change. It does not solve resource attachment identity or temporal video history.
Stateless replay, exact event boundaries and input-alpha semantics are unchanged.

Whole config/schedule, source validity and frame-rate admission remain ahead of
material and source-snapshot allocations. `shade` rejects mismatched identity
before output allocation. An owned state clone is a separate caller allocation.

## Corrected logical memory estimate

`state_and_scratch_bytes` still describes two six-f64 material-cell payloads:
96 bytes/cell. `source_snapshot_bytes` adds the actual four-f64 owned input:
32 bytes/cell. `replay_peak_bytes` is their checked sum plus
`size_of::<CanvasState>()` (includes config identity and state/source Vec headers)
and `size_of::<Vec<CanvasCell>>()` for scratch. Caller input/output, allocator
metadata and call stack are excluded. This is not a measured peak-RSS claim.
The previous receipt's 96-byte material estimate did not include this new snapshot.

## Actual native verification

After the narrow fix, 13 material/identity tests passed. The shared-clock worker
then replaced the clock adapter with actual `time::{FrameRate, MediaTime}` calls.
The integrated CPU suite passed 17/17 (13 material/identity plus 4 clock tests),
0 ignored, no compiler warnings, using the existing real native library:

`E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/target/debug/deps/libtime-2f6cc1aecb57019b.rlib`

SHA256: `79ac7c26f48e98dd9d7f572963050ceb2c2c66a61803ac6899cdf5019236be23`.

The stdin module-path wrapper was compiled with `rustc --edition 2024 --test -`,
`--extern time=<above>` and `-L dependency=<rocut>/target/debug/deps`,
`-C debuginfo=0 -C opt-level=1`. No Cargo or time stub was used. A preceding
compile immediately after the shared-clock edit failed with unresolved `time`
before those required extern flags were supplied; it is not counted as passing.
The dependency is a real existing native rlib; this test does not prove an exact
current-time-source-to-build provenance binding, which remains separate.

New negatives cover source one-bit changes, all RGBA channels, signed-zero input,
external source mutation, every config field, one-bit config and signed-zero
drying/light. Equal snapshots remain usable. The estimate has an exact size test.
The earlier off-grid, replay, drying, diffusion, premultiplication and strict DTO
controls also pass.

All new native artifacts are confined to
`C:/tmps/canvas-identity-sol-47aac22b`: two files, 7719424 bytes total (<10 MiB).
No shared registration files, GPU/WASM, browser, app, Host/UI/export or installed
runtime were touched or accepted. Earlier receipts remain unchanged.
