## 1. Gate: prove the desktop substrate before building on it

- [x] 1.1 Add `electron` as an exact-pinned dev dependency of the new `apps/electron-host`
      scaffold (manifest only at this point) and install it with `ELECTRON_CACHE` pointed at an
      E:-drive path outside any Temp directory — this machine's AV has hung staging in `%TEMP%`
      before, and a hang here is the AV signature, not a tooling bug. Record install result and
      cache location.
- [x] 1.2 Throwaway spike (deleted before any commit, gate-1 precedent): a minimal Electron main
      that registers a privileged `opencut://` scheme (`standard`, `secure`, `supportFetchAPI`,
      `stream`) before app-ready, serves one static HTML page through `protocol.handle` with a
      `Content-Security-Policy` response header, and opens a window on it. Prove: the page loads,
      `document.origin` is the scheme origin, the CSP header is observed by the page, and
      `fetch()` of a scheme-served asset succeeds.
- [x] 1.3 Prove `_electron.launch()` from `@playwright/test` reaches that spike window
      (`firstWindow()` returns a page; a `page.evaluate` round-trips), with the GPU flags
      (`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`) passed as launch args. Record the
      launch config that works — the parity launcher (Group 7) reuses it verbatim.
- [x] 1.4 Delete the spike, record all three results in `evidence/gate-1-desktop-substrate.md`
      with self-logged `REAL_EXIT_CODE:$?` lines, and confirm the working tree is back to the
      pre-spike state.

## 2. Oracle first: the boundary checker sees a third consumer before source lands

- [x] 2.1 Re-capture the live baseline census (design Context warns the P1-close figures may have
      drifted): full `node script/check-package-boundary.mjs` output — files scanned, per-rule
      file counts, cross-package edges, `@opencut/*` specifiers examined — plus
      `--negative-control` and `--converse-control` results, and the type-baseline result. This is
      the before-half of every census comparison in this change.
- [x] 2.2 Add `apps/electron-host` to `packages/boundary.json`'s `consumers`, and change
      `ownerOfPath()` / `packageAndConsumerSourceFiles()` / the edge-exclusion predicate in
      `script/check-package-boundary.mjs` to derive consumer root prefixes from the declared
      consumer list instead of the two hardcoded strings. No other behaviour change.
- [x] 2.3 Control run, before any Host source exists: the checker output must be byte-identical to
      2.1's baseline (a declared consumer holding no files changes nothing observable), and both
      controls must still pass. Record the diff-proving transcript. A difference here means the
      derivation is not behaviour-preserving and blocks Group 3.
- [x] 2.4 Add an electron-consumer case to the in-memory control fixtures: the negative control
      gains a deep import from a file under an (fixture) electron root that must fire
      `public-entry-only`; the converse control gains a declared-entry import from the same root
      that must stay silent. Re-run both controls.

## 3. The Host skeleton: a Vite renderer that boots the real editor

- [x] 3.1 Author `apps/electron-host` (package `@opencut/electron-host`, private, exact-pinned
      `electron` dev dep, `react`/`react-dom` 18.3.1, `typecheck` script): Vite config with
      `react()`, `wasm()`, `topLevelAwait()`, `target: "esnext"`, React `dedupe`, `publicDir:
      false`, and the `editorAssets` + `moduleGraph` plugins imported from
      `../vite-example/build/` (single-source allowlist — no second copy of
      `EDITOR_RUNTIME_ASSETS`); stylesheet mirroring the Vite example's (`@source` over the
      package tree and the app — the P1 Blocker was a stale scan scope producing a silently
      unstyled, non-interactive editor).
- [x] 3.2 Author the renderer skeleton mirroring `apps/vite-example/src`: `app.tsx` with the
      project picker recording `?project=<id>`, `EditorErrorBoundary`, an
      `electron-host-config.ts` composition root that spreads `createInMemoryPorts()` and
      final-overrides nothing yet (in-memory store is correct for this stage), and the
      `EditorSessionHost`-wrapped editor. `next-themes` and everything else the app imports is
      declared in its own manifest — no hoisting-by-accident.
- [x] 3.3 Author the real Electron main + preload for the skeleton: privileged scheme + handler
      serving the built renderer (`opencut://app/…`) and the copied asset directory
      (`opencut://assets/…`), `contextIsolation` + `sandbox` on, `nodeIntegration` off, preload
      exposing nothing yet (the bridge lands in Group 4), and `--opencut-entry=<name>` /
      `OPENCUT_ENTRY` selecting the start entry. Build the renderer, launch the app, and prove the
      editor boots to an interactive timeline from the scheme origin with the in-memory store.
- [x] 3.4 Census reconciliation now that source has landed: re-run the boundary checker; files
      scanned must have grown by the app's scanned-file count, `@opencut/*` specifiers examined
      and cross-package edges must both be non-zero-additive, and the numbers must reconcile
      against the app's actual files (the 7.5 precedent — a hold or collapse is a scope failure at
      `PASS`). Record before/after side by side in the evidence.
- [x] 3.5 Deep-import probe, violation-and-revert, from a real `apps/electron-host/**/*.tsx`
      file: an undeclared `@opencut/editor-classic/src/…` import must fail `public-entry-only`
      live (exit 1, the file and specifier named); revert must return exit 0 with the enlarged
      census intact. Record both runs.
- [x] 3.6 `bun run --cwd apps/electron-host typecheck` passes; `check-type-baseline.mjs` is
      unchanged from 2.1's baseline (the electron app is outside its `apps/web` program by design
      — record that decision in the Group 9 audit table, do not widen the baseline).

## 4. The filesystem store: bridge, store, conformance, migration

- [x] 4.1 Author `ProjectStoreFiles` (the bridge interface: record list/load/save/remove,
      attachment CRUD, library-record CRUD, inspect, clear — identifiers only, never paths) and
      `NodeFsStoreBridge` implementing it over `node:fs` against a caller-supplied root. On-disk
      layout per design E4; writes atomic (temp + rename); fs errors mapped to `ProjectStoreError`
      with the port's scope/code semantics.
- [x] 4.2 Author `FilesystemProjectStore` over the bridge: `schemaVersion` =
      `CURRENT_PROJECT_VERSION` from `@opencut/editor-classic/storage`, `migrate()` delegating to
      the published `runStorageMigrations`, `persistedSchemaVersion()` reading the on-disk
      envelope. No schema logic of its own — the published runner is the SDK-consumption story.
- [x] 4.3 Conformance leg under `bun test` (no Electron involved): `runPortConformance` over the
      composed ports with a disposable-root `NodeFsStoreBridge` fixture, `profile: "portable"`,
      `exerciseMigration: true`. Every case passes or carries a stated skip; no port role reports
      zero cases. **The opaque-payload case is the provider-private round-trip requirement** —
      record it by name in the evidence.
- [x] 4.4 Filesystem migration probes under `bun test`, mechanism-neutral analogs of the C5
      browser probes: a seeded old-version record migrates forward through the published runner; a
      deliberately failing transform preserves the source record and reports the failure; the
      no-opt-in refusal holds; `afterDatabases`-equivalent: no stray files outside the layout
      after migration. The browser (IndexedDB) probes are stated non-coverage for this store.
- [x] 4.5 The owed cheap correct action from P1's archive: add the fail-closed
      `expect(files.length).toBeGreaterThan(0)` non-vacuity assertion to the violation-scan test
      in `apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts` — **the
      assertion only; the scan's scope is NOT widened.** Run the file; all tests pass.
- [x] 4.6 Production bridge: preload exposes the single `opencutStore` object (contextBridge) and
      main implements the same `ProjectStoreFiles` surface over IPC with all I/O inside a root the
      main process owns (`app.getPath("userData")/projects`, overridable by `OPENCUT_STORE_ROOT`
      for evidence runs). The renderer holds no path-shaped surface anywhere (grep-provable:
      no absolute-path string crosses the bridge).

## 5. The desktop composition: assets, workers, CSP

- [x] 5.1 Swap the composition root to the desktop ports: `store` final-override
      `FilesystemProjectStore` (via `IpcStoreBridge`), `assets`/`assetLoader` over
      `opencut://assets/` (reusing `BrowserAssetResolver`/`BrowserRuntimeAssetLoader` from
      `@opencut/editor-classic/browser`), Host `runtimeResources` with scheme-rewriting worker
      construction, process-lifetime `DeterministicIdGenerator` + `RecordingDiagnostics`.
      `diagnostics`/`ids`/`environment`/`exporter` stay visibly the in-memory reference roles —
      the composition names each decision.
- [x] 5.2 Prove runtime assets end-to-end: the build copies the allowlist and emits the electron
      `asset-manifest.json`; the booted editor fetches `fonts/font-atlas.json` and a font chunk
      through the scheme (resolver + loader, not a URL the editor built itself). Run
      `check-asset-manifest.mjs` against the electron `dist` (parameterize its manifest path or
      invoke it twice — do not fork a second checker).
- [x] 5.3 Prove worker construction: the C4 worker fixture starts through the runtime-resource
      port at the scheme origin and exchanges a message (the vite example's `?c4-worker-harness=1`
      pattern is the model; a minimal equivalent harness page or entry in the electron app is
      acceptable). If any worker form resists scheme serving, the `blob:` fallback is implemented
      and the fallback's trigger recorded.
- [x] 5.4 Commit the narrow CSP (design E7's starting set) as the scheme handler's response header
      plus the identical `<meta>` in the built HTML, and run the **boot gate**: production
      renderer under the scheme, editor to interactive timeline, **zero CSP violation reports and
      zero console errors** — violations are failures, not warnings. Any relaxation of the
      starting set names the feature that forced it, in the CSP's own comment and the evidence.
      Self-log `REAL_EXIT_CODE`.

## 6. Evidence entries: surface-evidence and disposal dispatch

- [x] 6.1 Author the `surface-evidence` entry: a second built HTML entry mounting
      `SurfaceEvidenceHarness` with `hostName: "electron"`, the electron composition
      (`forceRendererBackend: "none"`, fs store over the bridge), and a build-marker env —
      selected via `--opencut-entry=surface-evidence`. No change to the harness itself.
- [x] 6.2 Author the disposal dispatch: `?c6-disposal-harness=1` on the app entry mounts
      `C6DisposalHarness` (from `@opencut/editor-classic/evidence`, unmodified) with the electron
      `createHost`, `isDurableBrowserStore: (store) => store instanceof FilesystemProjectStore`,
      and a build-marker env. Confirm the harness renders and its ordinary control completes one
      cycle — the full oracle run is Group 8.
- [x] 6.3 Wire disposable roots: every evidence entry (disposal, surface-evidence, parity runs)
      accepts `OPENCUT_STORE_ROOT` and documents it — the disposal harness runs many cycles and
      the parity run must start from empty; nothing in an evidence run writes toward
      `userData` by accident.

## 7. Parity: the same nine interactions on the third Host

- [x] 7.1 Extend `apps/vite-example/tests/parity/host-profile.ts`: `HostName` gains `"electron"`;
      the profile's `entryPath` is the full `opencut://app/index.html` URL; `createProject` uses
      the existing `clickUntil` pattern against the electron picker (`?project=` takes effect);
      `newProjectName` matches what the electron picker actually names a project.
- [x] 7.2 Add the page-acquisition seam to `parity.pw.ts` (and the same minimal branch to
      `agent.pw.ts` in Group 8): when `HOST === "electron"`, acquire the page via `_electron.launch`
      with the Group-1 launch config against the built app; otherwise the fixture page unchanged.
      The interaction bodies after acquisition are untouched — diff the spec and show the
      interactions did not move.
- [x] 7.3 Add the host-scoped persisted reader to `snapshot.ts`: `readPersisted` dispatches on the
      host; the electron branch reads the fs store's own on-disk layout **through the page's own
      bridge** (`page.evaluate` over `opencutStore`) — the same no-purpose-built-export-path rule
      in the new medium. The vite/next IndexedDB path is byte-identical in behaviour.
- [x] 7.4 Add the electron leg to the Playwright surface config (launcher instead of `webServer`;
      no `baseURL`/`channel` for this leg; artifacts under `tests/parity-artifacts/electron/` and
      the agent-evidence regression path per `evidence-path.ts`). Run `PARITY_SPEC=parity
      PARITY_HOST=electron`: all nine interactions pass with only first-party assets
      (`page.route` blocking stays on).
- [x] 7.5 Diff electron-vs-vite with the **unmodified** `script/diff-parity-snapshots.mjs`. First
      verify how the tool selects its host pair; if the pair is hardcoded, adding pair selection
      is an argument change only — the classifier is not touched. Acceptance is the §3.2 bar:
      **zero semantic rows outside the documented idempotency envelope**; any row outside it is a
      defect in this Host. Record the report.
- [x] 7.6 Regression control on the shared harness: re-run `PARITY_HOST=vite` and `PARITY_HOST=next`
      parity after the 7.1–7.3 edits; both must reproduce their pre-change results (same
      differences, same classifications). A changed result means the seam edit moved behaviour,
      not just plumbing.
- [x] 7.7 State the electron comparison in `PARITY.md` alongside the existing Vite/Next comparison
      (host pair, differences, classification, leaf count), without rewriting the inherited
      classification or its envelope language.

## 8. Automate and disposal: the S03 and S02 evidence on the desktop Host

- [x] 8.1 Run the agent scenario on the electron Host: `PARITY_SPEC=agent PARITY_HOST=electron`
      through the `surface-evidence` entry (`?scenario=agent`). Apply phase: every declared step
      executed and asserted, ledger written, no console/page errors. Reopen phase: full window
      reload, fresh session over the same disk store, reopened engine reports the exact committed
      revision and every committed entity with committed values. Self-log `REAL_EXIT_CODE`.
- [x] 8.2 Validate the electron agent ledger against the same nine predicates
      `check-agent-evidence.mjs` applies (`ledger-present` … `metadata-only`), by hand against the
      fresh ledger as P1 did for its regression runs — the checker itself still reads the archived
      original and is not repointed. All nine pass; record the per-predicate result.
- [x] 8.3 Run the disposal oracle on the electron Host: `?c6-disposal-harness=1` ordinary control
      through its full cycles, plus the `missing-created` and `leak` negative controls, plus the
      `proof=durable-reopen` variant against the fs store. The harness is the package's own code;
      only the composition is new. No leaked timers/workers/audio contexts/object URLs across
      cycles; durable reopen passes. Self-log `REAL_EXIT_CODE`.
- [x] 8.4 Bundle the Group 5–8 execution evidence (boot gate, asset manifest, worker fixture,
      parity, agent, disposal) under `evidence/` with the real exit codes visible — this is the
      live-server/browser region no static gate covers, and P1's worst defects both lived exactly
      here. A green static checker is not evidence in this region.

## 9. Checker audit close-out and documentation

- [x] 9.1 Produce the per-checker audit table (P1 task 2.4 precedent) covering **every runnable
      `script/check-*.mjs`**: "scope follows the source" + the edit made, or "deliberately
      Host-scoped" + the reason. Predicted classifications to verify, not assume:
      `no-elftia-import` auto-covers (its enumeration is repo-wide — confirm its file count grew
      in 3.4); `check-distributable-boundary` stays Vite-graph-scoped (the electron build emits
      its own graph; record the decision); `check-type-baseline` stays `apps/web`-program-scoped
      (the app's own `typecheck` is its gate); singleton/runtime-asset/headless checkers audited
      individually. Silence per checker is not acceptable. Commit as
      `evidence/group-9-checker-scope-audit.md`.
- [x] 9.2 Extend `check-host-composition.mjs` with the third composition root: assert the electron
      root constructs one stable `FilesystemProjectStore` and final-overrides the inherited
      reference store — the rule's intent ("each production Host constructs one stable durable
      store") generalized past `BrowserProjectStore`. Re-run green.
- [x] 9.3 Run **every runnable static checker** and confirm all green, including
      `check-distributable-boundary.mjs` with `no-desktop-app` intact and both boundary controls.
      Any red is either fixed or recorded with a named pre-existing cause — none is silently
      waived.
- [x] 9.4 Frozen-signature control: diff the public surfaces frozen by S03+S04 (the
      premove-baseline `frozen-signature-*.diff` method from P1's evidence) against this change's
      base — zero differences. Pressure to change one would have been a `failed` finding returned
      to the contract, not a patch.
- [x] 9.5 Update `BOUNDARIES.md`: a third-consumer section (the electron Host, its owned ports,
      the census before/after), the checker audit table's summary, and the non-coverage statement
      (no CI leg — P3/P6; no installer/signing; no tarball install — P3; transcription worker and
      browser migration probes not claimed; C7 headless not ported).
- [x] 9.6 Spec-falsification sweep: name which governance-spec §3 groups this change advanced
      (§3.3 fully; §3.9's `apps/desktop` exclusion and frozen-signature survival re-proven;
      §3.2's harness widened to a third Host without moving behaviour) and which it deliberately
      left untouched, in the honest register prior children used.

## 10. Ship

- [x] 10.1 Verify line endings per stage with `tr -dc '\r' < <file> | wc -c` on every file written
      or generated, and `git ls-files --eol` over the change's full path set at the end — the
      Write tool flips files to CRLF on this machine and rocut is LF-in-worktree.
- [x] 10.2 Stage explicit pathspecs only; assert `git diff --cached --name-only | grep -c
      '^\.rasen/'` is `0` before every commit — `.rasen/` is not gitignored here. Do not pass
      `--no-verify` (no hooks exist; it is a no-op).
- [x] 10.3 Commit locally to `feat/s05-community-beta`. **Ship mode is local; do not push.** The
      portfolio delivers once, at the parent, after all seven children.
- [ ] 10.4 The moment the review loop goes clean, write `{"kind":"standDown"}` to any parked
      worker's `<changeRoot>/signals/<role>.json` and confirm `signals/.state/` is empty before
      the archive is planned — a live heartbeat makes archive ESTALE unrecoverable by retry.
