# S09 integration and delivery validation progress

Date: 2026-09-28

Status (corrected 2026-10-01): G8/G9/M3 remain open. The 2026-09-28 isolated
plugin 0.4.4 smoke run produced two 1920×1080 MP4s, sampled frames and
screenshots. Its historical validator PASS is withdrawn as final acceptance:
performance fields contained budget constants, the seek threshold had been
relaxed from 250 to 500 ms, and the runner bypassed the actual Creator Studio
entry. The original 250 ms gate is restored; unmeasured installed performance
is now null and cannot pass. Those artifacts do not certify plugin 0.5.0.

## Newly verified automation paths

The public Creator Studio path is now exercised through the real CLI parser,
target resolver, authenticated HTTP host, canonical Rust/WASM factory,
transaction engine and durable project store. The focused suite proves:

- `motion-text catalog` returns the 889 drawable JIZURA entries and starter
  preset surface;
- `create` persists one sequence, visible clip and generated graphic track in
  one project revision;
- `list` returns the stored sequence with its stable cue/cut IDs and sequence
  revision;
- `mutate` advances the project and sequence revisions together;
- variation preview returns a candidate without advancing stored state;
- `vary --apply` advances both revisions and the same stable IDs are visible
  through `read.entities` afterward;
- two concurrent hosts selected with explicit `--project` routing isolate
  their request journals and project state even when they reuse the same
  idempotency key;
- the concurrent-host fixture stores independent `zh-Hans` and `ja`
  sequences, then mutates only the Chinese project and proves the Japanese
  project remains at its original project/sequence revisions;
- a combined upgrade/routing fixture now starts from two complete schema-v31
  projects carrying distinct opaque provider fields, migrates both through the
  published v31-to-v32 chain, creates independent `zh-Hans` and `ja` sequences
  while both Hosts are live, closes and reopens both projects, then proves
  stable IDs, language/text, dual revisions and provider fields remain
  isolated. Replaying the Chinese create after reopen is recovered by the
  durable journal without advancing either project;
- a three-lifecycle restart fixture proves the durable transaction ledger
  replays an identical create with its original IDs and revision, persists a
  later mutation, and rejects the same mutation after another restart because
  its sequence base is stale instead of reconstructing an obsolete Rust base;
- a real CLI subprocess proves stale mutation failures preserve the human
  `rocut: POST ... failed (409)` stderr line and add a machine-readable JSON
  line with HTTP method/status, stable conflict code and expected/actual
  sequence revisions;
- an independent editor-plane transaction produces a valid external user
  record, which the Host accepts and rebuilds over; the stale Agent mutation is
  rejected without a write, then read-back/retry reaches revisions 3/2 while
  preserving the user's revised cue text;
- F04/F05 source fixtures create 120/600 cues and 240/1,200 canonical cuts;
  their combined Host project survives close/reopen byte-semantically, and the
  durable journal replays the large F05 create without revision or identity
  drift;
- a real Chromium 151 probe performs 180/240 shuffled 720p seek-and-draw samples
  against those canonical sequences. Every shuffled frame matches its ordered
  fingerprint; p95 is 0.8/0.3 ms, both outputs contain visible pixels, and
  precise-heap evidence is retained in `s09-stress-probe.json`;
- the F04 path then applies 40 sequential updates to one stable cue ID. Every
  update advances the sequence revision exactly once and produces a visible
  stable frame; Rust replanning p95 is 11.4 ms, visible 720p draw/readback p95
  is 7.9 ms and the combined p95 is 18.9 ms against the 300 ms source-runtime
  budget;
- the same probe drives the production `SceneExporter`, `CanvasRenderer`,
  `WasmCompositor`, canonical time mapper and existing offline-font runtime. A
  60-frame MP4 from the final two seconds of F05 completes in 884.6 ms with
  19,477 bytes and an `ftyp` header; a full eight-minute/14,400-frame export
  cancels after five frames, emits exactly one cancellation event, returns no
  buffer and settles in 25.9 ms.
- a separate catalog-pinned representative export matrix selects
  `layout:perspective`, `enter:assemble`, `fx:mosaic`, `bg:noiseField` and
  `trans:hrBlink` from the authoritative 912-entry catalog. The canonical Rust
  preview factory applies every selected preset to every eligible cut (the
  first cut is correctly ineligible for a transition), then the production
  `CanvasRenderer` and `SceneExporter` render and encode five short 320x180,
  30-fps MP4s through one session compositor and the existing offline-font
  runtime. All sampled frames contain non-black pixels, all five combined
  frame digests differ, all five MP4 SHA-256 digests differ, and all 180 encoded
  frames complete with one completion event, no error event and an `ftyp`
  header. The report pins both the canonical WASM and catalog digests in
  `s09-export-matrix.json`.
- the same production fixture now closes the full drawable-catalog export
  smoke without replacing the existing per-item, two-phase Chromium renderer
  proof. All 889 drawable entries across 11 preset groups are created by the
  canonical Rust factory, sampled at three group-appropriate phases and
  exported at the most visible sampled phase. The run covers 1,751/1,751
  eligible preset/cut assignments, 889/889 entries with non-black compositor
  pixels, 1,778 encoded frames, 889 MP4 buffers, 889 completion events and zero
  error events. Every buffer has an `ftyp` header; their combined size is
  2,215,529 bytes. The aggregate report pins the exact 889 catalog-key digest,
  canonical catalog/WASM digests and per-group evidence digests in
  `s09-export-catalog.json`.
- F05 now also completes instead of only proving cancellation. The production
  `SceneExporter` encodes the complete eight-minute, 600-cue/1,200-cut range at
  320x180 and 30 fps: all 14,400 frames finish in 61,661.6 ms, followed by one
  completion event, zero error/cancel events and a 4,322,393-byte MP4 with an
  `ftyp` header. `s09-full-export.json` pins the output SHA-256 and canonical
  WASM identity. This low-resolution stress completion does not replace the
  final installed-artifact 1080p acceptance gate.
- the fixed F06 format matrix now runs `layout:perspective` through the
  canonical preview factory and production compositor/exporter at 24, 25, 30,
  60 and 30000/1001 fps for 16:9, 9:16 and 1:1 canvases. All 15 combinations
  contain visible samples and produce distinct `ftyp` MP4s: 90/90 encoded
  frames, 15 completion events, zero errors and 48,147 aggregate buffer bytes.
  The three 30-fps frame digests differ by aspect ratio. Together with the
  existing 11-group × 8-scene language/orientation matrix, this closes the
  canonical F06 source-runtime fixture without claiming installed 1080p
  delivery. `s09-format-matrix.json` pins the exact formats, frame/export
  digests, catalog and WASM identities.
- the F01 UI probe and the standalone font-readiness probe share one
  post-edit text fixture. Canonical Rust/WASM inspection now verifies 19 unique
  offline font assets against that exact text: the `gothic_bold` zh-Hans
  variant (`noto-sans-sc-variable.ttf`) reports 0 missing code points and is
  the single full-coverage asset. `s09-font-readiness.json` pins the fixture,
  catalog, canonical WASM and per-asset result; candidate mode additionally
  requires an expected font SHA-256, expected license SHA-256 and strict UTF-8
  OFL 1.1 text before reporting exact glyph coverage.
- the Rust builtin-font catalog now separates each stable JIZURA role from an
  optional language-specific asset variant. Creation and JIZURA import resolve
  a role once from `language` and persist the concrete asset ID; later
  mutations, locked cuts, variations and JSON reopen keep that stored ID rather
  than consulting the current catalog again. Catalog validation requires all 23
  stable base role IDs to remain present and rejects duplicate role/language
  defaults. The catalog now declares exactly one such variant,
  `gothic_bold_zh_hans`, so zh-Hans creation and JIZURA import resolve to the
  Chinese asset while every other language keeps the original `gothic_bold`
  asset. The Rust resource test checks a concrete sample for every declared
  `en`/`ja`/`zh-Hans`/`ko` language tag and rejects any tag that has no test
  sample, so the Chinese asset cannot satisfy the catalog test with English
  glyphs alone.
- the SBOM generator no longer hard-codes the font count, role count, byte
  totals or language tags. `motion-text-font-inventory.mjs` derives them from
  the catalog and shipped public tree, verifies every digest and OFL text, and
  rejects orphan TTF/license files, missing base roles, unsupported language
  defaults and ambiguous role/language mappings. Its synthetic variant test
  proves an appended language asset increases the asset-entry count without
  inventing a 24th JIZURA role; the current generated SBOM records 19 TTF /
  23 roles / 117,539,061 bytes including 19 notices. `check:sbom` recomputes
  the complete document without writing and fails when the checked-in output is
  stale. After dependency installation, the three-platform build job now runs
  that gate, the pinned F01 readiness check and the focused font inventory /
  candidate-review tests before the installed-WASM checks.
- a canonical non-motion compatibility scene now exercises the unchanged
  renderer path with a regular video element, ordinary `TextNode`, native
  rectangle `GraphicNode` and a generated 48 kHz audio buffer. Three sampled
  compositor frames are visible and distinct; the production `SceneExporter`
  then completes 30/30 frames with one completion and no error, producing a
  22,624-byte `ftyp` MP4 whose boxes contain both `vide` and `soun` handlers.
  `s09-non-motion-export.json` pins the output and canonical WASM digests. This
  closes the canonical source-runtime compatibility slice, while the packaged
  installation must still repeat the visual acceptance.

The first repository-wide regression pass also found and fixed four integration
gaps that narrower motion-text tests did not expose:

- preset catalog previews no longer call browser RAF directly; their loop is
  owned by `SessionResources`, stops on suspend/dispose and reacquires only on
  resume;
- `UpdateMotionTextSequenceCommand` is included in the exhaustive transaction
  routing registry;
- the independent singleton boundary now accounts for all 41 inspected command
  modules and continues to prove one session-owned editor core;
- `buildScene` treats an omitted schema-v32 motion-text collection as the
  additive empty default, so legacy/non-motion render, thumbnail and export
  paths do not crash on `undefined`.

A follow-up compatibility slice now passes 111/111 tests across 23 files. It
covers ordinary text frame-proof sensitivity, media persistence, audio range
mixing and lifecycle, retime/split behavior, image/effect previews,
video/waveform/compositor cache ownership, session export isolation, CLI export
routes, export-job transitions, Electron bridge/provider behavior, RGB frame
conversion and a real ffmpeg job containing both video and audio. This is
useful non-motion regression evidence, but it is not claimed as the final
installed-artifact visual-project acceptance required by gate 5 below.

## Documentation and final matrix

The remaining delivery state is now classified instead of being left implicit:

- `README.md` is the user and Agent entry point;
- `capability-support.md` records all 11 preset groups, editing surfaces,
  font coverage and actual host support;
- `upstream-sources.md` pins JIZURA, generated catalog and offline-font
  provenance without claiming the unbuilt plugin closure;
- `s09-verification-matrix.md` marks every section-13 category, F01-F07
  fixture, performance budget and section-14 acceptance step as passed,
  partial, blocked or not run;
- `s09-known-limitations.md` records reproducible blockers, product boundaries
  and the separate non-motion repository failures.
- `s09-installed-acceptance-contract.md` defines the evidence closure for the
  still-unrun installed-artifact script. Its validator requires all 12 steps,
  isolated-install and source identities, two 1080p exports, six sampled
  frames, media/performance budgets, exact file hashes and redaction; eight
  positive/negative and CLI tests prove it fails closed, including sidecar vs
  manifest drift, without claiming G9 is run.

Completing this matrix closes the documentation/classification task, not G9.
The matrix still reports the installed-WASM, plugin packaging and final
installed-artifact acceptance gates as open; the zh-Hans source font gate is
closed and the remaining font limitation is general zh-Hant/ko offline coverage.

## Evidence

```text
cd apps/cli
bun test src/__tests__/cli-verbs.test.ts \
         src/__tests__/host.test.ts \
         src/__tests__/motion-text.test.ts \
         src/__tests__/motion-text-routing.test.ts \
         src/__tests__/motion-text-restart.test.ts \
         src/__tests__/motion-text-cli-errors.test.ts \
         src/__tests__/motion-text-mixed-edit.test.ts \
         src/__tests__/motion-text-stress.test.ts
  23/23 tests, 201 assertions

bun run typecheck
  PASS

cd ../vite-example
bun run typecheck
  PASS

cd ../..
cargo test -p motion-text
  75/75 tests

bun test packages/editor-classic/src/editor/persistence/__tests__/project-codec-motion-text.test.ts \
         packages/editor-classic/src/motion-text/__tests__/font-language-support.test.ts \
         packages/editor-classic/src/motion-text/__tests__/lock-state.test.ts \
         packages/editor-classic/src/motion-text/__tests__/preset-catalog.test.ts \
         packages/editor-classic/src/services/motion-text-audio-analysis/__tests__/service.test.ts \
         packages/editor-classic/src/services/renderer/__tests__/motion-text-font-catalog.test.ts \
         packages/editor-classic/src/services/renderer/__tests__/motion-text-font-runtime.test.ts \
         packages/editor-classic/src/services/renderer/__tests__/motion-text-node.test.ts \
         packages/editor-classic/src/wasm/__tests__/motion-text-audio.test.ts \
         packages/editor-classic/src/wasm/__tests__/motion-text-factory.test.ts \
         packages/editor-classic/src/wasm/__tests__/motion-text-time.test.ts
  128/128 tests, 20,930 assertions

bun test apps/cli/src/__tests__
  106/106 tests, 507 assertions

$compatibilityTests = Get-Content -LiteralPath "docs/motion-text/s09-compatibility-tests.txt" -Encoding UTF8
bun test $compatibilityTests
  111/111 tests, 366 assertions

bun test apps/cli/src/__tests__/host-health.test.ts
  7/7 tests, 32 assertions (isolated retry)

bun run check:motion-text:presets
  PASS (912 classified, 912 supported, 0 pending)

bun run check:motion-text:costs
  PASS (889 supported presets)

node script/check-session-resource-boundary.mjs
  PASS (0 direct resource-acquisition violations)

node script/check-editor-singleton.mjs
  PASS (991 runtime modules, 41 command modules)

node script/probe-motion-text-stress.mjs --check
  PASS (F04=120 cues, F05=600 cues; canonical WASM hash pinned)

node script/probe-motion-text-export-matrix.mjs --check
  PASS (layout:perspective, enter:assemble, fx:mosaic, bg:noiseField,
        trans:hrBlink; canonical WASM and catalog hashes pinned)

node script/probe-motion-text-export-catalog.mjs --check
  PASS (889 entries, 1,778 frames, 889 MP4s; canonical WASM, catalog and
        exact catalog-key hashes pinned)

node script/probe-motion-text-format-matrix.mjs --check
  PASS (15 formats, 90 frames; 24/25/30/60/30000÷1001 × 16:9/9:16/1:1)

node script/probe-motion-text-full-export.mjs --check
  PASS (F05=14,400 frames, 4,322,393 bytes, 61,661.6 ms; canonical WASM and
        output hashes pinned)

bun run check:motion-text:exports
  PASS (stress + representative + 889-entry + F06 format + full F05 reports)

bun run check:motion-text:compatibility
  PASS (30 frames, regular video + text + graphic + audio, video/audio handlers)

bun test script/__tests__/motion-text-font-inventory.test.mjs \
         script/__tests__/motion-text-font-readiness.test.mjs
  13/13 tests, 57 assertions

bun test script/__tests__/validate-motion-text-installed-acceptance.test.mjs
  11/11 tests
```

Each generated probe also accepts an explicit `--write` mode, implemented by
the shared `script/probe-report-output.mjs` helper. It writes the complete
validated JSON through a same-directory temporary file and rename; `--write`
and `--check` are mutually exclusive. The reports above were regenerated with
that path after the latest canonical rebuild, then independently re-read by the
aggregate `--check` commands.

The tests inject the generated canonical cores from
`rust/wasm/pkg/opencut_wasm_sync.js`; they do not replace an installed WASM
copy. After the zh-Hans font variant was added to the catalog and the binary
was rebuilt, the canonical binary is 5,511,220 bytes with SHA-256
`14de620a1bfa38228a43e4103cc557ae7a27bbb30185bfffae91b17d685e75a8`.
The 75 Rust motion-text tests, WASM path/API/init gates, the shared F01
readiness audit (19 assets, default asset 0 missing codepoints, 1 full-coverage
asset), five-group/889-entry/F06/full-F05 export probes, the real-Chromium F01
export with frame comparison (MAE 4.8332/255) and the non-motion compatibility
export all pass on this binary. Every generated probe report was regenerated
against this identity.

Two earlier full CLI runs exposed an unrelated existing millisecond-clock edge
in `host-health.test.ts`: two authenticated requests may receive the same
`Date.now()` value, while the assertion requires the second persisted
`lastActivityAt` to be strictly greater. The test passed 7/7 in isolation and
the latest expanded full suite passed 106/106. No activity-tracking
implementation or assertion was changed as part of motion-text integration.

The post-fix repository-wide `bun test` result is 1,080 pass, 5 skip and 7
fail across 1,092 tests. The seven remaining failures are not claimed as
motion-text passes:

- one C6 provenance assertion sees stale Vite/Next emitted-artifact hashes and
  requires a permitted fresh build rather than an anchor-only edit;
- one deliberately field-dropping `third-party-adapter-variant-nonconforming`
  fixture fails port conformance;
- three pre-existing mask tests disagree with current snapping/text-canvas/path
  behavior;
- one project-persistence diagnostic test calls an unbound method whose private
  helper is therefore missing;
- one placement test supplies fractional media ticks rejected by the strict
  integer time boundary.

The earlier motion-text failures in that run (direct RAF acquisition, command
registry/count drift, missing legacy sequence default and session/export
timeouts) all pass after the fixes above.

## Open S09 gates

1. ~~Select and add a digest-pinned offline font for the 14 missing F01
   zh-Hans glyphs.~~ Closed: `noto-sans-sc-variable.ttf` is the
   `gothic_bold_zh_hans` catalog variant with its OFL notice and closure
   records; the full UI/export probe now passes with the glyph gate intact
   (MAE 4.8332/255). The installed-artifact side of this item is tracked under
   gate 2.
2. ~~With explicit dependency-sync authorization, update installed WASM through
   the normal package path and rerun the complete WASM/API/init checks.~~
   Closed: `npx --yes bun@1.2.18 install` refreshed both the root and
   `apps/web` installed copies to the canonical binary (5,511,220 bytes,
   SHA-256 `14de620a1bfa38228a43e4103cc557ae7a27bbb30185bfffae91b17d685e75a8`,
   byte-identical to `rust/wasm/pkg/opencut_wasm_bg.wasm`). `bun run
   check:wasm` passes source currency, path, API-surface (59 JS exports, 76
   stable exports plus 3 trampolines, 612 imports), Bun 1.2.18 and Node v24
   init, and the 32-step migration chain with no mock; the no-alias installed
   entry point runs the F01 UI probe at 33/33 checks (export 40,098 bytes,
   MAE 5.9230/255). Repositories pinned to this commit must install with the
   pinned Bun 1.2.18: a newer Bun prunes the workspace junction that
   `check-wasm-init` relies on.
3. ~~Update and vendor the rocut plugin from a verified upstream commit, build
   dist, and test from an installation that has no rocut or JIZURA sibling
   checkout.~~ Closed: `upstream.json` now pins
   `8246f0b9c463d32e1d807cfed18b62c7baed04a4`, `licenses/NOTICE.md` §7.1
   declares `motion-text/fonts` and OFL-1.1 with the 19-family role map, the
   Vite surface was rebuilt with `OPENCUT_PUBLIC_BASE=./`, and
   `scripts/vendor-rocut.mjs --allow-modified-tracked` packed 350 files at that
   commit with the 128 modified and 78 untracked upstream files disclosed in
   `vendor/PROVENANCE.md`. `npm run build` produced a 354-file `dist/rocut`
   (tree hash `fd68541c4c72bffcecc295e3fd2ef00c40186c2a3a3be879d762c8e8e963275c`),
   `verify:dist` and 52/52 producer tests pass, and an isolated copy under a
   parent with no `node_modules` and no sibling checkout is byte-identical to
   `dist/rocut`. That isolated install runs the full motion-text command
   family, serves `motion-text/fonts/noto-sans-sc-variable.ttf` over HTTP
   (17,772,300 bytes, magic `00010000`), and creates a zh-Hans project whose
   defaults and every cut resolve to `gothic_bold_zh_hans`.
 4. Complete final installed-artifact browser acceptance from that isolated
    install. Reopened 2026-10-01. The historical smoke runner
    `script/run-motion-text-installed-acceptance.mjs`
    executed all twelve S14 steps from the isolated copy — host ensure on a
    fresh project, F01 12-cue zh-Hans sequence at 1920×1080 with video/audio,
    preset preview, cue edit + layout lock surviving variation, timeline
    move/trim/split, undo/redo, reload/reopen, CLI read with stale-revision 409
    then reread+retry, second ja sequence with shuffled seeks (interactive
    p95 294 ms under headless SwiftShader; renderer-slice parity stays in
    s09-stress-probe.json), full 900-frame and 61-frame selected-range 1080p
    exports with A/V offset 0 frames, closed-pane export rejected while read
    succeeds, and the missing-font / old-plugin / unknown-preset diagnostics
    with recovery. The historical `acceptance.json` had 12 step records,
    16 artifacts and 2 exports for plugin 0.4.4, but does not meet final
    acceptance for the reasons recorded above. Two real install
    defects were found and fixed on the way: http-project-store
    `listAttachments` returned empty bodies after reload, and
    renderer-manager dropped audio for CLI exports without an explicit flag.

Gate 4 remains open: measure installed performance and resource release,
verify target-frame visibility over at least 30 shuffled seeks, and exercise
the actual Creator Studio entry with the final pinned plugin build.
