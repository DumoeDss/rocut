## Context

C1 froze `EditorHost`, explicit Host ports, `createEditorSession({ host, runtimeGraphics,
runtimeGpu })`, the session lifecycle and the resource/migration contracts. It deliberately supplied
unimplemented runtime graphics/GPU providers and did not put ports directly in React context.

The running editor still resolves `EditorCore.getInstance()` from 82 sites across 43 files. The
static core owns twelve managers, command history and constructor side effects; 39 command modules
obtain it themselves. A second session value therefore does not create a second editor runtime.

C2 turns C1's session factory into the only core construction path while keeping C1's public
contract unchanged. It is a behavior-preserving ownership refactor. C3 later consumes C0b, isolates
the nine Zustand stores, repairs the no-selector subscription path and proves simultaneous
previews. C2 and C0b both start from integration commit `daef023b`.

## Goals / Non-Goals

**Goals:**

- Create exactly one `EditorCore` and twelve manager instances per `EditorSession`.
- Remove every runtime/static path that can obtain a core without an explicit session.
- Pass explicit editor context through the command stack.
- Make React, both Host composition roots, the Vite picker and sounds flow consume the current
  session rather than a process singleton.
- Keep default definitions process-idempotent while per-session diagnostics remain per-session.
- Reverse the save subscriptions/timers multiplied by core instantiation.
- Add a non-vacuous mechanical singleton boundary with negative controls.

**Non-goals:**

- Changing any C1 contract signature, provider domain or compile guard.
- Restoring or reinventing `useEditorPorts()`.
- Consuming C0b or editing Rust/generated WASM before C3.
- Isolating the global Zustand stores, renderer/compositor state or persistence implementation.
- Claiming C6's complete resource-acquisition/disposal acceptance.
- Changing the editing-parity fixture or the pinned type baseline.

## Decisions

### 1. The frozen session value is the ownership key; its public shape does not widen

`createEditorSession({ host, runtimeGraphics, runtimeGpu })` creates an `EditorCore` after the C1
migration precondition succeeds and binds it to the returned `EditorSession` in an internal
`WeakMap<EditorSession, EditorCore>`. An internal `editorForSession(session)` lookup requires an
explicit session and fails if the session is unknown or disposed.

The public `EditorSession` interface does not gain a `core`, manager or port property. No
`currentEditor`, module-scope core, implicit default session or fallback to a static accessor is
introduced. Disposal removes the binding after the core's C2-owned cleanup completes.

This keeps C1's contract stable while giving React and internal composition code an explicit
ownership route. A process-global "current session" was rejected because two Hosts would race to
replace it.

### 2. `EditorCore` becomes an ordinary session-owned object

The static instance field, `getInstance()` and `reset()` are deleted. Core construction is available
only to the session-runtime module (through a factory or narrowly scoped constructor), and every
manager is constructed from that core instance. Tests compare all twelve manager identities and
their command histories across two simultaneous sessions.

The singleton boundary check rejects:

- `EditorCore.getInstance` or `.reset`;
- a static core instance field;
- `new EditorCore` or a core factory at module scope;
- a core factory call outside the session-runtime ownership module.

Each rule has a deliberate violating fixture or isolated temporary-tree mutation that must make the
check exit non-zero. The scan covers the complete runtime execution graph of both Hosts, not only
the files edited by C2.

### 3. Commands receive one explicit context from their manager

The base `Command` contract changes `execute`, `undo` and `redo` to accept an explicit
`EditorCommandContext`. For C2 that context exposes the session-owned `EditorCore`; it is not a
global service locator and does not contain Host ports. `CommandManager` owns the context for its
session and supplies it for initial execution, undo and redo. `BatchCommand` forwards the same
context to every child command.

All 39 command modules replace their `getInstance()` reads with the supplied context. Focused tests
prove an undo/redo sequence mutates only the session whose command manager invoked it.

### 4. React resolves a session, never Host ports or a default core

An `EditorSessionProvider` accepts an explicit `EditorSession`. `useEditor()` first obtains that
session, then calls the internal session-keyed lookup. Use outside a provider fails with an
actionable error; it never falls back to a process singleton.

`EditorProvider`, the web Host root and the Vite root/project-picker flow create or receive one
session and mount the provider around every consumer that needs the editor. Project changes retain
the explicit owning session and reject stale async completion after that session is disposed.
Sounds code accepts the relevant editor/session explicitly from its direct caller.

`EditorHostContext` continues to expose only `EditorHostBase`. **`useEditorPorts()` is not created or
restored.** Composition roots spread C1's existing reference/in-memory port implementations and use
C1's `UNIMPLEMENTED_RUNTIME_GRAPHICS` and `UNIMPLEMENTED_RUNTIME_GPU` providers until C3.

### 5. Definition registration is process-idempotent, diagnostics are session-local

Default effects, masks, graphics, parameters and stickers move from the core constructor into an
explicit process bootstrap guarded by an idempotent state. Both Host roots invoke the same
bootstrap before their first session; a second call does nothing and cannot overwrite a definition.

Transcription diagnostics and other manager wiring that carry session identity remain in
session/core construction. Tests use registration counters/spies to prove two sessions run process
registration once while creating two distinct session diagnostics paths.

### 6. C2 reverses only the side effects it multiplies

Creating multiple cores multiplies `SaveManager` subscriptions/timers unless C2 closes them.
Session suspend/resume delegates to `SaveManager.pause()`/`resume()` where appropriate, and
disposal invokes `SaveManager.stop()` before removing the session-core binding. Any directly
core-owned subscription introduced or exposed by the refactor receives the same symmetric cleanup.

This is intentionally narrower than C6: worker, audio context, object URL and complete graphics
resource acquisition still follow the C1 registry contract/placeholders and are not claimed as
fully migrated here.

### 7. Parallel safety is enforced as a source boundary

C2 writes TypeScript/React session runtime, commands, composition roots and its focused tests/check.
C0b writes Rust/WASM and WASM evidence. Neither edits `script/fixtures/type-baseline.json`.
`PATCHES.md`, `SOURCE_INVENTORY.md` and `SOURCE_INVENTORY.json` are the planned documentation or
derived-state overlap. Each child appends independent `PATCHES.md` rows, which integration preserves
semantically; the inventories are regenerated from the combined committed tree rather than
hand-merged.

C2 must compile and run against the C1 placeholders. If it needs a C0b export/adapter, Rust source
or generated `rust/wasm/pkg/**`, the parallel proof has failed and work stops for serialization.
C3 begins only after both children are review-clean and locally shipped.

### 8. The archived-spec sweep closes provenance before handoff

The implementation sweep over the eight archived capabilities initially falsified
`upstream-provenance`'s patch-log completeness requirement: the planned write set changed inherited
upstream files but omitted `PATCHES.md`. C2 therefore adds `PATCHES.md` as a documentation/provenance
write, records every inherited file mechanically identified against upstream pin
`cf5e79e919144200294fb9fed22a222592a0aeea`, and re-runs the coverage probe. With that repair, all
eight archived capabilities have zero falsified requirements; no MODIFIED requirement block is
needed.

## Risks / Trade-offs

- **The internal `WeakMap` is still module state.** It is an ownership index keyed by an explicit
  session, not a default/core singleton; the negative gate rejects lookup without that key.
- **Async Host/session creation can race project changes.** Roots retain a generation/session token
  and ignore stale completion after disposal rather than publishing an orphaned core.
- **Changing command signatures is broad.** Compile checks plus execute/undo/redo focused tests
  cover base commands, batches and representative commands before the full suite/parity gate.
- **Some state remains process-global.** The nine Zustand stores and renderer state are explicitly
  left for C3; C2 proves only core/manager/history ownership and does not overstate isolation.
- **Registration idempotence can hide a changed definition.** Duplicate registration is rejected or
  verified equivalent; the bootstrap does not silently overwrite an existing key.
- **Disposal is incomplete by S02's final standard.** C2 reverses only newly multiplied core-owned
  effects and leaves the five-class C6 acceptance open.

## Migration Plan

1. Branch from `daef023b`, run the C0+C1 baseline, and inventory all singleton reads.
2. Introduce session-keyed core ownership and explicit command context; migrate all command modules.
3. Add `EditorSessionProvider`, migrate both Hosts, Vite picker and sounds paths, then delete the
   static API.
4. Move registry bootstrap and add C2-owned cleanup.
5. Add and falsify the singleton/ownership gate, run focused and full verification, and regenerate
   inventories after the source commit.
6. Review and locally ship C2 without C0b consumption.
7. Combine the review-clean C0b and C2 heads, regenerate inventories once and run the C3 joint gate.

Rollback restores the static core only together with the pre-C2 call sites; a partial rollback that
leaves both implicit and explicit ownership paths is forbidden.

## Open Questions

None. The frozen-session binding, React provider, command context, bootstrap and minimum cleanup
boundaries are fixed for C2; global-store and WASM-provider integration remain C3.
