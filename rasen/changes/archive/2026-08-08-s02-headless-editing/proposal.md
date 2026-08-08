## Why

S02 has separated editor capabilities from React-owned UI composition, but it still lacks executable proof that a project can be loaded, changed, saved, and reopened when no React Surface is mounted. C7 closes that final slice obligation with a data-only session path and an emitted-module boundary that proves React is absent from the shipped headless graph rather than merely absent from selected source text.

## What Changes

- Add a provider-private headless editor-session path that uses the C5 non-browser project store, runs the shared store-migration boundary, loads a project, applies one bounded data mutation, saves it, disposes the first owner, and reopens the durable result without mounting React.
- Preserve opaque provider data and attachment bytes across the headless round trip, and make headless disposal idempotent, terminal, and isolated from the C6 UI/resource lifecycle.
- Build and execute dedicated fresh Vite and Next headless entries, while retaining the ordinary Vite/Next Host regression gates and their browser-storage behavior.
- Collect the actual emitted module-id closure for each headless entry and fail a mechanical boundary checker on React-family modules, missing critical closure roots, empty/truncated graphs, stale attribution, or the wrong entry.
- Exercise deliberate React-import and evidence-integrity negative controls through the same collectors and checker used for acceptance.
- Preserve the C3-C6 session, Host, persistence, disposal, provenance, protected-fixture, and inherited-failure identities; do not introduce S03 transactions/revisions, an S04 Surface contract, an E1 React-version decision, or an Elftia integration.

## Capabilities

### New Capabilities

- `headless-editing`: defines React-free project load/edit/save/reopen behavior, non-browser storage and migration semantics, terminal ownership, independently attributable Vite/Next execution, and emitted-module-id enforcement with negative controls.

### Modified Capabilities

None. The fourteen current main capabilities remain authoritative and are regression obligations; C7 adds a new proof surface without changing their requirements or the public `EditorSession`, Host-port, project-store, Rust, or WASM contracts.

## Impact

- Affects provider-private session/persistence composition, a shared React-free migration helper, dedicated Vite and Next headless entrypoints, emitted-graph collection/checking, focused tests, Host regression harnesses, and architecture/provenance evidence.
- The public port/session shapes remain unchanged. The headless mutation seam is internal and intentionally narrower than S03's future transaction, revision, idempotency, and draft APIs.
- The only admissible implementation base is C6-integrated HEAD `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf`, tree `885d307814260b77397c2c2677b9361fdfc5f5e2`, on branch `feat/s02-headless-editing` in `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7`.
