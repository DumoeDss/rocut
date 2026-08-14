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


## Group 4 — the filesystem store: bridge, store, conformance, migration

All logs: `evidence/logs/group-4-store-evidence.log` (bun suites + typecheck)
and `evidence/logs/group-4-bridge-production.log` (task 4.6's production
proof). Every run logs its own `REAL_EXIT_CODE`.

**4.1 — the bridge pair.** `src/store/project-store-files.ts` declares
`ProjectStoreFiles` — the full store surface (record list/load/save/remove,
attachment CRUD, library-record CRUD, inspect, clear) keyed by identifiers
only; no method accepts or returns a path. `src/store/node-fs-store-bridge.ts`
implements it over `node:fs` against a caller-supplied root, design-E4 layout
(`projects/<id>/record.json`, `.../attachments/<key>` + `<key>.meta.json`,
`library/<ns>/<key>.json`, `store.json`), every write atomic (sibling temp +
rename), reads tolerating ENOENT, and every fs failure sanitized through
`ioFailure()` into a path-free `StoreBridgeError` (which
`FilesystemProjectStore.throughBridge` maps to the port's `unavailable` code).
Identifier-to-segment mapping: ids matching `[A-Za-z0-9][A-Za-z0-9._-]*` (not
`.`/`..`) pass through readable; anything else becomes `~`+base64url — `~`
cannot occur unencoded, so the conformance suite's `a:b` vs `a`/`b:c`
hierarchical-collision identities stay distinct trees.

**Codec decision (opaque payloads).** Opaque values cross the disk boundary as
`node:v8` structured-clone serialization carried base64 inside JSON envelopes:
the envelope stays inspectable (identity, version, summary readable without
decoding the payload) while Dates, Maps, Sets and buffers round-trip exactly —
what the port's provider-private round-trip requirement demands. The codec
lives bridge-side deliberately: the renderer has no `node:v8`, and Electron
IPC is itself a structured clone, so typed values cross the contextBridge
natively and only the bridge serializes.

**4.2 — the store.** `src/store/filesystem-project-store.ts`:
`schemaVersion = CURRENT_PROJECT_VERSION` (31) from
`@opencut/editor-classic/storage`; `migrate()` walks the published
`migrations` transform list under the browser store's policy model
(production identity migrates by default; any other identity refuses without
an explicit disposable opt-in; `disabled` always refuses — the no-opt-in
refusal). `persistedSchemaVersion()` reads on-disk envelope versions via
`listRecords` (empty store returns `schemaVersion`, else `Math.min`).
Conflict matrix, enqueue serialization, quota check at the commit seam, and
the control class mirror the in-memory reference store's shapes.

**Deviation from task 4.2's letter, recorded:** the task says `migrate()`
"delegating to the published `runStorageMigrations`". That published runner is
hardwired to the legacy `video-editor-projects` IndexedDB database (it opens
IndexedDB directly): under `bun test` it crashes on the missing `indexedDB`
global, and inside Electron it would read the wrong store entirely. The spec
(which wins over design/tasks where they speak) requires only that migration
be "brought forward by the published migration runner" — and task 9.4 freezes
the public signatures of the S03+S04 storage surface, so parameterizing
`runStorageMigrations` to accept a backend is exactly the change this change
may not make. Resolution: the store consumes the same published artifacts the
runner consumes — the `migrations` transform list and `CURRENT_PROJECT_VERSION`
— and sequences them per-record exactly as the runner's own
`transformLegacyProject` does (sort by `from`; skip non-matching; a skipped
transform is a failure; the chain must reach current). The frozen runner is
untouched.

**4.3 — conformance (the task's oracle).**
`src/store/__tests__/filesystem-store-conformance.test.ts` runs the published
`runPortConformance` on the portable profile with `exerciseMigration: true`,
over `createInMemoryPorts({ store })` with the filesystem store substituted
and a disposable-root `NodeFsStoreBridge` fixture. Result: **33 passed, 0
failed, 1 stated skip** (`environment: a forced no-rasterizer declaration
yields a zero limit :: this host declares detect mode, so there is no force to
check`). No port role reports zero cases: store 19, assets 2, assetLoader 1,
runtimeResources 5, exporter 2, diagnostics 2, ids 2, environment 3 (2+1
skip). **The provider-private round-trip case passed by name: "a known edit
round-trips without losing opaque nested fields."**

One repo-level constraint shaped the harness: `@opencut/editor-classic/storage`
statically reaches the real `opencut-wasm` package, whose init throws under
`bun test`. Both Group 4 suites follow the repo's established pattern
(`apps/web/src/editor/host/__tests__/production-composition.test.ts`,
`packages/editor-classic/src/evidence/index.ts`): the real suite runs in an
isolated child process whose first sequential import installs
`evidence/wasm-test-mock`, so the process-global wasm mock never reaches any
other test file.

**4.4 — filesystem migration probes.**
`src/store/__tests__/filesystem-store-migration-probes.test.ts`, the
mechanism-neutral analogs of the C5 browser probes (the IndexedDB probes
themselves — seeding, stage-database cleanup, recovery journals — are stated
non-coverage for this store). All five passed:

1. forward migration — seeded v29 (two steps) and v30 (one step) records both
   reach 31 through the published chain, `recordsMigrated: 2`, progress last
   `{completed: 2, total: 2}`, loaded payloads carry `version: 31`, second
   run `not-needed`;
2a. a throwing transform reports `failed`, reason names unchanged durable
   records, source `record.json` byte-identical (`readFileSync().equals`),
   reload still v30;
2b. a refusing (`skipped: true`) transform reports `failed`, source intact;
3. no-opt-in — default-disabled on a foreign identity refuses ("not enabled")
   touching nothing (byte-identical); an explicit production policy on a
   non-default identity refuses ("opt-in"); the default production identity
   is exactly the one string;
4. `afterDatabases` equivalent — post-migration root walk finds only the
   design-E4 layout (`projects/<id>/{record.json,attachments}`,
   `library/<ns>/*.json`, `store.json`) and zero `.tmp-` strays.

Probe authoring found one trap worth recording: `bun test` does not
typecheck, so a positional `saveAttachment(id, key, ...)` call against the
port's args-object surface ran with `undefined` identifiers and silently
created a `projects/undefined/` tree — `RegExp.test(undefined)` coerces to
the literal segment "undefined". The probe now calls the args-object surface
and the layout probe flags any such phantom; `tsc` (run below) is the
structural backstop.

**4.5 — the owed non-vacuity assertion (already paid).** The assertion
`expect(files.length, "persistence-importer scan must not be vacuous")
.toBeGreaterThan(0)` already exists in
`apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts`
(lines 413-416), added by pre-change commit `8389be4e` — not by this change.
Verified by execution (`bun test` that file: 1 pass / 0 fail /
REAL_EXIT_CODE:0) and left unmodified: the task forbids widening the scan's
scope, and adding a duplicate assertion would be exactly that in disguise.

**4.6 — the production bridge.** Three artifacts, no fourth:
`electron/preload.cjs` exposes exactly one global (`window.opencutStore`, the
`ProjectStoreFiles` surface, one `opencut-store:<operation>` channel per
operation, identifiers and structured-clone values only);
`src/store/main-store-ipc.ts` (electron-free, compiled by the package build to
`dist-main/main-store-ipc.cjs` via `bun build`) installs the fourteen IPC
handlers over one `NodeFsStoreBridge` rooted at
`app.getPath("userData")/projects`, with `OPENCUT_STORE_ROOT` overriding for
evidence runs; `src/store/ipc-store-bridge.ts` is the renderer-side
`IpcStoreBridge` over the preload surface, typing `window.opencutStore` once
and re-wrapping IPC rejections (Electron erases error identity) as
`StoreBridgeError`. `electron/main.cjs` installs the handlers before the first
window and writes the boot bookkeeping `store.json` (identity + fresh usage
inspection, advisory only). `src/store/__tests__/store-bridge-surface.test.ts`
holds the structure: the preload's operation list equals
`STORE_IPC_OPERATIONS`, exactly one exposed global, no `node:` require in the
preload, no path import or absolute literal in any bridge-facing module, and
`main.cjs` resolving the design-E4 root and override. `dist-main/` is
gitignored beside `dist/`.

The production proof (`scripts/store-bridge-proof.mjs`, log
`group-4-bridge-production.log`) launched the real app over a disposable
`OPENCUT_STORE_ROOT` and drove every operation through the page's own
`window.opencutStore`: 12/12 in-page steps green (including a Date in an
opaque payload surviving the full renderer-to-disk-to-renderer round trip,
and a 4-byte attachment body), Node-side layout exactly design E4,
`store.json` identity `opencut-fs-production`, and
`clearFiles({kind: "all"})` emptying the root. Zero console errors.

The proof earned its keep twice: run 1 caught a real IPC bug the bun suites
structurally cannot — the handler registrations had dropped Electron's
leading `event` parameter, so every arg-taking channel received an
`IpcMainInvokeEvent` where its payload belonged (`stored.record` of
`undefined`); run 2's only failure was the proof's own over-strict check (an
empty `attachments/` directory legitimately remains after `removeAttachment`
unlinks its files). Both are recorded in the log's run sequence; the final
run is REAL_EXIT_CODE:0.
