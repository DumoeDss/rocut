## Context

S05 leaves three useful but separate layers. The frozen ports package already publishes its
in-memory store, controls, host composition, and port conformance fixture. The contracts package
publishes all five suite interfaces, but the canonical engine/draft fixture assembly remains in
`conformance/requirements/__tests__`, while the in-memory and durable vector target factories
remain internal under `vectors/drivers/`. P3's conforming flat-JSON-tuple adapter and P6's
`custom-storage` example therefore repeat fixed project ids, native seeding, save/fault
observation, committed-state capture, draft counters, and vector seeding.

The baseline was rerun at `661d7ac8` before design: the repository-external P3 adapter passed
ports 36, transaction 21, engine 38, draft 22, and vectors 29; all four P6 examples passed and
the embed smoke passed 9 assertions. The current surface census is ports 6 entries (5 frozen,
1 experimental), contracts 10 (9 frozen, 1 experimental), and classic 19 (2 frozen,
13 provider, 4 experimental).

Constraints are strict: no registry publication or claim; no workspace linking; no frozen
entry/signature edits; no S06–S09 implementation; no dependency on Elftia; and every new public
entry must satisfy the existing exports/surface-marker checker in both directions.

## Goals / Non-Goals

**Goals:**

- Give an adapter author one documented route from freshly packed tarballs to all five structured
  conformance reports.
- Provide a real copyable project scaffold whose primary path exercises the author's own adapter,
  not only OpenCut reference implementations.
- Concentrate the repeated ProjectStore-backed engine/draft/vector fixture assembly behind a
  small public interface, while keeping suite options and reports on the existing frozen seams.
- Execute the guide and scaffold in a repository-external scratch tree locally and in CI, with
  no-link controls and non-zero population counts.
- Obtain an independent guide-only blind test before delivery.

**Non-Goals:**

- A general fake framework, public vector-driver internals, or a replacement conformance runner.
- Hiding an adapter defect by substituting the ports or transaction reference implementation for
  the author's implementation in the scaffold's acceptance run.
- Registry behavior, release automation, S09 provider evolution, or timeline/editor/export work.
- Changing the wasm-init routing or toolchain-determinism repair delivered separately by PR #3;
  this change consumes that repair and keeps only a fail-closed distinct-skip branch.

## Decisions

### E1 — One deep ProjectStore-backed fakes module, one experimental entry

Add `@opencut/editor-contracts/conformance/fakes` with this conceptual interface:

```ts
export interface ProjectStoreConformanceFactories {
	readonly engine: TransactionEngineConformanceFactory;
	readonly draft: DraftEditingConformanceFactory;
	readonly vectors: VectorTargetFactory;
}

export function createProjectStoreConformanceFactories(args: {
	readonly createStore: () => ProjectStore | Promise<ProjectStore>;
}): ProjectStoreConformanceFactories;
```

Each engine/draft factory call and each vector open obtains a fresh store. Reopen stays on the
same store within one engine fixture. The module preserves the existing factory options exactly,
uses deterministic internal seed values, excludes seed work from reported counters, and lets
real `ProjectStoreError` failures pass through. Configuration-shape or fixture-setup failures
throw/reject with a clear `contract fakes:` prefix; contract mismatches remain structured suite
reports and are formatted by the existing requirement index.

The implementation hides the contract-profile placement composer, native project seed/document
adapter, observed save/fail/pause wrapper, reopen and persisted-record reads, private native
committed-state capture, draft revision/apply/watch counters, retention fake, fixed draft project
id, and vector document-to-operation seeding. These are in-process mechanics over the
local-substitutable `ProjectStore` seam; there are no remote or true-external dependencies and no
new port.

The interface deliberately does not expose clock, seed, dispose, internal driver, or control
overrides. The frozen suite factory interfaces have no teardown seam, and inventing one here
would create lifecycle promises the suites cannot honor. The scaffold uses disposable local
stores; authors with external resources continue to implement the frozen factory interfaces
directly.

Three alternatives were designed independently:

- A zero-input reference-fakes aggregate was smallest, but it proves only that the runner works,
  not that the author's ProjectStore participates.
- A maximally flexible lifecycle object added clock, seed, purpose context, setup error classes,
  and disposal. It offered extension points before two real callers require them and made the
  interface nearly as complex as its implementation.
- One factory per suite or restoring `./vectors/drivers` was rejected because it leaks shallow
  test internals and reverses P5's removal of an unforced drivers entry.

The chosen module has depth: deleting it redistributes the same suite-specific assembly into the
template, requirement-index guard, and every ProjectStore adapter author; keeping it concentrates
that knowledge behind one create function and the already-frozen factory types.

### E2 — The public fake is experimental and versions move honestly

The new entry target lives under `packages/editor-contracts/src/conformance/fakes/`, begins with
an `@opencutSurface experimental` marker, and receives one attributed `surface.json` row. It is
test/author infrastructure rather than frozen contract truth. The contracts package moves from
`0.2.0` to `0.3.0`, a minor because the public surface changes; ports and classic remain at
`0.2.0`. Exact example pins and version assertions follow the actual per-package versions.

No existing frozen barrel re-exports the helper. Existing requirement-index tests consume the
new entry module instead of retaining duplicate engine/draft fixture assembly. The internal
vector drivers remain undeclared implementation modules.

### E3 — A dedicated scaffold, derived from the P3/P6 alien adapter

`templates/adapter-project/` is the canonical copyable scaffold. It retains the deliberately
alien flat JSON-tuple store, codec, port roles, transaction target, requirement-first reporting,
and both migration execution paths, but replaces repeated engine/draft/vector assembly with E1's
public helper. After PR #3, the production path loads and exercises the real chain with no mock;
the distinct-skip branch remains fail-closed, while the mock-installed path validates the
experimental compatibility entry. Its README labels required customization points separately
from reference/demo code and states which suites exercise which author-owned implementation.

The committed manifest records exact expected package versions as input data. Materialization
rewrites every `@opencut/*` dependency and the wasm override to staged `file:tarballs/*.tgz`
specs before install; exact pins are never described as a registry shape. The materialized
project contains no workspace protocol or symlink and can be copied after generation.

The existing P3 fixture and P6 example remain regression controls rather than becoming hidden
dependencies of the scaffold. A small drift guard compares the intended seed files or behaviors
so the new author asset cannot silently lose the properties that made P3 a proof.

### E4 — One author runner owns materialization; the guide documents what it executes

`script/run-adapter-author-template.mjs` reuses `packSdkTarballs` and the shared scratch harness:
resolve a marker-owned root outside the repo/Temp/leaky ancestors, stage four unmodified
tarballs, copy the scaffold, rewrite its manifest to `file:` specs, install with npm, assert real
directory copies and lockfile resolutions, type-check, run the production and mock-installed
legs, and self-log every exit code. The runner leaves the successful materialized project at the
printed scratch path for author inspection.

`docs/adapter-authors/README.md` gives the full conceptual path but keeps executable commands on
the supported runner and scaffold scripts. Every command block carries a stable command id; a
guide-command check maps those ids to runner steps and fails if prose gains an unexecuted command.
Failures are explained as frozen requirement → case → detail, never by asking authors to inspect
package stack traces.

The existing Ubuntu `sdk-examples` job invokes the author runner with
`$HOME/.opencut-adapter-template-ci`, after the same self-built wasm preparation as the other
tarball examples. No publish step is added.

### E5 — Evidence has independent and negative controls

Local evidence records baseline and final populations beside green conclusions: tarball/file
counts, surface-class census, five suite case counts, template command exits, package-boundary
controls, and full regression counts. The surface-label negative/converse controls and package
boundary negative/converse controls run after the new entry.

After the guide and scaffold are complete, an independent sub-agent receives only the guide and
scaffold entry point (not implementation notes) and materializes a fresh scratch project under a
different E:-drive root. It must identify the customization seams, execute all five suites from
tarballs, and explain one structured failure. Its transcript and any author-ambiguity findings
land in `evidence/`; the author fixes the guide, then the independent agent reruns the delta.

## Risks / Trade-offs

- **[The helper accidentally proves the reference implementation instead of the adapter.]** → Its
  only dependency injection is `createStore`; the scaffold runs ports and transaction against
  its own roles/target and engine/draft/vectors over stores returned by that function.
- **[Fixture observation changes store semantics.]** → The wrapper delegates all ordinary reads
  and writes unchanged and limits synthetic failure/pause behavior to suite-requested save
  controls; ports conformance continues to test the store directly.
- **[Template duplication drifts from P3/P6.]** → Keep a small declared seed inventory and an
  executed drift/behavior guard; do not maintain three manual copies without attribution.
- **[A version bump invalidates example assertions.]** → Store expected versions per package and
  run the packed consumer view plus every materialized example before completion.
- **[Guide commands become prose-only.]** → Stable command ids and the command check make any
  undocumented runner step or unexecuted documented step fail.
- **[Scratch cleanup becomes destructive.]** → Reuse the marker-owned lifecycle and fail closed
  on foreign roots; CI and local evidence use explicit roots outside Temp and the repository.

## Migration Plan

Land additively in five groups: public fake + tests/version/labels; scaffold; guide and author
runner; CI/docs/checker audit; independent blind test and full close-out. Rollback is a revert of
the additive entry and author assets plus restoring the contracts version/pins. No persisted user
data or runtime host behavior migrates.

## Open Questions

None at propose time. If implementation shows that a conforming arbitrary `ProjectStore` cannot
support the helper without a new frozen factory capability, stop and record a contract finding;
do not add a private workaround or modify the frozen surface.
