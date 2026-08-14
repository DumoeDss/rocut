## Why

B2 ruled the second Host is **Electron + Vite**, and P1 just delivered the packages it exists to
consume: three `@opencut/*` packages shipping TypeScript from `./src`, consumed today by exactly two
apps — the Next shell and the Vite example. Spec §3.3's claim (a minimal non-Elftia desktop
reference Host running the same scenarios through **its own ports**) is therefore entirely untested,
and so is the desktop-shaped evidence only this Host can supply: filesystem-backed storage, a
narrow CSP, and WASM/Worker constraints under a non-HTTP origin.

There is also a second reason this child cannot be a thin demo. **P2 adds a third consumer to a
boundary checker whose consumer scan set is hardcoded to two roots.** `public-entry-only`,
`no-internal-reexport` and `acyclic-direction` scan `apps/web/src/**` and `apps/vite-example/**` by
literal prefix; a new Host landing anywhere else is invisible to them, and a green run over an
unscanned consumer is exactly the collapsed-census failure P1's planning context named as P2's
inherited obligation. Widening the census is part of this change, not a follow-up.

## What Changes

- **A new app, `apps/electron-host`** (deliberately not `apps/desktop`, which stays excluded by the
  `no-desktop-app` rule): an Electron main process, a sandboxed preload, and a Vite-built React
  renderer that mirrors the Vite example's composition — project picker, editor, query-param
  harness dispatch, and a `surface-evidence` entry for the agent scenario.
- **Host-authored ports over the desktop shape**, composed like both existing Hosts (in-memory
  reference roles for the host-neutral parts, final-override for the Host-owned ones):
  - a **filesystem-backed `ProjectStore`** (`FilesystemProjectStore`) running in the renderer over
    a narrow preload bridge, with all byte I/O in the main process, `schemaVersion` aligned to the
    published migration runner reused from `@opencut/editor-classic/storage`;
  - **explicit runtime-asset loading** — the asset resolver and loader answer from a custom
    privileged scheme serving the same `EDITOR_RUNTIME_ASSETS` allowlist the Vite build copies;
  - **Host-constructed workers** — module workers built from same-origin `blob:` URLs, the pattern
    the runtime-resource port's own header blesses, exercised under the scheme origin.
- **A narrow CSP, stated and proven**: the renderer is served from a registered custom scheme
  (never `file://`) with a committed CSP that the boot proof and scenario runs must actually pass;
  any relaxation records the feature that forced it.
- **The parity harness gains a third Host**: `PARITY_HOST=electron` — a third `HostProfile`, an
  Electron launcher in the Playwright configs, and a host-scoped persisted-state reader (the
  current one reads IndexedDB names by literal; the Electron reader reads the filesystem store's
  own on-disk layout through the page's own bridge, preserving the "no purpose-built export path"
  rule). The same nine-interaction scenario, the agent scenario (`automate`, through the S03
  transaction API via the shared evidence entry), the disposal harness (reused, not re-invented),
  migration probes, and the portable port-conformance profile all run on it.
- **The boundary checker's consumer set becomes declared and derived**: `packages/boundary.json`
  gains the third consumer, `ownerOfPath()` resolves it through the declared list rather than
  hardcoded prefixes, and the census (files scanned, specifiers examined, edges examined) must
  **grow**, not hold constant. A deep import from the new Host is proven to fail the check.
- **Every other checker is re-asked** whether its scan set includes the new Host, with the same
  per-checker "follows the source / deliberately Host-scoped, because…" table P1's audit produced.
- **The cheap correct action P1's archive assigned to P2**: the fail-closed
  `expect(files.length).toBeGreaterThan(0)` non-vacuity assertion for the violation-scan test in
  `c5-storage-red-controls.test.ts` — added, and the scope itself NOT widened.

## Capabilities

### New Capabilities

- `sdk-desktop-reference-host`: the Electron + Vite reference Host itself — its process/serving/CSP
  shape, its own port implementations (filesystem store, scheme assets, blob workers), and the
  scenario evidence it must produce: parity interactions, `automate` through the transaction API,
  migration, disposal-harness reuse, and provider-private round-trip via port conformance.

### Modified Capabilities

- `sdk-package-boundary`: two requirements change because a third consumer lands after the freeze
  and the requirements as written do not force the checker to see it.
  - *Acyclic dependency direction, mechanically asserted* — consumer roots become a declared,
    derived part of the scan: files under any declared consumer root are owned and their
    `@opencut/*` edges judged, so the census grows when a consumer is added rather than the
    consumer landing outside the scan.
  - *Public entry points and no deep imports* — the no-deep-import guarantee is restated over every
    declared consumer, and a deep import from a consumer added after the freeze is a named
    negative-control case.

## Impact

**Added**

- `apps/electron-host/**` — main, preload, renderer, Vite config (reusing the Vite example's
  `editorAssets`/`moduleGraph` build plugins by import so the runtime-asset allowlist stays
  single-source), Playwright Electron config, `FilesystemProjectStore` + bridge, its conformance
  and migration probe tests, and a `typecheck` script.
- `electron` as a dev dependency of the new app (pinned; new to the repository).

**Modified**

- `packages/boundary.json` (declared consumers +1), `script/check-package-boundary.mjs`
  (consumer-derived scan roots, census output), `script/check-host-composition.mjs` (third
  composition root, asserting the stable `FilesystemProjectStore` final-override).
- `apps/vite-example/tests/parity/host-profile.ts`, `snapshot.ts` (host-scoped persisted reader),
  and the Playwright configs (electron branch: launcher instead of `webServer`).
- `apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts` (non-vacuity assertion
  only), `BOUNDARIES.md` (third-consumer section, checker audit table).

**Untouched, deliberately**

- Every public signature frozen by S03+S04, the three packages' export maps (any addition would be
  attributed to the module that forced it; none is expected), the parity classifier
  (`script/diff-parity-snapshots.mjs` unmodified), `apps/desktop` and the `no-desktop-app` rule.
- The 255-error pre-existing lint debt in `packages/*/src` — not P2's by proximity.

**Not covered by this change**

- Any CI leg — rocut CI runs the wasm checks and the Next build only; P3/P6 own adding legs.
- Installer, code signing, or auto-update packaging: "desktop packaging" here means the app runs as
  a real desktop process with its own origin, CSP and filesystem storage, not a distributed
  installer.
- Registry or tarball installation of the packages (P3's harness), versioning/labeling (P5),
  provenance regeneration (P7).
- The C7 headless proof is not ported to the Electron Host — §3.3 does not ask for it, and S02's
  headless work belongs to the browser Hosts.
- Consumption of the `./media` entry is **not forced**: it stays declared-and-unconsumed unless the
  Host genuinely needs it, in which case the consuming module is recorded per the monotone-growth
  rule.
