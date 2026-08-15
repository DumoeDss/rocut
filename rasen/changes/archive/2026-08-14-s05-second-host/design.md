## Context

P1 closed with three packages shipping TypeScript from `./src`, consumed by two apps. The boundary
checker's live census at close (re-capture before editing; these are the P1-close figures):
`acyclic-direction` ≈964 files / **329 cross-package edges**, `public-entry-only` **328
`@opencut/*` specifiers examined**, `no-internal-reexport` **863 files**, `no-elftia-import` ≈1048
files, `react-free-base` **68 files**. Consumer roots are literal prefixes —
`apps/web/src/**` and `apps/vite-example/**` — in `ownerOfPath()`, `packageAndConsumerSourceFiles()`
and `packages/boundary.json`'s `consumers`.

What already exists and is reused, not re-authored:

- **The composition pattern.** `apps/vite-example/src/host/vite-host-config.ts` spreads
  `createInMemoryPorts()` and final-overrides `store`/`diagnostics`/`ids`; `EditorSessionHost`
  (`@opencut/editor-classic/session`) takes the composed `EditorHost`. The Electron composition
  mirrors this file shape for shape.
- **The scenario machinery.** `apps/vite-example/tests/parity/` drives the nine-interaction parity
  scenario and the agent scenario; `host-profile.ts` is documented as "the only host-specific part".
  The agent scenario runs through the shared `/surface-evidence` entry with `?scenario=agent`
  (`AGENT_SCENARIO` from `@opencut/editor-contracts/vectors`) — that IS the S03 transaction-API
  path `automate` must take.
- **The disposal harness.** `C6DisposalHarness` (`@opencut/editor-classic/evidence`) takes
  `createHost`, `isDurableBrowserStore`, `buildMarker` and is mounted per-Host (a `/c6-disposal`
  route in `apps/web`, a `?c6-disposal-harness=1` query dispatch in the Vite example).
- **The port conformance suite.** `runPortConformance` (`@opencut/editor-ports/conformance`) is a
  plain async function with a `"portable"` store profile and an `exerciseMigration` flag; its
  opaque-payload case **is** the provider-private round-trip test (its own doc names Target State
  §5.6).
- **The published migration runner.** `runStorageMigrations` + 31 transformers +
  `CURRENT_PROJECT_VERSION` are exported from `@opencut/editor-classic/storage` and operate on
  `ProjectRecord` data, not on IndexedDB.
- **The runtime-asset allowlist.** `EDITOR_RUNTIME_ASSETS` in `apps/vite-example/build/editor-assets.ts`
  is the single copy list; the Vite plugin emits `dist/asset-manifest.json` from it.

Two measured traps shape the design. First, `readPersisted` in `tests/parity/snapshot.ts` reads
IndexedDB by literal database names — it cannot read a filesystem store, so the parity scenario's
save/reopen evidence needs a host-scoped persisted reader. Second, the ports' own header records
E0's `SecurityError … cannot be accessed from origin 'app://bundle'`: worker construction at the
editor's own origin is the frozen failure mode, and the port exists so the **Host** constructs
workers instead.

## Goals / Non-Goals

**Goals:**

- A minimal Electron + Vite reference Host at `apps/electron-host` that consumes only
  `@opencut/*` package entries and its own app code — no Elftia anything, no copied adapter code,
  no promotion of `apps/desktop`.
- Its own ports over the desktop shape: filesystem-backed `ProjectStore`, scheme-served runtime
  assets, Host-constructed workers — composed with the SDK's in-memory reference roles exactly as
  both existing Hosts compose theirs.
- The same scenario evidence the other Hosts produce: parity nine interactions, `automate` through
  the S03 transaction API, migration, disposal (S02 harness reused), provider-private round-trip.
- The boundary checker sees the third consumer: declared, derived, census **grows**, deep import
  from the new Host proven to fail. Every other checker audited with a recorded scope decision.
- P2 runs the live-server/browser region itself — boot proof, scenario runs, manifest check — with
  logged real exit codes; nothing in that region is trusted from a static gate.

**Non-Goals:**

- Changing any frozen S03+S04 public signature (a `failed` condition, returned to the contract),
  any package export map entry (an addition would be attributed; none is expected), or the parity
  classifier (`script/diff-parity-snapshots.mjs` stays unmodified).
- CI legs, installers/signing/auto-update, tarball install (P3), versioning (P5), examples (P6),
  provenance (P7), the C7 headless proof, the 255-error lint debt, forced `./media` consumption.

## Decisions

### E1 — Location: `apps/electron-host`, a consumer app, never `apps/desktop`

New directory `apps/electron-host` (package `@opencut/electron-host`, `private: true`), picked up
by the existing `workspaces: ["apps/*", ...]` glob with no manifest change. It is a **consumer**,
not a package: it owns no reusable surface and appears in `packages/boundary.json` only as a
declared consumer.

*Why not `apps/desktop`:* `check-distributable-boundary.mjs`'s `no-desktop-app` rule matches the
literal `apps/desktop/` prefix; reusing that path would either trip the rule or pressure relaxing
it, and spec §3.9 requires the rule to survive. A distinct path keeps the exclusion mechanical.
*Why not under `packages/`:* it publishes nothing and must not grow the export maps.

### E2 — Process shape: sandboxed renderer over a custom privileged scheme, never `file://`

Three processes: **main** (Electron, owns all `node:fs` access and the serving), **preload**
(`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; exposes exactly one bridge —
see E4), **renderer** (the Vite-built React app). The renderer is served from a registered custom
scheme, `opencut://` (`protocol.registerSchemesAsPrivileged` with `standard`, `secure`,
`supportFetchAPI`, `stream` before app ready; `protocol.handle` in main mapping `opencut://app/…`
to the built renderer output and `opencut://assets/…` to the copied runtime-asset directory).

*Why a scheme and not `file://`:* a `file://` page has origin `null` — workers, wasm instantiation
and `fetch` all degrade or fail, which is precisely the E0 failure class this Host exists to
exercise properly. A standard+secure scheme gives the renderer a real origin, makes the asset
resolver's output a same-origin URL, and lets the CSP be delivered as a response header by the
protocol handler (E7). Dev mode loads the Vite dev-server URL instead; production evidence always
comes from the scheme build.

Multi-entry parity with the Vite example (`index.html`, `surface-evidence.html`) is preserved by
serving both built entries; main selects the start entry from `--opencut-entry=<name>` (or
`OPENCUT_ENTRY`) so the Playwright launcher can target the evidence entry — the argv equivalent of
the example's separate HTML files.

### E3 — Port composition: own the desktop-shaped roles, reuse the reference roles

| role | source | why |
| --- | --- | --- |
| `store` | **Host: `FilesystemProjectStore`** (E4) | the desktop substitution this Host exists to prove |
| `assets` / `assetLoader` | **Host composition** over `opencut://assets/` — reusing `BrowserAssetResolver` / `BrowserRuntimeAssetLoader` from `@opencut/editor-classic/browser` with the scheme base (their own docs: "a custom-scheme URL [is] conforming") | the Host-owned part is the scheme, the allowlist copy and the manifest; the fetch/content-type semantics are generic |
| `runtimeResources` | **Host: scheme-rewriting worker construction** (E6), audio contexts and object URLs | worker construction is the one role the ports froze as Host-owned for exactly this origin problem |
| `diagnostics` / `ids` | `RecordingDiagnostics` / `DeterministicIdGenerator` from `@opencut/editor-ports/in-memory`, process-lifetime instances | both existing Hosts' precedent; the reference implementations exist to be reused |
| `environment` / `exporter` | `createInMemoryPorts()` defaults; `forceRendererBackend: "none"` on evidence entries, as the Vite evidence host does | host-neutral |

The composition root (`apps/electron-host/src/renderer/host/electron-host-config.ts`) mirrors
`vite-host-config.ts`: spread `createInMemoryPorts()`, final-override the owned roles. **The
evidence §3.3 wants is that a desktop host can substitute the desktop-shaped ports** — storage,
assets, workers — not that it re-derives a deterministic ID generator. Review should test exactly
that split: the four owned roles must not quietly delegate to browser or in-memory implementations.

### E4 — `FilesystemProjectStore`: one store class over a narrow bridge, two bridge impls

**The bridge.** The preload exposes a single `opencutStore` object — a minimal, store-shaped
surface (list/load/save/remove record; attachment CRUD; library-record CRUD; inspect; clear), all
keyed by project id / namespace / key strings. The renderer never sees a filesystem path; main
resolves every key inside a root it owns (`app.getPath("userData")/projects` in production; a
disposable directory from `OPENCUT_STORE_ROOT` for parity/disposal/conformance runs, which need
throwaway roots). The bridge interface lives in app source as `ProjectStoreFiles`.

**Two implementations, deliberately.** `IpcStoreBridge` (preload → IPC → main, main does the
`node:fs` work) is the production path; `NodeFsStoreBridge` (direct `node:fs` against a temp root)
exists for `bun test`, where there is no Electron. `FilesystemProjectStore` consumes only the
interface, so the conformance and migration evidence runs on the same store class the renderer
uses — the seam is the bridge, not the store.

**On-disk layout** (implementation detail, fixed here so probes can be Host-neutral):
`<root>/projects/<id>/record.json`, `…/attachments/<key>` (body) + `<key>.meta.json`,
`<root>/library/<namespace>/<key>.json`, `<root>/store.json` (identity + inspection). Writes are
atomic (`write temp → rename`); fs errors map to `ProjectStoreError` with the port's scope/code
semantics.

**Schema and migration.** `schemaVersion` = `CURRENT_PROJECT_VERSION` from
`@opencut/editor-classic/storage` (31 today); `migrate()` delegates to the published
`runStorageMigrations`. Migration evidence is a Host-authored probe set under `bun test` over a
seeded legacy envelope on disk: old-version record migrates forward through the published runner;
a failing transform leaves the source record intact; the "no opt-in" refusal holds. These are the
mechanism-neutral analogs of the C5 browser probes — the browser probes themselves are
IndexedDB-specific and are **not** claimed for this store (stated non-coverage).

**Conformance and provider-private round-trip.** `runPortConformance({ ports, storeFixture,
profile: "portable", exerciseMigration: true })` over the composed ports with a disposable
`NodeFsStoreBridge` fixture. The suite's opaque-payload case — fields the contract has never heard
of, nested, mixed types — is the provider-private round-trip requirement; a store that normalized
or reshaped them fails it.

### E5 — Runtime assets: one allowlist, copied by the same plugin, served by the scheme

The renderer build imports `editorAssets` (and `moduleGraph`) **from
`apps/vite-example/build/`** — a cross-app build-tool import, not a package entry — so
`EDITOR_RUNTIME_ASSETS` stays single-source and the electron build emits its own
`asset-manifest.json` and module graph. The scheme serves `opencut://assets/<logical-path>` from
the copied directory, so `BrowserAssetResolver` with base `opencut://assets/` resolves every
logical path the editor asks for (`fonts/font-atlas.json`, `flags/…`, `logos/…`, the C4 worker
fixture).

*Rejected: duplicating the allowlist in the electron app* — two lists drift, and the allowlist is
the whole mechanism. *Rejected: a new package entry for the allowlist* — it would widen the
published surface for a build concern. Consumer↔consumer edges are excluded from
`acyclic-direction` by design; the audit (E9) records this import as deliberate.

`check-asset-manifest.mjs` is parameterized (or invoked twice) so the electron `dist` gets the
same manifest audit the Vite build gets — same rules, second build output.

### E6 — Workers: same-origin scheme URLs first, `blob:` as fallback

The renderer origin is `opencut://app`, so a worker script served at
`opencut://app/assets/workers/…` is **same-origin by construction** — `new Worker(schemeUrl,
{ type })` needs no escape hatch, and `import.meta.url`-relative sidecar resolution inside the
worker keeps working. The Host's `runtimeResources.createWorker` therefore **rewrites the
request URL onto the scheme** (the `WorkerRequest.url` "request, not a guarantee" pattern) and
constructs directly. If a worker form resists scheme serving (module workers with external import
maps, say), the blessed fallback is fetch-bytes → `blob:` URL construction — both are conforming
per the port's header. The exercised case is the C4 worker fixture (the parity scenario and
disposal harness use it; the transcription worker is not exercised by these scenarios — stated,
not hidden).

### E7 — CSP: delivered by the protocol handler, proven by the boot gate

The protocol handler sets `Content-Security-Policy` on every scheme response (and the built
`index.html` carries the identical `<meta>` so the policy is visible in the artifact). Starting
set, narrowest reasonable for this editor:

```
default-src 'none';
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self' blob:;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
media-src 'self' blob: data:;
font-src 'self' data:;
connect-src 'self'
```

`'unsafe-inline'` in `style-src` is the React-app floor (inline `style=` attributes); everything
else is `'self'`-scoped; `wasm-unsafe-eval` is the wasm instantiation token. **This set is a
hypothesis, not a decision**: the boot gate treats any CSP violation report as a failure, and any
relaxation must name the feature that forced it. The boot gate (electron launches, loads the
editor entry, no CSP violations, no console errors, timeline visible) runs before any interaction
work — the vite Blocker of P1 is the precedent for why.

### E8 — Scenario harness: a third `HostProfile`, an Electron page source, a host-scoped persisted reader

- `host-profile.ts`: `HostName` gains `"electron"`; the profile's `entryPath` is the full
  `opencut://app/index.html` URL; `createProject` uses the same `clickUntil` pattern against the
  electron picker (the picker records `?project=<id>` exactly as the Vite one does — the electron
  app is written to match, so the profile stays trivial).
- **Page acquisition.** The parity specs' `page` fixture comes from a browser context; for the
  electron host the page comes from `_electron.launch()` (`@playwright/test`'s Electron support;
  the app binary is the electron package in the app's `node_modules`; launch args mirror the GPU
  flags — `--use-angle=swiftshader`, `--enable-unsafe-swiftshader`). The shared specs gain a
  bounded branch at the top — `acquireHostPage(browserPage)` returns the electron window's page
  (launching once per test) or the fixture page — after which **every interaction line is
  untouched**. `agent.pw.ts`'s `ENTRY` becomes conditional (`opencut://app/surface-evidence.html`
  for electron, launched with `--opencut-entry=surface-evidence`); its reload-and-reopen phase is
  a full window reload against the same disk-backed store.
- **Persisted reader.** `readPersisted` gains a host-scoped seam: the electron branch reads the
  filesystem store's own layout **through the page's own bridge** (`page.evaluate` over the same
  preload surface the store uses) — preserving the fixture spec's "read from the editor's own
  persisted project record, not a purpose-built export path" rule in the new medium. The
  IndexedDB reader for vite/next is byte-identical in behavior.
- **Artifacts.** Electron snapshots/ledgers land in `tests/parity-artifacts/electron/` (or the
  resolved regression evidence dir for the agent run, per `evidence-path.ts`); the snapshot diff
  runs electron-vs-vite with the **unmodified** `diff-parity-snapshots.mjs` — if the tool's host
  pair is hardcoded, adding a pair selection is an argument change, never a classifier change.
  Acceptance is the §3.2 bar: zero semantic rows outside the documented idempotency envelope.
- **Disposal.** `?c6-disposal-harness=1` on the app entry mounts `C6DisposalHarness` with the
  electron `createHost`, `isDurableBrowserStore: (store) => store instanceof
  FilesystemProjectStore`, and a build marker env — the harness, oracle classes and
  durable-reopen proof are reused untouched; only the composition is new. The run uses a
  disposable `OPENCUT_STORE_ROOT`.
- **Determinism.** Same rules as the other hosts: `page.route("**/*")` third-party blocking (works
  on electron pages), first-party-only assets, `DeterministicIdGenerator`.

### E9 — Checker widening: oracle-first, census-as-regression-test, per-checker audit

Order matters and copies P1's stage-1 discipline: **teach the checkers before the source lands**,
with a control run proving the scope change alone changes nothing.

1. `packages/boundary.json` gains `"apps/electron-host"` in `consumers`;
   `ownerOfPath()` and `packageAndConsumerSourceFiles()` derive consumer root prefixes from the
   declared list instead of the two hardcoded strings. Control: with no files under the new root,
   output is byte-identical to the pre-change baseline. Then the app lands and the census **must
   grow** — files scanned by ~the app's file count, `@opencut/*` specifiers examined and edges by
   the app's package imports. Before/after recorded side by side; a hold or collapse is a scope
   regression even at `PASS`.
2. Deep-import probe, violation-and-revert: an undeclared `@opencut/editor-classic/src/…` import
   placed in an electron-host source file must fail `public-entry-only` live; revert must return
   exit 0 with the enlarged census. The negative/converse control fixtures gain an
   electron-consumer case.
3. `check-host-composition.mjs` gains the third composition root, asserting the stable
   `FilesystemProjectStore` construction and final-override — the rule's intent ("each production
   Host explicitly constructs one stable durable store") generalizes past `BrowserProjectStore`.
4. **Every runnable checker gets a row** in an audit table (P1 task 2.4 precedent): "scope
   follows the source" + the edit, or "deliberately Host-scoped" + the reason. Predicted
   classifications, to be verified not assumed: `no-elftia-import` auto-covers (its enumeration is
   repo-wide — confirm its census grows); `check-distributable-boundary` stays Vite-graph-scoped
   (the electron build emits its own module graph; the checker's scope decision is recorded);
   `check-type-baseline` stays `apps/web`-program-scoped — it watches the *packages'* diagnostics,
   and the electron app carries its own `tsc --noEmit` `typecheck` script as its gate;
   `check-asset-manifest` extended to the electron dist (E5); singleton/runtime-asset/headless
   checkers audited individually. Silence per checker is not acceptable.
5. The owed non-vacuity assertion: `c5-storage-red-controls.test.ts`'s violation scan gains
   fail-closed `expect(files.length).toBeGreaterThan(0)` — the scope itself is NOT widened.

### E10 — Sequence: gate, oracle, store, composition, scenarios, audit

0. **Gate (throwaway spike):** `electron` installs on this machine (AV risk — see Risks), a
   minimal main + scheme + blank window boots, the CSP header is observed, and `_electron.launch`
   reaches it from Playwright. Evidence recorded; nothing else starts before this is green.
1. **Oracle-first checker widening** (E9.1) with the no-files control.
2. **Renderer skeleton:** Vite build with `wasm()` + `topLevelAwait()` + `editorAssets` imports,
   React dedupe, `@source`-complete stylesheet (the P1 Blocker lesson), booting the real editor on
   in-memory ports — earliest end-to-end proof, no fs store yet.
3. **Store:** bridge interface, `NodeFsStoreBridge`, `FilesystemProjectStore`, port conformance
   (portable + migration), fs migration probes, provider-private round-trip — all `bun test`
   legs, no Electron needed.
4. **Full composition:** scheme assets + manifest, worker construction, CSP header; **boot gate
   under CSP** — violations are failures.
5. **Harness entries:** surface-evidence entry, disposal query dispatch, disposable-root wiring.
6. **Parity:** host-profile + page-acquisition + persisted-reader branches; nine interactions on
   electron; snapshot diff vs vite; vite+next re-run to prove the shared-spec edits regressed
   nothing.
7. **Agent + disposal runs** on electron with real-exit-code logging.
8. **Audit close-out:** checker table, all-runnable-checkers sweep, census before/after,
   `c5` non-vacuity assertion, `BOUNDARIES.md` third-consumer section, `PARITY.md` restate.

## Risks / Trade-offs

- **[Electron's install is blocked or mangled by AV staging on this machine (the `%TEMP%`
  pattern).]** → Gate 0 exists to fail here first and cheaply; `ELECTRON_CACHE` pointed at an E:
  path outside any Temp directory; a hang is read as the AV signature, not a tooling bug.
- **[A worker form resists same-origin scheme serving.]** → E6's blessed `blob:` fallback; the
  exercised case (C4 fixture) is a single self-contained script; the transcription worker's
  sidecar case is stated as not exercised rather than hidden.
- **[The CSP is too strict and the editor degrades silently rather than failing loudly.]** → The
  boot gate treats CSP violation reports and console errors as failures; relaxations are
  attributed to the forcing feature. Starting narrow and relaxing with evidence, never the
  reverse.
- **[Editing the shared parity spec regresses the two existing hosts.]** → The edits are confined
  to page acquisition, entry selection and the persisted reader; both existing hosts are re-run
  after the branch lands; the interaction bodies are diffed untouched.
- **[`readPersisted`'s IndexedDB literal breaks the electron snapshot.]** → It is exactly why the
  host-scoped seam exists; the electron reader goes through the page's own bridge, not a test-only
  channel, preserving the fixture's no-export-path rule.
- **[The census looks grown but the new files are being scanned vacuously (e.g. only `.ts`, not
  `.tsx`).]** → The deep-import probe runs from a real electron-host `.tsx` file; the census
  deltas are reconciled against the app's actual file count, as P1's 7.5 did with the 341-edge
  baseline.
- **[Electron's bundled Chromium differs from Playwright's pinned browser.]** → `_electron` drives
  whatever binary the app launches; no `channel` is configured for the electron leg; GPU flags are
  passed as launch args, mirroring the parity config.
- **[The fs store passes conformance but diverges from the session's expectations in the real
  app.]** → Conformance runs the same store class the renderer uses (the bridge is the only seam),
  and the parity scenario exercises the store end-to-end through real sessions, reloads and
  reopen.

## Migration Plan

Nothing user-facing migrates: this is an additive app. Repository rollback is `git revert` of the
child's commits; the stage order (oracle → skeleton → store → composition → scenarios) leaves a
consistent, verifiable tree at every stage boundary. Ship mode is **local (commit only)** — the
portfolio delivers once, at the parent, after all seven children.

## Open Questions

- **The exact CSP token set** — settled empirically at the boot gate (E7's set is the starting
  hypothesis). Not blocking: the gate is early (stage 4) and cheap to iterate.
- **Whether `diff-parity-snapshots.mjs` accepts an arbitrary host pair today** — verified at
  stage 6; if its pair is hardcoded, host-pair selection becomes an argument, and the classifier
  itself remains untouched either way.
- **Electron version pin** — implementer pins the current stable exact version at gate 0; any
  later bump is its own change, not a silent caret drift.
- **Whether the electron renderer needs `next-themes` declared explicitly** (the Vite example
  imports it via hoisting without declaring it) — the electron app declares what it imports;
  settled when the skeleton's dependency list is written at stage 2.
