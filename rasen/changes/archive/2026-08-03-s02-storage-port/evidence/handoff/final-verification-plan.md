# C5 final verification, review, cleanup, and local-ship plan

Date prepared: 2026-08-02  
Planning root: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rasen/changes/s02-storage-port`  
Product worktree / command cwd unless stated otherwise: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c5`  
Frozen product base: commit `0ef35459f685d5d41a25d0ef959aff691b7519cd`, tree `286272307b05d23826ffa7223a76695365194dba`, branch `feat/s02-storage-port`  
Delivery mode: **local commit only**, because `auto-run.json` identifies this change as portfolio child C5 of `s02-session-runtime-host-ports`. Do not push, open a PR, merge, archive, or deploy from task 12.9.

This is an execution plan, not final evidence. The verifier-round-1 and cleanup documents are explicitly invalidated pre-fix snapshots. Strategy attempt 4 has implementation evidence but still requires independent non-author confirmation. Tasks 11.1-12.9 stay unchecked until their final-tree evidence exists.

## 1. Fixed facts and hard baselines

### Required identities

| Item | Required identity |
| --- | --- |
| parity fixture tree | `e1fbb55b985f4fb490c6b233d18c50c58ea14c28` |
| parity oracle blob (`script/diff-parity-snapshots.mjs`) | `fa387ebea1e7f0cc1110eebcb922d393a1337842` |
| type fixture blob / SHA-256 | `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8` / `0f7cc855fc8f5c7edd68b2c371bae993fe8e713d2ffd4ef21956de72bd387622` |
| public session blobs (`create-session.ts`, `session-types.ts`, `index.ts`) | `ee63d7843fa73df6959aa92030bf4871236b6038`, `c67d9822a2a6c994be14f367e6980fbbaa6e454b`, `59dd907482a109f8627b217764925bd284f3f223` |
| Rust trees (`rust/wasm`, `rust/crates/gpu`, `rust/crates/compositor`) | `d782b046c0f39e85b8a5ed518b42389214c211e5`, `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2`, `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34` |
| generated WASM JS / binary SHA-256 | `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1`, `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1` |
| root and `rust/wasm` MIT license SHA-256 | `8117f9bb64534f7530fc6139b014fd1c1465f7981f93d1871789150fa3f59d3d` |

The two public-session files that currently appear as `M` in `git status` are line-ending metadata only: `git diff` is empty and `git hash-object --path=<path> <path>` already matches the protected blobs. They must not be staged unless a later real content diff is independently justified; the final hash gate remains authoritative.

### Numeric gates

- Type ceiling: exactly three inherited diagnostics, compared by `file + code + message`, not merely by count:
  1. `next.config.ts`, `TS2345`, incompatible app-local/root `NextConfig` identities;
  2. `src/timeline/__tests__/update-pipeline.test.ts`, `TS2769`, `number` is not branded `MediaTime`;
  3. `src/timeline/placement/__tests__/resolve.test.ts`, `TS2769`, numeric `adjustedStartTime` is not `MediaTime`.
- Full-suite accepted red multiset: exactly six `resolveTrackPlacement` failures with `ReferenceError: Cannot access 'ZERO_MEDIA_TIME' before initialization`, one masks loader/module failure in `apps/web/src/masks/__tests__/snap.test.ts` with `TypeError: wasm.__wbindgen_start is not a function`, and one timeline loader/module failure in `apps/web/src/timeline/__tests__/update-pipeline.test.ts` with `ReferenceError: Cannot access 'DEFAULTS' before initialization`. The summary remains exactly `8 fail / 2 errors`; the passing-test and expectation totals may increase only by attributable C5 tests.
- Frozen-base full suite was `250 pass / 8 fail / 2 errors / 688 expectations`. The latest complete pre-attempt-4 broad run was `291 pass / 8 fail / 2 errors / 788 assertions`; attempt 4 subsequently added 28 isolated topology tests / 185 expectations. Treat `319 pass / 973 expectations` as a sanity projection only, not as a substitute for parsing every final red identity.
- Vite comparison baseline required by task 11.3 is **2,873 transformed modules**. C4 evidence also contains 2,863 (initial frozen build) and 2,871 (intermediate `dist-c4-final` / forced-none builds); those are earlier states. The final post-manifest-fix build and protected parity evidence both report 2,873, and `tasks.md` explicitly selects it. C5 verifier round 1 observed 2,882 (+9) before later fixes; that is an invalidated C5 measurement, not the baseline or final expected count.
- Source runtime boundary comparison baseline: 699 production modules. A C5 delta is allowed only when every added module is classified to the reviewed C5 source graph.
- Asset manifest: exactly 298 copied files and seven emitted files. Bytes/hashes are recorded from the fresh C5 build; count drift is a hard stop unless independently explained as an intentional C5 asset change (none is currently designed).
- WASM surface: exactly 38 JavaScript exports, 58 binary exports, and 609 imports.
- Protected parity: one scenario per Host, ten asserted interactions per Host, 195 leaf values, zero semantic differences, and exactly nine known incidental paths.

### Provenance warning discovered during inventory

`SOURCE_INVENTORY.json/.md` is stale for C5: 49 currently dirty source paths are absent from its recorded drift, and the recorded added list still contains the now-deleted `browser-host-adapter.ts`. The generator intentionally derives drift from `git diff <upstream-pin>` and therefore cannot see ordinary untracked files. Before running the canonical generator, apply intent-to-add or stage the already reviewed intentional new source files; never hand-edit either inventory file. The pinned source totals must remain 1,069 files / 7,500,075 bytes / rollup `8ce81cbd563de44ca6d99857fa9959feaeae4eb0992656deb1c4a10b7ba168bf` because they describe upstream pin `cf5e79e919144200294fb9fed22a222592a0aeea`, while the drift sections must change to describe C5.

## 2. Output ownership, environment, and concurrency rules

Before any gate, capture `git status --porcelain=v1 --untracked-files=all`, `git rev-parse HEAD`, `git rev-parse HEAD^{tree}`, `node --version`, `bun --version`, package versions reported by the builds, and the exact command cwd. HEAD must still be the frozen base until task 12.9.

### Secret-safe Next environment

The Next build/server inherits these nine environment **names**; verify each is present without printing its value: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MARBLE_API_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `MARBLE_WORKSPACE_KEY`, `FREESOUND_CLIENT_ID`, and `FREESOUND_API_KEY`. Build controls are `OPENCUT_PUBLIC_BASE`, `OPENCUT_NEXT_DIST_DIR`, `C4_BUILD_MARKER`, and `NEXT_TELEMETRY_DISABLED`. Evidence records names and presence only, never values.

### Fresh-output ledger

Use one run identifier in all names/logs, record it in `evidence/regression.md`, and create an ownership ledger before mutation.

- Vite output: `apps/vite-example/dist-c5-final-<run-id>`. It must be absent before the run. If it exists, choose a new run id; do not delete or reuse it.
- Next output for the protected root-base run must be `apps/web/.next`, as in the verified C4 procedure. If `.next` exists, move it intact to an absent sibling `apps/web/.next-pre-c5-final-<run-id>` and record that backup; never overwrite it. Build a new `.next`, copy evidence, remove only that newly created `.next`, then restore the backup exactly.
- Parity output: `apps/vite-example/tests/parity-artifacts`. If it exists, move it intact to an absent sibling with the run id and restore it after evidence has been copied. Do the same for `apps/vite-example/tests/.pw-output` if pre-existing.
- C5 browser scratch: only `apps/vite-example/tests/.pw-output-c5-storage` belongs to that config. Record whether it pre-existed. Remove only the run-created directory or exact `.last-run.json`; preserve a pre-existing directory by move/restore.
- Raw logs and emitted inventory belong under `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/.rasen/changes/s02-storage-port/ephemera/final-<run-id>/`. Final summaries belong in `evidence/regression.md`; the parity classification may additionally land at `evidence/parity-final-diff.md` and emitted inventory at `evidence/emitted-inventory-final.json`.
- Preserve `apps/web/.content-collections/generated`; it is an ignored but required type/build input created through the canonical Content Collections builder. Do not classify it as disposable during this run.
- Never delete or enumerate a user browser profile. Browser fixtures must use their randomized `c5-disposable-<uuid>` identities and must prove empty before/after test inventories. No manual database/OPFS cleanup is authorized.

### Ports and process isolation

- `playwright.c5-storage.config.ts` hard-codes the dev server command to port **4175** and sets `reuseExistingServer: true`. Before running, query the listener and owner. If any listener exists, do not reuse or kill it; wait or reschedule the gate. This prevents a foreign/stale server from being accepted as C5.
- Reserve **43551** for the manually owned Vite preview and **43552** for the manually owned Next standalone server only if both are free. Record owner PID and exact command line after launch. Stop only those recorded process trees, leaf-to-root, and verify the ports are released.
- Run build/browser/parity phases serially: fresh Vite build -> Vite manifest/parity -> stop Vite -> fresh Next build -> Next parity -> snapshot diff -> emitted cross-Host checks -> cleanup. Do not build or serve the two Hosts concurrently against shared parity artifacts.
- Commands expected to exceed two minutes run as an owned background process with distinct stdout/stderr logs and foreground polling at no more than 270-second intervals. Never fire-and-forget.
- Do not run another Bun test process concurrently with the full suite.

### Bun `mock.module` contamination

The four attempt-4 topology files directly install incompatible global module mocks. A combined single-process four-file invocation is invalid and has already leaked the media mock into the migration test (`opfsRead` missing). Run each in a separate Bun process:

```powershell
bun test apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts
bun test apps/web/src/services/storage/__tests__/browser-project-store-media-topology.test.ts
bun test apps/web/src/services/storage/__tests__/browser-project-store-cascade-topology.test.ts
bun test apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts
```

Expected results are respectively 9/9 (53 expectations), 5/5 (55), 7/7 (48), and 7/7 (29). Also run `c5-storage-red-controls.test.ts` in its own process because it mocks `indexeddb-adapter`. The final unfiltered `bun test` is still mandatory: if global mocks create a new full-suite red, that is not an acceptable “invalid combined run.” Make the test files self-isolating or otherwise fix the runner-visible contamination, then rerun; task 11.10 cannot exclude them.

## 3. Task-by-task execution and acceptance

### 11.1 Focused C5 matrix

Run this reviewed 15-file positive group from the product root. Its session/project files already use child-process isolation for the shared WASM mock; the four topology files and storage RED-control file remain outside it as required above.

```powershell
bun test apps/web/src/editor/ports/__tests__/conformance.test.ts apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts apps/web/src/services/storage/migrations/__tests__/v1-to-v2.test.ts apps/web/src/services/storage/__tests__/migration-provider-private.test.ts apps/web/src/editor/session/__tests__/session-async-store-isolation.test.ts apps/web/src/editor/session/__tests__/session-lifecycle.test.ts apps/web/src/editor/session/__tests__/session-state-isolation.test.ts apps/web/src/editor/host/__tests__/production-composition.test.ts apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts apps/web/src/core/managers/__tests__/project-persistence-rewire.test.ts apps/web/src/core/managers/__tests__/media-persistence-rewire.test.ts apps/web/src/core/managers/__tests__/save-manager-persistence-failure.test.ts apps/web/src/media/__tests__/persistence.test.ts apps/web/src/media/__tests__/processing-capacity.test.ts apps/web/src/components/__tests__/storage-provider-operations.test.ts
bun test apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts
```

Then run the four isolated topology commands above and all non-vacuity controls:

```powershell
bun test script/__tests__/c5-storage-boundary-red.test.mjs
node script/check-port-boundary.mjs --negative-control
node script/check-host-composition.mjs --negative-control
node script/check-session-state-boundary.mjs --negative-control
```

With port 4175 proven free, run the unchanged real-browser configuration, first focused and then full, serially:

```powershell
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts browser-store.pw.ts
bun x playwright test --config=apps/vite-example/playwright.c5-storage.config.ts
```

Acceptance: every Bun focused file exits 0; in-memory shared conformance is 18 pass / 0 fail with only the declared no-migration skip; browser store matrix is 19 pass / 0 fail / 0 skip; full Chromium config is 3/3 (browser store, C4 forced-none, migration round 1); all attempt-4 cascade/migration topology booleans are true; before/after database and directory inventories are empty; negative controls catch every named violation. Record actual versions, counts, skips, and exit codes rather than copying prior counts.

### 11.2 Type gate

```powershell
node script/check-type-baseline.mjs
```

This must exit 0 and report no diagnostic outside the pinned set. Do **not** use `--regenerate`. For auditable raw identity output, run from `apps/web`:

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --incremental false --pretty false
```

The direct compiler is expected to be non-zero because the three inherited diagnostics remain; compare its normalized `file + code + message` multiset to the table above. Ignore neither a fourth identity nor a changed message merely because the total stays three. Do not use the repository-root TypeScript 6 binary; verifier round 1 proved that invocation is invalid evidence.

### 11.3 Fresh Vite build and manifest

From `apps/vite-example`, set the build controls `OPENCUT_PUBLIC_BASE`, `C4_VITE_OUT_DIR`, and `VITE_C4_BUILD_MARKER` to the root base, exclusive run-owned output, and unique run marker, then run:

```powershell
bun run build
```

From the product root:

```powershell
node script/check-distributable-boundary.mjs apps/vite-example/dist-c5-final-<run-id>/module-graph.json
```

Start an owned preview on free port 43551:

```powershell
bun run preview -- --port 43551 --strictPort --host 127.0.0.1
```

Then run:

```powershell
node script/check-asset-manifest.mjs --manifest apps/vite-example/dist-c5-final-<run-id>/asset-manifest.json --base http://127.0.0.1:43551/ --public-base / --marker <run-marker>
```

Acceptance: output path was absent before build; build and boundary gate exit 0; build log records Vite version, duration, and transformed-module count; marker/base match; module graph has all ten exclusion rules clean; manifest has 298 copied and seven emitted files with MIME, byte length, SHA-256, category/graph completeness, served/local identity, and exclusions clean. Compare module count to 2,873 and explain the exact C5 graph delta by module categories; do not treat the pre-fix 2,882 as an approved ceiling.

### 11.4 Fresh Next build and 18/18 gate

After preserving any pre-existing `.next`, capture `apps/web/tsconfig.json` SHA-256. From `apps/web`, verify all nine required environment names are present without logging values, set the four build controls for root base/default `.next`/unique marker/telemetry disabled, then run:

```powershell
bun run build
```

Acceptance: build exits 0 under Next 16.1.3 (or records and explains an actual dependency-version change); compilation succeeds; static generation reaches exactly 18/18 and emits the complete route table; the marker occurs in compiled output; `.next/standalone/.../apps/web/server.js` exists; `tsconfig.json` before/after SHA-256 is identical. Any font/network fetch failure is a build failure, not a pass.

### 11.5 Protected Vite/Next parity and diff

Do not edit anything under `apps/vite-example/tests/parity/**` or the diff script. Against the still-running owned Vite preview, run from `apps/vite-example` with `PARITY_HOST`, `C4_VITE_OUT_DIR`, `PARITY_BASE_URL`, and `PARITY_NO_WEBSERVER` selecting the already built output/server:

```powershell
bun run test:parity
```

Stop and verify release of the Vite process/port. Assemble the fresh Next standalone directory by copying `apps/web/public` to its `public` child and `apps/web/.next/static` to its `.next/static` child, preserving relative paths. Start its exact `server.js` with inherited required environment names and `PORT`/`HOSTNAME` selecting the owned 43552 loopback listener. Smoke `/projects` for HTTP 200, then run from `apps/vite-example` with `PARITY_HOST=next` and `PARITY_BASE_URL` pointing at that root-base server:

```powershell
bun run test:parity
```

Do not use a non-root Next base for protected parity: the unchanged Host profile deliberately navigates to absolute `/projects`, and C4 evidence proved a prefixed invocation is verifier error. Stop the exact Next process and verify port release.

From the product root, classify the two fresh snapshots:

```powershell
node script/diff-parity-snapshots.mjs apps/vite-example/tests/parity-artifacts/vite/snapshot-vite.json apps/vite-example/tests/parity-artifacts/next/snapshot-next.json E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rasen/changes/s02-storage-port/evidence/parity-final-diff.md
```

Acceptance: each Host scenario exits 0; all ten named interactions (`create-open`, `import-media`, `place-multi-track`, `drag`, `trim`, `split`, `snap`, `scrub`, `play`, `save-reload-reopen`) have `error: null`; diff exits 0 with 195 leaves, zero semantic and exactly nine incidental differences at the known paths (duration/name, five one-frame track fields, playhead, zoom). Any extra/missing path requires explanation and independent approval; a semantic difference blocks.

### 11.6 Parity tree/oracle integrity

After parity, run:

```powershell
git status --short -- apps/vite-example/tests/parity script/diff-parity-snapshots.mjs
git diff --exit-code 0ef35459f685d5d41a25d0ef959aff691b7519cd -- apps/vite-example/tests/parity script/diff-parity-snapshots.mjs
git rev-parse 0ef35459f685d5d41a25d0ef959aff691b7519cd:apps/vite-example/tests/parity
git rev-parse 0ef35459f685d5d41a25d0ef959aff691b7519cd:script/diff-parity-snapshots.mjs
```

Acceptance: no tracked or untracked protected-source status, empty diff, and exact tree/blob values from section 1. Generated `tests/parity-artifacts/**` is evidence output and must never be confused with the protected fixture tree.

### 11.7 Source graph, emitted graph, and manifest tails

With both fresh build outputs still present, run serially from the product root:

```powershell
node script/check-runtime-asset-boundary.mjs
node script/check-runtime-asset-boundary.mjs --negative-control
node script/check-emitted-runtime-assets.mjs --positive-control
node script/check-emitted-runtime-assets.mjs --negative-control
node script/check-emitted-runtime-assets.mjs --vite-output apps/vite-example/dist-c5-final-<run-id> --vite-base / --next-output apps/web/.next --next-base / --inventory-output E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rasen/changes/s02-storage-port/evidence/emitted-inventory-final.json
node script/check-asset-manifest.mjs --negative-control
```

Acceptance: source gate sees both Host roots, every required asset/Worker layer, and all five rules clean; every negative is caught; cross-Host emitted inventory has entry/Worker/editor-WASM/ORT layers and no escaping/root/static/topology violation; the generated inventory is non-empty; source count is compared to C4's 699 and every delta is attributed to reviewed C5 files; Vite module graph comparison and 298/7 manifest counts remain accounted. Preserve the fresh inventory before deleting outputs.

### 11.8 WASM API and artifact gates

```powershell
bun run check:wasm
node script/check-wasm-api-surface.mjs --negative-control
node script/run-wasm-api-contract.mjs
node script/test-wasm-runtime-api.mjs
```

Acceptance: all commands exit 0; resolved root/web packages match the self-built artifact; source freshness, license, path-remap, CI wiring, structural/runtime contracts, and all negative controls pass; surface remains exactly 38 JS exports / 58 binary exports / 609 imports. No rebuild is authorized by this verification step. A stale-artifact failure must be investigated, not repaired by an unplanned Rust/WASM rebuild.

### 11.9 Protected public-session/type/Rust/generated hashes

For each public-session/type file run `git hash-object --path=<path> <path>` and compare with section 1; compute SHA-256 for the type fixture and two generated WASM files with `Get-FileHash -Algorithm SHA256`. For each protected tree, prove the worktree has no tracked or untracked delta, then read its frozen identity:

```powershell
git status --short -- rust/wasm rust/crates/gpu rust/crates/compositor
git diff --exit-code 0ef35459f685d5d41a25d0ef959aff691b7519cd -- rust/wasm rust/crates/gpu rust/crates/compositor
git rev-parse 0ef35459f685d5d41a25d0ef959aff691b7519cd:rust/wasm
git rev-parse 0ef35459f685d5d41a25d0ef959aff691b7519cd:rust/crates/gpu
git rev-parse 0ef35459f685d5d41a25d0ef959aff691b7519cd:rust/crates/compositor
```

The status + diff pairing is load-bearing because a base-tree lookup alone says nothing about an untracked worktree file. Every identity must exactly match preflight.

### 11.10 Full regression and exact red comparison

Run the unfiltered suite once, alone, from the product root, capturing complete stdout/stderr and exit code:

```powershell
bun test
```

Expected process exit is non-zero solely because the inherited red remains. Parse the raw output into a normalized multiset; require exactly the eight identities/two loader-module errors in section 1, no extra identity, and no missing C5 focused/topology file. Compare pass/test/file/expectation totals to the latest `291/788` run plus the 28/185 attempt-4 additions and explain any delta by test identity. A mock-contamination failure is a new red and blocks; do not filter the test files or summarize the command as green.

### 11.11 Source inventory, provenance, SBOM, license/reference, generated files

First audit and apply intent-to-add/staging only to the already reviewed intentional new C5 source paths so the canonical inventory can see them. Never use a blind `git add -A`; show the exact candidate path list and reject build/evidence/profile/database paths before changing the index.

Then run:

```powershell
node script/generate-source-inventory.mjs
node script/generate-sbom.mjs
node script/check-reference-boundary.mjs
```

Acceptance:

- `SOURCE_INVENTORY.json/.md` were changed only by `generate-source-inventory.mjs`; pinned totals/rollup remain exact; drift includes every intentional C5 source add/modify/delete, including deletion of `browser-host-adapter.ts`, with no stale path.
- Compare `git diff --name-status cf5e79e919144200294fb9fed22a222592a0aeea -- .gitignore apps rust script` against `PATCHES.md`: every behaviorally modified inherited file has a preserved/new row; newly added files are not patch rows. `PATCHES.md` is hand-maintained provenance, not a generated file.
- `generate-sbom.mjs` is canonical for `SBOM.md`. Because C5 changes no package or Cargo manifests/locks, the regenerated SBOM must be byte-identical to base and retain 1,359 npm packages / 763 workspace-lock Rust crates / 80 wasm32 graph crates. Any delta requires dependency attribution, not a silent generated-doc update.
- `LICENSE` and `rust/wasm/LICENSE` match the SHA-256 in section 1. `git diff --exit-code <base> -- LICENSE REFERENCE_SOURCES.md UPSTREAM.md bun.lock Cargo.lock SBOM.md` is empty unless an independently reviewed C5 provenance fact requires a documented change; none is currently expected.
- `git ls-files --error-unmatch SOURCE_INVENTORY.json SOURCE_INVENTORY.md SBOM.md` succeeds. `git ls-files` returns no build/cache/generated runtime path under `apps/vite-example/dist*`, `apps/web/.next*`, `apps/web/.content-collections`, `apps/vite-example/tests/parity-artifacts`, `apps/vite-example/tests/.pw-output*`, or `rust/wasm/pkg`.

Rerun any graph/reference/type gate affected by the generated provenance delta. Do not hand-merge generated files.

### 11.12 Final regression evidence

Write `evidence/regression.md` only from final-run logs. For every command record cwd, exact argv, environment **names** (secret values omitted), tool versions, start/end time, exit code, result counts, output path, and relevant SHA/tree/blob identity. Include the fresh-output ownership/restore ledger, process/port ledger, browser before/after disposable inventory, Vite module/accounting table, 298/7 manifest data, 699 source comparison, 38/58/609 WASM result, protected hashes, normalized full-suite red table, and links to parity/emitted inventories. A failed or unexecuted command is labeled failed/unexecuted; never inherit a pre-fix PASS.

## 4. Cleanup, review, and ship tasks

### 12.1 Final expected-write-set audit

Run:

```powershell
git status --porcelain=v1 --untracked-files=all
git diff --name-status 0ef35459f685d5d41a25d0ef959aff691b7519cd
git diff --stat 0ef35459f685d5d41a25d0ef959aff691b7519cd
git -c core.whitespace=cr-at-eol diff --check
```

Every product path must map to one of these reviewed groups: public store contract/conformance/decision; browser store/migration/topology and focused tests; session persistence coordinator and ownership; inventoried consumers plus required propagation/UI failure handling; Vite/Next Host roots; `c5-storage` and `c5-migration` browser harness/config/tests; boundary scripts/fixtures; canonical docs/provenance. The new attempt-4 topology modules/tests and migration/cascade probes belong to the browser-store group. Anything outside these groups is a blocker until attributed.

Remove only run-owned fresh outputs after copying evidence. For each recursive removal, resolve the exact absolute target and require it to be inside the specific `apps/vite-example` output/test directory or `apps/web/.next`; require the ledger to say it was absent before creation. Never use a glob, workspace root, unresolved variable, or broad `tests`/`apps/web` target. Restore every moved pre-existing output and verify its status/hash. Do not remove `.content-collections/generated`.

### 12.2 Later-change/protected-scope exclusion

Require no diff/status under parity/type fixtures, Rust/WASM trees, or generated WASM, and manually review the complete C5 diff for C6 five-resource disposal/shared-GPU last-owner behavior, C7 headless emission, or E1 feature behavior. C5 may mention their serialization in docs/handoff but must not implement them. Search the actual added lines for disposal/headless/E1 concepts and classify any hit; path-only checks are insufficient because C6 overlaps ports/session/storage consumers.

Hard acceptance: no AudioContext/Worker/WebSocket/object-URL/compositor five-resource disposal or shared-GPU teardown behavior, no emitted headless Host, no E1 project/media behavior, no protected fixture or Rust/generated-WASM edit.

### 12.3 Documentation

Review the actual diffs of `BOUNDARIES.md`, `FEATURE_HANDLING.md`, `PARITY.md`, and `apps/web/src/editor/ports/DECISIONS.md`. They must describe the final sole `EditorHost.store` boundary; required Vite/Next production browser-store composition with no in-memory fallback; provider-private opaque retention; additive/readback-before-delete migration rules; explicit durable preference classifications (sounds/presets versus shell preferences); and unchanged protected parity classification. Remove stale provisional-adapter or pre-strategy topology claims.

### 12.4 Strict validation, scenario mapping, and evidence completeness

From `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`:

```powershell
rasen validate s02-storage-port --project rocut --strict --json
```

Require exit 0, valid true, `1 passed / 0 failed / 0 issues`. Rebuild the scenario-to-test/evidence table in `evidence/cleanup.md` against the accepted-fix tree; the current file says it is invalidated. Every scenario in both delta specs maps to at least one final focused/integration test and evidence artifact, every task through 12.4 has evidence, and no prior pre-fix result is promoted.

### 12.5 Independent pre-landing review

Only after section 11 and 12.1-12.4 are complete, give a fresh non-author reviewer the frozen base, complete tracked + untracked diff, proposal/design/specs/tasks, attempt-4 design/topology audit/implementation evidence, `evidence/regression.md`, and prior review history. The reviewer must independently inspect and, where useful, reproduce controls for:

- provider-private/unknown-field retention at project/scene/track/clip/media/attachment/library levels;
- IndexedDB/OPFS stage/commit gaps and attachment all-or-previous behavior;
- migration readback, deletion ordering, retry authority, and additive old-field preservation;
- exact error/cancellation/commit semantics and payload-free diagnostics;
- private storage backchannels, singleton/direct mechanism paths, and production in-memory fallbacks;
- Vite/Next Host final overrides and required roles;
- multi-session/shared-durable versus live-state isolation;
- attempt-4 whole physical topology, including certified media/legacy/stage targets and exact reserved public/control store pairs.

The reviewer is not any attempt-4 implementer/fixer and writes `evidence/review.md` with canonical severity, exact file/line evidence, test gaps, and verdict. Existing open findings `C5-S4-B1`, `C5-S4-M1`, and `C5-S4-M2` require explicit independent closure or remain blockers.

### 12.6 Finding disposition and rerun rule

Record every finding in `evidence/review.md` as accepted/fixed, rejected with evidence, or accepted-known Minor/Trivial. Any product/test/doc fix invalidates earlier affected results. Run the smallest direct RED/GREEN gate, then rerun the **entire protected/boundary/regression tail**: type identity, focused/isolation tests, relevant browser suite, all positive/negative boundaries, fresh build(s) when their graph changed, parity when runtime/Host/persistence changed, emitted/manifest, WASM/protected hashes, provenance/generated files, and full-suite red comparison. A non-author re-reviews only the fix delta, then confirms no Blocker/Major remains. Refresh `regression.md`, `review.md`, `cleanup.md`, strict validation, and final status from the same tree.

### 12.7 Shipping hard-stop checklist

Do not stage for commit if any of these is present: provider-private loss; browser/non-browser conformance divergence; production in-memory fallback; unclassified direct persistence; unsafe migration deletion or topology alias; open Blocker/Major; parity semantic/oracle change; protected hash drift; a fourth/changed type diagnostic; full-suite red outside the exact inherited multiset; missing scenario evidence; foreign listener/process; or incomplete output/profile cleanup.

### 12.8 Final hygiene and safe cleanup

After all evidence is copied and every owned server exits:

1. verify ports 4175, 43551, and 43552 have no task-owned listener;
2. remove only ledger-owned fresh Vite `.next`, parity, and Playwright scratch paths after absolute-path containment checks;
3. restore pre-existing output backups exactly and remove no backup until restoration is verified;
4. require browser fixture before/after database/directory inventories to match and show only randomized disposable identities were touched;
5. run full `git status --porcelain=v1 --untracked-files=all` and classify every remaining path as intentional C5 source/doc/test/provenance;
6. require no database, browser profile, screenshot, log, cache, build output, or generated test result in the candidate commit.

No manual database deletion and no user Chrome session/profile access are part of cleanup.

### 12.9 Local commit and handoff identity

Commit order is strict:

1. independent review clean and all accepted findings independently confirmed;
2. final rerun evidence/cleanup/strict validation recorded from one unchanged worktree;
3. explicit reviewed path staging (never blind `git add -A`), including the intended adapter deletion and canonical inventory/provenance updates;
4. inspect `git diff --cached --name-status`, `git diff --cached --stat`, `git diff --cached --check`, protected-path exclusion, and absence of output/profile/database paths;
5. record the staged content fingerprint/tree, then create one local C5 commit with the approved message;
6. record `git rev-parse HEAD` and `git rev-parse HEAD^{tree}`, confirm the commit tree equals the reviewed staged tree, and confirm no unintended residue;
7. update `handoff/implementation.md` with commit, tree, branch, final evidence paths, review verdict, and delivery destination `local portfolio child; push/PR deferred to s02-session-runtime-host-ports`;
8. only then mark 12.9 complete. Do not push, PR, merge, archive, or deploy.

## 5. Batchability summary

| May run in one phase/process | Must be isolated or serial |
| --- | --- |
| 15-file positive focused command | each of four topology unit files (separate Bun process) |
| read-only hash/status commands | `c5-storage-red-controls.test.ts` (own Bun process) |
| independent positive boundary scripts after focused tests | C5 Playwright on hard-bound 4175 |
| source negative controls among themselves when no shared server/output | Vite build/preview/parity before Next build/server/parity |
| provenance read-only comparisons | full `bun test` alone; no parallel Bun mocks |
| protected hash calculations after all writes cease | independent review after final verification, and re-review after fixes |

The independent review/evidence/commit sequence is the final gate. Earlier round-1 or strategy-scoped PASS labels can guide diagnosis but cannot satisfy any final task by inheritance.
