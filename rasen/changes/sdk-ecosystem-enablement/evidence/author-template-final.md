# Final adapter-author scratch run

Date: 2026-08-16

Repository base: `661d7ac8`

Scratch root: `E:\opencut-adapter-author-final-20260816`

The root did not exist before the run. It is outside the repository, outside every Temp root,
and below no ancestor containing `node_modules`. The marker-owned runner created it fresh and
retained the materialized project at
`E:\opencut-adapter-author-final-20260816\adapter-project`.

## Reproduction command

```powershell
$env:OPENCUT_SCRATCH_ROOT='E:\opencut-adapter-author-final-20260816'
node script/run-adapter-author-template.mjs
```

## Packed and installed artifacts

| artifact | version | packed files | installed form |
| --- | --- | ---: | --- |
| `@opencut/editor-ports` | `0.2.0` | 25 | real directory, `file:` resolution, not a link |
| `@opencut/editor-contracts` | `0.3.0` | 65 | real directory, `file:` resolution, not a link |
| `@opencut/editor-classic` | `0.2.0` | 807 | real directory, `file:` resolution, not a link |
| `opencut-wasm` | `0.2.10` | 7 | real directory, `file:` resolution, not a link |

All four tarballs were freshly packed and staged inside the scratch project. The three direct
SDK dependencies and the wasm override were rewritten to `file:tarballs/*.tgz`. npm added 252
packages; the resulting lockfile contained 277 package entries, zero `workspace:` resolutions,
and zero link entries. `node_modules/react` was absent, as required by the React-free migration
entry proof.

## Typecheck and conformance populations

`npm run typecheck` completed with zero diagnostics. The production leg then reported:

| suite | verdict | population |
| --- | --- | ---: |
| ports | passed | 36 cases |
| transaction | passed | 21 cases |
| engine | passed | 38 cases |
| draft | passed | 22 cases |
| vectors | passed | 29 vectors |

The production Classic migration import reproduced the known
`wasm.__wbindgen_start is not a function` finding and skipped only that leg distinctly. The
mock-installed leg loaded Classic through the experimental wasm test-mock and validated the real
31-step chain to target v31 over the alien store: migration 30→31 completed with monotone 1/1
progress, the second call reported not-needed, and a declining transform failed closed.

## Structured failure demonstration

The deliberately stale transaction target produced exactly six expected failures out of 21
cases. Every item was formatted in frozen requirement → case → detail order. The demonstration
reported no stack-frame guidance and exited zero only after validating all six failures.

## Self-logged real exits

| step | exit |
| --- | ---: |
| `author/materialize` | 0 |
| `author/pack` | 0 |
| `author/install` | 0 |
| `author/controls` | 0 |
| `author/typecheck` | 0 |
| `author/conformance` | 0 |
| `author/migration` | 0 |
| `failure-demo` | 0 |
| `author/failure-demo` | 0 |
| `author-runner` | 0 |
| outer PowerShell process | 0 |

The npm install printed three high-severity audit findings in third-party dependencies. It did
not change the install result or any author-runner acceptance gate; dependency remediation is
not part of this additive adapter-enablement change.
