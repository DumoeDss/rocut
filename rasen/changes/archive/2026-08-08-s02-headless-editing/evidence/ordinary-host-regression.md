# C7 ordinary Vite/Next Host regression

Date: 2026-08-05 (Asia/Shanghai)

These are ordinary production Host builds, separate from the C7 isolated proof builds. They retain `BrowserProjectStore`, ordinary React editor composition, runtime assets, Workers, and the C3-C6 lifecycle/resource behavior.

## Vite ordinary production build

- Output: `apps/vite-example/dist-c7-ordinary-regression-20260805-1`.
- Marker/base: `c7-vite-ordinary-regression-20260805-1` / `/c7-vite-ordinary-regression/`.
- Default `bun run build` exited `0`: `2,893` modules, `307` files, `35,041,293` bytes.
- Canonical output file-set SHA-256: `50d2ed2e6841d4f5afa35a8a0f94736dc509c4033d26b70ac411ba1f2ac43e40`.
- `check-distributable-boundary`: `2,893` modules, all ten Next/site/database/auth/content/desktop exclusions PASS.
- `check-asset-manifest`: `298` copied files / `4,481,207` bytes and `7` emitted files / `30,266,669` bytes; served MIME, bytes, SHA-256, category/graph completeness, and exclusion probes all PASS.
- Cross-Host emitted runtime gate: one Vite entry, one transcription Worker, one editor WASM, and one ORT sidecar; all are non-empty and base-contained.

### Real Chrome C6 oracle

Owned Vite PID/port: `39916/63311`. Chrome ran the ordinary, missing-CREATED, and deliberate-leak controls for six cycles each.

- Ordinary: marker exact, `BrowserProjectStore`, no audio fallback, all five resource classes CREATED and terminally released in every cycle, residual series all `[0,0,0,0,0,0]`, same editor/root across suspend/resume, fresh renderer generation/resource after resume, and real WebGPU with two compositor instances.
- Missing-CREATED: non-clean for the intended missing Worker creation rule.
- Deliberate leak: non-clean for the intended independent Worker/GPU residual; the ordinary result remains clean.
- All pages had empty unexpected console/page errors. Expected post-revocation blob fetch failures were classified separately.
- The owned server exited and port `63311` was reacquired successfully.

The first runtime setup used `bunx` without passing the build base into preview. Asset requests correctly failed as HTML fallbacks, so no oracle was run and no pass was claimed. `bunx` left exact child PID `69380` listening on `63310`; its command line named this worktree's Vite CLI, output, and exact port. Only that PID was stopped and the port was then proven free. This setup failure changed no product/output byte.

## Next ordinary production build

The final accepted ordinary output is `apps/web/.next-c7-ordinary-regression-20260805-3`.

- Command: default `bun run build`, with no `--webpack`.
- Compiler identity printed by Next: `Next.js 16.1.3 (Turbopack)`; this proves the proof-only Webpack callback is absent from the ordinary config object.
- Marker/base: `c7-next-ordinary-regression-20260805-3` / `/c7-next-ordinary-regression`.
- Build exited `0`, compiled in `20.1s`, and generated `19/19` units including `/c6-disposal`, `/c7-headless`, and `/editor/[project_id]`.
- Output: `2,614` files / `247,650,021` bytes; build ID `MfsSIdOz18ObX6sALb1af`; canonical output file-set SHA-256 `74b5aaa431e23369160821eb27a7d1178de0912900c8fbe474cf64523f2f563f`.
- Cross-Host emitted runtime gate: eleven Next entries, three transcription Workers, one editor WASM, and one ORT sidecar; all are non-empty and base-contained.
- Next's automatic `tsconfig.json` additions were removed after the build with an exact `apply_patch` restoration; `apps/web/tsconfig.json` has no diff.

Environment handling used the nine names derived from `.env.example` plus a schema-valid local-only database fixture and the public test marker. `NODE_ENV` remained controlled by Next. No environment value was printed or written to evidence. The only build warnings were the known multi-lockfile root warning and example auth-secret quality warnings.

### Real Chrome C6 oracle

Owned Next PID/port: `50108/63312`. The same three-control/eighteen-cycle oracle passed with the exact final marker.

- Ordinary: `BrowserProjectStore`, no audio fallback, all five resource residual series zero, suspend dwell quiescent, fresh renderer activity after resume, and real WebGPU/two-preview evidence.
- Missing-CREATED and deliberate Worker/GPU leak controls were non-clean for their intended named reasons.
- Unexpected console/page errors were empty. The exact Next PID stopped and port `63312` was reacquired.

Attempt 1 compiled under Turbopack but rejected the literal `.env.example` database placeholder during page-data collection; its `188,779,737`-byte generated directory was recorded then removed under the authorized failed-output policy. Attempt 2 was a complete `19/19` Turbopack build (`2,614` files / `247,650,051` bytes), but its browser page had not been compiled with the unique `NEXT_PUBLIC_C6_BUILD_MARKER`; it remains a truthful successful build but was superseded for Host-oracle evidence by attempt 3.

## Ordinary boundary result

Final ordinary gates also pass for Host composition, storage boundary/no in-memory production fallback, runtime-asset source and emitted topology, port/session-resource boundaries, session-state ownership, editor singleton ownership, and reference/license policy. Headless disposal never appears in the C6 resource ledger, while full editor sessions retain their exact CREATED/released and deliberate-leak polarities.
