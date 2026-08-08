# C6 Phase 1 baseline / first RED

Worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`

## Frozen identity

- HEAD: `d6ed4166b5ffb13257d1924851f2fa57d73d349f`
- tree: `3875074383b41f622e5f32942091468cf8959b61`
- C5 product commit reachable: `0bfcf0457385b55de815c75ec712e9b9d69da242`
- `git status --short`: empty before implementation.
- `bun run check:wasm`: exit 0; self-built source/path/API gates clean.

## Protected identities (before edits)

| Path | Identity |
| --- | --- |
| `apps/web/src/editor/ports` tree | `efe499db6bec7afb8c35ac1a2aaa5fe851fac667` |
| `apps/web/src/editor/session/session-types.ts` blob | `c67d9822a2a6c994be14f367e6980fbbaa6e454b` |
| `apps/vite-example/tests/parity` tree | `e1fbb55b985f4fb490c6b233d18c50c58ea14c28` |
| `script/fixtures/type-baseline.json` blob | `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8` |
| type fixture SHA-256 | `0f7cc855fc8f5c7edd68b2c371bae993fe8e713d2ffd4ef21956de72bd387622` |
| `rust/wasm` tree | `d782b046c0f39e85b8a5ed518b42389214c211e5` |
| `rust/crates/gpu` tree | `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2` |
| `rust/crates/compositor` tree | `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34` |
| generated `opencut_wasm.js` SHA-256 | `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1` |
| generated `opencut_wasm_bg.wasm` SHA-256 | `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1` |

## Inherited gates

- `bun test`: exit 1, **330 pass / 8 fail / 2 errors / 1,058 expect calls**, 338 tests across 64 files. The eight failures are the inherited `resolveTrackPlacement` / `ZERO_MEDIA_TIME` placement identities; errors include the inherited `wasm.__wbindgen_start` and `DEFAULTS` loader identities.
- `bun run build:web`: exit 1 after successful compilation/content-collections generation; page-data collection fails on missing inherited environment variables (`NEXT_PUBLIC_MARBLE_API_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, Upstash/Marble/Freesound values). No product source was edited by the build.
- `node script/check-type-baseline.mjs` after build generation: exit 0, exactly 3 diagnostic identities (the pinned baseline); initial pre-generation run was non-evidentiary (11 diagnostics caused by missing `.content-collections/generated`).

## Initial RED / scope

The current implementation is RED for C6's intended behavior: `createSessionResources().disposeAll()` is synchronous and increments `released` before asynchronous audio close settles; `createEditorSession` has no serialized suspend/resume transition tail; and `prepareWasmRuntimeProviders()` frees per-session wrappers without a process-level final-owner `disposeGpu()` lease. These are the first implementation-owned REDs; no protected path drift was observed.
