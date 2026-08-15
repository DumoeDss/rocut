# Gate 1 — desktop substrate proven before building on it

Task 1.1–1.4. All runs self-log `REAL_EXIT_CODE:$?`; transcripts live in
`evidence/logs/gate-1-*.log`.

## 1.1 — electron exact-pinned and installed

- `apps/electron-host/package.json` (manifest only at this point):
  `electron 43.4.0` exact-pinned, plus `@playwright/test ^1.55.0` — the gate's
  own launcher needs `_electron` and this repo's `node-linker=isolated` layout
  means an undeclared dep does not resolve from `apps/electron-host`.
- Root `package.json` `trustedDependencies` gains `electron` (bun otherwise
  skips the binary postinstall entirely — the first install completed with the
  package present and no `dist/`, and the binary had to be fetched by running
  `node node_modules/electron/install.js` by hand; see below).
- `ELECTRON_CACHE=E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\.electron-cache`
  (E: drive, outside any Temp directory). `TMP`/`TEMP` were also pointed at
  `…\.electron-tmp` (E:) for the install invocations, and `ELECTRON_MIRROR`
  at the npmmirror electron mirror for the 225 MB binary download.
- Install result: **REAL_EXIT_CODE:0** — `bun install v1.2.18 … Resolved,
  downloaded and extracted [198] … 9 packages installed [5.28s]`, wasm
  preflight passed, lockfile saved. Binary present afterwards:
  `node_modules/electron/dist/electron.exe` (225,533,440 bytes).
  Transcript: `evidence/logs/gate-1-install.log` (plus
  `gate-1-electron-postinstall.log` for the manual binary fetch,
  REAL_EXIT_CODE:0).

### Durable finding: the install hang was a proxy concurrency stall

`bun install` (both system 1.2.2 and pinned 1.2.18) hung indefinitely at
`Resolving dependencies` with ~0 CPU. Diagnosis chain:

1. With every one of this change's manifest edits neutralized, `bun install
   --dry-run` still hung → not caused by this change.
2. A scratch project installed in 24 ms → bun itself healthy.
3. `--verbose` exposed the true state: `waiting for 87 tasks` — bun's pool of
   concurrent registry manifest fetches never completing.
4. All 64 of the stalled process's TCP connections ended at `127.0.0.1:7890` —
   the local proxy (`HTTP_PROXY`/`HTTPS_PROXY`). Single requests through it
   work (`bun pm view electron version` returns in seconds); a 64-connection
   burst is accepted at TCP level and then never answered.
5. `BUN_CONFIG_MAX_HTTP_REQUESTS=6` was ignored (64 sockets again).

The AV `%TEMP%` signature the dispatch warned about never materialized — TMP/
TEMP were on E: from the first attempt and the stall happened before any
download staging. Remedy that worked: `BUN_CONFIG_REGISTRY=https://registry.npmmirror.com`
with `NO_PROXY=registry.npmmirror.com,npmmirror.com` (mirror reached directly,
bypassing the concurrency-limited proxy), plus `ELECTRON_MIRROR` for the
binary. bun baked 6 mirror URLs into `bun.lock`; they were stripped back to
the default-registry form (`""`) and `bun install --dry-run --frozen-lockfile`
verified the lockfile clean in 327 ms, REAL_EXIT_CODE:0. The committed
`bun.lock` carries no machine-specific registry URLs.

## 1.2 — privileged scheme + CSP + fetch proven (standalone run)

Spike main (`apps/electron-host/spike/main.cjs`, deleted in 1.4):
`protocol.registerSchemesAsPrivileged` before app-ready with exactly
`standard, secure, supportFetchAPI, stream`; `protocol.handle("opencut", …)`
serving one HTML page (CSP response header) and one text asset; window with
`sandbox`, `contextIsolation`, `nodeIntegration: false`.

Page-reported result, relayed by main and captured in
`evidence/logs/gate-1-spike-run.log` (REAL_EXIT_CODE:0):

```json
{"origin":"opencut://spike","fetchStatus":200,"fetchText":"scheme-served asset bytes",
 "violation":{"effectiveDirective":"img-src","blockedURI":"opencut",
 "policy":"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'none'"}}
```

- Page loads from the scheme; `location.origin` is the scheme origin
  (`opencut://spike`). (`document.origin` is undefined in this Chromium —
  the first run dropped the field; `location.origin` is the correct probe.)
- `fetch()` of a scheme-served asset succeeds (supportFetchAPI works through
  `protocol.handle`): status 200, expected bytes.
- The CSP response header is observed **and enforced** by the page: the
  deliberate `img-src 'none'` probe produced a `securitypolicyviolation` event
  carrying `effectiveDirective: img-src` and the exact policy string back.

## 1.3 — `_electron.launch()` reaches the window; working launch config

`evidence/logs/gate-1-launch-check.log`, **REAL_EXIT_CODE:0**, `SPIKE PASSED`:
`firstWindow()` returned a page; `page.evaluate((v) => v + 1, 41)` → `42`; the
spike results above read back through `page.evaluate`; the only console error
is the deliberate CSP refusal.

The launch config Group 7 reuses verbatim:

```js
{
  executablePath: require("electron"), // → node_modules/electron/dist/electron.exe
  args: [mainPath, "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
}
```

**Durable finding (Windows):** `executablePath` must be the electron binary,
not `require.resolve("electron")` (the package's `index.js`). Playwright spawns
the executable directly; a `.js` path dies within 300 ms on Windows and
`_electron.launch` reports only `Process failed to launch!` (debug transcript:
`evidence/logs/gate-1-launch-debug.log`). `require("electron")` outside an
Electron process returns the binary path string — that is the correct value.

## 1.4 — spike deleted, tree back to pre-spike state

`apps/electron-host/spike/` removed. `apps/electron-host/` holds only the 1.1
manifest; tracked-tree deltas are exactly `package.json` (trustedDependencies)
and `bun.lock` — both 1.1 artifacts, not spike artifacts. Verified with
`git status --porcelain` (only ` M bun.lock` outside untracked paths) and
`ls -R apps/electron-host`.

## Incident note (review round 1, F1/F2 — added post-review)

`gate-1-launch-debug.log` was captured under `DEBUG=pw:channel`, and
Playwright's channel debug echoes the full `SEND> electron.launch` message —
including **the whole inherited process environment**. The original capture
therefore wrote live credential values (`ANTHROPIC_API_KEY#`,
`ANTHROPIC_API_KEY2`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN#`,
`ANTHROPIC_AUTH_TOKEN3`, `OPENAI_API_KEY`, `FIRECRAWL_API_KEY`) into the log
before it was committed. The committed copy is redacted to the diagnostic
content only (executablePath, args); the redaction originally landed as a
follow-up commit, which left the unredacted blob reachable in local history —
remediated by the review-round-1 history rewrite (see
`evidence/rewrite-record.md`; the first commit now carries the redacted bytes
natively). Nothing was ever pushed. **Future Electron evidence captures pass
an explicit minimal `env` to `_electron.launch`** — never the inherited one.
