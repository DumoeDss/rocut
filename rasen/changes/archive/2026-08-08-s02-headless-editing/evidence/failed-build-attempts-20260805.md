# C7 failed generated-build attempts and authorized reclamation

Date: 2026-08-05 (Asia/Shanghai)

These paths are generated C7 outputs created by the C7 Sol implementer. They are not authored source, tests, accepted clean artifacts, or another worktree's output. LEAD authorized their removal after this record was written because each attempt is rebuildable and failed before acceptance. Every deletion target is an explicit absolute path under `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7`; no glob, junction, parent directory, C6 output, or other worktree is in scope.

| Exact resolved path | Bytes / files | Attempt result | Retained evidence before removal |
| --- | ---: | --- | --- |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\vite-example\dist-c7-headless-react-control-20260805-1` | 207,512 / 4 | Invalid Vite React-control attempt: the first producer traversal omitted non-emitted connector modules, so the ordinary checker rejected missing persistence coordinator, project codec, and opaque overlay roots. | Graph SHA-256 `af713c90003796b9dbeffd74b426e6cd4e9938ea8233ac8c8326b6089ebdc5dd`; exact checker signature recorded in this row. The valid Vite control attempt 2 and accepted clean artifact remain untouched. |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\web\.next-c7-headless-react-control-20260805-1` | 1,086,695 / 8 | Invalid Next control: the first collector sampled the exact route source before resolving its emitted entry ownership and failed `C7 Next headless entry is not assigned to emitted output`. | No graph was emitted. Failure signature and size retained here. |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\web\.next-c7-headless-react-control-20260805-2` | 1,086,623 / 8 | Invalid Next control: incoming-owner fallback still sampled before usable emitted file attribution and failed the same exact-entry emission check. | No graph was emitted. Failure signature and size retained here. |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\web\.next-c7-headless-react-control-20260805-3` | 1,086,687 / 8 | Invalid Next control: exact webpack entrypoint was found, but `afterChunks` precedes generated filenames; the producer correctly failed closed rather than claim emission. | No graph was emitted. Failure signature and size retained here. |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\web\.next-c7-headless-react-control-20260805-4` | 503,869,923 / 124 | Invalid Next control: moving collection to `afterEmit` removed the attribution false negative, then explicit Webpack compilation failed on the unrelated generated `opencut_wasm_bg.wasm` because Webpack 5 WASM was not enabled. | Partial graph SHA-256 `34a9b60e193ae8cbcde424bb179d216f82ac0faaca42f14df5958e289ea56cea`; build failure named the exact WASM module and import trace. |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\web\.next-c7-headless-react-control-20260805-5` | 1,156,674,145 / 288 | Invalid Next control: proof-only async WASM allowed compilation and exact graph emission, but prerender failed on `/c6-disposal` because runtime sought `server/static/wasm/8258348ae71b98bc.wasm` while the asset was emitted under `server/chunks/static/wasm`. A proof-only output-filename correction was prepared for the next fresh attempt. | Graph SHA-256 `bd9d692124fb05f884d0635bee7249f68491d85d0744fb46fc6c58ec91eb4bfd`; build ID `next-webpack:4cb9fe10871babbc`; 16 modules / 26 files; module-set SHA-256 `60ace37d7bf9883b183c2f353771db5889ad3948a8e0ed23a7d09709430eb507`; file-set SHA-256 `710d46b5692b5833706c06c02f588a3b89bd5d5075934de96056e739cdca11e5`. The ordinary checker reached and named `apps/web/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react.js` with retained raw request `react`, and the injected `headless-proof-control-react.ts`; because the build later failed, this is diagnostic sensitivity only, not accepted negative-control evidence. |
| `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\web\.next-c7-baseline-20260805` | 188,523,494 / 653 | Invalid first ordinary Next baseline setup attempt; environment loading was malformed, so it was never promoted as baseline evidence. | The successful independent baseline remains at `.next-c7-baseline-20260805-attempt2`; this failed directory contains no C7 graph. |

Free bytes before deletion: `761368576`. Total measured removable payload: `1852535079` bytes across `1093` files.

Deletion result: all seven exact paths were removed and verified absent. Free bytes afterward: `2614145024`, an observed increase of `1852776448` bytes (filesystem allocation differs slightly from the summed logical file lengths). These generated failed outputs are not recoverable from Git, but every one is reproducible from the recorded marker/mode and none was an accepted artifact. Authored source/tests/evidence, Vite control attempt 2, the accepted Vite clean artifact, and the successful ordinary baseline artifacts remain present.

## Subsequent failed attempt

`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\web\.next-c7-headless-react-control-20260805-6` was the first fresh run after setting the server WebAssembly filename to `../static/wasm/[modulehash].wasm`. It compiled, emitted its attributable graph, and then failed while prerendering `/blog`: the generated runtime sought `.next-c7-headless-react-control-20260805-6\static\wasm\8258348ae71b98bc.wasm`, while compilation emitted the identical bytes at `server\static\wasm\8258348ae71b98bc.wasm`. Generated runtime inspection established the cause: Next places the server webpack runtime one directory above the server compiler's chunk output path, so one filename template is interpreted against different bases for emission and loading. The implementation will mirror the real emitted bytes to the runtime-resolved location in proof-only mode; it will not stub or replace WASM.

- Exact size: `1156521573` bytes / `288` files.
- Graph SHA-256: `6762204db59e35b213b2befea2220759df1f773ce8648cc97e7229ed6809c787`.
- Build ID: `next-webpack:3524230a47b43e49`; modules/files: `16` / `26`.
- Module-set SHA-256: `60ace37d7bf9883b183c2f353771db5889ad3948a8e0ed23a7d09709430eb507`.
- File-set SHA-256: `fae1baf79751d93f6047ee256596e752ad2717d1771a0663317f2381513e46cb`.
- Acceptance: invalid because the build exited nonzero after graph emission; it is diagnostic only.

LEAD's authorization covers later generated C7 failed-attempt directories under the same exact-path safeguards. This path was validated as a non-reparse-point directory directly under the C7 worktree's `apps\web` directory, deleted, and verified absent after the record above was written. It is rebuildable and not recoverable from Git.

## Ordinary Next environment-fixture failure

`E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7\apps\web\.next-c7-ordinary-regression-20260805-1` was the first post-change ordinary Next regression attempt. The exact default command selected `Next.js 16.1.3 (Turbopack)` and compiled successfully in `17.8s`, proving that the ordinary configuration no longer advertises the C7 proof-only Webpack callback. Page-data collection then rejected the literal `.env.example` `DATABASE_URL` placeholder because it is not a `postgres://` or `postgresql://` URL. This is an invalid test-fixture value rather than an implementation failure; no environment value was printed or retained.

- Exact size before deletion: `188779737` bytes / `668` files.
- Acceptance: invalid because the build exited nonzero during page-data collection; it is diagnostic only.
- Correction: rerun the same default command in a fresh output directory with schema-valid, non-secret test values for all nine documented variables. `NODE_ENV` remains controlled by Next.

The existing LEAD authorization for generated C7 failed-attempt directories applies. After this record was written, the exact path was validated as a non-reparse-point directory directly below the C7 worktree's `apps\web` directory, deleted, and verified absent. The generated output is rebuildable and is not recoverable from Git.
