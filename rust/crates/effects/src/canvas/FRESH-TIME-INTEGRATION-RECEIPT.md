# Canvas integrated CPU recheck with fresh shared time

2026-10-10. This is the same 17-test suite re-executed against a fresh current-source
time library, not 17 additional cases. Canvas remains N. Existing receipts and
executables were not modified or deleted.

Actual compile and execution: exit 0, 17 passed, 0 failed, 0 ignored; no compiler
warnings. Thirteen material/identity tests and four shared-clock tests passed.
No production source changes were made for this recheck.

The stdin wrapper is:

```rust
#[path = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rust/crates/effects/src/canvas.rs"]
mod canvas;
```

Working directory: the Rocut repository. Compile that wrapper from stdin with:

```text
rustc --edition 2024 --test - --extern time=C:/tmps/canvas-clock-sol-20261010/libtime.rlib -L dependency=E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/target/debug/deps -C debuginfo=0 -C opt-level=1 -C link-arg=/DEBUG:NONE -o C:/tmps/canvas-fresh-time-sol-31604567/canvas-tests.exe
C:/tmps/canvas-fresh-time-sol-31604567/canvas-tests.exe
```

The fresh real rlib was independently compiled by the shared-clock worker from
`rust/crates/time/src/time.rs`, using the actual shared crate and source modules,
not a stub or copied clock algorithm. Its build command/source manifest and
dependency evidence are recorded in
`C:/tmps/canvas-clock-sol-20261010/CLOCK-RECEIPT.md`.

Pins:

```text
fresh libtime.rlib f9093d7e4826dc68e7ad6195123a8cd2d11c38ea3a6578b94b0ec5c58784fc79
new canvas-tests.exe 43aa03b1c189d28cf2386b745c0e95b5151298fb4760ca8fb430df100c0e57da
canvas.rs e250e351111a2c82680cf8ef9e47eee2133e4cb747b8227620888b8275add9c9
canvas/clock.rs 7b302108c47f508524455d97eea1a9e350aa734a277b826a89c4d28daa72bfd4
canvas/contract.rs 6fbd4ae2cd1033f9d3cd235f7d0d8de7955a1ae169dcb2841a75b17791f941c4
canvas/simulation.rs edee4f8017944140c550776d0bb9fec11643b3985da9fc3b48a3820a7023c9c3
canvas/tests.rs 83c92ef68741d5d57815a118f5ea375ff650530d779adc7362419754f4e22959
```

This closes the old native-time-source binding gap for the directly rebuilt time
crate used in this execution. Existing binary dependencies remain reused, not
freshly rebuilt or fully transitive source-proven. The historical execution using
`libtime-2f6cc1aecb57019b.rlib` retains its original provenance limitation; no old
receipt is relabelled. This is not a whole effects-crate/Cargo/WASM build.

The entire new isolated directory `C:/tmps/canvas-fresh-time-sol-31604567` contains
one executable, 897536 bytes; no PDB or other artifact was generated (<10 MiB).
No GPU, browser, application, shared registration, Host/UI/history/export or
installed-runtime operation occurred. Resource/video-history identity remains
outside this frozen-input CPU contract.
