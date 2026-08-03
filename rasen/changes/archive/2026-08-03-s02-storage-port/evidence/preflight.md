# C5 preflight evidence

Date: 2026-08-01

Product worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c5`

All commands below ran from that worktree unless another directory is stated.

## Frozen identity before editing

Before the first edit, `git status --porcelain=v1` was empty.

| Check | Command | Exit | Observed value |
| --- | --- | ---: | --- |
| branch | `git branch --show-current` | 0 | `feat/s02-storage-port` |
| commit | `git show -s --format=%H HEAD` | 0 | `0ef35459f685d5d41a25d0ef959aff691b7519cd` |
| tree | `git show -s --format=%T HEAD` | 0 | `286272307b05d23826ffa7223a76695365194dba` |
| Node | `node --version` | 0 | `v24.14.0` |
| Bun | `bun --version` | 0 | `1.2.2` |

The commit, tree, branch, and initial clean state exactly matched the planner freeze.

## Protected objects and generated artifacts

Git objects were read with `git rev-parse HEAD:<path>`. File digests were read with PowerShell `Get-FileHash -Algorithm SHA256` and lower-cased.

| Protected input | Git object or SHA-256 | Expected | Result |
| --- | --- | --- | --- |
| `apps/web/src/editor/ports` tree | `3f7d89b52a3d8f1474519695b7ae7e0a5f68c471` | same | PASS; this is the intentional C5 contract-edit base |
| `apps/vite-example/tests/parity` tree | `e1fbb55b985f4fb490c6b233d18c50c58ea14c28` | same | PASS |
| `script/diff-parity-snapshots.mjs` blob | `fa387ebea1e7f0cc1110eebcb922d393a1337842` | same | PASS |
| `script/fixtures/type-baseline.json` blob | `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8` | same | PASS |
| type fixture SHA-256 | `0f7cc855fc8f5c7edd68b2c371bae993fe8e713d2ffd4ef21956de72bd387622` | same | PASS |
| `editor/session/create-session.ts` blob | `ee63d7843fa73df6959aa92030bf4871236b6038` | same | PASS |
| `editor/session/session-types.ts` blob | `c67d9822a2a6c994be14f367e6980fbbaa6e454b` | same | PASS |
| `editor/session/index.ts` blob | `59dd907482a109f8627b217764925bd284f3f223` | same | PASS |
| `rust/wasm` tree | `d782b046c0f39e85b8a5ed518b42389214c211e5` | same | PASS |
| `rust/crates/gpu` tree | `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2` | same | PASS |
| `rust/crates/compositor` tree | `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34` | same | PASS |
| `rust/wasm/pkg/opencut_wasm.js` SHA-256 | `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1` | same | PASS |
| `rust/wasm/pkg/opencut_wasm_bg.wasm` SHA-256 | `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1` | same | PASS |

## Storage-boundary baseline

Command: `node script/check-storage-boundary.mjs`

Exit: 0 before RED-control edits, and 0 again after adding fixture-only scan support.

Observed output:

- 736 source files scanned;
- exactly three explicit verification exemptions:
  - `apps/vite-example/tests/parity/snapshot.ts`;
  - `apps/vite-example/tests/probe/seed.ts`;
  - `apps/vite-example/tests/probe/legacy-migration.pw.ts`;
- browser mechanisms confined to `apps/web/src/services/storage/` outside those three fixtures;
- zero direct Host mechanism calls;
- one `BrowserHostAdapter` user: `apps/vite-example/src/project-picker.tsx`.

The C5 negative fixtures are excluded by their exact `script/fixtures/c5-` prefix from a normal production scan and are scanned only with the explicit `--fixture` argument. The normal 736-file count is therefore stable and the negative controls cannot poison or inflate the positive inventory.

## Importer and preference inventory

The nine current production `storageService` import paths are:

1. `apps/web/src/commands/media/add-media-asset.ts`
2. `apps/web/src/commands/media/remove-media-asset.ts`
3. `apps/web/src/components/storage-provider.tsx`
4. `apps/web/src/core/managers/media-manager.ts`
5. `apps/web/src/core/managers/project-manager.ts`
6. `apps/web/src/core/managers/scenes-manager.ts`
7. `apps/web/src/media/processing.ts`
8. `apps/web/src/sounds/sounds-store.ts`
9. `apps/web/src/services/storage/browser-host-adapter.ts`

Separately classified current consumers and mechanisms:

| Class | Paths | C5 disposition |
| --- | --- | --- |
| sole provisional-adapter Host user | `apps/vite-example/src/project-picker.tsx` | invert and delete adapter path |
| direct test/harness singleton consumers | `apps/vite-example/src/c4-forced-none-harness.tsx`; `apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts` | inject through owning Host/test seam, not exempt |
| direct browser verification probes | the exact parity snapshot, seed, and legacy-migration files named above | retain as individually named verification exemptions |
| durable editor data outside the C1 store surface | saved sounds through `storageService`; custom graph presets through `apps/web/src/timeline/components/graph-editor/custom-presets-store.ts` local storage | move to namespaced durable library records |
| browser storage mechanics | `services/storage/indexeddb-adapter.ts`, `opfs-adapter.ts`, `quota.ts`, `service.ts`, `use-storage-persistence.ts`, and storage migrations | remain behind the named browser storage boundary |
| shell/local UI preferences outside C5 | changelog acknowledgement, feedback history, mobile-gate acknowledgement, generic form persistence, onboarding state through `use-local-storage.ts`, and the persistence-prompt dismissal | explicitly classified; do not migrate opportunistically |

Commands used for the inventory were scoped `rg -n` searches for `storageService`, `BrowserHostAdapter`, `indexedDB`, `navigator.storage`, and `localStorage` across `apps/web/src`, `apps/vite-example/src`, and the three probe areas. No hit was silently discarded; the table above is the classification.

## Type baseline

The first `node script/check-type-baseline.mjs` run exited 1 with 11 diagnostics because the ignored but required `apps/web/.content-collections/generated` artifact did not exist. Eight diagnostics were the missing generated module and its induced implicit-`any` errors. This was environment bring-up, not a product baseline.

The canonical generator was then run from `apps/web`:

```powershell
node --input-type=module -e "import { createBuilder } from '@content-collections/core'; const builder = await createBuilder('./content-collections.ts'); await builder.build();"
```

It exited 0. The repeated command `node script/check-type-baseline.mjs` exited 0 and reported exactly three current diagnostics, all in the pinned set. A direct compiler run (`node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --incremental false --pretty false`, from `apps/web`) exited 1 with these exact inherited identities:

1. `next.config.ts(78,49) TS2345`: the app-local and root `NextConfig` identities are incompatible;
2. `src/timeline/__tests__/update-pipeline.test.ts(69,40) TS2769`: a `number` is not assignable to branded `MediaTime`;
3. `src/timeline/placement/__tests__/resolve.test.ts(646,5) TS2769`: `adjustedStartTime: number` is not assignable to branded `MediaTime`.

After the RED-control files were added, `node script/check-type-baseline.mjs` was run again and still exited 0 with exactly the same three inherited diagnostics. The controls add no type regression.

## Full-suite accepted reds and planner correction

Command: `bun test`

Exit: 1, expected because the inherited suite is red.

Observed exact summary on the frozen base:

```text
250 pass
8 fail
2 errors
688 expect() calls
Ran 258 tests across 47 files.
```

The eight failing identities remain exactly:

- six `resolveTrackPlacement` tests that throw `ReferenceError: Cannot access 'ZERO_MEDIA_TIME' before initialization`;
- the masks module-load error `TypeError: wasm.__wbindgen_start is not a function`;
- the timeline update-pipeline module-load error `ReferenceError: Cannot access 'DEFAULTS' before initialization`.

There is no new red identity. The planner's inherited text said `249 pass`; exact-base reproduction proves that count was stale by one passing test. The planning `design.md`, `tasks.md`, and `handoff/planner.md` were corrected to `250 pass / 8 fail / 2 errors / 688 expectations`. This is a planner-deviation correction, not a relaxed regression ceiling: C5 must preserve the exact eight/two red identities and may not add another.
