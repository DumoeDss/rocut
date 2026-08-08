# C6 browser disposal oracle — 2026-08-04

The same Playwright driver (`script/run-c6-browser-oracle.mjs`) was run against
fresh production builds of both host compositions. Each page ran six sequential
cycles through `runDisposalCycles` and serialized the complete
`DisposalCycleObservation` records.

| host | build marker | ordinary result | C5 proof | audio fallback | browser errors |
| --- | --- | --- | --- | --- | --- |
| Vite preview `:4207` | `c6-vite-20260804-7` | `clean: true` | `BrowserProjectStore` | `false` | none |
| Next start `:4209/c6-disposal` | `c6-next-20260804-5` | `clean: true` | `BrowserProjectStore` | `false` | none |

Ordinary run (both hosts, all six cycles):

```text
created/released per cycle:
  timer        1/1, 1/1, 1/1, 1/1, 1/1, 1/1
  worker       1/1, 1/1, 1/1, 1/1, 1/1, 1/1
  audioContext 1/1, 1/1, 1/1, 1/1, 1/1, 1/1
  objectUrl    1/1, 1/1, 1/1, 1/1, 1/1, 1/1
  gpuResource  1/1, 1/1, 1/1, 1/1, 1/1, 1/1
residualSeries:
  timer        [0, 0, 0, 0, 0, 0]
  worker       [0, 0, 0, 0, 0, 0]
  audioContext [0, 0, 0, 0, 0, 0]
  objectUrl    [0, 0, 0, 0, 0, 0]
  gpuResource  [0, 0, 0, 0, 0, 0]
platform terminal/residual: true/0 for every class in every cycle
runtime evidence per cycle: selectedBackend `webgl`, concurrentCompositorInstances `1`,
compositorHandle `1`, liveHandlesBeforeDispose `[1]`, liveHandlesAfterDispose `[]`,
disposeError `null`
```

The controls use the same evaluator, not a separate assertion:

```text
control=missing-created
  worker beforeDispose.created: [0, 0, 0, 0, 0, 0]
  evaluator clean: false
  six failures: "worker was not CREATED before disposal."

control=leak
  all five classes still report 1/1 each cycle; the real compositor is released in
  cycles 1–5 and intentionally retained in cycle 6
  gpuResource residualSeries: [0, 0, 0, 0, 0, 1]
  evaluator clean: false
  failures: one platform-residual failure + monotonic-growth failure
```

Evidence logs:

- [Vite build](c6-vite-build-20260804-7.log)
- [Vite browser JSONL](c6-vite-browser-oracle-20260804-7-ordinary.jsonl) (all three controls are emitted by one driver invocation)
- [Next build](c6-next-build-20260804-5.log)
- [Next browser JSONL](c6-next-browser-oracle-20260804-5.jsonl)

The final-tree Vite preview listener was PID `63572` on port `4207`; the final-tree
Next listener was PID `17964` on port `4209`. Each PID was verified against its exact
command line, stopped after capture, and a final listener check showed both ports
free. The Next page is the dedicated `/c6-disposal` route; the Vite page
uses the query harness entry. The machine-readable runner was executed with
Node (Bun's Playwright launch path timed out before page creation on this host).

The earlier `:4179`/`:4189` captures remain in the evidence directory as
superseded intermediate artifacts; this table and the linked logs identify the
only browser evidence for the final refactor/build tree.

## Scope note

The browser pages use the real C5 Vite/Next Host factories and their shared
`BrowserProjectStore`; browser Worker, AudioContext, and object-URL construction
run through the Host runtime ports. Every cycle calls
`prepareWasmRuntimeProviders`, creates and renders a real C0b WASM compositor,
records the runtime-selected backend and exact live handle, then disposes it. The
leak control wraps only the runtime release call in cycle 6 to prove the residual
gate while preserving five clean real-compositor cycles. No C7 headless evaluator
or direct platform-constructor path was used.
