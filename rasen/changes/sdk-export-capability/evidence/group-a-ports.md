# Group A — editor-ports export-job surface (evidence)

Date: 2026-08-16. Branch `feat/sdk-export-capability` (base 661d7ac8), worktree
`_others/rocut-wt-export`. All commands run from the worktree root. Every log
snippet below is real output captured to the untracked scratch logs named in
each section; exit codes are read from the `REAL_EXIT_CODE:$?` trailer the
commands themselves wrote (background exit codes are unreliable on this host).

Delivered:

- `packages/editor-ports/src/export-jobs.ts` — the additive experimental entry
  (types + `ExportJobStore` reducer + `ExportJobProvider` interface +
  `InMemoryExportJobProvider` reference). Exactly one `@opencutSurface
  experimental` marker, first docblock of the file.
- `packages/editor-ports/package.json` — `"./export-jobs": "./src/export-jobs.ts"`
  added to the exports map.
- `packages/editor-ports/surface.json` — the `./export-jobs` row, class
  `experimental`, with the design's reason text verbatim.
- `packages/editor-ports/src/__tests__/export-jobs.test.ts` — 24 tests
  (13 store-level, 11 provider-level).

## 1. check:surface-labels — PASS

Command: `node script/check-sdk-surface-labels.mjs` (final run, on the fully
restored tree after all mutation rounds; log `.groupa-final-labels.log`).

```
check-sdk-surface-labels: scanned 3 package(s), 36 export entries
  census  @opencut/editor-classic: 19 export entries — frozen 2, provider 13, experimental 4
  census  @opencut/editor-contracts: 10 export entries — frozen 9, provider 0, experimental 1
  census  @opencut/editor-ports: 7 export entries — frozen 5, provider 0, experimental 2
  census  total: 36 export entries across 3 package(s) — frozen 16, provider 13, experimental 7
  census  dangling-export-entries: 0
  PASS  completeness: every export entry is classified in surface.json with a known class and a non-empty reason, and every row names a declared entry
  PASS  marker-agreement: provider/experimental rows carry exactly one @opencutSurface marker matching the manifest class in their entry file; frozen rows carry none
  PASS  override-validity: every symbol-level override names a symbol the entry actually exports
  PASS  target-existence: every declared entry's target is a plain string whose file exists on disk
REAL_EXIT_CODE:0
```

Movement vs baseline: editor-ports 6 → 7 entries (experimental 1 → 2); total
35 → 36 (experimental 6 → 7). No dangling entries.

## 2. check:packages — PASS

Command: `node script/check-package-boundary.mjs` (final run; log
`.groupa-final-packages.log`). Baseline numbers from
`evidence/baseline-20260816.md` (1138 files) and the base-tree re-run in
`.groupa-chk-packages-baseline.log`.

```
check-package-boundary: scanned 1140 repo file(s) (tracked + uncommitted)
  PASS  acyclic-direction: every cross-package edge points to a strictly lower declared layer (1013 file(s) scanned, 416 cross-package edge(s) examined)
  PASS  public-entry-only: a specifier crossing into a package resolves only to a declared exports subpath (1013 file(s) scanned, 415 @opencut/* specifier(s) examined)
  PASS  no-internal-reexport: no package's declared entry re-exports a module owned by another package's undeclared internals (872 file(s) scanned)
  PASS  no-elftia-import: no package, Host or example imports an Elftia package, protocol identifier or runtime object (1140 file(s) scanned)
  PASS  react-free-base: editor-ports and editor-contracts import no React, no DOM global, and no editor-classic module (76 file(s) scanned)
REAL_EXIT_CODE:0
```

Movement vs base 1138 → 1140 (the two new editor-ports files);
react-free-base 74 → 76; no-internal-reexport 870 → 872. All rules green.

## 3. bun test packages/editor-ports — PASS

Command: `bun test packages/editor-ports` (final run; log
`.groupa-final-pkg-test.log`).

```
 56 pass
 0 fail
 272 expect() calls
Ran 56 tests across 3 files. [296.00ms]
REAL_EXIT_CODE:0
```

Base was 32 tests / 2 files; the new suite adds 24 tests / 1 file.

## 4. Full bun test — exactly the 6 baseline failures

Command: `bun test` (log `.groupa-final-full-test2.log`, run on the fully
restored final tree).

```
 748 pass
 6 fail
 3453 expect() calls
Ran 754 tests across 119 files. [48.29s]
REAL_EXIT_CODE:1
```

The six failures, byte-identical in name to the pre-existing baseline set:

```
(fail) the ports suite passes with the migration case exercised
(fail) mask snapping > snaps uniform scale handle for box masks
(fail) mask snapping > snaps text mask movement using intrinsic text bounds
(fail) custom mask point insertion > splits a segment into two segments at the insertion point
(fail) editor singleton boundary > the complete runtime graph has no implicit editor owner [563.00ms]
(fail) resolveTrackPlacement > batch time spans reject tracks when any span overlaps
```

Flake disclosure: one intermediate full run (`.groupa-final-full-test.log`)
reported a 7th failure, `browser project migration topology gate runs in an
isolated process [1797.00ms]` (747 pass / 7 fail). The nested isolated `bun
test` process in that harness crashed before running any tests (header + crash
separator, zero test lines — not an assertion failure). Evidence it is
environment flake, not this change: the same test **passed** (266 ms) in the
earlier full run on a byte-identical tree (`.groupa-full-test.log`), passes in
isolation on the final tree (`.groupa-isolated-recheck.log`, `1 pass / 0 fail`,
REAL_EXIT_CODE:0), and passed again in the final full run above. The topology
test is editor-classic storage territory and imports no editor-ports module.

## 5. Mutation verifications

Protocol: temporary edit to `export-jobs.ts` (applied via LF-safe python
`io` round-trips) → run
`bun test packages/editor-ports/src/__tests__/export-jobs.test.ts` → capture
RED → restore the exact original bytes → capture GREEN → verify zero CR bytes
and zero `MUTATION` remnants. All three rounds ran against the final tree
(after the queueMicrotask default-scheduler fix).

### Mutation 1 — progress monotonicity (encode decrease-refusal removed)

Edit: `setEncodeProgress` stopped refusing a lower value (the
`progress < state.progress` throw deleted).

RED (`.groupa-mut1-red.log`):

```
(fail) the export-job store > beginEncoding resets the progress scale and refuses a decrease
REAL_EXIT_CODE:1
```

GREEN after restore (`.groupa-mut1-green.log`): `24 pass / 0 fail`,
REAL_EXIT_CODE:0.

### Mutation 2 — cancel settle (confirmCancelled stopped settling the phase)

Edit: `confirmCancelled` patched only `{ cancelRequested: false }` and no
longer moved the phase to `cancelled`.

RED (`.groupa-mut2-red.log`):

```
(fail) the export-job store > cancel is two-step: the request stops work, the confirm settles
(fail) the export-job store > a cancel requested in queued goes straight to cancelled via confirm [15.00ms]
(fail) the in-memory reference provider > cancel stops the synthetic run, settles cancelled, and is idempotent
REAL_EXIT_CODE:1
```

GREEN after restore (`.groupa-mut2-green.log`): `24 pass / 0 fail`,
REAL_EXIT_CODE:0.

### Mutation 3 — resume frame-accuracy (resume reset accepted frames to zero)

Edit: `resume()` additionally patched `frames` back to
`{ accepted: 0, total }`, destroying the interrupted frame count.

RED (`.groupa-mut3-red.log`):

```
(fail) the export-job store > interrupt keeps frames, resume is frame-accurate to the original totals
error: ExportJobTransitionError: beginEncoding: every frame must be accepted first — frame accuracy is a state-machine property, not a producer promise
REAL_EXIT_CODE:1
```

The store's `beginEncoding` guard (requires `accepted === total`) is what
catches the mutated resume at unit level.

Honest nuance: under this mutation the provider-level resume test
("an interrupted provider job resumes and completes with the original totals")
still passes — the synthetic runner re-accepts frames from whatever count the
store reports, so a zeroed store simply re-renders and still lands on 30/30.
The store-level frame-accuracy test is the mutation-catching proof; the
provider test proves the reference wires resume through the store, not
frame-accuracy itself. Real adapters (Group C's desktop job manager) inherit
the store's guard because the store is the transition SSOT (design D2).

GREEN after restore (`.groupa-mut3-green.log`): `24 pass / 0 fail`,
`78 expect() calls`, REAL_EXIT_CODE:0.

## 6. Frozen surfaces untouched

Read-only record (`.groupa-final-diff.log`):

```
 packages/editor-ports/package.json | 1 +
 packages/editor-ports/surface.json | 4 ++++
 2 files changed, 5 insertions(+)
REAL_EXIT_CODE:0
```

Untracked additions in the package: `src/export-jobs.ts`,
`src/__tests__/export-jobs.test.ts`. No diff line touches
`src/export-provider.ts`, `src/index.ts`, `src/in-memory/**`,
`src/host/**`, or `src/conformance/**`.

## 7. Lint and C6 findings

- ESLint (`bunx eslint packages/editor-ports/src/export-jobs.ts
  packages/editor-ports/src/__tests__/export-jobs.test.ts`,
  `.groupa-eslint.log`): 0 problems, exit 0 — including the repo's
  `opencut/prefer-object-params` rule, which is why every store transition and
  provider method takes a single options object. (For the record, the frozen
  `src/in-memory/index.ts` carries 2 pre-existing prefer-object-params errors
  at base; lint is not an acceptance gate and those bytes were not touched.)
- C6 session-resource boundary: the first implementation's default scheduler
  `(fn) => setTimeout(fn, 0)` was flagged by `no-direct-timer` at
  `export-jobs.ts:618`. Fixed inside the allowed paths by defaulting to
  `(fn) => queueMicrotask(fn)` (not a C6-tracked timer global; rationale in the
  `ProviderOptions.scheduler` docblock). Post-fix run
  (`node script/check-session-resource-boundary.mjs`,
  `.groupa-c6-check.log`):

```
  PASS no-direct-timer: 0 violation(s)
  PASS no-direct-worker: 0 violation(s)
  PASS no-direct-audio: 0 violation(s)
  PASS no-direct-object-url: 0 violation(s)
  PASS no-offline-escape: 0 violation(s)
  PASS no-unkeyed-compositor: 0 violation(s)
  PASS no-second-acquisition-mediator: 0 violation(s)
clean — all non-exempt web editor acquisitions cross the session seam
REAL_EXIT_CODE:0
```

## 8. Line endings

`tr -dc '\r' < file | wc -c` prints 0 for all four delivered files:
`src/export-jobs.ts`, `src/__tests__/export-jobs.test.ts`, `package.json`,
`surface.json` — and for this evidence file.
