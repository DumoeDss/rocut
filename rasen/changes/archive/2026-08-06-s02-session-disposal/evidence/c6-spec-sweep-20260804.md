# C6 two-way main-spec sweep

Date: 2026-08-04. This is a falsification sweep, not a spec-sync operation. No file under
`rasen/specs/**` was changed by C6. The 13 main capability specs remain the authority; the C6
delta is limited to the `session-resource-disposal` capability.

## Main spec → evidence

| Main spec                          | C6 evidence that exercises or protects it                                                                                                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser-persistence-boundary`     | `c6-c5-browser-gate-20260804-1.log` (live Chromium persistence/migration matrix); `c6-c5-unit-gate-20260804-3.log`; `c6-boundary-gates-20260804-2.log` (storage/session-state normal and negative gates).                                                                                     |
| `developer-reproducibility`        | `c6-vite-build-20260804-7.log`, `c6-next-build-20260804-5.log`, `c6-vite-typecheck-final-20260804-1.log`, `c6-prettier-final-20260804-2.log`, `c6-eslint-final-20260804-2.log`; `c6-parity-vite-final-20260804-7.log` and `c6-parity-next-final-20260804-5.log`.                              |
| `editing-parity-fixture`           | Fresh final-host parity logs above plus `c6-parity-diff-final-20260804.log` and `c6-parity-diff-final-20260804.md` (9 incidental, 0 semantic differences).                                                                                                                                    |
| `editor-session-runtime`           | `c6-focused-final-20260804-1.log`; `c6-c4-unit-gate-20260804-2.log`; `c6-c5-unit-gate-20260804-3.log`; `c6-browser-oracle-20260804.md`; session-resource boundary normal/negative logs.                                                                                                       |
| `host-port-contract`               | `c6-port-tail-20260804-1.log` and `c6-port-negative-tail-20260804-1.log`; C4 conformance section in `c6-c4-static-gates-20260804-1.log`; fresh browser oracle evidence.                                                                                                                       |
| `host-service-boundary`            | `c6-c4-static-gates-20260804-1.log` (host composition, distributable and Next-import gates); `c6-asset-manifest-final-20260804-7.log`; `c6-emitted-final-20260804-7.log`; final Vite/Next browser oracle.                                                                                     |
| `inherited-defect-repair`          | `c6-type-baseline-final-20260804-2.log` (only pinned reductions); `c6-bun-test-full-final11.log` and `c6-bun-test-full-final12.log` (337 pass / 8 accepted placement failures / 2 inherited loader errors); `c6-c3-webgpu-attribution-20260804.md` (same WebGPU migration red on clean base). |
| `next-free-distributable-boundary` | `c6-c4-static-gates-20260804-1.log`; `c6-emitted-final-20260804-7.log`; `c6-emitted-inventory-final-20260804-7.json`; final Vite build and browser oracle.                                                                                                                                    |
| `runtime-asset-delivery`           | `c6-asset-manifest-final-20260804-7.log` plus `c6-asset-manifest-negative-20260804-1.log`; `c6-emitted-final-20260804-7.log`; `c6-asset-boundaries-20260804-1.log`; fresh final-host browser runs.                                                                                            |
| `self-built-wasm-artifact`         | `c6-wasm-provenance-20260804-1.log`; `c6-wasm-api-gates-20260804-1.log`; `c6-sbom-license-20260804-1.log`; `c6-protected-identities-20260804-1.log` (Rust trees and generated JS/WASM hashes).                                                                                                |
| `session-state-isolation`          | `c6-boundary-gates-20260804-2.log` (52 classified imperative modules, 10/10 factories and registry keys, normal and negative); C6 focused tests; final browser oracle's six-cycle per-class CREATED/release and leak rejection.                                                               |
| `upstream-provenance`              | `c6-provenance-boundary-20260804-1.log`; `c6-sbom-license-20260804-1.log`; `c6-protected-identities-20260804-1.log`; protected documentation diff was zero.                                                                                                                                   |
| `wasm-api-surface`                 | `c6-wasm-provenance-20260804-1.log`; `c6-wasm-api-gates-20260804-1.log`; `c6-sbom-license-20260804-1.log`; C3 WebGL/WebGPU runtime logs and final browser oracle.                                                                                                                             |

The corresponding main-spec inventories are present in the planning audit: 7/31 (browser
persistence), 5/9 (developer reproducibility), 5/14 (editing parity), 13/38 (editor session),
9/35 (host port), 4/9 (host service), 5/13 (inherited defects), 6/12 (next-free), 4/15
(runtime assets), 5/16 (self-built WASM), 9/30 (session state), 10/25 (provenance), and 6/18
(WASM API) requirements/scenarios. No C6 evidence asserts a new requirement in those specs.

## Evidence artifact → main spec (reverse direction)

| Evidence family                                                                    | Main spec IDs covered                                                                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Session resource implementation, focused C6 tests, disposal oracle, browser oracle | `editor-session-runtime`, `session-state-isolation`, `host-service-boundary`, `host-port-contract`                |
| Resource/port/storage/session-state scanners and negative controls                 | `session-state-isolation`, `host-port-contract`, `browser-persistence-boundary`, `editor-session-runtime`         |
| C4/C5 unit and browser gates, production Host composition                          | `host-service-boundary`, `host-port-contract`, `browser-persistence-boundary`, `next-free-distributable-boundary` |
| Vite/Next builds, parity runs and final diff                                       | `developer-reproducibility`, `editing-parity-fixture`, `runtime-asset-delivery`                                   |
| Asset manifest/emitted/module graph checks                                         | `runtime-asset-delivery`, `next-free-distributable-boundary`, `host-service-boundary`                             |
| WASM source/API/runtime/provenance/license/SBOM checks                             | `self-built-wasm-artifact`, `wasm-api-surface`, `upstream-provenance`, `developer-reproducibility`                |
| Type baseline, full Bun identity, clean-base C3 attribution                        | `inherited-defect-repair`, `developer-reproducibility`, `wasm-api-surface`                                        |
| Protected identities and zero protected-doc/source diff                            | `upstream-provenance`, `self-built-wasm-artifact`, `editing-parity-fixture`, `developer-reproducibility`          |

Every implementation file is either session-runtime/session-state ownership code or an explicitly
scoped host/asset/test boundary. Every other file in this evidence directory is verification-only.
No artifact changes, weakens, or silently replaces a requirement in an unrelated main spec; the
delta spec is the sole source for the new disposal behavior.

## Scenario 52 completion addendum (FINAL3)

| Delta-spec scenario                             | Verdict  | Fresh executed evidence                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 52 — Durable data survives all session disposal | **PASS** | `c6-scenario52-durable-reopen-20260804.md`; `c6-s52-final3-vite-accepted-20260804-1.jsonl` (SHA-256 `1c8b374893545b36a35254adccc1ac542414ac9c658eb0f5735bc602bb501d59`); `c6-s52-final3-next-attempt2-20260804-1.jsonl` (SHA-256 `4814beaf725b43f9d49cf6e33fa25b96eb73576caf410247873e5d0d4783edde`). |

Both production Host compositions write one known project edit, private sentinel, attachment
metadata, and attachment body through the exact public `BrowserProjectStore`; fully dispose the
first session; and reopen the same project through a distinct second public session on the same
Host/store. Project bytes and attachment digest survive exactly, both session IDs are removed,
all five resource classes are terminal, and browser console/page errors are empty. This addendum
updates the task-12.9 scenario map only; no main spec is synced or changed.
