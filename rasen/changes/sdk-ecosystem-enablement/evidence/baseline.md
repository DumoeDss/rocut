# Baseline evidence

Date: 2026-08-16

Repository baseline: `661d7ac87c3d324839d51bf30470bbf81764b694`

This capture was made before any implementation edit for
`sdk-ecosystem-enablement`. Both runs used the repository's own pack and scratch
harness, not workspace resolution.

## P3 third-party adapter scratch run

- Command: `$env:OPENCUT_SCRATCH_ROOT='E:\opencut-scratch-eco-p3'; node script/run-scratch-conformance.mjs`
- Scratch root: `E:\opencut-scratch-eco-p3` (outside the repository and every
  detected Temp root).
- Pack/install result: four freshly packed artifacts were staged and installed:
  `@opencut/editor-ports`, `@opencut/editor-contracts`,
  `@opencut/editor-classic`, and `opencut-wasm`.
- Control 1: root outside repository, root outside Temp, and ancestor
  `node_modules` absence all passed.
- Control 2: all four installed package paths were real directories with
  `symlink=false`; their lockfile entries resolved from `file:` tarballs with
  `link=false`; no `workspace:` resolution was present.
- React-free control: passed.
- Suite populations and outcomes:

  | surface | population | outcome |
  | --- | ---: | --- |
  | ports | 36 cases | passed |
  | transaction | 21 cases | passed |
  | engine | 38 cases | passed |
  | draft | 22 cases | passed |
  | vectors | 29 vectors | passed |

- Classic migration production leg: distinctly skipped because loading
  `@opencut/editor-classic/storage/migrations` observed
  `wasm.__wbindgen_start is not a function`. This is the existing
  Direction-level wasm-initialization finding, not a conformance-suite failure.
- Self-logged exits: `REAL_EXIT_CODE[suites]:0` and
  `REAL_EXIT_CODE[scratch-run]:0`; foreground process exit: `0`.

## P6 published examples run

- Command: `$env:OPENCUT_SCRATCH_ROOT='E:\opencut-scratch-eco-p6'; node script/run-published-examples.mjs`
- Scratch root: `E:\opencut-scratch-eco-p6`; four independent example projects
  were materialized outside the repository and Temp.
- Consumer view: four staged tarballs verified with zero failures and zero
  dangling declared entries.
- For every example, each declared SDK dependency (and the transitive wasm
  artifact where classic was present) passed the copy-not-link and `file:`
  lockfile controls. No workspace link was accepted.
- `agent-transaction`, `custom-storage`, `embed-surface`, and
  `install-packages` completed all manifest-declared steps with
  `EXIT[example/...]:0`.
- `custom-storage/run.ts` recorded the same production wasm-init skip
  distinctly; `custom-storage/run-mock.ts` installed the published experimental
  wasm test mock first and validated the real 31-step migration chain over the
  alien store.
- Embed Playwright smoke: 9/9 assertions passed.
- Self-logged exit: `REAL_EXIT_CODE[examples-run]:0`; foreground process exit:
  `0`.

## Public-surface census before the change

The census excludes each package's mechanical `./package.json` export.

| package | entries | frozen | provider | experimental |
| --- | ---: | ---: | ---: | ---: |
| `@opencut/editor-ports` | 6 | 5 | 0 | 1 |
| `@opencut/editor-contracts` | 10 | 9 | 0 | 1 |
| `@opencut/editor-classic` | 19 | 2 | 13 | 4 |

These populations are the before half for the additive entry and final census
checks later in this change.
