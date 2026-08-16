# Final regression and inherited-red disposition

Date: 2026-08-16

Repository base: `661d7ac87c3d324839d51bf30470bbf81764b694`

All results below are from the `feat/sdk-ecosystem-enablement` worktree after the final wasm,
Vite, Next, Surface CSS, and install sequence. Commands were run in the foreground or used their
own self-logged exit code. A non-zero result is not described as green.

## Build and package gates

| gate | result |
| --- | --- |
| `bun run build:wasm` | exit 0; self-sourced wasm artifact rebuilt |
| `bun install` in `apps/web` | exit 0 |
| Vite production build | exit 0; 3,842 emitted modules |
| Next production build | exit 0; Next `16.1.3` |
| dedicated Surface CSS build and boundary check | exit 0; 1 source + 1 emitted CSS file |
| scoped fakes TypeScript check | exit 0; 0 diagnostics |
| contracts package tests | 127 pass, 0 fail, 1,382 expectations, 14 files, exit 0 |

The scoped TypeScript command was:

```powershell
bunx tsc --ignoreConfig --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck --types bun packages/editor-contracts/src/conformance/fakes/index.ts packages/editor-contracts/src/conformance/fakes/__tests__/fakes.test.ts
```

The contracts run includes the new fakes interface tests (8 pass) and requirement-index guard
(4 pass). Its printed six-case stale-revision report is the intentional failure-demonstration
input to a passing formatter test.

## Root tests

Final post-review `bun test` result: **736 pass / 7 fail**, 3,432 expectations across 120 files,
exit 1. At that run, the six then-new tests (five lifecycle-safety cases plus the malformed-store
case) all passed. The two lifecycle cases added by the subsequent re-review fix passed in the
focused seven-case run recorded below. The previously intermittent C5 isolated-process
RED-control test also passed in the final install state. The seven remaining failures are
inherited, not suppressed:

1. C6 independent Vite/Next artifact-anchor digest.
2. P3 migration-walker ports suite with the migration case exercised.
3. Box-mask uniform scale snapping.
4. Text-mask movement snapping.
5. Custom-mask point insertion.
6. Editor singleton complete-runtime-graph assertion.
7. Batch time-span overlap placement.

`git diff --quiet 661d7ac8 -- <path>` returned 0 for every failing test file, the C6 checker,
the migration walker, and the affected classic/web implementation areas. It also returned 0 for
root `package.json`, `bun.lock`, `tsconfig.json`, and both Host manifests. The change's new fakes
and requirements-index tests are green in both the root and focused contracts runs.

## Complete checker-family census

All 32 `script/check-*.mjs` files were executed directly and their real exits recorded.
Twenty-five exit 0. Four are context-only entry points whose bare invocation correctly refuses
missing inputs. Three inherited reds are retained and dispositioned below.

| checker | exit | result / population |
| --- | ---: | --- |
| `check-adapter-author-guide-commands.mjs` | 0 | 5 documented commands = 5 unique runner steps |
| `check-adapter-project-template.mjs` | 0 | 16 files; 43 imports; suites 36/21/38/22/29 |
| `check-agent-evidence.mjs` | 0 | both Hosts' existing agent evidence clean |
| `check-asset-manifest.mjs` | 2 | context gate: requires preview at `127.0.0.1:4173` |
| `check-distributable-boundary.mjs` | 0 | 3,842 modules; all exclusions clean |
| `check-editor-singleton.mjs` | 0 | 781 runtime + 40 command modules |
| `check-emitted-runtime-assets.mjs` | 1 | inherited red: 2 Next worker relative escapes |
| `check-headless-graph.mjs` | 2 | context gate: requires envelope and Host/build arguments |
| `check-headless-semantic-result.mjs` | 2 | context gate: requires Vite and Next report JSON |
| `check-host-composition.mjs` | 0 | 3 Host roots + 836 production modules |
| `check-next-imports.mjs` | 0 | clean |
| `check-package-boundary.mjs` | 0 | final rerun: 1,158 repo files; 1,013 source files; 419 cross-package edges |
| `check-packed-manifest-closure.mjs` | 0 | 4 packages; 0 closure failures |
| `check-port-boundary.mjs` | 0 | all non-empty acquisition rules clean |
| `check-react-singleton.mjs` | 0 | 4 manifests + lock + 3,842 modules |
| `check-reference-boundary.mjs` | 0 | 1,281/1,660 files scanned; all rules clean |
| `check-resolution-equivalence.mjs` | 1 | context gate: requires staged specifier rewrites; 0 present |
| `check-runtime-asset-boundary.mjs` | 0 | all Host and asset/Worker layers present |
| `check-sdk-consumer-view.mjs` | 0 | 4 packed packages; 0 failures; 0 dangling entries |
| `check-sdk-surface-labels.mjs` | 0 | 36 entries = frozen 16 / provider 13 / experimental 7 |
| `check-session-resource-boundary.mjs` | 0 | all non-empty resource rules clean |
| `check-session-state-boundary.mjs` | 0 | 10/10 factories; 10/10 registry keys; 53 imperative modules |
| `check-storage-boundary.mjs` | 0 | final ProjectStore/Host boundary clean |
| `check-surface-boundary.mjs` | 0 | 15 Surface modules |
| `check-surface-css-boundary.mjs` | 0 | 1 source + 1 emitted CSS file |
| `check-surface-portal-boundary.mjs` | 0 | 13 files |
| `check-surface-private-drag.mjs` | 0 | 724 files |
| `check-transaction-boundary.mjs` | 0 | all vector-leak rules clean |
| `check-type-baseline.mjs` | 1 | inherited red: 2 TS2769 diagnostics |
| `check-wasm-api-surface.mjs` | 1 | inherited environment red: LICENSE/README line endings |
| `check-wasm-paths.mjs` | 0 | 285 remapped `/cargo` paths; no machine identity |
| `check-wasm-source.mjs` | 0 | 8 build files; 44 Rust inputs considered |

The four context-only exits are the documented fail-closed bare behavior, not regression claims.
Their exercised forms are covered by the completed Host parity/build evidence or are inapplicable
because this change contains no staged resolution rewrite.

## Inherited-red base/diff evidence

### Emitted Next transcription worker

`check-emitted-runtime-assets.mjs` reports exactly:

```text
relative-next-static-escape static/media/worker.dd71b7fd.ts -> ../../transcription/types
relative-next-static-escape static/media/worker.dd71b7fd.ts -> ../../transcription/audio
```

The same run first passes the source-level runtime asset boundary. Both
`script/check-emitted-runtime-assets.mjs` and
`packages/editor-classic/src/services/transcription/worker.ts` are byte-unmodified by this change
(`git diff --quiet 661d7ac8 -- <path>` exit 0). The generated worker merely preserves the two
unchanged source imports. No adapter-enablement file imports or emits this worker.

### Type baseline

`check-type-baseline.mjs` reports two TS2769 diagnostics in the unchanged classic tests:

- `packages/editor-classic/src/timeline/__tests__/update-pipeline.test.ts:69`
- `packages/editor-classic/src/timeline/placement/__tests__/resolve.test.ts:646`

The checker and both diagnostic files have zero diff from `661d7ac8`; package-manager and
TypeScript configuration inputs are also unchanged. The adapter fakes' strict scoped TypeScript
check has zero diagnostics.

### wasm API newline anchor

The API checker and `script/wasm-api-surface-contract.mjs` have zero diff from `661d7ac8`.
The current Windows wasm-pack output contains LF-only text for the two failing generated files:

| file | actual LF SHA-256 | CR bytes | in-memory CRLF projection | checker expected |
| --- | --- | ---: | --- | --- |
| `LICENSE` | `814632368a8331fd1f485f4bd4b7ecb6401e5f2a24fba79cd3e21aff8ca39a6e` | 0 | `8117f9bb64534f7530fc6139b014fd1c1465f7981f93d1871789150fa3f59d3d` | same |
| `README.md` | `c8fe27ab5d2e12963e1f04571549afc9828060f4dfec85e6afaa188d3d90a128` | 0 | `a09d79579ac121a05ab38ca5c4cba505d91f2ee4359d336cc2cc1fd36b4d3191` | same |

Mechanical LF-to-CRLF projection in memory exactly reproduces both recorded hashes. The wasm
implementation and the separate wasm-determinism worktree were not modified.

## Dual-Host parity

- Vite parity: 1/1 passed.
- Next parity: 1/1 passed.
- Cross-Host classifier: exit 1 with **28 total / 19 semantic / 9 incidental**.
- All 19 semantic rows remain inside the known per-run idempotency UUID nondeterminism envelope;
  zero rows exist outside that envelope.

`28/19/9` is the authoritative historical baseline recorded in
`rasen/changes/archive/2026-08-12-s0304-surface-css-react-a11y/evidence/implementation-report.md`.
That report explicitly states that the classifier is causation-blind and exits non-zero on every
run, so the rows, not the raw exit alone, are the parity gate. Neither parity harness nor either
Host is changed here.

## Published tarball examples

Fresh scratch root: `E:\opencut-published-examples-final-20260816`.

- `install-packages`, `embed-surface`, `custom-storage`, and `agent-transaction`: exit 0 each.
- Embed Playwright smoke: 9/9 assertions.
- All four installed SDK artifacts were real directory copies from staged `file:` tarballs, with
  no workspace or link resolution.
- Mixed versions were observed as intended: ports `0.2.0`, contracts `0.3.0`, classic `0.2.0`,
  wasm `0.2.10`.

Together with `evidence/author-template-final.md`, this proves both existing published examples
and the new author scaffold execute from freshly packed artifacts without a registry or workspace
link.

## Post-review fix regression

The independent pre-landing review found six actionable issues. All six were accepted. Its first
re-review closed four and retained the scratch quarantine identity and executable-command binding
findings; both received a second fix and the affected gates were rerun:

- Clean-checkout CI now runs `bun install --frozen-lockfile` before the repository template drift
  check. The drift checker fails if that locked root install is absent or ordered after the check;
  the live gate passed with suites 36/21/38/22/29.
- Scratch replacement now authenticates marker schema, exact `createdBy`, original root path,
  physical parent identity, and root device/inode. It moves an authenticated tree to a unique
  sibling quarantine, requires the first post-rename directory identity to equal the pre-rename
  identity, and revalidates parent/tree/marker immediately before recursive cleanup. Cleanup
  failures re-inspect canonical/quarantine/marker state before reporting it. Seven tests passed
  with 29 expectations: exact owned rerun, foreign/copied marker, parent swap, canonical-root
  redirection, post-rename copied-marker replacement, cleanup-quarantine redirection, and partial
  cleanup failure. No unrelated sentinel was removed.
- Each guide command is now derived from the same structured executable/argv descriptor consumed
  by `runLogged`; there is no second hard-coded argv at the execution sites. The live gate passed,
  and negative controls fired for an added prose ID, guide-body mutation, actual execution-argv
  mutation under an unchanged descriptor/ID, and an undocumented runner step.
- All four malformed resolved ProjectStore shapes now reject with the promised
  `contract fakes: engine createStore:` prefix, while real `ProjectStoreError` identity remains
  preserved. Focused fakes tests passed 8/8 with 40 expectations and strict scoped TypeScript
  produced zero diagnostics.
- `BOUNDARIES.md` now describes exact pins as version-intent rewritten to fresh `file:` tarballs,
  not a registry install shape.
- Focused ESLint over the lifecycle, guide/template checks, runner, and fakes files exited 0;
  Prettier check, strict UTF-8/LF checks, and `git diff --check` also passed for the final delta.

The four in-project descriptor commands were then exercised against the retained successful
materialization at `E:\opencut-adapter-author-final-20260816\adapter-project`: typecheck, production
conformance, mock migration, and failure demo all exited 0, with populations 36/21/38/22/29 and
the expected six requirement-first demonstration failures. The runner-entry/materialize descriptor
was exercised by a further fresh-root pack/install attempt after command binding: materialization
and all four tarball packs exited 0, but npm stopped during dependency extraction with `ENOSPC`
when the E: drive had only about 1.63 GB available. That run is not counted as green. Its newly
created partial scratch tree was authenticated, moved to quarantine, removed through the safe
lifecycle, and left as a marker-only empty root; no retained evidence scratch or repository path
was removed.

Shared-harness integration was repeated from fresh repository-external roots after the safety
change:

| consumer | result |
| --- | --- |
| author runner, fresh root | all steps 0; populations 36/21/38/22/29 |
| author runner, same exact root | authenticated quarantine move/cleanup/recreate; all steps 0 |
| P3 scratch conformance | four real tarball copies; populations 36/21/38/22/29; exit 0 |
| four published examples | all four exit 0; embed smoke 9/9; final runner exit 0 |

## 6.2 conclusion

Every change-attributable package, scaffold, guide, build, Host, packed-consumer, surface-label,
and boundary gate is green with non-zero populations. The retained non-zero results are either
fail-closed context entry points or byte-unmodified inherited reds with explicit base/diff
evidence above. No registry behavior, S06-S09 implementation, frozen signature, or wasm fix is
claimed.

## 7.1 strict change readiness

`rasen validate sdk-ecosystem-enablement --type change --strict --no-interactive --json` was run
from this linked worktree without `--project rocut` (which would select the separate registered
main worktree). It reported 1/1 valid change, 0 failures, and 0 issues.

At reconciliation time, tasks 1.1 through 6.5 were complete with no open implementation box;
the author, blind-test, template-drift, and regression evidence agreed on populations
36/21/38/22/29. The delta spec contained 5 requirements and 12 scenarios, `signals/.state/` had
zero entries, the local `.rasen/` tree had zero files, and zero `.rasen/` path was staged.

## 7.3 pull request CI

The substantive branch head `e835c6a5e855e09d3f65371f5dd8b368df53e589` was pushed and opened as
`https://github.com/DumoeDss/rocut/pull/4` against `main`. Bun CI run `31942372869` completed its
change-specific `sdk-examples` job green in 4m30s. The published-examples runner, locked root
install, adapter template/guide checks, and adapter-author template runner all completed
successfully on the clean Ubuntu checkout.

The overall workflow remained red because `build (ubuntu-latest)` failed the pre-existing
`Verify the exact additive wasm API surface` step; macOS and Windows were then cancelled by
matrix fail-fast. The immediately preceding `main` run `31915394334` at the exact base commit
`661d7ac87c3d324839d51bf30470bbf81764b694` failed the same Ubuntu step with the same five
messages: generated `LICENSE`, `README.md`, and `package.json` drift, low-level declaration drift,
and the binary export set differing from 58. This change does not modify that checker, Rust/WASM
source, or generated wasm contract. The PR remains open and unmerged.
