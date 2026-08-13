# Static-checker family regression — task 4.4

Fixes MAJOR-3 (review round 1): task 4.4 said "re-run the existing static checkers that need no
build and confirm all remain green" and the commit message reported "19 green," but no enumeration
was recorded — the reviewer independently counted 26 `script/check-*.mjs` files (25 pre-existing
plus this change's own `check-package-boundary.mjs`) and could not tell which 19 of the 25 the
claim referred to, nor confirm several don't need a build step first. Recorded now: every one of
the 25 pre-existing checkers was invoked directly (`node script/check-<name>.mjs`, no arguments,
no server started) and its exit code and tail output captured. Run 2026-08-13 on
`feat/s05-community-beta`, from repo root.

**Correction to the commit-message claim**: the true count of pre-existing checkers that run clean
today with a bare invocation and no extra setup is **22**, not 19 — this evidence file supersedes
that number rather than trying to reconstruct which 19 the original claim meant. 3 of the 25 cannot
run standalone at all (not merely "need a build" — two need artifacts from an actual headless
capture run, one needs a live server); those 3 are excluded from the regression count below and
listed separately with the specific reason each was excluded.

## 22 green (exit 0, bare invocation, no build/server/session needed beyond what's already on disk)

| checker | result |
|---|---|
| `check-agent-evidence.mjs` | `PASS` both Hosts executed one identical declared plan |
| `check-distributable-boundary.mjs` | `PASS no-content-collections`, `PASS no-desktop-app` |
| `check-editor-singleton.mjs` | `PASS explicit-session-only` |
| `check-emitted-runtime-assets.mjs` | `PASS dynamic-root-flags`, `PASS direct-platform-worker`, clean |
| `check-host-composition.mjs` | 3/3 rules `PASS` |
| `check-next-imports.mjs` | clean |
| `check-port-boundary.mjs` | 4/4 rules `PASS` |
| `check-react-singleton.mjs` | clean |
| `check-reference-boundary.mjs` | 3/3 rules `PASS` |
| `check-runtime-asset-boundary.mjs` | 5/5 rules `PASS` |
| `check-session-resource-boundary.mjs` | 4/4 rules `PASS` |
| `check-session-state-boundary.mjs` | `PASS 10/10 factories, 10/10 registry keys` |
| `check-storage-boundary.mjs` | 4/4 rules `PASS` |
| `check-surface-boundary.mjs` | 4/4 rules `PASS` |
| `check-surface-css-boundary.mjs` | clean |
| `check-surface-portal-boundary.mjs` | clean |
| `check-surface-private-drag.mjs` | clean |
| `check-transaction-boundary.mjs` | 4/4 rules `PASS` |
| `check-type-baseline.mjs` | `PASS no diagnostic outside the pinned baseline set` |
| `check-wasm-api-surface.mjs` | `PASS` exact export/import counts |
| `check-wasm-paths.mjs` | 4/4 checks `PASS` |
| `check-wasm-source.mjs` | 4/4 checks `PASS` |

All 22 exit `0`. Two of the 22 (`check-emitted-runtime-assets.mjs`, `check-runtime-asset-boundary.mjs`)
read from `apps/vite-example/dist` and `apps/web/.next`, which happen to already exist on disk from
a prior build — this run performed no build step itself; it only confirms both checkers still pass
against whatever is currently built. `check-type-baseline.mjs` reports two benign baseline shrinks
(`v1-to-v2.ts` and `stickers/providers/index.ts`, both `TS2554` diagnostics that dropped to 0) —
the checker itself calls this "not a failure," and it is unrelated to this change's package-boundary
work (no `.ts` files under `services/storage/migrations` or `stickers/providers` were touched).

## 3 excluded — cannot run standalone, not simply "need a build"

| checker | why excluded |
|---|---|
| `check-asset-manifest.mjs` | fetches `http://127.0.0.1:4173/` — needs a **live preview server** serving the built `apps/vite-example/dist`, not just the dist directory on disk. Exit `2`, `no preview server at http://127.0.0.1:4173/ — fetch failed`. |
| `check-headless-graph.mjs` | requires `--envelope --host --producer --entry --marker --head --tree` CLI arguments pointing to the output of an actual headless browser capture run. Exit `2`, usage error with no arguments. |
| `check-headless-semantic-result.mjs` | requires `--vite <report.json> --next <report.json>` — the same class of headless-capture-run output. Exit `2`, usage error with no arguments. |

None of the 3 relate to package boundaries; none were plausibly exercised by this change either way.

## `no-desktop-app` unmodified

```
$ git status --porcelain -- script/check-distributable-boundary.mjs
(no output)
```

Confirms the file this change never touched carries `no-desktop-app` exactly as committed —
`git diff --name-only` for this change's fix delta lists only `script/check-package-boundary.mjs`.

## Reading

22/22 of the checkers that can run standalone stayed green; the 3 that could not run standalone
were excluded for stated, specific reasons rather than silently dropped, and none of the 3 bear on
package boundaries. This change's own commit message will be corrected to say "22 of 25
pre-existing static checkers ran clean standalone; the remaining 3 need a live preview server or
headless-capture-run artifacts this task does not produce" rather than repeat the unverified "19."
