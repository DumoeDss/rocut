# C3 WebGPU attribution — 2026-08-04

The C3 WebGPU migration assertion was reproduced against both the C6 worktree
and an untouched `d6ed4166b5ffb13257d1924851f2fa57d73d349f` base worktree. This
is therefore not attributable to the C6 session-disposal delta.

| build | worktree | result |
| --- | --- | --- |
| `c6-vite-20260804-6` | `rocut-wt-c6` (C6 source) | capacity/handle/frame/project assertions passed; migration assertion failed because `data-migrating` remained `false` for 60s |
| `c6-base-20260804-1` | `rocut-wt-s02` (clean `d6ed4166`) | identical failure: capacity/handle/frame/project assertions passed; `data-migrating` remained `false` for 60s |

Commands (Node Playwright CLI, installed Chrome, explicit WebGPU):

```text
C3_BROWSER_BACKEND=webgpu C3_BUILD_COMMIT=c6-vite-20260804-6 C3_WEBGPU_EXECUTABLE=C:/Program Files/Google/Chrome/Application/chrome.exe C3_PREVIEW_PORT=4191 C4_VITE_OUT_DIR=dist-c6-vite-20260804-6 node ../../node_modules/@playwright/test/cli.js test --config=playwright.c3.config.ts
C3_BROWSER_BACKEND=webgpu C3_BUILD_COMMIT=c6-base-20260804-1 C3_WEBGPU_EXECUTABLE=C:/Program Files/Google/Chrome/Application/chrome.exe C3_PREVIEW_PORT=4193 C4_VITE_OUT_DIR=dist-c6-c3-base-20260804-1 node ../../node_modules/@playwright/test/cli.js test --config=playwright.c3.config.ts
```

The C6 worktree has no diff in `apps/vite-example/src/c3-session-harness.tsx`,
`apps/vite-example/tests/c3/session-capacity.pw.ts`,
`apps/web/src/project/components/migration-dialog.tsx`,
`apps/web/src/services/storage/service.ts`, or the project manager migration
implementation relative to the clean base. Machine-readable logs:

- `c6-c3-webgpu-20260804-1.log` (C6)
- `c6-c3-webgpu-base-20260804-1.log` (clean base)

The WebGL C3 control remains green (`c6-c3-webgl-20260804-1.log`).

After the final lint/refactor edits, the fresh Vite output
`dist-c6-vite-20260804-7` was exercised again: WebGL passed with the C3
configuration's required `C3_BUILD_COMMIT=missing` (`c6-c3-webgl-final-20260804-7-corrected.log`),
and installed-Chrome WebGPU reproduced the same migration-only failure
(`c6-c3-webgpu-final-20260804-7.log`). The first final-tree WebGL attempt used
`C3_BUILD_COMMIT=c6-vite-20260804-7` but correctly failed the harness marker check
because the C3 marker is not emitted by the C4-marked build; it was a marker-only
control and was not counted as a product result.
