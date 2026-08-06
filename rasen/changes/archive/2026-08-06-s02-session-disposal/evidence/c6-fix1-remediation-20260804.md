# C6 accepted-finding remediation ledger (2026-08-04)

This ledger records only fix-round work executed after the first Luna-max review. It does not
replace the review or evaluation artifacts.

| Finding | Fix and fresh GREEN evidence | RED / polarity evidence |
| --- | --- | --- |
| B1 RendererManager type boundary | `renderer-manager.ts` now declares typed `editor` and `assetResolver`; fresh `bunx tsc --noEmit -p apps/vite-example/tsconfig.json` and pinned type baseline pass (`c6-fix1-green-vite-typecheck-20260804-1.log`, `c6-fix1-green-type-baseline-20260804-1.log`). | Captured RED before the field declarations: `c6-fix1-b1-red-vite-typecheck-20260804.log` (exit 2). |
| B2 resource-boundary coverage | Scanner inventories 711 source modules across all required roots and the fresh Vite graph (2,889 modules); all five rules are zero violations. The five rule fixtures and every required-root omission control are caught (`c6-fix1-vite-boundary-emitted-20260804-1.log`, `c6-fix1-boundary-negative-20260804-1.log`, `c6-fix1-boundary-unit-20260804-1.log`). | The negative controls are intentionally violating fixtures and exit nonzero if the checker becomes false-green. Historical pre-fix direct-acquisition output was not regenerated; no stale output is presented as fresh RED. |
| B3 cache/preview ownership | Video and waveform caches are per-session; effect preview is a final-owner lease; runtime ownership tests pass in `c6-fix1-focused-tests-20260804-1.log`. Browser ordinary cycles show zero independent cache/platform residual and `gpuTerminal=true`. | Deliberate browser leak control is non-clean at cycle 6 with independent Worker residual and GPU `liveHandles()` residual (the same JSONL captures), proving attempted-release counters cannot make it green. |
| B4 transcription ownership | Core owns one session transcription service, terminates it on suspend/dispose, and generation-guards callbacks. Transcription/session focused tests pass; browser lifecycle fields prove root/project/editor identity across suspend/resume. | The missing-created control is non-clean and names the missing Worker creation; ordinary controls require an actual Worker message before disposal. |
| B5 browser/platform proof | Real BrowserRuntime ports are used (no audio fallback); fixture Worker message/listener, AudioContext `running -> closed`, object URL fetch-before/revoke-after, timer callback terminality, and compositor live-handle probes are serialized in both Vite and Next JSONL. | Missing-created and deliberate-leak controls are required to be non-clean; runner exits nonzero on polarity failure. Intentional revoked-blob fetch failures are recorded separately as `expectedRevocationFailures`, not treated as unrelated console errors. |
| M1 WASM shared lease | Final-owner release retries failed GPU disposal, preserves owner counts on failure, serializes concurrent final release, and permits reinitialization. Runtime ownership tests pass; ordinary browser GPU handles drain to `[]`. | Deliberate GPU leak control reports a non-clean residual and a failed final runtime release (`liveHandlesAfterDispose:[1]`), while ordinary is clean. |

## Fresh commands and artifacts

- Vite build marker `c6-fix1-vite-20260804-3`, output `apps/vite-example/dist-c6-fix1-vite-20260804-3/`,
  browser gate `c6-fix1-vite-browser-oracle-20260804-4.jsonl`.
- Next build marker `c6-fix1-next-20260804-2`, browser gate
  `c6-fix1-next-browser-oracle-20260804-2.jsonl`; build `c6-fix1-next-build-20260804-2.log`.
- Focused tests: 13 pass / 0 fail / 45 expectations (`c6-fix1-focused-tests-20260804-1.log`).
- Source and emitted boundary scanner plus all negative controls pass (`c6-fix1-vite-boundary-emitted-20260804-1.log`,
  `c6-fix1-boundary-negative-20260804-1.log`).

The fresh controls also close tasks 4.5, 10.2, and 10.5. Independent artifact review, complete
race matrices, exclusion proof, model evaluation, ship, integration, spec-sync, and archive remain
separate open workflow leaves.
