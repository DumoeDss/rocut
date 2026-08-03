# C5 strategy attempt 3 planner handoff

Date: 2026-08-02  
Change: `s02-storage-port`  
Strategy budget: **3/3 exhausted**  
Status: **B1 Blocker open; not independently confirmed**

## Outcome

I selected a domain-complete v3 clear journal backed by a dedicated durable
library-clear authorization descriptor. The current bug is exact: v2 persists
certified media targets but resolves `clearLibrary:true` through the reopening
wrapper's current library database/store. That explains the independently
reproduced old-library survival and new-library cross-delete.

The full design is in
`evidence/strategy-attempt-3-design.md`. This handoff authorizes no status change:
the Blocker remains open until implementation and a different reviewer/verifier
confirm it.

## Selected implementation package

1. Add a versioned library clear binding scoped to
   `{projectsDatabase, projectsStore, libraryDatabase, libraryStore}` and SHA-256
   it over a canonical domain-tagged tuple.
2. Store an exact, strict descriptor/authorization row in dedicated
   `<projectsStore>-library-clear-bindings` storage under `projectsDatabase`.
3. Write `CascadeEnvelopeV3` with `clearScope` and separate exact `media` and
   `library` target arrays. Delete `clearLibrary` from newly written journals.
   Projects scope requires zero library targets; all scope requires exactly one.
4. For new all-clear, expand the logical commit to one transaction spanning
   project, cascade, and descriptor stores. Descriptor and journal must never be
   separated by a crash.
5. Before any physical I/O, validate all media certificates plus the strict
   library descriptor, fingerprint, control plane, and target equality. Execute
   library cleanup from the journal target only, never from current wrapper
   library fields.
6. Retain descriptors and retain journals on all postcommit failures. Cleanup is
   idempotent and deletes the journal only after every exact target succeeds.

The alternative that also works is domain-tagged library rows in the existing
media-ownership store. It was rejected because it expands the already-confirmed
media codec/state machine and increases regression risk for little benefit.
Journal-only digests or current-wrapper matching do not meet authorization plus
cross-configuration convergence.

## Legacy compatibility

- v2 `clearLibrary:false`: retain exact-media compatibility and perform no
  library I/O.
- v2 `clearLibrary:true`: default fail closed before all physical cleanup,
  retain the journal, and report
  `project-cascade-library-binding-required`/`unavailable`/nonretryable. Never
  bind the boolean to current configuration.
- If recovery for unlanded/developer v2 data is required, add trusted internal
  `previousLibraryBinding`. Atomically put its descriptor and replace the same
  v2 journal with v3 before cleanup. A conflict/malformed descriptor aborts.
- Revision-1 library booleans are equally ambiguous and must not clear the
  current wrapper.

## Commit and failure invariants

- Before transaction: failure or abort changes nothing.
- Logical commit: project clear + cascade journal + all-scope descriptor are one
  IndexedDB transaction.
- After commit: every retry rereads durable authorization before deleting
  anything.
- Different wrapper: only the shared projects control plane is taken from the
  wrapper; library database/store comes from the authorized journal target.
- Tampered/missing binding or inconsistent journal scope/cardinality: retain,
  report corrupt/unavailable, zero physical I/O.
- Failure after media, during library, after library, or before journal delete:
  exact idempotent retry converges and cannot touch a different library binding.

## Minimum product files

- `browser-project-store-internals.ts` or the new deep binding module
- new `browser-project-store-library-clear-bindings.ts`
- `browser-project-store-cascade.ts`
- `browser-project-store-cascade-manager.ts`
- `browser-storage-mechanisms.ts`
- `browser-project-store.ts`
- cascade round-2 probes, Vite harness, Playwright expectation, focused negative
  tests

Do not redesign media ownership. Preserve exact media descriptors/certificates,
binding-scoped owners, historical retry, the projects-control-plane queue, and
all attempt-2 M1/M2 acceptance.

## Required Chromium gates

1. Interrupted old `clear(all)` + runtime reset + new wrapper with distinct
   media/library bindings clears the old library and preserves the new sentinel.
2. Cross-config `clear(projects)` touches neither library.
3. Tampered binding/target retains journal and all unrelated sentinels; no media
   or library physical operation begins.
4. v2 `clearLibrary:true` fails closed without trusted history; optional explicit
   v2 promotion clears only the supplied old binding.
5. Crash after library clear but before journal deletion retries idempotently
   under another configuration.
6. Complete prior Chromium, focused tests, TypeScript/lint, boundary, format, and
   diff checks remain green.

## Required next roles

1. Implementer applies the selected design and records evidence without closing
   B1 by authorship alone.
2. A non-author reviewer reproduces the original two-sentinel counterexample and
   audits codec/authorization/transaction boundaries.
3. A non-author verifier reruns the complete gates and only then may close B1.

Final planner disposition: **Blocker open, strategy budget exhausted, escalated
to implementation plus independent confirmation**.
