# R2 capability-spec falsification sweep

## Corpus and method

The sweep runs against every current `rasen/specs/*/spec.md` after the R2 product diff is
complete and **before** R2's own delta spec is synced. Files were decoded as strict UTF-8,
sorted by capability name, and checked at three levels: every `### Requirement:` block, every
uppercase normative `SHALL`/`MUST` occurrence including numbered clauses embedded in prose,
and every scenario whose observable could be moved by the tracked-plus-untracked R2 write set.

- Files: **17**
- Requirement blocks: **165**
- `SHALL`: **381**
- `MUST`: **56**
- Total normative occurrences: **437**
- Corpus SHA-256: `beb9dcd23980f93b399e9113206ed1a9ee106fec2e71522a2f248969ba6ee640`
  (raw file bytes concatenated in lexical relative-path order)
- Result: **no current capability assertion is made false by R2.**

Sixteen of the seventeen spec files are **byte-identical to the corpus R1 swept**; their
SHA-256 values below match R1's archived table exactly. The single difference is
`embeddable-react-surface`, which grew from 9 requirements / 18 SHALL / 0 MUST to 15 / 35 / 8
when R1's delta spec was synced at archive. That is the capability R2 modifies, and it is
reconciled clause by clause below.

## R2 write set

R2 modifies **43** tracked files and adds **17** new ones:

- **Surface runtime (new):** `surface-portal.tsx`, `surface-drag-coordinator.tsx`,
  `surface-error-boundary.tsx`, `surface-react-identity-probe.tsx`,
  `surface-evidence-seams.tsx`, `surface.css`
- **Surface runtime (modified):** `editor-surface.tsx`, `surface-focus.ts`,
  `surface-evidence-harness.tsx`
- **Shared editor UI portals:** the nine Radix wrappers plus the assets `createPortal` site
- **Provider-private drag continuation:** number-field, color-picker, bookmark drag, timeline
  element/keyframe/resize controllers and their hooks
- **Host composition/CSS:** `apps/web/src/app/globals.css`, `apps/vite-example/src/styles.css`,
  the two `/surface-evidence` entries
- **Dependency metadata:** three manifests + `bun.lock` (React 19 → one exact React 18 line)
- **Checks and tests:** four new `script/check-*.mjs`, one modified, five new focused suites,
  one modified suite, the Playwright surface spec and its new R2 evidence module
- **Repository hygiene:** `.gitignore` (ignores the generated `dist-surface-css/`)

It changes **no** `rust/**`, no generated WASM package, no Host-port contract, no
transaction/domain contract or engine, no persistence implementation or migration, no headless
entry or graph, no session lifecycle/disposal implementation, no provider schema, no upstream
pin/licence/SBOM, and no canonical save path.

## Complete inventory

| Capability | Requirements | SHALL | MUST | SHA-256 | R2 contact and falsification result |
| --- | ---: | ---: | ---: | --- | --- |
| `browser-persistence-boundary` | 7 | 21 | 1 | `b184ce328233772ff7ce079bd8d1e4ceba707da0132e9f58cbd16256648e721d` | No store, migration, or persistence implementation changed. Both final parity runs save, reload and reopen canonical IndexedDB state, and the persisted track/clip/placement/trim summary is byte-identical to R1's. Not falsified. |
| `developer-reproducibility` | 5 | 6 | 0 | `bea7ebbca7c98a73cda5405bab00c6725fa00a2d89969b944bb1add127b82a45` | Adds one documented Vite config for the emitted Surface stylesheet and records exact build commands, markers and artifact hashes. Ordinary builds and parity remain runnable by the documented commands. Not falsified. |
| `editing-parity-fixture` | 5 | 7 | 0 | `8e5ca03f6706b090d6e9032ef9df116cb7f26fbdc6d31bfd52a18b2f5653e871` | All ten interactions stay asserted on both Hosts and the persisted track/clip summary is byte-identical to R1's archived table. Final cross-host attribution is **29 / 20 / 9** against the authoritative R1 **28 / 19 / 9**: the same 16 idempotency key/fingerprint rows, the same 9 incidental rows, and one additional `createdIds` ordinal row. A same-host control (vite compared against itself: 18 / 18 / 0) shows those rows are run-nondeterministic rather than host-attributable, and the `createdIds` count was observed at 2, 3, 3, 4, 4 across five comparisons with no source, build, or host change. Zero semantic rows exist outside the T3 idempotency envelope. See `parity-nondeterminism-control.md`. Not falsified. |
| `editor-session-runtime` | 13 | 35 | 0 | `c9a64cca76b4a5d24a3dcc8a29bc9f5bd8c5deef3d21d94eff472bff77b87b1b` | R2 adds providers *inside* the existing root and changes no mount/unmount/suspend/resume call. Session and root identity survive the whole resize matrix and every portal, drag and error phase. Not falsified. |
| `embeddable-react-surface` | 15 | 35 | 8 | `82c8eeb70de1c7be969ad1a4929f5094802b4067fc8b30007987cdfbc7f2cab3` | The capability R2 modifies. `EditorSurfaceProps`, `FocusMode`, the opaque commit slot and the lifecycle mapping are unchanged; the frozen `tabIndex` matrix is re-asserted in both Hosts. See the clause-level reconciliation below. Not falsified. |
| `headless-editing` | 14 | 5 | 15 | `c1d33ad083d28fd41b5b208ca908d96095c649eddc98da9849422116a12599ff` | No headless factory, migration gate, non-browser store or proof entry changed. Not falsified. |
| `host-port-contract` | 9 | 27 | 3 | `4bbd0fd300095331f65482f994bbeea2ec2934bf177fd27637e436245fdc5ad7` | No port signature, role or browser implementation changed; the port boundary check passes normally and under its negative control. Not falsified. |
| `host-service-boundary` | 4 | 7 | 0 | `54ab6b9cf9c7008d111ab85979192391bbc58cc7cd19f0684f35ca8dd13aef26` | Host toaster, chrome, picker and product-shell overlays keep their own portal destinations and are explicitly excluded from the editor-portal claim. Parity runs with third-party requests blocked. Not falsified. |
| `inherited-defect-repair` | 5 | 6 | 0 | `93fc05f0df98dd682a5d7fbb7d265e96fb7fcc4bc1f58372ae5f570dc4a35a60` | R2 claims no donor-defect repair. Six changed-file ESLint errors and one warning are each proven present on the pristine HEAD blob and are recorded rather than absorbed. Not falsified. |
| `next-free-distributable-boundary` | 6 | 7 | 0 | `fc4cb8a50abed6f6c75a4cc331813972c34c4e24e12618cdeb12cf835cf0a297` | Emitted Vite graph is 2,934 modules with all ten exclusions clean and exactly one React/ReactDOM package root. The distributable stylesheet no longer contains any `:root`, `html` or `body` selector. Not falsified. |
| `runtime-asset-delivery` | 4 | 12 | 1 | `6f4ff6be648360d1581bbaa9a482d86eb90d91f41a1f9ed37d899976c8cf7819` | No WASM, worker or data-asset contract changed; the additional CSS-only Rollup input uses the existing pipeline and both production builds pass. Not falsified. |
| `self-built-wasm-artifact` | 5 | 10 | 0 | `a9a9ac3483876f0ecd1341344a276193bbb3a282367ee4eb7be3b798d952af1d` | No Rust, generated package, export, licence or correspondence file changed. Not falsified. |
| `session-resource-disposal` | 14 | 35 | 0 | `67cf974f90ce8c73839c5010f41731322935e2ec1d4b04a5744db6274b3fdc60` | The Surface still never disposes. The maintained S02 six-cycle disposal oracle reruns `clean: true` on **both** Hosts at the final marker, and no resize, drag, portal or error path reacquires a resource. Not falsified. |
| `session-state-isolation` | 9 | 23 | 0 | `6160bffcfb042bbb993a25a328ca499858836d450dd91cc23ad0eb8ec52cffd6` | Portal owner, drag coordinator and error boundary are all per-Surface. Two-Surface isolation is asserted for portals, theme, drag ownership and error containment in both Hosts. Not falsified. |
| `transaction-automation-api` | 34 | 100 | 28 | `126756888d385c4f6a99a22d06042432f0e32bf657c2d2388b213afab141ea03` | Contract and engine files are untouched. Drag migration preserves each controller's existing commit callback; the outside-bounds drag commits exactly once and the transaction boundary check passes with its negative control. Not falsified. |
| `upstream-provenance` | 10 | 25 | 0 | `c4bffe0b3c61a747221e1cdb9dc076a3a2c53e86c44181f769e48df0d90b1a78` | Pin, licence, SBOM, type fixture and Rust/WASM correspondence are unchanged. Modified files that existed at the upstream pin are ordinary source edits within the established provenance log. Not falsified. |
| `wasm-api-surface` | 6 | 20 | 0 | `4d0029a800f9b0a741adb3c719fe0715778d6019e48e0fcaca7d9b3e41404c68` | No Rust, generated declarations, runtime queries, compositor handles or teardown code changed. Not falsified. |

## Clause-level reconciliation of `embeddable-react-surface`

This is the only capability R2 modifies, so its frozen clauses get individual treatment.

- **Public contract unchanged.** `EditorSurfaceProps`, `FocusMode`, `SurfaceCommitBinding` and
  the opaque commit slot are untouched; every new owner is a private context. The public
  boundary checker passes `no-public-provider-type-leak` over 15 Surface modules.
- **One named root per Surface.** R2 adds `role="region"` and a stable accessible name to the
  existing `[data-editor-surface]` root and adds no second root. The frozen focus matrix
  (`passive -1`, `focused 0`, `full 0`) is re-asserted in both Hosts.
- **Root-only focus machinery.** `surface-focus.ts` remains root-scoped; the drag coordinator
  is a separate private module whose document listeners exist only during a live drag. R1's
  focus scope was additionally *repaired* here: it had stopped propagation for every
  `pointerdown` in the root's bubble phase, which suppressed descendant React pointer handlers
  across the editor subtree. It now stops propagation only when the root is the target, and
  `surface-focus.test.ts` pins that a child pointer event is not stopped.
- **Lifecycle mapping.** Mount, unmount, suspend and resume calls are unchanged, and the
  visibility/resource ledger is unchanged across the new resize matrix.
- **CSS namespace.** The `cssNamespace` prop keeps its meaning; the emitted distributable sheet
  now defines tokens and base behaviour only under `:where([data-editor-surface])`, and the
  owned portal host carries the same attribute value.

## Deliberate non-claims

Recorded so no reader over-reads the evidence:

- **Not whole-application WCAG conformance.** The axe evidence is bounded to the Surface visual
  root and its owned portal host, with content open; 15 rules on the visual root and 14 on the
  portal host, zero violations, on both Hosts. Host/page findings outside those roots are out
  of scope and are not filtered from an owned node.
- **No new public API, prop, or theming surface.**
- **React error boundaries do not catch event-handler or detached asynchronous throws.** R2
  claims render/commit containment only.
- **The parity classifier's one-frame rule remains causation-blind** and its residual
  idempotency-envelope rows remain classified "semantic" though they are demonstrably
  run-nondeterministic. R2 does not change the parity harness.
- **Physical no-rasterizer coverage is still absent** (inherited from the E1 spike): this
  machine has WebGPU and both Hosts run under SwiftShader flags, so R2 cannot speak to a
  genuinely rasterizer-free environment.
