# C7 planner → Sol implementer handoff

## Start here

Implement `s02-headless-editing` through the Rasen apply flow. Product implementation, fixes, and rework are Sol-only. Do not use Luna for any product-code phase; Luna-xhigh is reserved for the later separate local-ship and archive leaves.

- Planning root: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut`
- Change: `rasen/changes/s02-headless-editing`
- Product worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7`
- Branch: `feat/s02-headless-editing`
- Required starting HEAD: `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf`
- Required starting tree: `885d307814260b77397c2c2677b9361fdfc5f5e2`
- Pipeline: `small-feature`, serial after integrated C6

Read completely before editing:

1. `proposal.md`
2. `design.md`
3. `specs/headless-editing/spec.md`
4. `tasks.md`
5. `evidence/planning-audit.md`
6. the parent handoff at `C:\Users\Sayo\.rasen\projects\rocut-703d9dad\changes\s02-session-runtime-host-ports\work\handoff\lead-1.md`

Then run from the planning root:

```powershell
rasen status --change s02-headless-editing --project rocut --json
rasen instructions apply --change s02-headless-editing --project rocut --json
```

Use the applicable `rasen-apply-change`/`rasen-auto` instructions and execute tasks in numerical order. Do not mark a task complete until its command/evidence actually exists.

## Product contract to implement

Build a deep, provider-private React-free headless owner over `SessionPersistenceCoordinator`, imported through an isolated `apps/web/src/editor/session/headless.ts` path. It accepts a complete `EditorHost`, owns one project and coordinator, and exposes only load, save, and asynchronous terminal dispose. The caller changes a detached `TProject` between load and save; do not add S03 transactions/revisions/drafts/idempotency or widen public session/Host/store/schema types.

Extract the existing once-per-store migration memo/error/orchestration into one React-free helper used by both full and headless factories. Preserve exact full-session diagnostics/failure/concurrency/retry behavior.

The semantic acceptance sequence is: seed valid project + unknown provider sentinel + attachment bytes in `InMemoryProjectStore`; first owner loads; caller makes a real known-field edit; save resolves durably; first owner disposes; new second owner reopens the edit; unknown data and attachment digests remain; both disposals leave durable data intact; no React Surface/full editor/C6 resource class/browser store is acquired.

## Measurement warning — treat this as RED first

Do not use the existing `collect-next-editor-module-ids.mjs` aggregate or a source scan to claim React absence. A read-only reconnaissance observed a large UI-route inventory report zero React IDs, so the existing measure is not sensitivity-proven.

Before clean work:

- reproduce and record that measurement limitation as RED;
- create a dedicated Vite headless entry and a dedicated Next headless application root;
- collect the exact emitted dependency closure rooted at each named entry, including dependency/virtual IDs and emitted-chunk membership;
- require critical implementation modules before checking absence;
- inject a real React dependency into the same exact root in a fresh negative build for each Host;
- make the ordinary collector/checker fail nonzero and name React;
- rebuild distinct clean outputs afterward.

For Next 16.1.3, a proof-only explicit webpack compilation hook is permitted if necessary, but the normal default `next build` must still run independently as an ordinary Host regression. A union of route NFTs/manifests/source maps is insufficient.

## Stop conditions

Stop and report to LEAD rather than improvising if:

- HEAD/tree or tracked starting state differs;
- the C6 baseline no longer reproduces and the difference cannot be attributed;
- a protected port/session/parity/type/Rust/generated identity changes;
- exact Next application-root emitted reachability cannot be obtained or a real React import is not detected;
- acceptance would require a public Host/store/session/schema or Rust/WASM change;
- browser persistence, ordinary Host behavior, C6 disposal, or inherited-red identity regresses;
- an unowned dirty path overlaps the intended write set.

The implementation-level choice of the narrowest Next graph hook is not itself a blocker as long as every fixed acceptance property in the design is met.

## Required handback before ship

Return to LEAD with:

- final product diff and attributed write-set manifest;
- exact child HEAD/tree (uncommitted until ship leaf) and protected identity comparison;
- completed task list through implementation/review only;
- focused RED/GREEN totals and shared migration matrix;
- raw fresh Vite and Next clean graph envelopes/results/digests;
- raw React-injection and integrity negative-control results for both Hosts;
- fresh ordinary Vite/Next Host/storage/runtime/disposal results;
- fresh build/type/parity/Rust/WASM/full-suite identities and exact inherited reds;
- fourteen-existing-spec falsification sweep plus 14-requirement/62-scenario execution map;
- strict validation output and clean non-author Sol review/re-review;
- an explicit statement that no product task was delegated to Luna.

Only after LEAD accepts that handback should a separate Luna-xhigh ship leaf create the local child commit. It must not push, integrate, sync specs, archive, or repair product code. A different Luna-xhigh archive leaf runs only after LEAD integration, fresh integrated gates, main-spec sync, and strict validation.
