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

## Group 5 — the desktop composition: assets, workers, CSP (tasks 5.1–5.4)

### 5.1 The composition root names every decision

`apps/electron-host/src/host/electron-host-config.ts` follows the
`vite-host-config.ts` module-lifetime pattern: `electronDiagnostics`
(`RecordingDiagnostics`), `electronIds` (`DeterministicIdGenerator`) and
`electronFilesystemStore` (`new FilesystemProjectStore(new IpcStoreBridge(),
{ identity: DEFAULT_FILESYSTEM_STORE_IDENTITY })`) are module-level
singletons, so the store/ID/diagnostics survive the host object being
recreated on every project-id change. `createElectronEditorHost` then composes
off `createInMemoryPorts()` with each override named at its site:

- **owned roles** — `assets: new BrowserAssetResolver("/")`,
  `assetLoader: new BrowserRuntimeAssetLoader(assets,
  globalThis.fetch.bind(globalThis))`, `runtimeResources: new
  ElectronRuntimeResources(workerUrlRewriter)`;
- **the desktop substitution** — `store: electronFilesystemStore` (durable
  projects on disk through the production preload bridge, not IndexedDB, not
  in-memory);
- **reference roles, process-lifetime by decision** — `diagnostics`, `ids`;
- **visibly NOT overridden** — `environment` and `exporter` stay the
  in-memory reference implementations `createInMemoryPorts()` provides;
- plumbing for the Group 6/7 evidence entries rides the same seam
  (`workerUrlRewriter`, `forceRendererBackend: "none"`), and the branding
  logo goes through the asset role (`assets.resolve`) rather than a
  hand-built URL.

`ElectronRuntimeResources` (`electron-runtime-resources.ts`) is the one port
role this Host owns outright, per design E3. `createWorker` rewrites the
request onto the renderer's own scheme origin (design E6): a URL already on
`opencut://app` passes through untouched; any other origin keeps its path and
query but is served from `location.origin` — same-origin by construction,
which is what a `file://` page can never offer. An explicit rewriter (the
evidence harnesses) takes precedence. `createAudioContext` and
`createObjectUrl` re-implement the browser reference semantics
(`electron-audio:` / `electron-object-url:` resource ids) rather than
delegating, so the owned role owns all three decisions.

**Single-origin deviation from design E2's two-host sketch (recorded here as
the Group 3 decision reached, now proven live):** the design sketch drew
assets on a second `opencut://assets` host. The build's allowlist copy lives
in the same `opencut://app` tree the protocol handler already serves, so the
composition resolves assets against base `"/"` — one origin, one handler, and
the CSP's `'self'` covers page, fonts, workers and fetch identically. A
second host would have been ceremony, not isolation. The live proof below
exercises this end to end (page, atlas, 15 font chunks, the worker fixture —
all `opencut://app`, zero foreign requests).

### 5.2 Runtime assets end to end — static and live

Static: the build copies the allowlist and emits the electron
`asset-manifest.json` (298 copied files / 4,481,207 bytes; 7 emitted /
30,111,668 bytes). `check-asset-manifest.mjs` was invoked with its existing
`--manifest` parameter against the electron dist — no checker fork, no
checker edit. Node cannot fetch Electron's custom scheme, so the checker's
served-bytes leg ran against a trivial read-only stand-in
(`apps/electron-host/scripts/serve-dist.mjs`, rooted at the same `dist/`,
byte- and MIME-identical) — the scheme serving itself is proven live below.
Result: `PASS MIME + bytes + SHA-256 + category/graph completeness`, `PASS
excluded paths remain absent below the tested base`, REAL_EXIT_CODE:0.

Live: in the same production launch as the boot gate, the booted editor
(picker → New project → interactive timeline) fetched
`opencut://app/fonts/font-atlas.json` and fifteen
`opencut://app/fonts/font-chunk-*.avif` entries through the composition's
resolver+loader — recorded from the request stream, not inferred.

### 5.3 Worker construction through the port at the scheme origin

The vite example's `?c4-worker-harness=1` pattern, mirrored as
`apps/electron-host/src/c4-worker-harness.tsx` + the dispatch branch in
`src/app.tsx` (dispatch split into `App`/`EditorApp` exactly like the vite
example, so the hooks rules hold). The harness requests a worker at
`https://request.invalid/original-worker.js` (type `module`, name `OpenCut C4
Worker fixture`); the Host rewriter serves `opencut://app/workers/
c4-worker-fixture.js`. Live verdict, all attributes read from the settled
DOM:

- request observed by the rewriter: id `c4-round-trip`, the exact foreign
  URL, type, name;
- rewritten URL `opencut://app/workers/c4-worker-fixture.js`;
- ping-pong with a transferred 4-byte buffer: `{"kind":"pong","byteLength":4}`;
- session resource report: worker created/released `1`/`1`;
- `request.invalid` never reached the network; the whole run recorded **zero
  foreign requests**.

No worker form resisted scheme serving — the `blob:` fallback (design E6's
blessed escape) was not needed and is not implemented; its trigger condition
therefore never fired.

### 5.4 The boot gate: narrow CSP, zero violations, zero console errors

The CSP (design E7's starting set, unchanged from Group 3 — no relaxation was
forced, so none is named) is committed in both places the task requires: the
scheme handler's `Content-Security-Policy` response header
(`electron/main.cjs`) and the identical `<meta>` in `index.html`, which the
build carries into `dist/index.html`.

The gate ran as the first leg of `scripts/desktop-composition-proof.mjs`:
production renderer at `opencut://app`, project created through the picker
(identity seam), editor to the interactive timeline (main-track ARIA label +
timecode title, the parity harness's own selectors), onboarding dialog
dismissed, 3s settle. Result: **zero CSP violation reports, zero console
errors** (both `securitypolicyviolation` instrumentation and console/pageerror
capture; the worker-harness leg ran under the same instrumentation with the
same zero). REAL_EXIT_CODE:0, self-logged. Screenshots:
`evidence/screenshots/group-5-boot-gate.png`,
`group-5-worker-harness.png`.

### Findings from this group

- **The session's `released` bookkeeping settles a microtask after
  `terminate()`.** Proof run 1 failed only on `created/released = 1/0`:
  `SessionResources.release()` (session-resources.ts) defers its
  `released += 1` behind an `await`, so a report read synchronously after
  `terminate()` sees the mid-flight value. The archived S02 vite evidence
  recorded `1/1` because the S02-era release path was synchronous; the
  *current* vite harness would also report `0` today (it reads the report in
  the same synchronous spot — left untouched here, vite is not this change's
  scope). The electron harness now lets the bookkeeping settle (one
  macrotask) before reading the report; run 2 recorded `1/1`.
- The asset checker's served leg needs an HTTP base; on a custom-scheme host
  a rooted stand-in server is the honest bridge, with the live scheme run in
  the same group covering what the stand-in cannot (the scheme itself).

## Group 6 — Evidence entries: surface-evidence and disposal dispatch

Task text: `rasen/changes/s05-second-host/tasks.md` §6. Proof script:
`apps/electron-host/scripts/evidence-entries-proof.mjs` (both entries in one
run). Log: `evidence/logs/group-6-evidence-entries.log`.

### 6.1 The `surface-evidence` entry

A second built HTML entry — `apps/electron-host/surface-evidence.html` →
`dist/surface-evidence.html` — selected with the entry seam from Group 3
(`--opencut-entry=surface-evidence`; `main.cjs` validates the name and loads
`opencut://app/surface-evidence.html`). The vite config gains the second
rollup input (`vite.config.ts` `rollupOptions.input["surface-evidence"]`),
mirroring the vite example's own multi-entry shape. The mount
(`src/surface-evidence-main.tsx`) mirrors
`apps/vite-example/src/surface-evidence-main.tsx`: the electron composition
(`createElectronEditorHost` with `forceRendererBackend: "none"`, the fs store
over the bridge, module-lifetime store/ids/diagnostics), the R2 build marker
(`VITE_R2_BUILD_MARKER`, fallback `"missing-electron-marker"`), and the
harness imported **unmodified** from `@opencut/editor-classic/evidence`.

**The `hostName` cast — a frozen-dual prop crossed by a third host.**
`SurfaceEvidenceHarness` declares `hostName: "next" | "vite"`: it was born
dual, and the S03 extraction froze its public signature. The extraction audit
(`2026-08-14-s05-package-extraction`) lists exactly four frozen surfaces —
the transaction-contract barrel, the engine, the ports barrel, and the
Surface embedding types — and the evidence harness is **not** among them;
but task 6.1 ("No change to the harness itself") and the spec's
harness-sharing requirement ("through the same harnesses rather than
Host-private copies") both freeze the harness for this change anyway.
Crossing the union would therefore need either a harness edit (forbidden
here) or a host-side lie. The mount passes
`{"electron" as unknown as "next" | "vite"}` at the call site with a comment
naming this exact reasoning: the prop is a *label recorded verbatim into the
evidence ledger* — the runtime ledger entries carry `host: "electron"`
truthfully — and the harness does not branch on it. If the union is widened
later, the cast deletes cleanly. Flagged in the final report as a deviation.

**Proof (final run, log [E]).** The proof launches the app with
`--opencut-entry=surface-evidence`, a `mkdtemp` `OPENCUT_STORE_ROOT`, and an
`addInitScript` CSP listener, then asserts: `data-host === "electron"` (the
label the harness itself rendered), `data-status === "ready"`, the R2 ledger
present, **zero CSP violation reports, zero console errors**. Verdict JSON +
`EVIDENCE ENTRIES PROOF PASSED`, `REAL_EXIT_CODE:0`.

### 6.2 The disposal dispatch and the attributed CSP relaxation

`src/app.tsx` gains the dispatch branch `?c6-disposal-harness=1` →
`<C6DisposalHarness>` imported **unmodified** from
`@opencut/editor-classic/evidence`, wired with the electron `createHost`
(store over the bridge — no `forceRendererBackend` override here; the
disposal cycle exercises the default backend path),
`isDurableBrowserStore: (store) => store instanceof FilesystemProjectStore`,
and the C6 build marker (`VITE_C6_BUILD_MARKER`). The proof reaches it by
in-page navigation
(`location.href = "opencut://app/index.html?c6-disposal-harness=1"`) on the
main entry.

**The relaxation, by design E7's own mechanism.** Run 1 (log [C]) completed
all six cycles but recorded **six object-URL terminality failures** plus
**24 CSP violation reports**, every one `connect-src`/`blob:`. Root cause:
the C6 oracle's object-URL terminality probe *fetches the `blob:` URL it
creates* — `createObjectURL` → fetch → `revokeObjectURL` → fetch must fail.
Under the design-E7 starting policy `connect-src 'self'` the probe's *first*
fetch is blocked, terminality is "not proven", and the oracle fails every
cycle. Design E7 pre-declares this exact situation — the starting set "is a
hypothesis, not a decision"; any relaxation must name the feature that
forced it. `connect-src 'self' blob:` is therefore added in all three places
the policy lives (the scheme handler's response header in
`electron/main.cjs`, the `<meta>` in `index.html`, the `<meta>` in
`surface-evidence.html`), each with a comment naming the forcing feature.
Post-relaxation (log [E]): object-URL failures gone, **zero CSP
violations**. This is an attributed hypothesis update per design E7,
recorded here rather than as a deviation.

**Expected console noise.** The final run logs six
`Failed to load resource: net::ERR_FILE_NOT_FOUND` console lines — one per
cycle, each the oracle's *post-revoke* fetch failing exactly as the probe
intends. That is the proof working, not a defect; the vite standing test
gates `report.clean` and `failures`, not console noise. Group 8's gate
mirrors that.

**The cycle-1 independent-timer race (open, non-blocking).** The final run
records one failure: `cycle 1 timer independent platform residual 1`. Facts
established: (1) it appears **only at cycle 1**, never cycles 2–6, in any
run — counts recover immediately, so there is no monotonic growth and no
leak (the oracle's own leak predicate never fires); (2) it is
timing-sensitive — present in both gated proof runs ([C]/[E]), absent in the
instrumented diagnostic run ([D]); (3) the independent ledger's timer
population around cycle 1 was captured by stack diagnostics: a
session-mediated 5 ms `setInterval` plus 800 ms `queueSave` debounces
scheduled by `markDirty` (first mutation) and `resume` — all editor-package
code this change freezes. The independent ledger wraps the window timer APIs
globally and counts a session-mediated timer exactly once when it bottoms
out at the window API, so a first-cycle debounce still pending at the ledger
snapshot (the snapshot lands after `dispose()` + a 60 ms yield + the awaited
terminality fetch) reads as residual 1 on the slower first cycle. No
legitimate composition-side fix exists — the timer lifecycle is frozen
harness/editor code, and the host adds no timers of its own. **Group 8
plan:** run the gated oracle; if the race recurs, rerun a bounded number of
times and record the distribution alongside the clean run.

### 6.3 Disposable roots

`main.cjs`'s `storeRoot()` (Group 4) honors `OPENCUT_STORE_ROOT` globally —
every entry inherits it, since the store installs once per process at boot.
Both proof launches use `mkdtempSync` roots and remove them on exit
(`rmSync recursive force`); nothing in either run writes toward `userData`
(the override short-circuits the `userData` path entirely). The parity runs
(Group 7) use the same seam and will start from empty roots. Documented in
`main.cjs` at `storeRoot()` and in both proof-script headers.

### Findings from this group

- The frozen-dual `hostName` prop is crossed by a documented call-site cast
  (see 6.1) — the honest option among forbidden ones; widens cleanly if the
  harness union ever gains `"electron"`.
- The C6 oracle's object-URL terminality probe is CSP-load-bearing: it
  *fetches* the `blob:` URL it creates, so any host running the disposal
  oracle needs `connect-src blob:`. Recorded via design E7's attribution
  mechanism; the vite/next hosts run under `http(s)` origins where blob:
  fetches are same-origin and never noticed.
- The independent timer ledger is a *global* wrap: session-mediated timers
  that legitimately bottom out at window timers are counted once by it, so a
  first-cycle debounce pending at the snapshot reads as platform residual on
  a slow host — intermittent, cycle-1 only, non-cumulative (details 6.2).
  Known consequence, not fixed here; Group 8 records the distribution.

## Group 7 — Parity on the third Host (tasks 7.1–7.7)

### What was built

- **7.1** `host-profile.ts`: `HostName` gains `"electron"`; the profile's entry is the full
  `opencut://app/index.html` URL (no `baseURL` to resolve against); `createProject` reuses
  the existing `clickUntil` pattern against the electron picker (same "New project" button,
  same `?project=` record of the open project); `newProjectName` is `"Untitled Project"` —
  the name the electron picker's own `createNewProject` call gives a project.
- **7.2** The page-acquisition seam, `tests/parity/electron-page.ts`: refuses to run against
  an unbuilt host (checks `dist/index.html` and `dist/surface-evidence.html`), launches the
  app with `_electron.launch` using the gate-1 launch config (`--use-angle=swiftshader
  --enable-unsafe-swiftshader`, Electron resolved through the app's own `package.json`),
  a fresh `OPENCUT_STORE_ROOT` per run, and returns `app.firstWindow()`. Teardown
  (`closeElectronPage`) closes the app and removes the disposable root; the spec calls it in
  `test.afterEach`.
- **7.3** `snapshot.ts`: `readPersisted` dispatches on `HOST`. The electron branch reads the
  fs store's own records through the page's own `opencutStore` bridge — `listRecords` /
  `loadRecord` / `listAttachments`, the operations the store itself uses — and projects to
  the public-row shapes the browser store publishes (project row `{...record.data, id}`;
  media row `{id, name, type, size, lastModified, width, height, duration, thumbnailUrl,
  ephemeral}` with `size` from the body's byte length, `{id}` alone when metadata misses the
  row contract). Attachment bodies never leave the page. The databases census records the fs
  store's own shape (`fs:records`, `fs:attachments:<projectId>`). The vite/next IndexedDB
  path is unchanged under its original body.
- **7.4** `playwright.surface.config.ts`: the electron leg has no `webServer`, no `baseURL`,
  and drops the `channel` pin (the fixture browser opens idle; its page is destructured but
  never driven on this leg). Artifacts key on `host` — parity output lands under
  `tests/parity-artifacts/electron/`, agent evidence under the `evidence-path.ts`-resolved
  leaf with no further config.

### Two Electron import findings

- Electron windows do **not** surface Playwright's `filechooser` event — the browser hosts'
  chooser-interception dance cannot complete there. The editor's own always-mounted hidden
  `<input type="file">` (assets panel) is the same import path its change handler serves.
- That input is not `multiple` in markup: `openFilePicker()` sets `el.multiple = true` as
  the one statement before the native dialog would open. The electron branch reproduces
  exactly that statement, then one `setInputFiles` with all four fixtures — the same single
  change event the intercepted chooser produces on the browser hosts, which keep the genuine
  chooser flow unchanged.

### The Host defect the parity run caught (durable finding)

Run 3 failed `place-multi-track` with hover hit-tests intercepted by the header's
project-name input, a panel resize separator, and `<html>` — while the accessibility tree
was complete and steps 1-2 had *asserted* visibility. Both step screenshots showed chrome
only: everything below the header was painted at near-zero height. Root cause: the host
mount supplied no definite-height ancestor. The editor's embedding contract is explicit
(`editor-root.tsx`: "the host supplies the viewport-sized wrapper"), and the Vite example's
`HostChrome` — whose bordered box reads as demo decoration — carries the load-bearing
`height: 100vh` + flex main. Group 3 mirrored `app.tsx` "minus the bounding HostChrome" and
dropped the height chain along with the decoration: `#root` is `min-height: 100%` (height
`auto`), and the editor's `size-full` chain then resolves against `auto` all the way down,
so the panel group measures a degenerate container.

Fix (host-side, in scope): `apps/electron-host/src/app.tsx` wraps the picker/editor
conditional in `<main className="h-screen w-screen overflow-hidden">` — the desktop window
*is* its own chrome, so the wrapper is the whole window; the picker's `size-full` root gets
the same contract satisfied. Run 4 then passed end to end.

### Run verdicts

- **Electron (run 4)**: `1 passed (37.0s)`. All ten ledger entries **asserted**; zero
  console errors; zero blocked third-party requests; persisted census `fs:records` 1 row,
  `fs:attachments:<id>` 4 rows. Track summary: image on main, split video halves on
  overlay, two audio tracks.
- **7.5 diff (unmodified tool, argv pair vite→electron)**: exit 1 — the tool exits non-zero
  on any semantic row, envelope rows included, so the verdict is read off the report:
  **25 differences — 20 semantic, 5 incidental; 275 leaf values compared** (the same leaf
  count as the committed Vite/Next pair). Every semantic row is under
  `project.__opencutTransaction.idempotency[*]` — **zero outside the envelope; the §3.2 bar
  is met.** The 5 incidental rows are the documented classes only (inherited one-frame
  `metadata.duration`, two one-frame overlay `startTime` rows, `playheadTime`,
  `zoomLevel` — the desktop window is 1424 CSS px vs the browser viewport's 1600, so its
  zoom differs more; the one-frame rule absorbs the quantization exactly as documented).
  Known artifacts of running the unmodified tool: the report's "next" column holds the
  electron snapshot, and its "Interaction ledger" section is absent (the tool looks for
  `ledger-next.json` beside the second snapshot). Report:
  `evidence/parity-electron-vs-vite-20260815.md`.
- **7.6 regression control**: both browser hosts re-run after the 7.1-7.3 edits — vite
  `1 passed (38.2s)`, next `1 passed (39.2s)`; same single third-party block, same two
  route-blocker `ERR_FAILED` console errors as the committed record. Fresh Vite-vs-Next
  diff: **27 differences — 18 semantic, 9 incidental; 275 leaves.** All semantic rows
  inside the same envelope; the 9 incidental paths are the same 9 as the committed record.
  The in-envelope count (18 vs the committed 20) is the envelope's own by-construction
  per-run variance (retry nonces, `createdIds` ordinal ordering) — path classes unchanged.
  Report: `evidence/parity-vite-vs-next-regression-20260815.md`.
- **7.7**: root `PARITY.md` gained a "Third host: the desktop (Electron) comparison"
  section stating the pair, the counts, the classification and the regression result; the
  inherited classification and envelope language above it are untouched.

### Shared-harness diff record (7.2's "interactions did not move")

- `parity.pw.ts` — exactly 2 hunks: the seam import; and the test header (afterEach
  teardown, `page` → `fixturePage` destructure rename, seam acquisition, origin dispatch).
  All nine interaction bodies and the save-reload-reopen block are byte-identical.
- `driver.ts` — exactly 2 hunks: the `HOST` import; and the electron branch inside
  `importFixtures`. The browser-host chooser dance and every other primitive are unchanged.
- `host-profile.ts` / `snapshot.ts` — additions that dispatch on `HOST`; the vite/next
  paths are unchanged under their original code.

No frozen surface was touched; no deviation from the change artifacts in this group (the
`app.tsx` wrapper is host-side defect repair that the parity run exists to catch).
