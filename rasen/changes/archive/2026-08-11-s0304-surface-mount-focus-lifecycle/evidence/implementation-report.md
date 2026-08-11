# R1 implementation report — Round 2 final-source closure

## Attribution baseline

- Product baseline: `c5a139662c8411b99570e15b22c7c30662e7864e`.
- Capability inventory: 17 files under `rasen/specs/*/spec.md`: `browser-persistence-boundary`, `developer-reproducibility`, `editing-parity-fixture`, `editor-session-runtime`, `embeddable-react-surface`, `headless-editing`, `host-port-contract`, `host-service-boundary`, `inherited-defect-repair`, `next-free-distributable-boundary`, `runtime-asset-delivery`, `self-built-wasm-artifact`, `session-resource-disposal`, `session-state-isolation`, `transaction-automation-api`, `upstream-provenance`, and `wasm-api-surface`.
- Pinned Web type baseline: `node script/check-type-baseline.mjs` passed at 3 current diagnostics, 13 at pin `cf5e79e9`, with no diagnostic outside the pinned set. The R1 ceiling is 3.
- Pre-R1 Next composition: `apps/web/src/app/editor/[project_id]/page.tsx` rendered `EditorSessionHost -> viewport div -> MobileGate -> EditorProvider -> EditorRoot`, with C4 probe and changelog owned by the page.
- Pre-R1 Vite composition: `apps/vite-example/src/app.tsx` rendered `HostChrome -> ViteEditorHost -> MobileGate -> EditorProvider -> EditorRoot`, with picker, error boundary, theme, tooltip, and toaster owned by the Host shell.
- Parity attribution oracle: `rasen/changes/archive/2026-08-10-s0304-ui-commit-routing/evidence/implementation-report.md` records both after-routing Host scenarios passing 1/1 and their corresponding pre-routing baseline scenarios passing 1/1 (Vite 42.2 seconds, Next 40.7 seconds with documented placeholder environment), plus the exact normalized/raw snapshot hashes.
- Disposal attribution oracle: `rasen/changes/archive/2026-08-06-s02-session-disposal/evidence/c6-browser-oracle-20260804.md` records the shared six-cycle browser disposal driver and complete `DisposalCycleObservation` records; the maintained executable oracle is `apps/web/src/editor/session/c6-disposal-harness.tsx` plus `apps/web/src/editor/session/disposal-oracle.ts`.

## Round 2 closure identity and chronology

- Final Vite build: **PASS**, 2,931 modules, UTC `2026-08-11T09:25:13.0390574Z`–`2026-08-11T09:26:03.8648806Z`.
- Final C4-enabled Next build: **PASS**, 20/20 routes, UTC `2026-08-11T09:45:55.7306770Z`–`2026-08-11T09:46:43.5245976Z`, with build marker `c4-final-commit-s0304-round2-20260811-0946z` and only checked-in placeholder values for the nine required environment names.
- The first unmarked Next build passed at UTC `2026-08-11T09:35:35.4399659Z`–`2026-08-11T09:36:12.4553479Z`, but the C4 gate correctly falsified it: the production page ignored `c4-next-probe` because the build lacked the required `c4-final-commit-*` marker. The marked rebuild above fixed the evidence protocol rather than weakening the probe guard.
- C4 Next: **PASS 1/1**, UTC `2026-08-11T09:46:55.8812535Z`–`2026-08-11T09:47:17.5851517Z`.
- Surface Vite: **PASS 2/2**, UTC `2026-08-11T09:49:08.3303129Z`–`2026-08-11T09:49:33.0616089Z`.
- Surface Next: **PASS 2/2**, UTC `2026-08-11T09:49:41.4939984Z`–`2026-08-11T09:50:05.8505001Z`.
- Full parity Vite: **PASS 1/1**, UTC `2026-08-11T09:50:16.2650179Z`–`2026-08-11T09:51:04.6094464Z`.
- Full parity Next: **PASS 1/1**, UTC `2026-08-11T09:51:19.8241464Z`–`2026-08-11T09:52:07.7547389Z`.
- Relevant final source/test writes precede their evidence: P1 source at `2026-08-11T05:11:05Z`, S2 helper/probe at `2026-08-11T09:24:05Z`, P1 browser assertion at `2026-08-11T09:49:01Z`; the C4 result is `2026-08-11T09:47:17Z`, Surface results are `2026-08-11T09:49:33Z` / `09:50:05Z`, and parity results are `2026-08-11T09:51:04Z` / `09:52:07Z`.

## Delta-scenario evidence

Evidence keys used below:

- `COMP`: `apps/web/src/editor/surface/embedding/__tests__/surface-composition.test.ts`
- `FOCUS`: `surface-focus.test.ts` and `surface-keybinding-scope.test.ts` in the same test directory
- `ACTION`: `apps/web/src/actions/__tests__/registry.test.ts`
- `LIFE`: `surface-lifecycle.test.ts`
- `TX`: `surface-transaction-binding.test.ts`
- `BROWSER:<step>`: the named asserted step in both `browser-surface/vite/ledger-vite.json` and `browser-surface/next/ledger-next.json`
- `C4`: `browser-surface/results-next-c4.json` plus its two post-load screenshots
- `BOUNDARY`: Surface/transaction/port positive, negative, and converse controls
- `PARITY`: the established full Vite and Next parity scenarios plus `parity-comparison.md`

| # | Delta-spec scenario | Executed evidence | Result |
| ---: | --- | --- | --- |
| 1 | Session remains the only required prop | `COMP` — `exports the runtime while public props and commit payload stay frozen`; `surface-contract.assertions.ts` | PASS |
| 2 | Session mount receives the real Surface root | `COMP` — `renders one bounded root in the caller tree and binds the exact target`; `BROWSER:slow-ready-unmount-remount` | PASS |
| 3 | Container ownership does not become viewport ownership | `COMP`; `BROWSER:bounded-container-and-outside-style` | PASS — 716×416 Surface fills the 720×420 bordered content box, not the 1600×1000 viewport |
| 4 | Two Surface instances retain explicit ownership | `COMP` provider identity; `ACTION` same-name owner isolation; `BROWSER:two-sessions-two-roots` sends an effectful Space shortcut and compares both real session states | PASS — only the focused secondary session toggles playback |
| 5 | Passive runtime leaves Host input unclaimed | `FOCUS` passive policy/pointer test; `BROWSER:passive-controlled-request` | PASS |
| 6 | Focused runtime scopes editor input to the root | `FOCUS` focused pointer/wheel test; `BROWSER:focused-local-input-and-outside-control` | PASS |
| 7 | Focused shortcuts require focus inside the Surface | `FOCUS` explicit-root keybinding registration; focused browser step asserts outside control then inside handling | PASS |
| 8 | Full runtime cycles dynamic tab stops locally | `FOCUS` dynamic eligibility/cycle tests; `BROWSER:full-dynamic-tab-cycle` | PASS |
| 9 | Controlled mode changes replace listener ownership | `FOCUS` mode replacement/listener counts; passive browser step proves request remains advisory | PASS |
| 10 | Multiple focused Surfaces do not share shortcuts | `FOCUS` independent roots/unmount cleanup; `ACTION` scoped bind/invoke/unbind plus nested inheritance; `BROWSER:two-sessions-two-roots` | PASS — one handler delta on the focused session, zero on the other |
| 11 | Ready publishes only for the live generation | `LIFE` — `publishes ready only after the live handle settles`; browser remount ledger | PASS |
| 12 | Unmount before ready suppresses stale publication | `LIFE` stale ready resolution/rejection; `BROWSER:slow-ready-unmount-remount` | PASS |
| 13 | Hidden visibility delegates to the existing drain path | `LIFE` delegation test; `BROWSER:visibility-resource-ledger` | PASS — real session RAF/decoder Worker drains through `session.suspend()` |
| 14 | Visible visibility delegates to resume | `LIFE`; `BROWSER:visibility-resource-ledger` call order is exactly `suspend-call`, `resume-call` and RAF generation advances only after resume | PASS |
| 15 | Rapid visibility updates converge on the latest live value | `LIFE` serialized/coalesced and hidden-visible-hidden tests | PASS |
| 16 | React cleanup remains reversible and Host disposal remains permanent | `LIFE` Strict-Mode-shaped remount; `BROWSER:listener-cleanup-and-host-disposal-cycles`; both S02 six-cycle oracles | PASS |
| 17 | Lifecycle failures are attributable | `LIFE` live/stale ready, visibility, and cleanup failure cases | PASS |
| 18 | One valid T0 batch reaches the supplied apply seam once | `TX` — public void shape and one valid apply | PASS |
| 19 | Invalid opaque input fails before apply | `TX` malformed null/scalar/operations matrix | PASS |
| 20 | Transaction rejection is reported once | `TX` async rejection test | PASS |
| 21 | Both Hosts reuse the session-owned facade | `COMP` session bridge test and both production composition assertions | PASS |
| 22 | Public Surface types remain opaque and Host-neutral | compile-time assertions plus `BOUNDARY` provider/type-leak controls | PASS |
| 23 | Existing routed UI work is not double-committed | `COMP` source assertion (no command/pointer interception or engine open); `PARITY` real edit path | PASS |
| 24 | Next retains Host-owned page behavior | `COMP` production-root assertion, Surface boundary, Next build (20/20 routes), `C4` post-load Worker/forced-none gate (1/1), and corrected Next Surface/parity reruns on isolated port 3017 | PASS |
| 25 | Vite retains bounded Host chrome | `COMP`, emitted-graph boundary, Vite build/typecheck, bounded browser step | PASS |
| 26 | Default public mode and production Host mode remain distinct | `COMP` default/public assertion and explicit focused Host-source assertion; passive/focused browser steps | PASS |
| 27 | Both Host parity behavior remains unchanged | `PARITY` — post-P1 Vite 1/1, Next 1/1; 25 raw differences classified as 16 pre-existing T3 envelope and 9 established Host-incidental differences | PASS — no action-scope or R1 editing-semantic delta |
| 28 | Surface boundary check has negative and converse controls | `BOUNDARY` | PASS |
| 29 | Mounting causes no outside style or viewport delta | `BROWSER:bounded-container-and-outside-style`; `measurements-{vite,next}.json` compare mount/focus/hide-show/unmount against the post-CSS baseline | PASS — every outside snapshot byte-equivalent |
| 30 | Session resource and disposal evidence remains green | `BROWSER:visibility-resource-ledger`, Host-owned disposal cycles, and `s02-disposal-oracle-{vite,next}.json` | PASS — both six-cycle reports `clean: true` |
| 31 | Type baseline does not grow | `node script/check-type-baseline.mjs`; Vite typecheck; Next build | PASS — 3 current, 0 outside pin |
| 32 | All current capability specs are falsification-swept | `spec-falsification-sweep.md` | PASS — 17 specs, 159 requirements, 412 normative occurrences, no falsification |

## Verification ledger

| Gate | Result |
| --- | --- |
| Surface boundary | PASS — 10 runtime modules scanned; four deliberate violations caught and four converse controls accepted |
| Transaction boundary | PASS — normal and negative-control modes |
| Host-port boundary | PASS — normal and negative-control modes |
| Focused Surface/action Bun suites | PASS — 37 tests, 0 failures, 172 expectations across 8 files |
| Existing Host/session focused suites | PASS — 2 isolated child suites |
| Changed-file ESLint attribution | PASS for R1 attribution — three pre-existing errors reproduced: `page.tsx` unsafe `params.project_id as string`; `editor-provider.tsx` hook immutability; and its `BeforeUnloadEvent.returnValue` assertion. Three warning-only unused bindings (`GridPopover`, `usePreviewStore`, and `TimelineToolbar`'s `editor`) also exist at `HEAD`. Five Vite config/evidence test files remain outside the root ESLint match and report ignored-file warnings |
| Pinned type baseline | PASS — 3 current diagnostics, 13 at pin `cf5e79e9`, none outside the pinned set |
| Vite typecheck/build | PASS — production build emitted both normal and explicit Surface-evidence entries |
| Next production build | PASS — final marked production build emitted 20/20 routes, including `/surface-evidence` |
| C4 Next runtime gate | PASS — 1/1 after active project **and** `!getIsLoading()`; the Worker reply completed and its release was observed after a microtask, and forced-none performed no GPU work |
| Next source imports | PASS — no editor/Surface Next import |
| Vite emitted graph | PASS — 2,931 modules: 630 Web, 15 example Host, 2,282 dependencies, 4 other; all ten exclusions pass |
| Surface Playwright, Vite | PASS — 2/2, 9 asserted matrix/lifecycle steps, 49 calls, effectful two-session isolation, 0 console/ledger errors |
| Surface Playwright, Next | PASS — isolated server at `http://127.0.0.1:3017`, 2/2, 9 asserted matrix/lifecycle steps, 49 calls, effectful two-session isolation, 0 console/ledger errors |
| S02 disposal oracle | PASS — six cycles per Host, both `clean: true` |
| Full parity | PASS — final-source Vite 1/1 and Next 1/1 reruns; snapshot SHA-256 `9ca5eab0…` / `15922673…`; 19 T3 idempotency-envelope rows and 9 established Host-incidental rows, with no action-scope/R1-attributable track, clip, ordering, edit-path, or persistence delta |
| Capability falsification | PASS — all 17 specs and all 412 uppercase normative occurrences inventoried |
| Strict Rasen validation | PASS — strict project-scoped validation |
| UTF-8 / BOM / U+FFFD / mojibake | PASS — final scoped product/planning/evidence set |
| `git diff --check` | PASS |

## Browser evidence and commands

The shared parameterized spec is `apps/vite-example/tests/parity/surface.pw.ts`. The evidence runs were invoked from `apps/vite-example` with:

```powershell
$env:PARITY_HOST='vite'; bunx playwright test --config playwright.surface.config.ts
$env:PARITY_HOST='next'; bunx playwright test --config playwright.surface.config.ts
$env:PARITY_HOST='next'; $env:PARITY_SPEC='c4-next'; bunx playwright test --config playwright.surface.config.ts
```

Each Host result contains two passing tests: the Surface matrix/lifecycle case and the maintained S02 disposal oracle. Each ledger contains 9 asserted steps, 49 lifecycle/resource/action calls, zero Surface errors, and zero console errors. In the two-session step, both real projects carry a 10-second element so Space produces an observable playback-state change. The step starts at `primary=false`, `secondary=false`; after one Space it records exactly one secondary `playback-toggle` (`false -> true`), zero primary toggles in the step delta, and ends at `primary=false`, `secondary=true`. The two earlier primary toggles are the focused-mode effect and its explicit reset to the required false baseline; they are outside the two-session delta. Vite suspend closes timer `540/540` and Worker `1/1`; Next closes timer `348/348` and Worker `1/1`. Resume advances the RAF generation from 0 to 1 without a Surface-owned reacquisition path.

All corrected Next evidence runs used an explicitly owned `next start` server at `http://127.0.0.1:3017`, `reuseExistingServer: false`, the marked production build named above, and only the checked-in placeholder environment in `playwright.surface.config.ts`; they did not inherit an ambient server or secret-bearing application environment. The C4-only run passed 1/1 after full project-load completion and wrote `results-next-c4.json`, `07-c4-worker-post-load.png`, and `08-c4-forced-none-post-load.png`.

The full parity scenarios used the same config with `PARITY_SPEC=parity`, once per `PARITY_HOST`, followed by:

```powershell
node ../../script/diff-parity-snapshots.mjs tests/parity-artifacts/vite/snapshot-vite.json tests/parity-artifacts/next/snapshot-next.json ../../rasen/changes/s0304-surface-mount-focus-lifecycle/evidence/parity-comparison.md
```

The final-source parity snapshots hash to `9ca5eab01cc80d1f4e390295314c74733ce6ef7ac0a11e3d397c5cc75d20e6d4` (Vite) and `159226734d6d5dbd555c67ce7b844193a579b69f30d56cbd96c3ffd0de85e20d` (Next). The generator intentionally exits non-zero when differences exist. It reports 28 rows: 19 are confined to T3's opaque idempotency envelope (key/fingerprint plus three `createdIds` ordinal-order rows caused by the two Hosts' concurrent media imports completing in different orders), while the other 9 are the established Host-incidental differences. Final track membership, clip order, placement/trim classification, save/reload/reopen state, and all ten interaction assertions remain unchanged. The regenerated report hash is `637c2866c39d354ef00e3524a09f3c3ac45b0fc76f6d00f732747f877396be50`.

The final-source Surface result hashes are `fdf1149354e4610c917ed75468bc0acd23c19f61a9ce4709d73f92f4157f4868` (Vite) and `ec7f4cfb842d8dc5d6221f7cd59a220bc4446eb62ec08a84c67bd180f465ec4c` (Next). The C4 result and its Worker/forced-none screenshots hash to `a78c0194f85aadca2cd6eb49177402baf56bb53ca8d687eef686440012ecf555`, `41240b102c23ea5fe26fa6298fecb67445c20903809aaa3393b570f4be6292d4`, and `fa7d71b02478e6ab8fa4acd1fb83745897f5cde2d6223775b8709816a0ddd271`, respectively.

Browser artifacts and their SHA-256 values are recorded in `artifact-hashes.sha256`. The hash manifest excludes itself.

## Reproducible final worktree receipt

The final product/checker receipt is `2984b222baf7de5670c88209ff63296729af0d372c1c7fda4348a983dc16cf95` over **44 paths** and **5,154 serialized UTF-8 bytes**. It is reproducible as follows:

1. read `git status --porcelain=v1 -z --untracked-files=all`;
2. exclude `.rasen/` process ephemera, normalize path separators to `/`, and retain the exact two-character porcelain status;
3. sort records with bytewise comparison of each path's UTF-8 bytes;
4. serialize each record as `status<TAB>path<TAB>sha256(file)<LF>` in the order below;
5. SHA-256 the serialized bytes.

```text
 M	BOUNDARIES.md	7965ce863edb80cd82144036e4a589cd5279a7c47c7e1cece57bfd2b17826210
 M	PATCHES.md	c1df806d405ea8fa80b06bd95f6a5eabe46a120efdacff62f76dea7967da9000
 M	apps/vite-example/package.json	a324ee595c8af25af6923455be9d633548969079b55b5ab3ec0fea4ac18b070e
??	apps/vite-example/playwright.surface.config.ts	adfe770703658cdeb9cd52eb142a891241dcbafe3484be9b7cedb8755d1befcf
 M	apps/vite-example/src/app.tsx	6a8b507f5f433af6cbffc262b804612605e65b8102382c599e46d539104c1531
??	apps/vite-example/src/surface-evidence-main.tsx	4df488b3f0578b4e0cd37a76642a9f78b0e5137e82b045ee99521812a770c36d
??	apps/vite-example/surface-evidence.html	b010b87306cae22579db7c73b61ea92c525b7e88428ee0682f220fc5c010c028
??	apps/vite-example/tests/parity/c4-next.runtime.ts	6a3d3b11a782d31beb13eee03014157126b813e867aa9131d24df9dd8aee30bc
 M	apps/vite-example/tests/parity/driver.ts	eb753d4e4ea3adb549f16db99dfc3ea5c03551635b7d48bb2c888fa7e93e739d
??	apps/vite-example/tests/parity/surface.pw.ts	a8f4bd2ef854ceac386545005899a5dc1593536927a56638af42535a78d604e9
 M	apps/vite-example/tsconfig.json	9f8603eb56ad6ceb1adc416029ed9c9380829f0b99f40d64d63c217e126f3720
 M	apps/vite-example/vite.config.ts	d976c6ce7f5fe3ed71ebacaa4f0d9d5dc585ef0fbf4601f67bf770dee8b75e0b
??	apps/web/src/actions/__tests__/registry.test.ts	210274a4233de85277aae1464f01c050246c6f55eb11a43a17a1d2a685629d48
??	apps/web/src/actions/action-scope.tsx	3a02c494a24821baaf07c144726653b08d647cf2f09d9b899346c33d551c10f5
 M	apps/web/src/actions/index.ts	16dbd861b888c98021b3e3dc18505608f8aec6d0569027846dec99a6715f974d
??	apps/web/src/actions/keybinding-target.ts	7e3010c4961952565be6de70584b2048deb66be1d6761eaffb6abec253190f92
 M	apps/web/src/actions/registry.ts	a9a8c60207a5539cfb6fa359d18fb589a2a23936ffab906930e1a36660a1300a
 M	apps/web/src/actions/use-action-handler.ts	896ac93349acf6015d8202488e1efc4b061bccc4530bc8525566ef2e33a65f7b
 M	apps/web/src/actions/use-keybindings.ts	5b43f8ee6fcea1c2da4b09e5f2fbc20c077736ef93a1ad641fe6b432914b3719
 M	apps/web/src/app/editor/[project_id]/page.tsx	bb2008d75a827340b48a84bef591db61a58ca58fdbea10baef2ed49cc3908f94
??	apps/web/src/app/surface-evidence/page.tsx	f37e5d381540f5ee77af3e06625cd07eff5b4462e89e851a323d4a442e5cb24a
 M	apps/web/src/components/editor/panels/assets/views/assets.tsx	9e745d99dbb20714a3fbcaa84acd4f18499f2eb261c36d0626034a524ab82f82
 M	apps/web/src/components/providers/editor-provider.tsx	62442ca883b8b860195d45a0a78b1c86a31b4ec6e2878a3b682609b6579c7b17
 M	apps/web/src/editor/host/c4-next-runtime-probe.tsx	e133543045ae0cc77a62fa258dbcfb59f1619b34ff5715827c4310727506df4f
??	apps/web/src/editor/host/c4-project-load.ts	d3cc01d300135f0862216eb5d6ff96f6a1c2dd650b77ed2815c1e9ee33c9205a
??	apps/web/src/editor/surface/embedding/__tests__/surface-composition.test.ts	eebda3a2f7dfbca5fc6fcd2a720e16e610344913428f8756e6a6e36663595ab8
??	apps/web/src/editor/surface/embedding/__tests__/surface-focus.test.ts	a08f0cd4c6eb0c51a0b845bd355f8bb873c622dd58fa57d5be3d5c1fddd69069
??	apps/web/src/editor/surface/embedding/__tests__/surface-keybinding-scope.test.ts	482f1a21f6439b1f4b3550e4b2a322e89d986575db64febc98a8a8c427548eb5
??	apps/web/src/editor/surface/embedding/__tests__/surface-lifecycle.test.ts	b1a9e9e51a0452a14b2237bc66cecf001f6d11ab69896066b901c7d1d598b9de
??	apps/web/src/editor/surface/embedding/__tests__/surface-transaction-binding.test.ts	185ff039341d6955009b0e8a19a964910e1b39a0113b4335215d94e00286ec51
??	apps/web/src/editor/surface/embedding/editor-surface.tsx	796d15e68fa303daa6f0271bf1689bd2edd3db510334e6bdcd7738bb185bb909
 M	apps/web/src/editor/surface/embedding/index.ts	4a80e8389581e4b54bac746f153074bac23719694254999f4a9f98ca0377414e
??	apps/web/src/editor/surface/embedding/session-surface-bridge.tsx	77dea84c43d1d79aa9d6c68252c65fbe2e6be348f00c98b424613e896ad13a15
??	apps/web/src/editor/surface/embedding/surface-commit-context.tsx	928e962eddc7840760b7a0630294c620e3c329973fb03e5b3eda9f60484769e4
??	apps/web/src/editor/surface/embedding/surface-contract.assertions.ts	39b90b171c4118c5bb241a9e573248408d48571e043cc84748b9f8ccddbe07f8
??	apps/web/src/editor/surface/embedding/surface-focus.ts	f906b0b16193815dcccc14f3194b1dd0925d0be2a8417ef0d20fdb218caea58d
??	apps/web/src/editor/surface/embedding/surface-lifecycle.ts	62b89f4e3deb51815e07e5d07631f67c00853a37206dfdd76e04651c5e0fff14
??	apps/web/src/editor/surface/embedding/surface-transaction-binding.ts	ee39fd440c05662ba410e264baa520a02fa8bf2d6eb4f77212e86e3fae29401d
??	apps/web/src/editor/surface/evidence/surface-evidence-harness.tsx	89aa889fd93427d67a5f2993cd176e76eeecb49e9eae25fd1d28a046d974011c
 M	apps/web/src/preview/components/toolbar.tsx	4362aa03170f2ed7c16b4f6d5a6d82c10d7b33bb544afa274d4ac7db07132c58
 M	apps/web/src/timeline/components/index.tsx	1bdc40e3b8126658e40852fd928e36058198f0455532c8163daa00cc013a7620
 M	apps/web/src/timeline/components/timeline-element.tsx	7046cf58fc794c48d1ee4e8e9ac4221f9df2a7d1f17563dcda66ce4e2fb551b4
 M	apps/web/src/timeline/components/timeline-toolbar.tsx	1757d65a6ae670eee2e8187347e6a45dd1746e8b7050f3e9b2e1c75529afe7b2
??	script/check-surface-boundary.mjs	c5031e969dc71f16b9849ee6412e2347dc96bbebc641968d96e5fffecc422457
```

## Ownership and contract confirmation

- No `rust/**`, generated WASM, Host-port, transaction/domain, Draft, provider-public, browser-storage, or headless contract file changed.
- The only modified files inherited from upstream are recorded in `PATCHES.md` as P-274–P-276.
- The Surface renders in the caller's React tree, creates no nested root/session/core, and derives providers only from its exact `session` prop.
- Explicit null `targetRef` means no shortcut target; it never falls back to `document` in a Surface tree.
- Each Surface creates an action registry scope owned by its exact session. Handler binding and React UI dispatch consume that context; synchronous nested `invokeAction` calls inherit the active scope. The no-provider path remains an explicitly tested unscoped legacy bucket rather than a broadcast into scoped sessions.
- React cleanup invokes `session.unmount()` synchronously before awaiting settlement and never invokes `session.dispose()`.
- Visibility delegates only to the existing `session.suspend()`/`resume()` lifecycle; the evidence-only RAF/decoder use the session resource seam.
- The private commit adapter binds the existing session-owned transaction facade and does not intercept T3 command/pointer work or change canonical save behavior.

## R2-owned limitations retained by R1

- Portal container/CSS-variable isolation, shared React 18, a11y/error-boundary/resize polish, and provider-private document-level drag mechanics remain R2 work.
- Consequently, shortcuts do not follow focus into a body-level portal, and existing provider-private drag/scrub mechanics may retain their pre-R1 document listeners. R1 adds no global listener or pointer capture to compensate and makes no R2 completion claim.
