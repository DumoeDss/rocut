# Phase 7 final parity / protected-tail evidence

Date: 2026-08-04  
Author: Luna Max Phase 7 implementer  
Product worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`  
Run id: `final-20260804-lunamax-p7-01`  
Frozen base: `0ef35459f685d5d41a25d0ef959aff691b7519cd` (tree `286272307b05d23826ffa7223a76695365194dba`)

This is author evidence for the protected parity/build/regression tail. It does not replace the
independent Phase 7 implementer evaluation and does not modify tasks, runstate, or protected
fixtures.

## Fresh-build parity gate

The pre-existing output directories were recorded in the ownership ledger and moved intact before
the run. Fresh outputs used unique run-owned paths and the fixed parity marker
`c5-sidecar-20260804-lunamax-p7-01`.

- Fresh Vite build completed with Vite 7.3.6 and 2,887 transformed modules. The distributable
  module-graph boundary passed all ten exclusions. The first preview invocation omitted the owned
  output environment and failed closed; the corrected preview on port 43551 served the owned
  output and the Vite parity scenario passed 1/1.
- Content Collections generation and a foreground Next build both exited 0. Next 16.1.3 compiled
  successfully, emitted 18/18 static pages, and produced a standalone server. The owned standalone
  server on port 43552 returned `/projects` with HTTP 200; the Next parity scenario passed 1/1.
- The unchanged oracle diff passed with the exact acceptance result: **10/10 interaction rows,
  195 leaf values, 0 semantic differences, 9 incidental differences**. Every row had
  `error: null`. The oracle tree/blob remained unchanged.

The first-pass parity artifacts and build logs are retained under
`rasen/changes/s02-storage-port/ephemera/final-20260804-lunamax-p7-01/`.

## Boundary REDs and narrow corrections

### Runtime source boundary (11.7)

The first positive run of `check-runtime-asset-boundary.mjs` was RED because Git reported the
deleted cached path `apps/web/src/services/storage/browser-host-adapter.ts`, and the checker tried
to read that non-existent path. This was a real C5 deletion interaction, not an inherited product
diagnostic. A sensitive Bun test first reproduced that failure and then wrote an existing temporary
production file containing `fetch("/fonts/atlas.json")`; the latter remained rejected with
`root-fetch`.

The narrow fix filters `git ls-files` results through `existsSync` before scanning. It does not
change any boundary pattern or exemption. After the fix the source checker passed all five rules
over 722 existing production modules; the negative control still passed.

### Emitted runtime inventory (axes A and B)

Axis A started with a sensitive Vite `base: "/"` fixture RED: four valid root-relative first-party
URLs were incorrectly reported as root escapes. The existing mounted-base `vite-entry-root`
negative remained RED. The only correction was to treat `/` as containing root-relative first-party
URLs while retaining the mounted-prefix requirement for non-root bases. The root-base fixture and
the mounted-base negative both behaved as intended.

Axis B started from the fresh `.next` graph. The physical edge is present: chunk
`static/chunks/545eff920fcd496e.js` contains module `828861` with
`e.v("static/chunks/27a88e35df72eaf6.wasm")`; the target bytes match the protected Rust editor
WASM. The parser recorded this edge, but `artifactLayer` classified the shared entry chunk as a
transcription worker because it contains the worker marker. A minimal root-base fixture reproduced
the RED (missing entry layer and entry-to-worker/editor topology). The narrow parser correction
gives manifest/route entry roots precedence over content-based layer classification. It leaves the
`missing-runtime-topology` requirement intact.

After both corrections:

- `--positive-control` passed the mounted Next graph, the root-base shared-entry Next graph, and
  the root-base Vite graph;
- `--negative-control` passed all **25** failure fixtures (the 23 pre-M1 fixtures plus the two named
  mounted-base dot-segment controls), including mounted-base root escapes,
  deleted reachable files, relative output/static escapes, direct entry-to-ORT, and unrelated WASM;
- the real fresh inventory passed with Vite layers `1/1/1/1` and Next layers
  `entry=9, transcription-worker=3, editor-wasm=1, ort-sidecar=1` for base `/`.

The emitted inventory JSON is retained as
`rasen/changes/s02-storage-port/ephemera/final-20260804-lunamax-p7-01/emitted-inventory-final.json`.

### Mounted-base dot-segment correction (M1)

The Sol review found that raw prefix containment accepted `/c4-vite/../...` and
`/c4-vite/%2e%2e/...` before browser URL normalization. The checker now resolves every mounted
candidate with WHATWG `URL` semantics against the public origin, rejects origin changes, and tests
the canonical pathname against the normalized mount. Root-base and ordinary mounted-base positives,
the Next shared-entry topology, and all pre-existing negatives remain covered.

Two independently named Vite fixtures and a Bun RED-control test now enforce the behavior:
`vite-mounted-dot-segment-literal` and `vite-mounted-dot-segment-encoded` each exit 1 with
`[root-emitted-entry-url]`, `file=assets/entry.js`, and their exact raw URL. The final emitted
negative-control command reports **25/25** (23 existing + 2 M1), and the final preserved-output
inventory remains Vite `1/1/1/1`, Next `9/3/1/1` with all topology paths satisfied.

## Focused protected tail

The previously reviewed C5 focused set remained green: 64 pass / 0 fail / 241 expectations over
15 files; the RED-control wrapper passed 1/1; isolated topology suites passed 12/12, 7/7, 7/7,
and 9/9; and the storage-boundary RED suite passed 19/19 with 37 expectations. Positive storage
boundary scanning found 723 modules, zero direct singleton/adapter imports, zero unexpected
mechanism hits, and zero production in-memory fallback. Port, Host-composition, and session-state
negative controls all failed closed as designed. The exact-three type baseline passed.

WASM gates also passed: `bun run check:wasm` reported 38 JS exports, 58 binary exports, and 609
imports; all 14 API-surface negative controls passed; the API contract passed; and runtime API
tests passed for WebGL capacity/handles/cancellation plus concurrent failure coalescing.

## Protected identities

All preflight values matched exactly:

| Protected value                                      | Observed                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/editor/session/create-session.ts` blob | `ee63d7843fa73df6959aa92030bf4871236b6038`                                                                      |
| `apps/web/src/editor/session/session-types.ts` blob  | `c67d9822a2a6c994be14f367e6980fbbaa6e454b`                                                                      |
| `apps/web/src/editor/session/index.ts` blob          | `59dd907482a109f8627b217764925bd284f3f223`                                                                      |
| `script/fixtures/type-baseline.json` blob / SHA-256  | `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8` / `0f7cc855fc8f5c7edd68b2c371bae993fe8e713d2ffd4ef21956de72bd387622` |
| `apps/vite-example/tests/parity` tree                | `e1fbb55b985f4fb490c6b233d18c50c58ea14c28`                                                                      |
| `script/diff-parity-snapshots.mjs` blob              | `fa387ebea1e7f0cc1110eebcb922d393a1337842`                                                                      |
| `rust/wasm` tree                                     | `d782b046c0f39e85b8a5ed518b42389214c211e5`                                                                      |
| `rust/crates/gpu` tree                               | `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2`                                                                      |
| `rust/crates/compositor` tree                        | `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34`                                                                      |
| `rust/wasm/pkg/opencut_wasm.js` SHA-256              | `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1`                                              |
| `rust/wasm/pkg/opencut_wasm_bg.wasm` SHA-256         | `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`                                              |

The parity fixture/oracle diff was empty.

## Full regression and test isolation

The first unfiltered `bun test` run produced 335 pass / 10 fail / 2 errors. Besides the eight
frozen inherited identities, it exposed an isolated Bun media-test segfault and one order-sensitive
failure in the new migration-topology test. A second run removed the transient media segfault but
still reproduced the migration failure (336 pass / 9 fail / 2 errors).

The migration topology test used the same repository child-process convention as the other focused
rewire tests. Its default entry now runs one isolated child; setting
`OPENCUT_BROWSER_MIGRATION_TOPOLOGY_ISOLATED=1` runs the real 9-test/37-expectation body. This
prevents cross-file `mock.module` export collisions without skipping tests or changing product
semantics. The sensitive child run passed 9/9, and migration + media, cascade, and topology
two-file combinations all passed.

The final unfiltered run then returned **330 pass / 8 fail / 2 loader errors / 1,058 expectations**
over 338 tests in 64 files. The only reds were the six inherited `ZERO_MEDIA_TIME` placement
failures, the inherited `wasm.__wbindgen_start` loader error, and the inherited `DEFAULTS`
initialization loader error. No new red identity remains.

## Provenance, hygiene, and scope

- Source inventory, SBOM, and reference-boundary checks passed. Generators updated the expected
  `SOURCE_INVENTORY.{json,md}` and `SBOM.md` outputs; their drift is recorded rather than hidden.
- `git -c core.whitespace=cr-at-eol diff --check` passed.
- Strict Rasen validation passed 1/1 with no issues.
- Fresh build/parity/PW outputs were moved intact to the run ephemera after evidence capture. The
  pre-existing Next, parity, and PW directories were restored to their original paths; the
  pre-existing Vite output and C5 storage scratch were preserved; `.content-collections/generated`
  was untouched. No owned preview/standalone process remained listening on ports 43551/43552.
- Phase 7 implementation changes are limited to runtime boundary/inventory scripts, the sensitive
  runtime-boundary test, and the migration-topology test's process-isolation guard, plus generated
  provenance outputs. No C6/C7/E1 implementation, Rust source, generated WASM, protected fixture,
  oracle, task, runstate, or portfolio file was changed.

Evidence logs and the ownership ledger are retained under the run-id ephemera directory. No files
were staged, committed, or pushed.

## Post-return completeness correction

The first return omitted an explicit format gate. During the LEAD completeness review,
`bun x prettier --check` was rerun over the three authored files and correctly found both modified
boundary scripts unformatted; the migration-topology test was already clean. This was an author
evidence omission, not a product behavior change.

The bounded Luna correction ran Prettier write only on:

- `script/check-runtime-asset-boundary.mjs`
- `script/check-emitted-runtime-assets.mjs`

The final check over those two scripts plus
`apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts`
passed with all files matched. ESLint over the same three files exited 0 (with the repository's
existing pages-directory warning), and `git -c core.whitespace=cr-at-eol diff --check` exited 0.

The required post-correction rerun was sequential and clean:

- runtime source positive and negative controls passed; the deleted-file RED-control test passed
  1/1 with 4 expectations;
- emitted `--positive-control` passed and all **25** `--negative-control` fixtures passed (23
  existing plus the literal and encoded mounted-base dot-segment controls);
- the real preserved Phase-7 outputs passed emitted inventory: Vite `entry=1,
transcription-worker=1, editor-wasm=1, ort-sidecar=1`; Next `entry=9,
transcription-worker=3, editor-wasm=1, ort-sidecar=1`. The rerun inventory is
  `ephemera/final-20260804-lunamax-p7-01/emitted-inventory-final-prettier.json`, and its host/base/
  file-count/topology summary matches the original final inventory;
- migration topology passed in wrapper mode (1 isolated test), explicit child mode (9 tests / 37
  expectations), and migration+media (8/74), migration+cascade (8/48), and migration+physical-
  topology (13/64) two-file combinations;
- the exact-three type baseline passed; no owned process remained and ports 43551/43552 had no
  listeners. The temporary runtime-boundary probe was absent after the rerun.

This correction changes formatting and evidence completeness only; no other product, protected,
task/runstate, delivery, or later-change scope was touched.

## Post-Sol provenance/index correction (B1)

The first Phase-7 return omitted the exact untracked-source review. This correction records the reviewed intent set and the canonical generator outputs. The lists below are the complete intentional source set passed to `git add -N`; every output/cache/parity/profile/database/generated/evidence path was rejected.

Intentional omitted C5 production source (22):

- `apps/web/src/components/storage-provider-operations.ts`
- `apps/web/src/editor/persistence/index.ts`
- `apps/web/src/editor/persistence/opaque-value.ts`
- `apps/web/src/editor/persistence/project-codec.ts`
- `apps/web/src/editor/persistence/session-persistence-coordinator.ts`
- `apps/web/src/media/persistence.ts`
- `apps/web/src/services/storage/browser-project-store.ts`
- `apps/web/src/services/storage/browser-project-store-cascade.ts`
- `apps/web/src/services/storage/browser-project-store-cascade-manager.ts`
- `apps/web/src/services/storage/browser-project-store-cascade-probes.ts`
- `apps/web/src/services/storage/browser-project-store-cascade-round2-probes.ts`
- `apps/web/src/services/storage/browser-project-store-conformance.ts`
- `apps/web/src/services/storage/browser-project-store-control.ts`
- `apps/web/src/services/storage/browser-project-store-internals.ts`
- `apps/web/src/services/storage/browser-project-store-library-clear-bindings.ts`
- `apps/web/src/services/storage/browser-project-store-media-ownership.ts`
- `apps/web/src/services/storage/browser-project-store-migration.ts`
- `apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts`
- `apps/web/src/services/storage/browser-project-store-records.ts`
- `apps/web/src/services/storage/browser-project-store-residual-probes.ts`
- `apps/web/src/services/storage/browser-project-store-topology.ts`
- `apps/web/src/services/storage/browser-storage-mechanisms.ts`

Intentional omitted C5 tests (14):

- `apps/web/src/components/__tests__/storage-provider-operations.test.ts`
- `apps/web/src/core/managers/__tests__/media-persistence-rewire.test.ts`
- `apps/web/src/core/managers/__tests__/project-persistence-rewire.test.ts`
- `apps/web/src/core/managers/__tests__/save-manager-persistence-failure.test.ts`
- `apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts`
- `apps/web/src/media/__tests__/persistence.test.ts`
- `apps/web/src/media/__tests__/processing-capacity.test.ts`
- `apps/web/src/services/storage/__tests__/browser-project-store-cascade-topology.test.ts`
- `apps/web/src/services/storage/__tests__/browser-project-store-media-topology.test.ts`
- `apps/web/src/services/storage/__tests__/browser-project-store-migration-topology.test.ts`
- `apps/web/src/services/storage/__tests__/browser-project-store-records.test.ts`
- `apps/web/src/services/storage/__tests__/browser-project-store-topology.test.ts`
- `apps/web/src/services/storage/__tests__/c5-storage-red-controls.test.ts`
- `apps/web/src/services/storage/__tests__/migration-provider-private.test.ts`

Additional intentional C5 harness/fixture source (30):

- `apps/vite-example/c5-migration.html`
- `apps/vite-example/c5-storage.html`
- `apps/vite-example/playwright.c5-storage.config.ts`
- `apps/vite-example/src/c5-migration-harness.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`
- `apps/vite-example/tests/c5-storage/c4-forced-none.pw.ts`
- `apps/vite-example/tests/c5-storage/migration-round1.pw.ts`
- `script/__tests__/c5-runtime-asset-boundary-red.test.mjs`
- `script/__tests__/c5-storage-boundary-red.test.mjs`
- `script/check-host-composition.mjs`
- `script/fixtures/c5-browser-store-conformance/browser-store-conformance.ts`
- `script/fixtures/c5-storage-boundary/direct-adapter/apps/web/src/core/consumer.ts`
- `script/fixtures/c5-storage-boundary/direct-indexeddb/apps/web/src/core/consumer.ts`
- `script/fixtures/c5-storage-boundary/direct-opfs/apps/web/src/core/consumer.ts`
- `script/fixtures/c5-storage-boundary/direct-singleton/apps/web/src/core/consumer.ts`
- `script/fixtures/c5-storage-boundary/hidden-host-storage/apps/web/src/editor/host/editor-host.ts`
- `script/fixtures/c5-storage-boundary/in-memory-fallback/apps/vite-example/src/host/vite-host-config.ts`
- `script/fixtures/c5-storage-boundary/localstorage-presets/apps/web/src/timeline/components/graph-editor/custom-presets-store.ts`
- `script/fixtures/c5-storage-boundary/localstorage-sounds/apps/web/src/sounds/sounds-store.ts`
- `script/fixtures/c5-storage-boundary/mechanism-type-leak/apps/web/src/editor/ports/project-store.ts`
- `script/fixtures/c5-storage-boundary/physical-storage-path-leak/apps/web/src/editor/ports/project-store.ts`
- `script/fixtures/c5-storage-boundary/private-storage-context/apps/web/src/editor/storage-context.tsx`
- `script/fixtures/c5-storage-boundary/public-command-leak/apps/web/src/editor/ports/project-store.ts`
- `script/fixtures/c5-storage-boundary/public-schema-leak/apps/web/src/editor/ports/project-store.ts`
- `script/fixtures/c5-storage-boundary/public-state-store-leak/apps/web/src/editor/ports/project-store.ts`
- `script/fixtures/c5-storage-boundary/public-storage-implementation-leak/apps/web/src/editor/ports/project-store.ts`
- `script/fixtures/c5-storage-boundary/second-media-port/apps/web/src/editor/ports/index.ts`
- `script/fixtures/c5-storage-boundary/second-storage-port/apps/web/src/editor/ports/index.ts`
- `script/fixtures/c5-storage-boundary/unlisted-verification/apps/vite-example/tests/probe/unlisted.ts`

The final reviewed intent set is 67 files (36 omitted C5 paths + 30 additional C5 paths + the named M1 RED test `script/__tests__/c5-emitted-runtime-assets-red.test.mjs`). `git diff --cached --name-status` is empty; `git add -N` created intent metadata only. The index contains no output/cache/parity/profile/database/generated/evidence path and no cached file content.

Canonical provenance results:

- `node script/generate-source-inventory.mjs`: **1069 files / 7,500,075 bytes / rollup `8ce81cbd563de44ca6d99857fa9959feaeae4eb0992656deb1c4a10b7ba168bf`**, with drift **169 modified / 97 added / 0 other**.
- `node script/generate-sbom.mjs`: **1359 npm packages / 80 wasm crates**; D-1..D-4 were recorded as observed and D-5 was repaired. The generator briefly emitted one inherited `workers` directory observation; that one line was removed with `apply_patch` only. Final `git diff 0ef35459f685d5d41a25d0ef959aff691b7519cd -- LICENSE REFERENCE_SOURCES.md UPSTREAM.md bun.lock Cargo.lock SBOM.md` exited 0. The frozen-base identity counts are **1359 npm / 763 workspace-lock Rust / 80 wasm32**.
- `node script/check-reference-boundary.mjs`: exit 0, scanned **969 of 1640** tracked+uncommitted files; no forbidden OpenChatCut/remotion/AGPL reference.
- `PATCHES.md` reconciliation is exact: **177** changed inherited files / **177** unique patch rows, with no missing or extra path.

## Post-LEAD completeness correction chronology

LEAD's final direct-disk audit caught two author-evidence omissions after the prior completion claim: the protected WASM-JS SHA line still contained a stale, longer value, and this Markdown artifact failed its own Prettier check. Luna corrected only the SHA line with `apply_patch`, formatted only this author artifact with Prettier, and reran the exact hash/occurrence, Prettier, and diff checks. The generated WASM files, protected fixtures, reviewer artifacts, and product behavior were not changed.

## Post-review residual C5-P7-m2 correction chronology

The fresh cumulative Sol re-review then caught stale current claims in this artifact and two peer author artifacts: the WASM API negative-control count was still 13 instead of the live 14, the reference-boundary scan was still 968/1639 instead of 969/1640, and the full unfiltered Bun result was still 329/8/2/1,050 over 337 tests/63 files instead of the live 330/8/2/1,058 over 338 tests/64 files. It also reproduced Prettier failures in `cleanup.md` and `regression.md`. Those residual evidence/format defects are recorded as a re-review finding, not rewritten as first-pass success; the corrected values and three-artifact format rerun follow this chronology.
