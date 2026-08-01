# C4 emitted graph gate — review round 2 fix evidence

- Scope: `script/check-emitted-runtime-assets.mjs` only; no product, provenance, task, run-state, or protected-oracle edits.
- Review finding addressed: the Next checker globally selected and seeded every Worker/WASM file under `.next/static`, so orphan layers could manufacture a complete graph.
- Baseline: `507cecf456ed68007c60829be5c3c41bebf64a5d`.

## RED

Before changing the scanner, an `orphan-next-layers` real-parser control was added around the existing disconnected positive fixture. `good-entry.js` had no edge to the Worker or ORT, while both files merely existed under `.next/static`.

```text
node script/check-emitted-runtime-assets.mjs --negative-control
exit 1
...
FAIL orphan-next-layers: non-zero [missing-emitted-layer] with file/layer/url
```

The old positive control itself still exited 0 with that disconnected graph. This reproduced the round-2 Major without a hand-built `entries` array.

## Repair

- The Next manifest is parsed and only browser roots from `clientModules.*.chunks`, `entryCSSFiles`, and `entryJSFiles` are accepted. `ssrModuleMapping` and unrelated server bundles are not graph seeds.
- The only traversal seeds are those editor-route client entry/CSS references plus editor-route HTML/CSS files. The traversal follows browser references recursively within `.next/static/{chunks,css,media}` and handles HTML, CSS, JS, MJS, TypeScript Worker assets, WASM, and static media.
- Windows containment uses resolved paths plus the platform `sep`; `..` references and paths outside `.next/static` cannot enter the browser graph.
- Entry, transcription Worker, editor-WASM, and ORT classifications are produced only from existing files in the visited graph. Missing-layer validation consumes only that derived inventory. No directory-wide Worker/WASM preselection or seeding remains.
- Reachable missing files fail with `missing-reachable-next-file`. Orphan required layers remain unvisited and therefore fail with attributable `missing-emitted-layer` findings.
- Root-escape attribution resolves the referenced target back to its visited classification, so a hashed Worker URL is reported as `transcription-worker`, an editor WASM URL as `editor-wasm`, and a Worker-to-ORT URL as `ort-sidecar`.
- Retained inventory now records the traversed `from`, `to`, `fromLayer`, `toLayer`, and reference for every Next browser edge, in addition to the classified file hashes.

## GREEN

### Real-parser positive

```text
node script/check-emitted-runtime-assets.mjs --positive-control
exit 0
fixture graph clean:
  static/chunks/good-entry.js -> static/media/opencut-editor.wasm
  static/chunks/good-entry.js -> static/chunks/transcription-worker.js
  static/chunks/transcription-worker.js -> static/media/ort-wasm-simd-threaded.jsep.wasm
  server/chunks/unrelated.js excluded
```

The unrelated server bundle deliberately contains first-party root URLs and Worker-like text. The positive can pass only if that bundle remains outside the browser graph and scanner.

### Real-parser negatives

```text
node script/check-emitted-runtime-assets.mjs --negative-control
exit 0 — 14/14 controls PASS
```

The parser-backed cases prove:

- disconnected/orphan Worker and ORT files fail as missing layers;
- deleting the Worker referenced by the entry fails as a missing reachable file;
- entry, Worker, editor-WASM, and ORT root escapes each fail with their target layer and source file;
- manifest, route HTML/CSS, and recursively reached lazy-chunk root escapes remain covered;
- empty and truncated graph controls continue to fail closed.

### Source boundary and static checks

```text
node script/check-runtime-asset-boundary.mjs
exit 0 — 699 production modules; 5/5 rules PASS

node script/check-runtime-asset-boundary.mjs --negative-control
exit 0 — 6/6 controls PASS

node --check script/check-emitted-runtime-assets.mjs
exit 0

bunx biome check script/check-emitted-runtime-assets.mjs
exit 0

git diff --check
exit 0
```

All `rocut-next-emitted-*` synthetic directories were removed by the fixture `finally` cleanup; none remained after verification. Heavy Vite/Next rebuilds and browser runs were intentionally left to the review/ship integration gate.
