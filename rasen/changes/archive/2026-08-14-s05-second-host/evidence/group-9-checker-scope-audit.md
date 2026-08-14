# Group 9 checker scope audit (task 9.1)

Precedent: P1 task 2.4's audit (`evidence/group-2-checker-scope-audit.md` in
the s05-package-extraction archive). Every runnable `script/check-*.mjs` —
all 27 — gets a row. No silence. Two classifications, exactly as tasks.md
9.1 defines them:

- **follows-source** — the checker's scan set is derived from the repo (or is
  host-agnostic by construction), so it judges the electron Host's files
  either automatically or after an edit this change made to teach it the
  third Host; the row names the edit.
- **deliberately scoped** — the checker's scope is a named contract area,
  build output, or Host this change does not own; the row names the reason
  and where the electron Host's equivalent duty is actually gated.

Sweep verdicts are from `evidence/logs/group-9-all-checkers.log` (27 checkers
+ type-baseline, each with a logged exit code, plus the follow-up live and
control runs). Nonzero exits are dispositioned inline with a named cause —
none is silently waived.

| Checker | Classification | Edit made / reason | Sweep |
|---|---|---|---|
| check-agent-evidence | follows-source | Rules are ledger-shape-driven (nine predicates + 87 node-driver assertions), host-agnostic by construction. Consumed the electron ledger (`agent-ledger-electron.json`, Group 8) unmodified. | 0 |
| check-asset-manifest | deliberately scoped | Fetches the vite example's preview server (127.0.0.1:4173) and audits `apps/vite-example/dist/asset-manifest.json` (MIME + bytes + SHA-256). The electron Host serves assets over its app protocol from its own resources dir — there is no HTTP preview to fetch; its asset completeness is gated at runtime by the boot, C6 and parity oracles (Groups 3, 5, 7, 8). | 0 against a live IPv4-bound preview (298 entries); exit 2 without one (prerequisite, not a red) |
| check-distributable-boundary | deliberately scoped | Vite-graph-scoped by design (reads `apps/vite-example/dist/module-graph.json`); the electron build emits its own graph, gated instead by check-build-structure in the agent ledger (23 assertions, Group 8). Decision recorded per task 9.1's own prediction. Ran with `no-desktop-app` intact. | 0 (3842 modules, every rule PASS) |
| check-editor-singleton | follows-source | `sourceFilesUnder("apps/electron-host/src")` added to the runtime-module walk; command modules counted. 780 runtime + 40 command modules scanned. | 0 |
| check-emitted-runtime-assets | deliberately scoped | Audits the two browser Hosts' emitted web roots (vite dist + Next .next). The electron Host's emitted output is not a static web root (app protocol + resources dir); its emitted-graph duty is check-build-structure's. | 1 — **pre-existing, named cause**: `relative-next-static-escape` in Next's `static/media/worker.dd71b7fd.ts` (`../../transcription/{types,audio}`). The `.next` tree was built 2026-08-14 12:23, nine hours **before** this change's base commit `66add22f` (2026-08-14 21:24); the checker is byte-unchanged since base (`git diff 66add22f -- script/check-emitted-runtime-assets.mjs` empty); this change never builds `apps/web`. The red existed at the branch point with the same bytes. |
| check-headless-graph | deliberately scoped | Build-verification harness parameterized by explicit build coordinates (`--host/--producer/--entry/--marker/--head/--tree`); not runnable bare (swept invocation exits 2 usage). Exercised with coordinates in its owning browser-Host groups; the electron build's graph duty is check-build-structure's (Group 8). | 2 (usage-gated; no bare form exists) |
| check-headless-semantic-result | deliberately scoped | C7 headless parity comparator; needs two headless report JSONs. C7 headless is explicitly not ported this change (see BOUNDARIES.md §12 non-coverage). | 2 (usage-gated; C7 out of scope) |
| check-host-composition | follows-source | **Edited (task 9.2).** HOST_ROOTS string list generalized to a HOSTS array `{path, durableStore, identityKey}`; rules parameterized (`stable-explicit-durable-store`, `explicit-durable-identity`); three desktop negative-control fixtures added. Intent preserved: each production Host constructs one stable durable store and final-overrides the inherited reference store — now proven for `BrowserProjectStore`/`storageIdentity` twice and `FilesystemProjectStore`/`identity` once. 3 roots, 831 production modules; negative control 15/15. | 0 |
| check-next-imports | deliberately scoped | `apps/web/src` import hygiene; the electron Host imports nothing from apps/web (enforced anyway by check-package-boundary's layer rules). | 0 |
| check-package-boundary | follows-source | **Edited (Group 2).** Consumer scan roots derived from `boundary.json` consumers instead of the two hardcoded Hosts — the third consumer's files enter every rule's set (census 1063→1078 tracked+uncommitted at sweep time). no-elftia-import auto-cover confirmed: its enumeration is repo-wide ls-files. Negative control 14/14 (incl. the task-2.4 electron-root deep-import probe), converse control 13/13 (incl. the legal electron-root entry import). | 0 + both controls 0 |
| check-port-boundary | follows-source | Scan set is ls-files over `apps` + `packages` filtered to the frozen CONTRACT_FILES/CONTRACT_AREAS — any file landing in a port-contract area is judged automatically; this change added none (the electron Host's ports are Host-owned composition, not contract additions — see check-surface-boundary's own scoping note). Frozen ports barrel byte-identical (frozen-signature control). | 0 |
| check-react-singleton | follows-source | **Edited.** `apps/electron-host/package.json` added to MANIFESTS; the electron pins the exact versions (react/react-dom 18.3.1, @types 18.3.28/18.3.7). 4 manifests, lock, 3842 emitted modules, probe shape. | 0 |
| check-reference-boundary | follows-source | Repo-wide ls-files (`--cached --others --exclude-standard`) enumeration — the electron sources auto-enter the set. No edit needed. | 0 |
| check-resolution-equivalence | deliberately scoped | Move-verification tool: proves staged import-specifier rewrites resolve identically; **fails closed** (exit 1, "nothing was verified") when the staged diff contains no rewritten specifiers. This change rewrites none — it is all-additive (+77 tracked files, 0 removed; the spike was deleted pre-commit). Not applicable by the checker's own design. | 1 (fail-closed N/A, by design) |
| check-runtime-asset-boundary | follows-source | **Edited.** WORKER_ADAPTERS set gains `electron-runtime-resources.ts`; HOST_ROOTS gains the electron host config; REQUIRED_LAYERS gains `electron-host` + `electron-worker-adapter`; the `...browser` override-placement check now guards on text (the electron root composes explicit roles); production files include `apps/electron-host/src`. **The widened root-css-url rule caught a real defect in this change's own mirror**: `c4-worker-harness.tsx` built its fixture URL from a root-absolute literal; fixed to the vite twin's `${import.meta.env.BASE_URL}workers/...` form (commit follows), dist rebuilt. 835 production modules; negative control clean. | 0 |
| check-session-resource-boundary | follows-source | **Edited.** SCAN_ROOTS gains `apps/electron-host/src`; CONSTRUCT_EXEMPTIONS gains exact-match entries for `electron-runtime-resources.ts` (no-direct-worker / no-direct-audio / no-direct-object-url / desktop wording) and `c4-worker-harness.tsx` (no-direct-timer — the evidence harness settles the release bookkeeping's deferred increment before reading the durable report; c4-next-runtime-probe precedent). | 0 |
| check-session-state-boundary | follows-source | **Edited.** PRODUCTION_ROOTS gains `electron-editor-host.tsx` (fourth production entry); trackedSources include `apps/electron-host/src`; fixture gains the electron `project-picker.tsx` `useEditorInstance()` lifecycle-effect classification. 10/10 factories, 10/10 registry keys, 53 classified imperative modules. | 0 |
| check-storage-boundary | follows-source | **Edited.** SOURCE_ROOTS gains `apps/electron-host/src` (browser-mechanism inventory only — durable-store composition duty lives in check-host-composition, avoiding double-ownership). | 0 |
| check-surface-boundary | follows-source | ls-files of the Surface package; Host-owned viewport wrappers are outside the scan by the checker's own note. The electron wrapper is Host-owned exactly like the vite/next wrappers. No edit needed. | 0 |
| check-surface-css-boundary | follows-source | ls-files of the Surface source + emitted dist CSS walk. The electron Host consumes the same Surface and owns no CSS of its own. No edit needed. | 0 |
| check-surface-portal-boundary | follows-source | ls-files of `apps/web/src` + the Surface package — the electron Host adds files to neither. No edit needed. | 0 |
| check-surface-private-drag | follows-source | Same scan set as the portal checker. No edit needed. | 0 |
| check-transaction-boundary | follows-source | ls-files over `apps` + `packages` — the electron sources auto-enter; its transaction usage goes through the same declared surface and stayed green with the third Host in the set. Transaction contract barrel byte-identical (frozen-signature control). | 0 |
| check-type-baseline | deliberately scoped | apps/web-program-scoped by design (per task 9.1's own prediction); the electron app's own gate is its build/typecheck (Group 3, clean). | 1 — **pre-existing, named cause**: the two FAIL rows (`update-pipeline.test.ts:69` TS2769, `resolve.test.ts:646` TS2769) are P1's move artifact — the checker keys on file+code+message, and its own "present at the pin, absent now" list shows the identical TS2769s at their pre-move `apps/web/src/timeline/...` paths (pin `cf5e79e9`, 1→0 each). Both files are byte-untouched since this change's base (`git diff 66add22f` empty on both). The red predates this change; nothing here introduced or can fix it without editing files outside this change's scope. |
| check-wasm-api-surface | follows-source | Hashes the wasm artifact contract (readdir + SHA of the artifact dir) — Host-agnostic; the electron build copies the same artifact (Group 5 emitted leg). No edit needed. | 0 |
| check-wasm-paths | follows-source | Path-remap contract on wasm crate sources — untouched by this change; auto-cover over the crate tree. No edit needed. | 0 |
| check-wasm-source | follows-source | **Edited.** HOSTS list gains `apps/electron-host` (wasm-source roots). No wasm was compiled from source in any Host. | 0 |

## Summary

- 27/27 checkers classified; 12 edited where scope follows the source
  (package-boundary [Group 2], host-composition, storage-boundary,
  runtime-asset-boundary, editor-singleton, wasm-source, react-singleton,
  session-resource-boundary, session-state-boundary, plus the fixture JSON —
  and, counted by duty rather than by file, the runtime-asset-boundary
  widening whose root-css-url rule then caught the c4-worker-harness defect).
- 3 nonzero exits dispositioned with named causes: type-baseline (P1 move
  artifact, files byte-identical since base), emitted-runtime-assets
  (Next-output red byte-older than the branch point), resolution-equivalence
  (fail-closed move tool; this change rewrites no specifiers). Plus two
  usage-gated harnesses (headless-graph, headless-semantic-result) that have
  no bare form and whose duties are gated elsewhere.
- Task 9.1's three predictions all verified, not assumed: no-elftia-import
  auto-covers via repo-wide enumeration (census grew with the electron
  files); check-distributable-boundary stays Vite-graph-scoped with the
  electron graph gated by check-build-structure (decision recorded above);
  check-type-baseline stays apps/web-scoped with the electron app's own
  typecheck as its gate.
