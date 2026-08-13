# R1 capability-spec falsification sweep

## Corpus and method

The sweep was run against every current `rasen/specs/*/spec.md` file after the R1 product diff was complete. Files were decoded with strict UTF-8, sorted by capability name, and checked at three levels: every `### Requirement:` block, every uppercase normative `SHALL`/`MUST` occurrence (including numbered clauses embedded in prose), and every scenario whose observable could be changed by the tracked-plus-untracked R1 write set.

- Files: **17**
- Requirement blocks: **159**
- `SHALL`: **364**
- `MUST`: **48**
- Total normative occurrences: **412**
- Corpus SHA-256: `3c51f7172226280be44b0822e506248e2ddeec76f30efb4c826abf08ae300a34` (raw file bytes concatenated in lexical relative-path order)
- Result: **no current capability assertion is made false by R1**.

The exact R1 write set changes React Surface composition/input/lifecycle wiring, session-owned action registry/context dispatch, scoped editor UI action callers, two Host composition entries, evidence/build wiring, and its checks/tests. It changes no `rust/**`, generated WASM, Host-port contract, transaction/domain contract, browser persistence implementation, headless entry, provider schema, CSS namespace/portal implementation, or automatic disposal ownership.

## Complete inventory

| Capability | Requirements | SHALL | MUST | SHA-256 | R1 contact and falsification result |
| --- | ---: | ---: | ---: | --- | --- |
| `browser-persistence-boundary` | 7 | 21 | 1 | `b184ce328233772ff7ce079bd8d1e4ceba707da0132e9f58cbd16256648e721d` | No persistence/store/migration implementation changed. Both full parity runs save, reload, and reopen canonical IndexedDB state. Not falsified. |
| `developer-reproducibility` | 5 | 6 | 0 | `bea7ebbca7c98a73cda5405bab00c6725fa00a2d89969b944bb1add127b82a45` | Adds explicit Vite/Next evidence entries and records exact commands/artifacts; ordinary builds and parity remain runnable. Not falsified. |
| `editing-parity-fixture` | 5 | 7 | 0 | `8e5ca03f6706b090d6e9032ef9df116cb7f26fbdc6d31bfd52a18b2f5653e871` | Shortcut dispatch now focuses the Surface root and selects its session-owned action scope; all ten required interactions remain asserted on both Hosts and persisted structure is unchanged apart from established T3 envelope/Host-incidental differences. Not falsified. |
| `editor-session-runtime` | 13 | 35 | 0 | `c9a64cca76b4a5d24a3dcc8a29bc9f5bd8c5deef3d21d94eff472bff77b87b1b` | Surface consumes the frozen session lifecycle and exact root handle; it creates no session/core and never disposes. Focused lifecycle, ownership, two-session, and browser disposal evidence pass. Not falsified. |
| `embeddable-react-surface` | 9 | 18 | 0 | `d422aec98ada9b6eb1b5687509dd72aec3b54f6f3bc654f3c214ecb42cc78abf` | R1 implements the frozen additive contract without widening public types. CSS namespace/portal/shared-React/a11y work remains explicitly unclaimed for R2. Not falsified. |
| `headless-editing` | 14 | 5 | 15 | `c1d33ad083d28fd41b5b208ca908d96095c649eddc98da9849422116a12599ff` | No isolated headless factory, migration gate, non-browser store, proof entry, or headless graph changed. The Surface evidence entry is excluded from the dedicated headless build. Ordinary Host builds remain green. Not falsified. |
| `host-port-contract` | 9 | 27 | 3 | `4bbd0fd300095331f65482f994bbeea2ec2934bf177fd27637e436245fdc5ad7` | No port signature/role or browser implementation changed. Port boundary positive and negative controls pass; both Hosts retain their existing complete Host/session creation. Not falsified. |
| `host-service-boundary` | 4 | 7 | 0 | `54ab6b9cf9c7008d111ab85979192391bbc58cc7cd19f0684f35ca8dd13aef26` | No endpoint, degradation, or remote-feature behavior changed. Product-shell/Host services remain outside Surface and parity succeeds with third-party requests blocked. Not falsified. |
| `inherited-defect-repair` | 5 | 6 | 0 | `93fc05f0df98dd682a5d7fbb7d265e96fb7fcc4bc1f58372ae5f570dc4a35a60` | R1 does not claim a known donor-defect repair. Three changed-file lint diagnostics are proven pre-existing at HEAD and are not silently absorbed. Not falsified. |
| `next-free-distributable-boundary` | 6 | 7 | 0 | `fc4cb8a50abed6f6c75a4cc331813972c34c4e24e12618cdeb12cf835cf0a297` | Surface/editor graph has no Next import or viewport ownership; emitted Vite graph has 2,931 modules and no excluded Next/app/site/auth/changelog/content-collections module. Bounded browser proof passes. Not falsified. |
| `runtime-asset-delivery` | 4 | 12 | 1 | `6f4ff6be648360d1581bbaa9a482d86eb90d91f41a1f9ed37d899976c8cf7819` | No WASM/worker/data asset contract changed; the additional Vite HTML entry is built by the existing asset pipeline and both production builds pass. Not falsified. |
| `self-built-wasm-artifact` | 5 | 10 | 0 | `a9a9ac3483876f0ecd1341344a276193bbb3a282367ee4eb7be3b798d952af1d` | No Rust, generated package, export, license, or artifact correspondence file changed. Not falsified. |
| `session-resource-disposal` | 14 | 35 | 0 | `67cf974f90ce8c73839c5010f41731322935e2ec1d4b04a5744db6274b3fdc60` | Hidden/visible delegates only to `session.suspend()`/`resume()`; unmount never disposes. Real timer/decoder activity drains, resumes in a new generation, and both maintained six-cycle disposal oracles are `clean: true`. Not falsified. |
| `session-state-isolation` | 9 | 23 | 0 | `6160bffcfb042bbb993a25a328ca499858836d450dd91cc23ad0eb8ec52cffd6` | Providers and action scope derive from the exact session prop. Two real sessions mount independent roots; an effectful Space shortcut flips only the focused session's playback state, and registry tests prove same-name scope selection, cleanup, legacy unscoped compatibility, and nested scope inheritance. No store/compositor ownership changed. Not falsified. |
| `transaction-automation-api` | 34 | 100 | 28 | `126756888d385c4f6a99a22d06042432f0e32bf657c2d2388b213afab141ea03` | Private adapter forwards one structurally valid batch once to the existing session facade and does not intercept routed commands/pointers. Contract and engine files are unchanged; transaction boundary controls and parity pass. Not falsified. |
| `upstream-provenance` | 10 | 25 | 0 | `c4bffe0b3c61a747221e1cdb9dc076a3a2c53e86c44181f769e48df0d90b1a78` | The only modified files that existed at the upstream pin are logged as P-274–P-276. Pin, license, SBOM defects, type fixture, Rust/WASM correspondence, and derived inventories are unchanged. Not falsified. |
| `wasm-api-surface` | 6 | 20 | 0 | `4d0029a800f9b0a741adb3c719fe0715778d6019e48e0fcaca7d9b3e41404c68` | No Rust, generated declarations, runtime queries, compositor handles, or teardown code changed. Existing Host/session ownership and parity gates remain green. Not falsified. |

## Explicit reconciliation of the nine high-contact capabilities

### `editor-session-runtime`

R1 calls the existing synchronous `session.mount({ target })`, stores the returned root handle, observes its `ready` promise, calls idempotent `session.unmount()` synchronously during React cleanup, and delegates visibility only to `suspend`/`resume`. It does not alter the lifecycle type, factory dependencies, single-core lookup, migration, store registry, resource acquisition, or Host disposal. `surface-lifecycle.test.ts`, `surface-composition.test.ts`, the existing session ownership suite, two-real-session browser step, and S02 oracles jointly cover the contact surface.

### `transaction-automation-api`

R1 imports only T0 types in the private adapter. A valid opaque batch reaches `TransactionApply.apply` exactly once; malformed input fails before apply; async rejection is reported once. The session bridge reuses `editorForSession(session).transactions`, creates no sibling engine, exposes no generic command payload, and does not intercept T3 command or pointer routing. Transaction contract/engine files and public Surface types remain unchanged; focused adapter tests, transaction boundary controls, and full parity establish no duplicate save/revision/watch/history publication attributable to R1.

### `next-free-distributable-boundary`

The public Surface and evidence harness contain no Next imports. Host viewport/chrome remains outside the component; the browser proof records a 716×416 Surface inside a 720×420 bordered container against a 1600×1000 viewport with zero html/body/chrome/sentinel delta. Source import and emitted-graph checks pass, including the 2,931-module Vite graph exclusions. The known body-portal containment limitation remains recorded for R2 rather than being hidden with document capture.

### `editing-parity-fixture`

The shared driver now focuses `[data-editor-surface]`, and its dispatcher selects the Surface's session-owned action scope. Vite and Next each pass the one complete create/import/place/drag/trim/split/snap/scrub/play/save/reload/reopen scenario after the P1 fix. The raw comparison reports 25 differences: 16 pre-existing T3 transaction-envelope key/fingerprint differences and 9 established Host-incidental differences; no track membership, clip order, edit-path, or persistence difference is attributable to action scoping or R1.

### `host-service-boundary`

Surface composition neither changes nor acquires service endpoints, branding, links, remote assets, or product-shell controls. Next keeps route/navigation/product siblings outside Surface and Vite keeps picker/error/theme/tooltip/toaster ownership outside. Full parity runs with third-party requests blocked, so unavailable/remote services remain non-blocking diagnostics.

### `host-port-contract`

No Host role, port signature, reference implementation, storage identity, worker construction contract, graphics capability, or error type changed. Both production roots still obtain their sessions from the existing Hosts; Surface only consumes `session` and `session.host`. Normal and negative port-boundary checks pass, and the session-owned Worker used by evidence crosses `SessionResources.createWorker` rather than introducing a second mediator.

### `session-resource-disposal`

The Surface owns no timer registry, decoder manager, resource drain, or permanent disposal path. Evidence uses a real session plus the existing `createRafLoop` and session-owned Worker to observe the existing activity ledger: Vite drains timer 650/650 and worker 1/1 on suspend; Next drains 968/968 and 1/1; resume alone opens a fresh RAF generation. React unmount remains reversible, while two explicit Host dispose/replace cycles and each Host's maintained six-cycle S02 oracle finish `clean: true` with no monotonic residual growth.

### `session-state-isolation`

Each Surface provider value and action scope is derived from the exact `session` prop; there is no alternate Host/session prop or singleton. The registry keys handlers by explicit scope, unbinds only that bucket, preserves unscoped behavior only for no-provider legacy callers, and carries the scope through synchronous nested action calls. The two-session browser step now sends Space to the focused secondary root and proves the secondary real playback state changes while the primary state and handler count do not; existing session ownership tests prove distinct cores/coordinators/caches. R1 changes no nine-store registry, interaction-canceller, renderer generation, migration dialog, compositor handle, or backend-capacity behavior.

### `headless-editing`

The dedicated headless import, migration gate, in-memory store, Vite/Next proof configurations, closure checker, and semantic fixture are untouched. The normal Surface entry intentionally carries React and full-session code, but it is not the dedicated headless entry and does not enter that emitted closure. No public session/port/provider/Rust/WASM surface is widened, and ordinary Host builds remain independent and green.

## Negative scope confirmation

The final R1 diff contains none of the following:

- `rust/**`, generated WASM, compositor/query exports, or runtime teardown changes;
- Host-port, `ProjectStore`, transaction/domain operation, Draft, engine, or provider-private public type changes;
- CSS namespace, portal container, a11y, error-boundary policy, resize, or shared-React implementation;
- canonical save, transaction publication, pointer routing, or legacy-save arbitration changes;
- `session.dispose()` ownership in Surface or any Surface-owned timer/Worker/decoder drain.

The remaining portal focus/CSS isolation and provider-private document-level drag mechanics are existing limitations assigned to R2; R1 neither claims nor masks their completion.
