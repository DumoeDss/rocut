# C4 strategy attempt 1 — emitted browser graph repair

- Date: 2026-08-01
- Role: review-cap strategy fixer (non-reviewer)
- Scope: `script/check-emitted-runtime-assets.mjs` plus this evidence only
- Trigger: `review-round-3.md` remained blocked after three review/fix rounds because the Next gate false-greened relative references, arbitrary WASM identity, and disconnected required layers.

## Why this is a material strategy change

The prior checker accumulated files using a Next-path regex and then asked only whether four labels appeared. This attempt replaces that model with one browser graph and one normal acceptance path:

1. Every visited HTML/CSS/JS/MJS/TS node is scanned for references appropriate to that syntax: HTML attributes, CSS `url(...)`, JavaScript runtime calls/module imports, base-root URLs, and Turbopack `static/{chunks,css,media}` references.
2. `./` and `../` references are resolved against both the referrer's public URL and its emitted filesystem directory. Query strings and fragments stay on edge evidence while the filesystem lookup uses the path component.
3. Windows containment uses `resolve()` plus `isInside()` checks. A relative reference fails explicitly when it escapes the configured public base, the `.next` output, the `.next/static` tree, or its `chunks|css|media` categories.
4. Traversal produces visited nodes and edges. Every edge records `from`, `to`, `kind`, `ref`, resolved URL, and endpoint layers.
5. The normal gate now requires reachable paths for `entry -> transcription-worker`, `entry -> editor-wasm`, and `transcription-worker -> ort-sidecar`; intermediate browser chunks are allowed.
6. A generic `.wasm` is a resource, not editor WASM. Editor WASM is recognized only by a narrow OpenCut filename or by SHA-256 equality with `rust/wasm/pkg/opencut_wasm_bg.wasm`. ORT retains a narrow `ort-wasm*.wasm` identity.
7. `acceptanceViolations()` is shared by production `runCheck()` and every Vite/Next fixture. The old fixtures that directly constructed violation objects were removed.
8. JSON inventory output now retains all visited nodes, edge kind/reference evidence, and the three topology results including concrete paths.

## Red before the graph repair

I first added reviewer-shaped controls without changing the old parser/gate. The same fixture parser plus the same then-current normal acceptance function produced this expected red test run:

```text
node script/check-emitted-runtime-assets.mjs --negative-control

PASS existing controls through mixed-next-root-escapes
FAIL relative-lazy-deleted: expected missing-reachable-next-file
FAIL relative-css-base-escape: expected relative-public-base-escape
FAIL direct-entry-ort: expected missing-runtime-topology
FAIL unrelated-editor-wasm: expected missing-emitted-layer
exit 1
```

These are the two review-3 false-green families: relative subgraphs/escapes were invisible, and label presence accepted the wrong topology plus an unrelated WASM.

## Green controls

### Connected positive

```text
node script/check-emitted-runtime-assets.mjs --positive-control
```

Result: exit 0. The fixture visited seven emitted edges and excluded the deliberately present `server/chunks/unrelated.js`. It exercised a query/hash-bearing relative lazy import and a query/hash-bearing CSS-to-media reference. Acceptance printed these required paths:

```text
entry-to-transcription-worker=static/chunks/good-entry.js -> static/chunks/transcription-worker.js
entry-to-editor-wasm=static/chunks/good-entry.js -> static/media/opencut-editor.wasm
transcription-worker-to-ort-sidecar=static/chunks/transcription-worker.js -> static/media/ort-wasm-simd-threaded.jsep.wasm
```

The positive also asserts that every retained edge has `from/to/kind/ref` and every topology item has a non-empty path.

### Fail-closed matrix

```text
node script/check-emitted-runtime-assets.mjs --negative-control
```

Result: exit 0, **23/23 controls passed**. Each child fixture itself exited non-zero with attributable `file/layer/url` evidence. Coverage:

- Vite entry, Worker, editor-WASM, and ORT root escapes;
- Next entry, Worker, editor-WASM, ORT, and mixed root escapes;
- empty and truncated graphs;
- orphan Next layers and a deleted absolute reachable Worker;
- relative lazy deletion and a first-party escape inside the reached lazy chunk;
- relative CSS media deletion;
- relative CSS traversal outside the public base, outside `.next`, and outside `.next/static`;
- entry-direct-to-ORT with no Worker-to-ORT path;
- `unrelated.wasm` in place of the actual editor WASM.

Server-only exclusion is part of the connected positive: its `ssrModuleMapping` and malicious `server/chunks/unrelated.js` remain outside the visited browser graph, while `nextInventory()` itself fails if a `server/chunks` node ever enters that graph.

## Static and source verification

All commands ran from the C4 worktree:

```text
node --check script/check-emitted-runtime-assets.mjs
bunx biome check script/check-emitted-runtime-assets.mjs
node script/check-runtime-asset-boundary.mjs
git diff --check
```

Results:

- Node syntax: exit 0.
- Biome: exit 0, no diagnostics.
- Source boundary: exit 0; 699 production modules, both Host roots, all eight required layers, all five rules PASS.
- Diff whitespace: exit 0. Git printed only existing Windows LF/CRLF conversion warnings.

## Existing output smoke check

I also ran the normal gate read-only against the currently present `apps/vite-example/dist` and `apps/web/.next`. It correctly failed: the Vite entry no longer matches its manifest digest, and the Next output has root asset/API URLs plus no reachable ORT sidecar/topology. These directories are not the retained fresh review-2 build (and were not regenerated in this restricted strategy task), so this is diagnostic evidence that the gate fails closed on stale/non-matching output, not final build evidence. A fresh Host build remains the verifier's responsibility.

## Cleanup and scope audit

- Every fixture uses `mkdtempSync()` and removes its exact temp root in `finally`.
- No `rocut-next-emitted-*` or `rocut-vite-emitted-*` directory remained under `%TEMP%` after the final run.
- No product, provenance, task, run-state, or commit file was edited by this attempt.

