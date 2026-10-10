# Canvas clock source/build addendum — 2026-10-10

Canvas remains N. This is CPU source/build evidence, not renderer, WASM, GPU, browser, application, or runtime acceptance evidence.

## Clarification of the frozen receipt

The opening phrase “No ... dependency rebuild occurred” in `C:/tmps/canvas-clock-sol-20261010/CLOCK-RECEIPT.md` is too broad if read as including the project's shared time crate. **The current real `rust/crates/time/src/time.rs` and its source modules were directly compiled with rustc into a fresh time rlib in this round.** No Cargo invocation occurred.

Only the existing third-party/bridge binary dependencies were reused without reinstalling or rebuilding them. Their full transitive source provenance is not established by this receipt. No claim of a fresh build of the complete dependency closure is made.

The frozen receipt is unchanged, with SHA256 `30f30e084270936a2913f4be81ea5f9c6bcb425d03e0d60cc96f299cf2cfa4d3`. Its detailed build command, historical CPU records, and initial output-basename correction remain valid; this addendum clarifies the opening sentence rather than rewriting that evidence.

## Fresh shared time build

- Toolchain: rustc 1.88.0, commit `6b00bc3880198600130e1cf62b8f8a93494488cc`, host `x86_64-pc-windows-msvc`, LLVM 20.1.5.
- Entry: `rust/crates/time/src/time.rs`, `--edition 2024 --crate-name time --crate-type rlib`.
- Output: `C:/tmps/canvas-clock-sol-20261010/libtime.rlib`, SHA256 `f9093d7e4826dc68e7ad6195123a8cd2d11c38ea3a6578b94b0ec5c58784fc79`.
- Dep-info: `C:/tmps/canvas-clock-sol-20261010/libtime_canvas_clock.d`, SHA256 `64a5c1ea5721d7337395eef81a00f511e0293e2a96844862afd7cdd6ed6344ea`.
- This worker executed 4/4 independent clock tests against that fresh rlib: off-grid/negative floor, rational 30000/1001, unsupported integral ticks/frame, safe-JS and authoring rate bounds. Separate integrated Canvas checks belong to the identity worker's evidence.

Direct reused binary dependencies, relative to the rocut repository:

```text
target/debug/deps/bridge-118dca6e8ce5bf1f.dll 5f63d0e0965d420db23855c8e99bfa3dcd93ae936d9792acd4fa8e0e89616f42
target/debug/deps/libserde-b5fb49d33599b962.rlib 8e09d05de35ef947f2538d94f4b4e43282906ab2484c1e6d335cf53fc82c68c1
target/debug/deps/libnum_traits-67d92d7058184602.rlib 836b2e3c9ea22f3c0970d448edc5278f2416912fd191eaf60bb270a1158fa2f3
```

## Full current time source manifest

All 16 source files below are the actual source dependencies listed by the fresh build's dep-info. Paths are repository-relative; hashes cover raw bytes. The manifest digest is `8846d55f9ec4edfb658ba0ab8b523f9e4604b5fd38024f084dc235e7f827bf89`: sort the following `path + space + hash` strings lexicographically, join with LF, append LF, and hash UTF-8 bytes. This manifest covers this time crate's source files, not the transitive sources of reused binary dependencies.

```text
rust/crates/time/src/time.rs daca3425299323f53386cea12444064479c55f4848cb1d37d7f6233f5574a4ee
rust/crates/time/src/frame_rate.rs c66f6fde28813ccfce1ad5e533a09b2e3923f70891148a4dbb758b11f85bd4ca
rust/crates/time/src/audio_clock.rs 2c543cd0c52358f82c0d03d56d4ae42060d848a212a4b04c23c8f5ee80c7dfd0
rust/crates/time/src/clip_export.rs 33cbadae5d6eb1be63c56316197191fa428c7be13a3353aa719505bf371f56c2
rust/crates/time/src/frame_grid.rs e402a25076d388c02dccd776be012b3ff8385aac67e27e74ce04154d679faa86
rust/crates/time/src/media_time.rs e017ec4b19fbb6d10f6266c758402eafef0d077ded8f0478a75ecee26be70d41
rust/crates/time/src/replay.rs 1f522b63a462e2dc44d6c40d7df97e7f0cdf09d83c601c5b806ea27d0534d11a
rust/crates/time/src/replay/job.rs eac1d736fb1641ada8264f5e9a78b354986cb4f41106beb695ade0a25dc16331
rust/crates/time/src/source_span.rs d78d072b498ac93ebbc3a3376d917f448b82d772161b975ae5cc5f036143c04c
rust/crates/time/src/strict_object.rs 564084057d9c962a62b5506892c24911b82f97eeef94646c6fa05e4ba535fafa
rust/crates/time/src/timecode.rs 518f473a8ad2031ee9167e3158d0a84479e1789b222c23ed75a0474f91f4c944
rust/crates/time/src/transition.rs a739f4c1bb5738beafb1e11b5d22c42274574a04d6251ab2df075766147b0913
rust/crates/time/src/transition_api.rs 6881698281af6abda0b1cea74e259fdc089d026891363f319c65f1c640615e99
rust/crates/time/src/transition_graph.rs a8eb29097d8be306ea4d8f96cbb60158b74bdd0d9c71185ee5ac028861da0007
rust/crates/time/src/transition_reconcile.rs 549030f75fa48637e52a16fbe45eb51473808be6aecf19820688a01f2bba5ff0
rust/crates/time/src/video_time.rs 40aec2610b023b41b87a782fc31c26e13d32bee2b87e33831299fdd9301b842b
```
