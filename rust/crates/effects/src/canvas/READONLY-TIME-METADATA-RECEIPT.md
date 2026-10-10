# Canvas sampled-time metadata is read-only

2026-10-10. Narrow encapsulation change only: `CanvasState.sampled_ticks` is now
private, with a read-only `sampled_ticks() -> i64` accessor. Columns/rows, clock,
numerics, input identity and renderer registration are unchanged. The existing
off-grid test checks the accessor; no new numerical cases were claimed.

The same integrated 17-test suite passed 17/17, 0 ignored, no suite compile
warnings, against fresh current-source time rlib
`C:/tmps/canvas-clock-sol-20261010/libtime.rlib`, SHA256
`f9093d7e4826dc68e7ad6195123a8cd2d11c38ea3a6578b94b0ec5c58784fc79`.
This is a recheck, not 17 additional cases. Compilation used the stdin module-path
wrapper, actual `--extern time=<above>` and `-L dependency=<rocut>/target/debug/deps`,
`--edition 2024 --test - -C debuginfo=0 -C opt-level=1 -C link-arg=/DEBUG:NONE`.

A separate caller compile-fail control used the same real dependency and wrapper:

```rust
fn forge(state: &mut canvas::CanvasState) { state.sampled_ticks = i64::MAX; }
fn main() {}
```

Actual result: rustc exit 1, E0616, `field sampled_ticks of struct CanvasState is
private`. No executable was emitted. Three unused re-export warnings from the
minimal caller wrapper preceded the expected privacy error; they are not hidden
or counted as test failures. No unsafe bypass is claimed to be prevented.

New isolated directory `C:/tmps/canvas-readonly-sol-556132a1` contains exactly one
executable, 898048 bytes, no PDB, below 10 MiB. Old executables/receipts were not
overwritten or deleted. No production files beyond simulation.rs/tests.rs changed.

SHA256 pins:

```text
canvas/simulation.rs 05e5ec37bd668b7c22aa53cc064f45e3c52c77a98a61c83df66bfcceb97a3839
canvas/tests.rs 451fbf3926a3cdfea88fb8b501f0dee9fd7de8f0a28576b1a1f60c1c8104a7f1
new canvas-tests.exe 2437385de4ffcd13deacbb2f2cb40b84d615312c924d9e9712e0bf32ef58fb47
```

The historical 20/21 CPU independent-review result pertains to its earlier source
snapshot. It is not promoted to independent acceptance of this new metadata-only
source change; Root coordinates a separate read-only review. Fresh time rebuild
does not establish full transitive source provenance of reused binary dependencies.
Canvas remains N; no Cargo/WASM/GPU/browser/app/Host/UI/history/export or installed
runtime acceptance is claimed.
