# C7 planning audit — s02-headless-editing

Date: 2026-08-05 (Asia/Shanghai)

## Outcome

Planning is complete and implementation has not started. The Rasen change has a proposal, deep design, one new capability delta, and an ordered implementation checklist. All 137 implementation/delivery tasks remain unchecked; this document records planning and read-only code inspection only and is not runtime, test, build, review, ship, integration, or archive evidence.

The selected design is a provider-private React-free headless owner over the existing `SessionPersistenceCoordinator`, with a shared extracted migration gate and a dedicated isolated import path. It explicitly rejects reusing the full `createEditorSession()` graph and rejects source scans or the existing aggregated Next route collector as no-React proof.

## Accepted identity and scope

- Product worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\elftia\_others\rocut-wt-c7`
- Branch observed: `feat/s02-headless-editing`
- HEAD observed: `a9dbae62573af5877b440ecf9cb2b8a0d4f1dbbf`
- Tree observed (quoted `git rev-parse 'HEAD^{tree}'`): `885d307814260b77397c2c2677b9361fdfc5f5e2`
- Tracked/untracked status observed: empty at the end of planning
- Product-code edits made by this planner: none
- Planning write scope: only `rasen/changes/s02-headless-editing/**` (plus the Rasen CLI-created child ephemera scaffold outside the tracked planning tree)
- Office-hours override checked at both supported locations: absent

Implementation must stop rather than silently adjust this plan if the starting HEAD/tree, protected identities, or inherited-red identity differ.

## Artifact inventory

| Artifact | Planning result |
| --- | --- |
| `.openspec.yaml` | Rasen `spec-driven` scaffold |
| `proposal.md` | one new capability, no modified capability |
| `design.md` | deep headless boundary, design-it-twice alternatives, exact graph measurement, write/scope fences, risks, migration plan |
| `specs/headless-editing/spec.md` | 14 added requirements, 62 scenarios |
| `tasks.md` | 13 ordered groups, 137 unchecked tasks, 0 checked |
| `evidence/planning-audit.md` | this planning-only audit |
| `handoff/planner.md` | exact Sol implementer handoff |

After integration and spec sync, the expected corpus is fifteen main specs with 116 requirements and 386 scenarios. Those totals are projections, not an archive claim.

## Authority and read-only findings

The planner read the S02 Target State, Roadmap slice, Slice specification, corrected Slice plan, parent planning context, direction corrections, current parent handoff, C5/C6 artifacts, all fourteen main specs, and the applicable Rasen workflow/design instructions.

Read-only product observations that shaped the design:

- `createEditorSession()` resolves the complete Host, owns migration/lifecycle/resources, binds session stores, and acquires an `EditorCore`; it is not a data-only graph even if `mount()` is never called.
- `session/index.ts` re-exports React provider/Host modules, so a headless consumer needs a separate import path rather than that barrel.
- `SessionPersistenceCoordinator` is the existing deep React-free seam for project decoding, retained opaque overlays, durable save ordering, attachment/library behavior, and cheap destruction.
- The once-per-store migration promise memo and `MigrationFailedError` are private in the full factory. C7 must extract one shared helper; duplicating the memo would violate cross-factory ordering.
- `InMemoryProjectStore` and `createInMemoryHost` provide the required non-browser store/Host composition without widening a port.
- The ordinary Vite graph producer currently uses Rollup module IDs and is a useful mechanism, but C7 needs a dedicated single-entry build and exact façade attribution rather than the full React app graph.
- The current Next editor collector aggregates NFTs, client-reference data, output files, and source maps. A parent read-only reconnaissance reported a large UI-route inventory with zero React IDs despite the route's React composition. That observation is recorded only as a measurement RED to reproduce; it is not accepted evidence. C7 requires a dedicated application root, emitted per-entry dependency closure, required-module anti-vacuity, and a real injected React negative control.

No historical build/test result was created or claimed by this planner. The C6 totals in task 1.8 are an inherited baseline that the implementer must reproduce on the exact C7 base.

## Existing-capability falsification sweep

The fourteen current main specs contain 102 requirements and 324 scenarios and strict-validated 14/14 during planning. The table identifies how C7 could make each capability false and the mandatory implementation gate; it does not claim those gates have run.

| Existing capability | Count (requirements/scenarios) | C7 falsification edge | Required executed gate |
| --- | ---: | --- | --- |
| `browser-persistence-boundary` | 7/31 | shared coordinator/migration or disposal changes could delete or bypass browser durability; proof adapters could silently use production fallback | C5 conformance, opaque/attachment/cascade/migration, topology authorization, and ordinary Vite/Next `BrowserProjectStore` durability reruns |
| `developer-reproducibility` | 5/9 | new Next/Vite modes, markers, environment inputs, and output cleanup can become cache- or machine-dependent | fresh output/bootstrap/build-before-type, environment-name-only record, exact commands/digests/process cleanup |
| `editing-parity-fixture` | 5/14 | project codec or known-field round-trip changes could alter protected editing semantics | exact fixture blob comparison and protected parity oracle |
| `editor-session-runtime` | 13/38 | migration extraction and nearby factory exports can change full-session lifecycle/events/errors | characterized migration matrix plus full create/mount/suspend/resume/unmount/dispose tests and session-type identity |
| `host-port-contract` | 9/35 | headless Host use could introduce partial casts, fallback ports, or public widening | protected port-tree equality, complete-Host tests, no new port/session/store/schema surface |
| `host-service-boundary` | 4/9 | missing-project or headless adapters could reach navigation/services/network | missing-project no-navigation tests and ordinary Host service-boundary checks |
| `inherited-defect-repair` | 5/13 | new entry/build/test loading can hide, rename, or grow known reds | exact baseline reproduction, full-suite/type identity comparison, no filtering or suppression |
| `next-free-distributable-boundary` | 6/12 | graph-tool refactors or Vite config changes can weaken existing Next/product-shell exclusion | existing ordinary Vite boundary gate plus new exact-root/anti-vacuity/React controls; old collector output compatibility if refactored |
| `runtime-asset-delivery` | 4/15 | dedicated Vite/Next entries/config could change public base, assets, Worker resolution, or fallback | fresh ordinary Host asset/Worker/base-path/degraded-renderer gates |
| `self-built-wasm-artifact` | 5/16 | build configuration or dependency closure work could edit/regenerate or misattribute WASM | protected Rust/generated hashes, source tests, provenance, SBOM/license gates |
| `session-resource-disposal` | 14/59 | headless terminal ownership or full-factory migration edits could alter C6 acquisition/drain/leak semantics | C6 lifecycle serialization, five-class boundary, leak controls, multi-cycle Host oracles, final-GPU-owner teardown |
| `session-state-isolation` | 9/30 | shared store migration and two headless owners could leak cache/identity/state across owners | full two-session isolation plus headless same-store/different-store/dispose-one-owner matrices |
| `upstream-provenance` | 10/25 | new graph/build evidence and architectural records could be unauditable or aspirational | attributed diff, base/marker/digests, exact write-set audit, observed-only documentation |
| `wasm-api-surface` | 6/18 | accidental `EditorCore`/runtime inclusion or API “fix” could widen Rust/WASM contracts | protected API/generated identities, forced-none/runtime-provider gates, explicit no-WASM-write scope audit |

## New-scenario realization map

The new delta contains 14 requirements and 62 scenarios. The implementation checklist maps them as follows; final verification must replace this planning map with exact executed evidence per scenario.

| New requirement concern | Primary task groups |
| --- | --- |
| provider-private headless surface | 2, 4, 11 |
| load/edit/save/dispose/reopen | 2, 4, 5, 9 |
| shared migration gate | 2, 3, 10 |
| non-browser store/browser exclusion | 4, 5, 9 |
| opaque provider data and attachments | 5, 7-9 |
| serialized terminal resource-free ownership | 4, 5, 10 |
| attributable Vite artifact | 6, 7, 9 |
| attributable exact-root Next artifact | 2, 6, 8, 9 |
| required-root/anti-vacuity graph rules | 2, 6-9 |
| emitted React-family absence | 6-9 |
| per-Host React-injection sensitivity | 6-9 |
| truthful runtime/process/build evidence | 5, 7-9 |
| C3-C6 invariant preservation | 1, 10, 11 |
| verification/review/delivery separation | 11-13 |

## Evidence truth and model-role policy

- All product implementation and accepted product fixes: Sol.
- Independent product review and delta re-review: non-author Sol.
- Ship: separate Luna-xhigh leaf after verified implementation/review; local child commit only.
- Integration and spec sync: LEAD after child ship, with fresh integrated evidence.
- Archive: a different separate Luna-xhigh leaf after accepted integration/spec sync.
- Luna is not authorized to implement C7 product code or repair review findings.
- No planning checkbox is checked. A negative control is evidence only when the ordinary collector/checker detects the intended defect; build/setup crashes do not count.
- Environment values and secrets must never enter evidence; only variable names and redacted presence may be recorded.

## Validation performed

- `rasen status --change s02-headless-editing --project rocut --json`: all four planning artifacts complete; apply is the next workflow.
- `rasen validate s02-headless-editing --type change --strict --no-interactive --project rocut --json`: 1 item passed, 0 failed, 0 issues.
- `rasen validate --specs --strict --no-interactive --project rocut --json`: 14 items passed, 0 failed, 0 issues.
- Mechanical counts: 14 new requirements, 62 new scenarios, 137 unchecked tasks, 0 checked tasks.

## Open implementation choice (non-blocking)

The exact Next compiler hook/file arrangement remains deliberately implementation-level. Sol may choose the narrowest proof-only hook available in Next 16.1.3, including an explicit webpack proof build, only if it proves exact application-root reachability, emitted-chunk membership, dependency-ID retention, required-root anti-vacuity, and React-injection sensitivity. The normal default Next build remains an independent mandatory regression. No other product-semantic decision is open.
