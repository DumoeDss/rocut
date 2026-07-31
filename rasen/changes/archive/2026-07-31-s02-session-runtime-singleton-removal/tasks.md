> Common base: `daef023b5a714088a6e629743cabb9e154d5cc30` (review-clean C0+C1
> integration). C2 and C0b may run concurrently only while their declared product-source write sets
> remain disjoint.
>
> Standing constraints: C1's session/Host/provider contracts and compile guards do not change;
> `useEditorPorts()` is not created or restored; C2 uses C1's explicit unimplemented graphics/GPU
> providers and does not import C0b; no `rust/**` or generated `rust/wasm/pkg/**` file is touched;
> the root `package.json`, CI workflow and `script/fixtures/type-baseline.json` are not edited;
> parity is not re-baselined. `PATCHES.md` is an allowed documentation/provenance overlap with C0b:
> both children append independent rows and combined integration preserves both sets.

## 0. Establish the exact baseline and singleton inventory

- [x] 0.1 Create/verify an isolated C2 worktree and branch at exact commit
      `daef023b5a714088a6e629743cabb9e154d5cc30`; record `HEAD`, `HEAD^{tree}` and a clean
      `git status --short` before editing.
- [x] 0.2 Materialize the canonical C0 generated package in this fresh worktree by running
      `bun run build:wasm` with a C-drive `CARGO_TARGET_DIR`, then run `bun install` so the
      `file:rust/wasm/pkg` dependency is current. Verify `node script/check-wasm-source.mjs`
      passes; this is ignored bring-up evidence only, and C2 must not modify or commit generated
      WASM.
- [x] 0.3 Export the nine values from planning-context §4.1 and run
      `npx turbo run build --filter=@opencut/web --force`; assert
      `apps/web/.content-collections/generated` exists; then run
      `node script/check-type-baseline.mjs` and record `3 diagnostic(s) ... PASS`.
- [x] 0.4 Record the complete baseline singleton inventory: all 82 `EditorCore.getInstance()` reads
      in 43 files, the static instance/reset/constructor, all 39 command modules, both Host roots,
      `EditorProvider`, Vite picker and sounds flow. Treat any count drift as an inventory update,
      not as permission to omit a path.
- [x] 0.5 Build both Hosts, run the C1 focused session/port tests and
      `bun --cwd apps/vite-example run test:parity`; archive the normalized parity snapshot. A
      baseline failure stops the child and is reported rather than repaired here.

## 1. Make the frozen session own the core

- [x] 1.1 Remove the static `EditorCore` instance, `getInstance()` and `reset()` APIs; expose
      construction only through the narrow session-runtime ownership module.
- [x] 1.2 Make `createEditorSession({ host, runtimeGraphics, runtimeGpu })` create one core after C1's
      migration precondition and bind it to the returned frozen `EditorSession` in an internal
      session-keyed `WeakMap`.
- [x] 1.3 Add an internal `editorForSession(session)` lookup that requires a known live session and
      fails actionably for unknown/disposed sessions; add no implicit default/current-session path.
- [x] 1.4 Construct all twelve managers from the session core and add a two-session identity test
      proving cores, every manager and command-history objects are distinct.
- [x] 1.5 On disposal, complete C2-owned core cleanup before deleting the session binding; prove a
      second disposal is harmless and another live session remains retrievable.

## 2. Pass explicit command context

- [x] 2.1 Define the narrow `EditorCommandContext` and update base `Command.execute`, `undo` and
      `redo` signatures so context is mandatory rather than resolved globally.
- [x] 2.2 Make each session's `CommandManager` own/supply its context for execute, undo and redo, and
      make `BatchCommand` forward that exact context to every child in the defined order.
- [x] 2.3 Migrate all 39 command modules from `EditorCore.getInstance()` to the supplied context;
      compile-search the complete commands graph for zero remaining implicit reads.
- [x] 2.4 Add focused execute/undo/redo/batch tests with two live sessions, proving each operation
      mutates only its owning core/history.

## 3. Move React and both Hosts to explicit sessions

- [x] 3.1 Add `EditorSessionProvider` accepting one explicit session; make `useEditor()` resolve that
      session through the internal binding and throw an actionable missing-provider error without a
      singleton fallback.
- [x] 3.2 Migrate `EditorProvider` and the web Host composition root to create/receive a C1 session
      and mount the session provider around every editor consumer.
- [x] 3.3 Migrate the Vite root/project-picker flow to one explicit owning session and guard async
      project completion with session/generation identity so a disposed session cannot receive stale
      work.
- [x] 3.4 Remove the sounds-store singleton read by passing the owning editor/session explicitly
      from its direct caller(s); add a two-session focused test if the path mutates core state.
- [x] 3.5 Keep `EditorHostContext` at `EditorHostBase`; use C1's existing reference/in-memory ports
      plus `UNIMPLEMENTED_RUNTIME_GRAPHICS` and `UNIMPLEMENTED_RUNTIME_GPU`, and prove no
      `useEditorPorts`/equivalent hook or C0b import was added.

## 4. Separate process bootstrap from session effects

- [x] 4.1 Move default effect, mask, graphics, parameter and sticker registration out of the core
      constructor into one explicit process bootstrap shared by both Hosts.
- [x] 4.2 Make bootstrap idempotence observable: two invocations register each definition once and
      reject or verify-equivalent duplicate keys rather than silently overwriting them.
- [x] 4.3 Keep transcription diagnostics and manager wiring per-session; prove two sessions with
      distinct diagnostics ports do not cross-deliver events.
- [x] 4.4 Wire session suspend/resume/dispose to only its own `SaveManager.pause()`, `resume()` and
      `stop()`, plus symmetric cleanup for any other core-owned subscription multiplied by C2.

## 5. Build the non-vacuous singleton boundary

- [x] 5.1 Add `script/check-editor-singleton.mjs` scanning the complete runtime execution graph of
      both Hosts for `getInstance`, `reset`, a static core instance, module-scope core construction
      and construction outside the session-runtime owner.
- [x] 5.2 Assert graph completeness by requiring both Host roots, session factory, all command
      modules, Vite picker and sounds path; make empty/truncated enumeration fail.
- [x] 5.3 Add one isolated negative fixture/mutation per forbidden shape and prove each exits
      non-zero with the expected rule identifier.
- [x] 5.4 Add a focused Bun test that runs the singleton script and all negative controls, so the
      existing `bun test` CI path executes the gate without changing root `package.json` or the CI
      workflow.
- [x] 5.5 Run the singleton gate plus negative controls after a literal/import-aware search confirms
      zero runtime singleton reads and no module-scope core construction.

## 6. Run branch verification and touch-set proof

- [x] 6.1 Run focused session/core/command/provider/bootstrap/save-lifecycle tests, including two
      simultaneous sessions, and record exact test counts.
- [x] 6.2 Run C1's session lifecycle, port conformance and compile guards plus
      `node script/check-port-boundary.mjs`; prove the frozen contracts and the direct prohibition on
      `useEditorPorts` remain intact.
- [x] 6.3 Run `bun test`, then export the nine verified build variables and run
      `npx turbo run build --filter=@opencut/web --force`; assert generated content exists and run
      `bun --cwd apps/vite-example run build`.
- [x] 6.4 Run `node script/check-type-baseline.mjs`; require at most 3 diagnostics and `PASS`, and
      show `script/fixtures/type-baseline.json` has no diff.
- [x] 6.5 Run `bun --cwd apps/vite-example run test:parity` and
      `node script/diff-parity-snapshots.mjs` against task 0.5; require zero semantic/incidental
      movement.
- [x] 6.6 Run the existing asset, storage, Next-import, distributable, reference, port, WASM-source
      and WASM-path gates; C2's runtime refactor must not disturb their results.
- [x] 6.7 Commit product-source changes, run `node script/generate-source-inventory.mjs`, commit
      `SOURCE_INVENTORY.md` and `SOURCE_INVENTORY.json`, then rerun the generator and prove a clean
      result. Never hand-merge either generated file.
- [x] 6.8 Audit `git diff --name-only daef023b`: allow only the declared C2 TypeScript/React
      runtime/Host/tests, `script/check-editor-singleton.mjs`, `PATCHES.md` and regenerated
      inventories; assert no Rust/generated WASM, C1 contract signature/guard, C0b adapter, root
      manifest, CI workflow, global-store sessionization or pinned baseline change.

## 7. Complete both required specification sweeps

- [x] 7.1 Perform a prose-and-scenario falsification sweep over all eight archived capability specs:
      `browser-persistence-boundary`, `developer-reproducibility`, `editing-parity-fixture`,
      `host-service-boundary`, `inherited-defect-repair`, `next-free-distributable-boundary`,
      `runtime-asset-delivery` and `upstream-provenance`; record every requirement made false and the
      evidence for every negative result.
- [x] 7.2 Confirm C2's ownership refactor falsifies none of those eight archived capability
      requirements. The initial `upstream-provenance` patch-log-completeness hit is repaired by
      adding `PATCHES.md` to the documentation write set and recording every inherited file; rerun
      the mechanical coverage probe. If any hit remains, add its complete MODIFIED requirement block
      and revalidate before implementation can be considered complete.
- [x] 7.3 Perform the full unimplemented-addition sweep over every ADDED requirement/scenario in the
      C2 `editor-session-runtime` delta: map each to implementation plus positive/negative evidence;
      fail on TODOs, stubs, skipped scenarios or a new placeholder. The only allowed
      `"unimplemented"` markers are C1's two pre-existing graphics/GPU providers, which must remain
      explicit and unwired until C3.

## 8. Freeze the C3 joint-gate handoff

- [x] 8.1 Record the review-clean C2 head, zero-singleton search, provider/WeakMap ownership route,
      focused test counts and exact two retained C1 placeholder locations for C3.
- [x] 8.2 Record the combined-tree command order C3 must run:
      rebuild WASM with C-drive target -> `bun install` -> regenerate both inventories ->
      `bun run check:wasm` -> C0b API controls -> C1 port controls -> C2 singleton controls -> forced
      web build -> Vite build -> type ceiling -> focused/full tests -> parity.
- [x] 8.3 State that only after this joint gate may C3 replace C1's graphics/GPU placeholders,
      session-scope the nine stores, repair the no-selector/MigrationDialog path and demonstrate
      simultaneous independent previews; C2 does none of that early.
