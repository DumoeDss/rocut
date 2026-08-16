# Independent adapter-author blind test

Date: 2026-08-16

Verifier: independent sub-agent `/root/blind_test_adapter_guide`

Scratch root: `E:\opencut-adapter-blind-20260816`

The verifier received only `docs/adapter-authors/README.md`, the scaffold entry
`templates/adapter-project/README.md`, and the repository worktree location. It was explicitly
forbidden from reading the Rasen change, evidence, handoff, branch diff, implementation notes, or
unreferenced test source. All verifier writes stayed under the scratch root; it made no repository
edit.

## First clean-root run

The scratch path did not exist before the run. The verifier followed the documented supported
command with `OPENCUT_SCRATCH_ROOT` set to that path. Foreground exit was 0 after 75.6 seconds.

| step | real exit |
| --- | ---: |
| `author/materialize` | 0 |
| `author/pack` | 0 |
| `author/install` | 0 |
| `author/controls` | 0 |
| `author/typecheck` | 0 |
| `author/conformance` | 0 |
| `author/migration` | 0 |
| internal `failure-demo` | 0 |
| `author/failure-demo` | 0 |
| `author-runner` | 0 |
| foreground wrapper | 0 |

The verifier then independently ran the four materialized-project commands. `npm run typecheck`,
`npm run run`, `npm run run:mock`, and `npm run failure-demo` each exited 0.

## Tarball and install controls

| package | version | packed files | installed observation |
| --- | --- | ---: | --- |
| `@opencut/editor-ports` | `0.2.0` | 25 | real directory, not a symbolic link |
| `@opencut/editor-contracts` | `0.3.0` | 65 | real directory, not a symbolic link |
| `@opencut/editor-classic` | `0.2.0` | 807 | real directory, not a symbolic link |
| `opencut-wasm` | `0.2.10` | 7 | real directory, not a symbolic link |

The three direct SDK specs and their overrides resolved to their matching
`file:tarballs/*.tgz`; the wasm override resolved to its matching tarball. An independent strict
Node JSON read found 277 lock entries, zero `workspace:` resolutions, and zero `link:true`
entries. Repository/Temp/ancestor-`node_modules` controls passed and root React was absent. No
registry publish was attempted.

## Five-suite populations

| suite | verdict | population |
| --- | --- | ---: |
| ports | passed | 36 cases |
| transaction | passed | 21 cases |
| engine | passed | 38 cases |
| draft | passed | 22 cases |
| vectors | passed | 29 vectors |

The production migration leg reported `wasm.__wbindgen_start is not a function` and skipped only
migration distinctly. The mock-installed leg loaded the experimental wasm test mock and verified
the real 31-step chain: v30 to v31 with progress 1/1, a repeated `not-needed` result, and a
declining transform that failed closed with `invalid-version`.

## Independent failure interpretation

The deliberate stale target produced six expected failures out of 21 and no stack guidance. The
verifier read every entry in frozen requirement -> case -> detail order:

1. Three revision/conflict cases reported the target's stale read revision.
2. The keyless idempotency case observed a zero increment where two were required.
3. The watch case received a stale revision.
4. The get-context case returned revision 9 while the read seam remained at 0.

It correctly concluded that the details identify the adapter-owned transaction target's stale
`read.revision()` behavior, not an SDK stack problem, and that the transaction seam must be fixed
before rerunning the suite.

## Independently identified customization seams

Without implementation notes, the verifier classified:

- Required author modules: `src/alien-codec.ts`, `src/alien-store.ts`, `src/roles.ts`, and
  `src/transaction.ts`.
- Required factory seam: change only `createAdapterProjectStore()` in `src/factories.ts`, returning
  a fresh disposable store for each factory/open while engine reopen retains its fixture's store.
- Optional/conditional author modules: `src/alien-control.ts` when useful and `src/migrate.ts` only
  when the adapter truly owns Classic legacy data.
- SDK infrastructure: frozen suite runners/corpus/factory inputs and the published engine/draft;
  experimental fakes, requirement formatter, and wasm test mock remain infrastructure and do not
  prove adapter conformance by themselves.
- Demonstration support: `run.ts`, `run-mock.ts`, `failure-demo.ts`, `seed-check.ts`, and the Culori
  declaration support retain their exit/guard roles while author implementations change.

## Findings, author fixes, and same-verifier rerun

The first run found no blocker in the supported path, but identified three documentation
ambiguities: toolchain/wasm prerequisites were unstated, npm's three high-severity audit findings
had no conclusion boundary, and repository-only drift output could be mistaken for author-runner
output. The author updated only the guide to state exercised toolchains and prepared-wasm
requirements, separate audit policy from runner acceptance, and distinguish the repository-only
CI drift gate from the four materialized commands.

On the same verifier's marker-owned rerun, the runner printed that it verified and replaced the
previous scratch root, then recreated its marker. Foreground exit was 0 after 91.2 seconds; every
runner step remained 0 and populations remained 36/21/38/22/29. This also closed the verifier's
previously unexercised marker-replacement observation.

That rerun exposed one precise wording defect: the guide originally implied local use of pinned
Bun `1.2.18`, while the materialized scripts honestly printed Bun `1.2.2`. The author corrected
the guide to require Bun on `PATH`, state that materialized npm scripts call it directly, and
separate the exercised local versions from CI's explicit `1.2.18` installation.

The same verifier's final affected-delta probe returned:

| probe | value | exit |
| --- | --- | ---: |
| `node --version` | `v24.14.0` | 0 |
| `npm --version` | `11.9.0` | 0 |
| `bun --version` | `1.2.2` | 0 |

Those values exactly match the final guide and the fresh runner transcript. The verifier confirmed
that prerequisite, audit, and drift/materialized boundaries are now unambiguous, with no remaining
conflict. It correctly did not claim the repository-only drift gate was part of its author-runner
transcript; that separate gate is executed by CI and was already green in the final checker census.
