# s05-second-host — implementation report

Implementer: `implementer-s05-p2`. Change: `s05-second-host` (P2 of the S05
`community-beta-second-host` portfolio), branch `feat/s05-community-beta`, local
commits only. Written as groups complete; oracle verdicts and exit codes live in
the named evidence files beside this one.

## Environment rulings made before any Host source existed

- **Registry concurrency stall (durable finding).** `bun install` on this
  machine hung indefinitely at `Resolving dependencies` with ~0 CPU. `--verbose`
  showed the true state: `waiting for 87 tasks` — bun's pool of concurrent
  registry manifest fetches never completing. Single registry requests complete
  fine (`bun pm view electron version` returns in seconds); only the concurrent
  burst stalls. This is a network throttling signature, not a tooling bug and
  not the AV `%TEMP%` signature the dispatch warned about (TMP/TEMP were already
  redirected to an E: drive before the first attempt; the stall happened before
  any download staging began). The bisect evidence: with all of this change's
  manifest edits neutralized, `bun install --dry-run` still hung; a scratch
  project installed in 24 ms; `--frozen-lockfile --dry-run` also hung (bun
  re-resolves subtrees affected by any manifest delta, enqueueing 87 manifest
  downloads). Remedy: `BUN_CONFIG_MAX_HTTP_REQUESTS=6` on the install
  invocation. Transcript: `evidence/logs/gate-1-install.log` and
  `evidence/logs/gate-1-diagnostic-dryrun.txt`.
- **Type-baseline is red at the live baseline — pre-existing, named cause.**
  `script/check-type-baseline.mjs` exits 1 at branch HEAD before any of this
  change's edits, failing on exactly two diagnostics:
  `packages/editor-classic/src/timeline/__tests__/update-pipeline.test.ts:69` and
  `.../placement/__tests__/resolve.test.ts:646` (TS2769, number vs MediaTime).
  Cause: commit `c234042e` (S05-P1 "extract Stage C") moved both files out of
  `apps/web/src/timeline/...` into `packages/editor-classic`, shifting their
  pinned path keys: the pin (cf5e79e9) knows these diagnostics under their old
  `src/...` keys, so they register as "not present at the pin". Red has been the
  state of this checker on this branch since that commit. This change's duty
  (tasks 3.6 / 9.3) is that the checker is **unchanged** from the 2.1 baseline
  capture — which stays a byte-identical comparison whether green or red.
  Baseline capture: `evidence/census/baseline-type-baseline.txt`
  (REAL_EXIT_CODE:1 recorded).

## Group 1 — gate: prove the desktop substrate

In progress. Install transcript with REAL_EXIT_CODE: `evidence/logs/gate-1-install.log`.

## Group 2 — oracle first: boundary checker sees a third consumer

**2.1 — baseline census** captured before any checker edit or Host source
(2026-08-15):

| measure | value |
| --- | --- |
| repo files scanned (no-elftia-import) | 1051 |
| acyclic-direction files / edges | 964 / 329 |
| public-entry-only files / specifiers | 964 / 328 |
| no-internal-reexport files | 863 |
| react-free-base files | 68 |
| negative control | clean, REAL_EXIT_CODE 0 |
| converse control | clean, REAL_EXIT_CODE 0 |
| type-baseline | RED, pre-existing (see above) |

Transcripts: `evidence/census/baseline-*.txt`.

Note: 1051/964/329/328/863 match the P1-close figures the handoff recorded; the
handoff's no-elftia figure (1048) has drifted +3 with unrelated tree growth —
recaptured live here, as the design's Context section instructed.

**2.2 — consumer-root derivation.** `boundary.json`'s `consumers` are now
objects `{ id, root, ownership? }`; `electron-host` is declared with root
`apps/electron-host/src`. In `script/check-package-boundary.mjs` every literal
consumer-root prefix was replaced by derivation from the declared list:
`consumerEntries` / `consumerIds` / `consumerRootEntryOf` (longest-root-wins)
/ `isUnderConsumerRoot` drive `ownerOfPath` (an `ownership: "map"` consumer
keeps map resolution — web's arrangement unchanged; otherwise the consumer id
owns its root outright), `layerIndex` (a consumer sits above every package
layer), `acyclicDirectionRule`'s scope / resolved-target filter /
consumer↔consumer exclusion, `reactFreeBaseRule`'s scope and resolved-target
check, `packageAndConsumerSourceFiles` (threaded through
`publicEntryOnlyRule` and `scan()`), `guardSelfConsistency`, and
`guardUnownedFiles` (every declared consumer root's `.ts`/`.tsx` files must
resolve to an owner; a directly-owned root never produces an unowned file, so
the guard's bite is web-unchanged and new-consumer-neutral). The two control
fixtures' boundaries (`FOURTH_PACKAGE_BOUNDARY`, `RENAMED_DIR_BOUNDARY`)
spread `FIXTURE_BOUNDARY` and override only `layers`, so they inherit the
object form automatically.

**2.3 — byte-identity control, before any Host source exists.** Captured on
the same tree immediately before the first checker edit
(`evidence/census/control-pre-edit.txt`, 1049 files — the 2.1 baseline minus
the two deleted gate-1 spike files, the only tree delta between the two
captures) and immediately after the last edit
(`control-post-edit.txt`): `diff` exit 0 — **byte-identical**, and both
controls clean (`control-negative-post-edit.txt`, `control-converse-post-edit.txt`,
REAL_EXIT_CODE 0 each). A declared consumer holding no files changed nothing
observable; the derivation is behaviour-preserving.

**2.4 — electron fixture cases.** `FIXTURE_BOUNDARY` consumers became the
three objects (web map-owned; vite-example and electron-host direct). New
negative case: `apps/electron-host/src/violation11.ts` deep-importing
`@opencut/editor-ports/internal/secret` — `public-entry-only` **caught**. New
converse case: `apps/electron-host/src/consumer-ok.ts` importing the declared
`@opencut/editor-ports/host` — **silent**. Both controls re-run clean
(`control-negative-with-electron.txt`, `control-converse-with-electron.txt`,
REAL_EXIT_CODE 0 each), and the live checker re-diffed byte-identical after
the fixture additions (fixtures are in-memory control-mode data; the live
path never touches them).

## Group 3 — the Host skeleton: a Vite renderer that boots the real editor

**3.1 — manifest + Vite config.** `apps/electron-host/package.json` extends the
1.1 manifest with `react`/`react-dom` 18.3.1, `next-themes ^0.4.4`
(apps/web's pin), `@opencut/editor-classic` + `@opencut/editor-ports`
workspace deps, and the build toolchain (`vite ^7`,
`@vitejs/plugin-react`, `vite-plugin-wasm`, `vite-plugin-top-level-await`,
`@tailwindcss/postcss`/`postcss`/`tailwindcss`, `typescript ^5.8.3`,
`@types/react{,-dom}`, `@types/bun`) plus `typecheck`/`build`/`start` scripts
— everything the app imports is declared, no hoisting-by-accident.
`vite.config.ts`: `react()`, `wasm()`, `topLevelAwait()`, `target: "esnext"`,
`dedupe: ["react","react-dom"]`, `publicDir: false`, and the `editorAssets` +
`moduleGraph` plugins imported from `../vite-example/build/` (single-source
allowlist, design E5 — the cross-app build-tool import the design itself
prescribes). Stylesheet mirrors the Vite example's (`@source` over the package
tree and the app; same repo depth, same relative paths). tsconfig mirrors the
Vite example's (`types: ["vite/client","bun"]`, package ambient types only).

**3.2 — renderer skeleton.** `src/app.tsx` (picker recording `?project=<id>`,
error boundary, `EditorSessionHost`-wrapped editor, no harness dispatches
yet), `src/project-picker.tsx`, `src/editor-error-boundary.tsx`,
`src/host/electron-editor-host.tsx`, and the composition root
`src/host/electron-host-config.ts`. One real defect was found and fixed while
proving 3.3: "final-overrides nothing" cannot mean "per-call reference
roles" — `createInMemoryPorts()` mints a fresh store per host object, so the
editor branch mounted against a store that never saw the project the picker
created and the timeline never appeared. The vite config's own shape is the
answer: module-lifetime `InMemoryProjectStore` /
`DeterministicIdGenerator` / `RecordingDiagnostics` instances, final-overridden
exactly as `vite-host-config.ts` overrides with its browser store. The
Group-4 store swap replaces one of these named overrides.

**3.3 — real main + preload + boot proof.** `electron/main.cjs`: privileged
scheme registered before app-ready (`standard/secure/supportFetchAPI/stream`),
`protocol.handle` mapping `opencut://app/<path>` onto `dist/` with traversal
guard, MIME map, CSP response header, `--opencut-entry=<name>`/`OPENCUT_ENTRY`
entry selection (validated name), 1440×900 window with `contextIsolation` +
`sandbox` on and `nodeIntegration` off; `electron/preload.cjs` deliberately
exposes nothing. A first-run CSP bug (stray trailing quotes in four
`blob:`/`data:` tokens made Chromium drop four directives — caught by the
proof's own console-error gate) was fixed before the clean run.

Boot proof (`scripts/boot-proof.mjs`, gate-1 launch config verbatim):
**BOOT PROOF PASSED, REAL_EXIT_CODE:0** — origin `opencut://app`;
`?project=3e57f193-…` recorded through the picker; main track + timecode
visible; the first-run onboarding dialog dismissed and reported; **0 CSP
violations, 0 console errors**. Screenshot:
`evidence/screenshots/group-3-boot-proof.png`; transcript:
`evidence/logs/group-3-boot-proof.log` (+ `group-3-build.log` for the build,
exit 0, 298 runtime assets / 3789 modules emitted).

**3.4 — census reconciliation** (baseline → post-source, both in
`evidence/census/`):

| measure | baseline | post-source | delta | reconciles as |
| --- | --- | --- | --- | --- |
| repo files scanned | 1049 | 1063 | +14 | 6 src ts/tsx + index.html + vite.config.ts + package.json + tsconfig.json + postcss.config.mjs + scripts/boot-proof.mjs + electron/main.cjs + preload.cjs = 14 |
| acyclic-direction files / edges | 964 / 329 | 970 / 339 | +6 / +10 | the 6 src files / their 10 `@opencut/*` imports |
| public-entry-only files / specifiers | 964 / 328 | 970 / 338 | +6 / +10 | app.tsx 4 + picker 2 + editor-host 2 + host-config 2 = 10 |
| no-internal-reexport | 863 | 863 | 0 | packages-only rule; the app owns no package entry |
| no-elftia-import | 1049 | 1063 | +14 | repo-wide enumeration auto-covers the new app |
| react-free-base | 68 | 68 | 0 | base layers untouched |

Every number reconciles exactly against the app's actual files — additive,
no hold, no collapse.

**3.5 — deep-import probe.** Appended a
`@opencut/editor-classic/src/session/session-editor-host` import to
`src/host/electron-editor-host.tsx`: checker **exit 1**,
`[public-entry-only] apps/electron-host/src/host/electron-editor-host.tsx:32`
naming the exact specifier (`evidence/census/group-3-deep-import-probe.txt`).
Reverted: checker exit 0 and the post-source census byte-identical
(`group-3-post-revert.txt` diff exit 0 vs `group-3-post-source.txt`).

**3.6 — typecheck + type-baseline.** `bun run --cwd apps/electron-host
typecheck` REAL_EXIT_CODE:0. `check-type-baseline.mjs` output byte-identical
to the 2.1 baseline capture (`group-3-type-baseline.txt`, diff exit 0) — the
pre-existing RED is unchanged; the electron app is outside its `apps/web`
program by design (decision to be recorded in the Group 9 audit table).

