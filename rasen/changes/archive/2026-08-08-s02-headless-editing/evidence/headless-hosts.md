# C7 clean headless Host evidence

Date: 2026-08-05 (Asia/Shanghai)

Both accepted artifacts were built only after their corresponding successful React-injected control. The retained envelopes are exact-entry, outgoing-dependency, emitted-chunk closures; neither is an NFT/source-map/source-list absence claim.

## Vite clean graph and browser execution

- Accepted output: `apps/vite-example/dist-c7-headless-clean-20260805-2`; entry `apps/vite-example/src/headless-entry.ts`; marker `c7-vite-headless-clean-20260805-2`; base `/c7-vite-headless-clean-2`.
- Fresh build and shared checker both exited `0`. Raw envelope SHA-256: `78b16bbe7df5a55d85974c61f8dd89569b33c6b69e29fddecf708d16f650cc7d`; build ID: `vite:c7-vite-headless-clean-20260805-2:47bef2a6df57e1c4`.
- Exact closure: `12` emitted modules / `2` files; module-set SHA-256 `f525a43f9c1b7c7d0d4a98ebd4d158af915c0bbd7919d9644992a42109c1fb76`; file-set SHA-256 `47bef2a6df57e1c440e58f3854de3be6b8b21c2dd2048d2348745115a41fa71b`; forbidden count `0`.
- The final structured checker replay exited `0` with canonical graph digest `ae270fd41477130625263ff8abe31cee3c2d747ca243a0c0de01698499200c22`, `ok=true`, `exitCode=0`, and an empty issue array.
- Raw runtime record: `evidence/raw/vite-headless-runtime-clean2-20260805.json`. Owned Vite PID/port `7460/63290`; owned Chrome PID/CDP port `48532/63291`. The semantic edit, explicit save, first disposal, genuinely new second owner, reopen, opaque-provider digest, attachment metadata/body digest, and post-dispose rejection all passed. React mount and navigation attempts were `0`; workers/audio contexts/object URLs were `0`; console errors, page errors, request failures, and HTTP errors were all empty.
- Cleanup is part of the accepted record: only the owned server/browser were stopped, both ports were released, and the temporary Chrome profile was removed.
- `dist-c7-headless-clean-20260805-1` remains a truthful superseded attempt: its graph was clean, but browser execution exposed one favicon `404`. Adding a data favicon to the dedicated HTML eliminated that only runtime error before attempt 2 was promoted.

## Next clean graph and server execution

- Accepted output: `apps/web/.next-c7-headless-clean-20260805-1`; application entry `apps/web/src/app/c7-headless/route.ts`; Webpack entrypoint `app/c7-headless/route`; marker `c7-next-headless-clean-20260805-1`; base `/c7-next-headless-clean`.
- Next `16.1.3`, explicit proof-only `next build --webpack`; build exited `0` and completed `19/19` static-generation units. The ordinary default build remains a separate Turbopack path documented in `ordinary-host-regression.md`.
- Raw envelope SHA-256: `2f5e3d8bbd21f3c2095606ef995dd6958ecaae4f5026c8759f0258e708b2e062`; build ID `next-webpack:0e4af95144cec01c`.
- Exact closure: `13` emitted modules / `3` files; module-set SHA-256 `d9408bc2d030431e957cac1b76f4e37b2ef2a43409e4d4656b15fceb37f38d04`; file-set SHA-256 `10de56ce48f21f47ea1d4bf08a393ee44bb1e63ba14523501ec7c7f61b44ace7`; forbidden count `0`.
- The final structured checker replay exited `0` with canonical graph digest `2078cdc1869b2d867dd150059abfaaa9b386174ca63dd7bbdf762efa4ee64981`, `ok=true`, `exitCode=0`, and an empty issue array.
- Raw runtime record: `evidence/raw/next-headless-runtime-20260805.json`. Owned Next PID/port `3084/60802`; request status `200` with `application/json`. The same semantic evaluator accepted an independent Next store-run identity, owners, edit/reopen values, opaque and attachment digests, terminal outcomes, zero mounts/navigation/resources, and no error list. The owned process stopped and its port was released.
- Proof-only Webpack mirrored the real app-wide wasm-bindgen output from `server/chunks/static/wasm/8258348ae71b98bc.wasm` to the server-runtime-resolved `server/static/wasm/8258348ae71b98bc.wasm`. Both are SHA-256 `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`, exactly the protected C6 binary; no stub or alternate WASM was used.

## Independent cross-Host verdict

`node script/check-headless-semantic-result.mjs --vite evidence/raw/vite-headless-runtime-clean2-20260805.json --next evidence/raw/next-headless-runtime-20260805.json` exits `0`. It requires distinct Host, build, marker, output, process, graph, and store-run identities while requiring equal deterministic semantic outcomes. The accepted Vite and Next graph digests differ, both required-root sets are complete, and neither Host result can be copied to satisfy the other.

The only product-byte edits after these runs were type-erased project-type derivation in `headless.ts`; the browser sentinel spelling and checker report schema are test/tooling changes. The proof callback was moved behind a conditional object spread without changing its proof-mode body, so ordinary configs contain no `webpack` key. Both retained emitted artifacts were rechecked byte-for-byte with the final checker after those changes.

## Authorized clean-cache reclamation

The exact generated cache `apps/web/.next-c7-headless-clean-20260805-1/cache` measured `1090257407` bytes across `9` files. None of the graph's combined output/chunk references named `cache/`. After LEAD authorization and exact containment/non-reparse checks, only that cache was deleted and verified absent; graph, referenced server/static files, manifests, and runtime files remain. The operation followed `rasen-careful` exact-target safeguards and is not recoverable from Git.

## Round-1 final post-format Host supplement

The earlier Host artifacts remain truthful but are superseded by the post-format sequence:

- Vite clean `dist-c7-r1-headless-clean-20260805-3`: `14` modules / `5` files, raw graph
  `eeda71ecf1217b0f287765333a16d78f757b60bb910ce4b2f8a39bb7810d8932`, final runtime report
  `raw/vite-headless-runtime-r1-final-20260805.json`.
- Next clean `.next-c7-r1-headless-clean-20260805-2`: `15` modules / `2` files, raw graph
  `b32ac37ff3f9c9139eafec67b730e89a23fed2ba171579bfbe39364a19b9040c`, build
  `next-webpack:c405e64dd0c5ae11`, final runtime report
  `raw/next-headless-runtime-r1-final-20260805.json`.
- The emitted and runtime-mirror WASM files both hash to the protected
  `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`.
- Both reports pass the actual pre-load probe: events `1..5`, exact same-store identity, no fallback,
  full semantic preservation, zero platform/Host/React/GPU resource observations, no errors, and
  complete owned cleanup. Their report SHA-256 values are `c607648e...` and `2cfd5148...`.
- Final independent cross-Host evaluation exits `0` and binds the two distinct raw graph identities.

See `review-round1-fixes.md` for complete digests, PIDs/ports, failure record, cache measurements,
and exact cleanup facts.
