# C5 Planner Handoff — `s02-storage-port`

## Result

ONE_SHOT planning is complete and strict-valid for the C5 browser-storage inversion. No product file was edited. The frozen product worktree remains clean at commit `0ef35459f685d5d41a25d0ef959aff691b7519cd`, tree `286272307b05d23826ffa7223a76695365194dba`, branch `feat/s02-storage-port`.

Planning artifacts:

- `proposal.md`
- `design.md`
- `specs/browser-persistence-boundary/spec.md`
- `specs/host-port-contract/spec.md`
- `tasks.md`

`rasen validate s02-storage-port --project rocut --strict` exits 0 with `Change 's02-storage-port' is valid`.

The delta contains 12 requirement blocks and 43 scenarios. The implementation checklist contains 12 ordered groups and 136 unchecked tasks.

## Governing Design Decision

C1's explicitly recorded storage risk has materialized. Its project-only `ProjectStore` cannot invert current media binaries, saved sounds, graph presets, and storage capacity/support calls. C5 therefore performs one formal, public, spec-governed in-place deepening of the existing `EditorHost.store` role. It does **not** add `StoragePort`, `MediaStore`, a storage React context, a hidden Host property, another session/factory argument, or a singleton escape hatch.

The amended store remains mechanism-neutral and adds direct operations for:

- project-scoped opaque attachments plus portable bytes;
- namespaced durable opaque library records;
- generic availability/capacity information;
- cascade/clear behavior; and
- typed mechanism-neutral failure/cancellation semantics.

This is the first implementation hard gate. Contract/conformance/decision-record changes must receive independent review before consumer wiring. If review rejects any amendment to the C1 interface, stop and return to direction/C1; do not improvise a private port.

## Planned Architecture

Both Vite and Next Host roots explicitly final-override the inherited in-memory store with one stable `BrowserProjectStore`. That deep browser adapter owns IndexedDB, OPFS, database/path identity, platform error mapping, and store-owned migration. A session-scoped editor persistence coordinator above `host.store` knows OpenCut schemas and serves managers/commands/UI, but contains no browser storage calls and is not a second port.

The project codec retains the entire opaque loaded snapshot and overlays known changes by stable project/scene/track/clip/media identity. Tests must seed unknown sentinels at every level, make a real known edit, save, destroy and recreate the complete Host/session, reopen, and compare unknown fields. Load-then-save without an edit is not accepted.

The in-memory store and real browser store run the same exported conformance case matrix. Destructive migration cases require `exerciseMigration: true`, a randomized disposable identity, verified test prefix, and resolved cleanup target. Legacy data is retained until transformed records/attachments are staged, read back, and validated.

## Current Import and Mechanism Inventory

Nine production service/adapter importers are the mandatory inversion set:

1. `apps/web/src/commands/media/add-media-asset.ts`
2. `apps/web/src/commands/media/remove-media-asset.ts`
3. `apps/web/src/components/storage-provider.tsx`
4. `apps/web/src/core/managers/media-manager.ts`
5. `apps/web/src/core/managers/project-manager.ts`
6. `apps/web/src/core/managers/scenes-manager.ts`
7. `apps/web/src/media/processing.ts`
8. `apps/web/src/sounds/sounds-store.ts`
9. `apps/web/src/services/storage/browser-host-adapter.ts`

`apps/vite-example/src/project-picker.tsx` is the sole `BrowserHostAdapter` user. Also rewire the C3-deferred `apps/web/src/timeline/components/graph-editor/custom-presets-store.ts` from durable localStorage to the store's library records.

Test/harness consumers requiring injection rather than exemption include `apps/vite-example/src/c4-forced-none-harness.tsx` and `apps/web/src/core/managers/__tests__/project-manager-thumbnail-degraded.test.ts`.

Actual browser mechanisms belong under `apps/web/src/services/storage/**`. Only these three exact direct verification fixtures are planned exceptions:

- `apps/vite-example/tests/parity/snapshot.ts`
- `apps/vite-example/tests/probe/seed.ts`
- `apps/vite-example/tests/probe/legacy-migration.pw.ts`

Unrelated shell/local UI preferences remain classified outside C5. Saved sounds and custom graph presets no longer qualify for that allowlist after rewiring.

## Protected Base and Accepted Reds

The exact protected values and commands are enumerated in `design.md` and tasks 1.2–1.7. Key identities:

- ports base tree: `3f7d89b52a3d8f1474519695b7ae7e0a5f68c471` (this one changes intentionally and must be reviewed)
- parity tree/oracle: `e1fbb55b985f4fb490c6b233d18c50c58ea14c28` / `fa387ebea1e7f0cc1110eebcb922d393a1337842`
- type fixture blob/SHA-256: `1aa6e2d8424d69ae28a0532ff49925f40ceab0e8` / `0f7cc855fc8f5c7edd68b2c371bae993fe8e713d2ffd4ef21956de72bd387622`
- public session blobs: `ee63d7843fa73df6959aa92030bf4871236b6038`, `c67d9822a2a6c994be14f367e6980fbbaa6e454b`, `59dd907482a109f8627b217764925bd284f3f223`
- Rust trees: `d782b046c0f39e85b8a5ed518b42389214c211e5`, `4da4fe82bd946d6ef3937ec0c25f10e77ba674f2`, `cdaa2215e4b7bbe3f42d2e2c8db32e429cd5af34`
- generated package SHA-256: `19714428b345a2ac128440319ece8a1c7f3c2f0336d454712189445d427c69f1`, `15622cf5f9852c5238cd8326e67a9ec704450d1101a15f2647998501869af9b1`

The type ceiling is exactly three inherited errors. The accepted full-suite baseline is `250 pass / 8 fail / 2 loader or module errors / 688 expectations`, limited to six `ZERO_MEDIA_TIME` initialization failures, the masks `wasm.__wbindgen_start` failure, and the timeline `DEFAULTS` initialization failure. No new red or identity drift is allowed.

Apply preflight corrected the planner's stale `249 pass` transcription after running `bun test` on the exact frozen base `0ef35459f685d5d41a25d0ef959aff691b7519cd`. The exact command exited 1 with `250 pass / 8 fail / 2 errors / 688 expect() calls`, while every red identity still matched the planned six `ZERO_MEDIA_TIME` failures plus the `__wbindgen_start` and `DEFAULTS` loader/module errors. The corrected count is evidence-derived; it does not relax the no-new-red gate.

## Delta-Spec Coverage

`browser-persistence-boundary` has five modified requirements plus removal of the provisional-adapter requirement (19 scenarios). It covers final boundary ownership, both Hosts, all consumers, negative controls, full-reload known/private round-trip, media isolation, real database identity, once-per-durable-identity migration, opt-in nondestructive migration, and delete-after-validation ordering.

`host-port-contract` has two added and four modified requirements (24 scenarios). It covers failure/cancellation commit semantics, durable scope/session isolation, required complete Host roles, no private storage channel, mechanism-neutral opaque values, browser and in-memory execution of the same conformance matrix, and the explicit C1 decision amendment.

## Implementation Order and Stops

Follow `tasks.md` in order:

1. freeze/reproduce the exact baseline;
2. add failing and negative controls;
3. amend/review the public contract;
4. expand shared conformance and in-memory implementation;
5. implement the browser store;
6. make migration staged/validated/non-destructive;
7. add the session coordinator/opaque codec;
8. rewire all consumers;
9. finish both Host roots and remove provisional paths;
10. strengthen boundary gates and negative controls;
11. run focused, type, fresh-build, parity, WASM, regression, provenance, and cleanup gates;
12. independently review, fix, re-verify, and ship.

Ship must stop for any provider-private loss, different browser/non-browser conformance, production in-memory fallback, parallel/private persistence dependency, unclassified browser mechanism hit, unsafe legacy deletion, parity-oracle/fixture change, protected-hash drift, fourth type error, or new regression red.

## Expected Write Set and Later-Change Overlap

Expected C5 product writes:

- `apps/web/src/editor/ports/project-store.ts`, exports, in-memory store, conformance, tests, and storage decision record;
- `apps/web/src/services/storage/**` and storage migration tests;
- the nine inventoried importers plus `custom-presets-store.ts`;
- a session persistence coordinator/codecs and existing session/Host resolution files required to make roles non-optional;
- `apps/vite-example/src/project-picker.tsx`, both Host composition roots, focused browser fixtures, boundary scripts, and relevant generated/canonical docs.

C6 overlaps `editor/ports`, session factory/Host resolution, media/sounds consumers, and possibly storage teardown. It must rebase onto the landed C5 tree and owns all five-resource disposal plus shared-GPU last-owner behavior. C7 overlaps Host composition/factory shape and follows C6; it owns emitted headless/no-React behavior. E1 must serialize any project/media manager overlap. None of those scopes may be pulled into C5.

## Planner Integrity

- Product worktree: read-only and clean at the exact base/tree above.
- Planning repo writes: only `rasen/changes/s02-storage-port/**`.
- Portfolio/runstate and parent handoff were not edited.
- No implementation, commit, push, PR, merge, archive, or protected fixture change was performed by the planner.
