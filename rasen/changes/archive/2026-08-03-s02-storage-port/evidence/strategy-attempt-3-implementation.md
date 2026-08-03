# C5 review-cycle strategy attempt 3 - implementation evidence

Date: 2026-08-02  
Branch/worktree: `feat/s02-storage-port` / `rocut-wt-c5`  
Base: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Selected design: Candidate A, dedicated library-clear authorization store  
Disposition: **implementation green; B1 requires independent non-author review and verification**

## Result

New projects/all clears now use a strict revision-3, domain-complete cascade
journal. The journal carries separate exact `media` and `library` target arrays;
new records never persist the revision-1/revision-2 `clearLibrary` boolean.
Projects scope requires zero library targets and all scope requires exactly one.
The v3 outer record, envelope, nested target object, media target, and library
target codecs reject missing or additional keys, illegal revisions/kinds,
undefined physical names, duplicate exact targets, and scope/cardinality
mismatches.

Library clear authority is retained in the dedicated internal
`<projectsStore>-library-clear-bindings` object store inside the projects
database. Each immutable descriptor binds revision 1 plus the exact
`{projectsDatabase, projectsStore, libraryDatabase, libraryStore}` tuple. Its
lowercase SHA-256 fingerprint is recomputed from canonical domain-tagged JSON,
must match the descriptor envelope and digest-derived row key, and is scoped to
the projects control plane containing the journal. An independently altered
journal target or descriptor therefore cannot authorize a physical clear.

For `clear(all)`, project rows, replacement cascade maintenance rows, and the
exact library descriptor are one three-store IndexedDB transaction. The helper
rereads the descriptor row inside that same transaction and aborts on a
conflicting value; an identical historical descriptor is reusable. Projects
scope retains the prior two-store logical commit and writes no library target.

Every cleanup retry performs the complete authorization preflight before the
first physical operation:

- every media target is revalidated through the retained attempt-2 descriptor
  and exact coverage certificate;
- every library target rereads its descriptor from the projects control plane,
  recomputes its fingerprint, and checks exact target equality;
- only after both domains pass are media databases/directories removed and the
  journal's exact `target.database` / `target.store` cleared.

The cleanup path never resolves a v3 library target through the reopening
wrapper's current library fields. Descriptor rows remain as bounded historical
authority, and the journal is deleted only after all physical work succeeds.
Malformed or unauthorized pending state is retained and diagnosed without
starting physical I/O.

## Legacy behavior

- Revision-1 and revision-2 `clearLibrary:true` records without trusted history
  fail closed before media or library I/O. They retain the journal and emit the
  fixed `project-cascade-library-binding-required` diagnostic with
  `code: unavailable` and `retryable: false`.
- Revision-1 is never promoted to current library configuration.
- Revision-2 `clearLibrary:true` optionally accepts the internal trusted
  `previousLibraryBinding`. The implementation first validates its exact v2
  media targets, prepares the historical library descriptor, then compare-and-
  swaps the same journal ID from v2 to v3 together with the descriptor in one
  cascade-plus-binding transaction. Both the expected raw journal and any
  existing descriptor are checked inside the transaction before either put.
- Revision-1/revision-2 `clearLibrary:false` remains media-only compatibility
  and performs zero library I/O.

Attempt-2 M1 tombstone staging and M2 media descriptor/certificate history,
binding-scoped ownership, projects-control-plane queueing, exact target
derivation, cross-binding registration serialization, and same-ID pending-save
barriers were retained.

## RED then GREEN

The Chromium cascade-round2 probe and Playwright contract were extended before
the product implementation. The RED run kept every inherited field green and
returned false for exactly these seven attempt-3 groups:

```text
version3AllJournalRetriesExactLibraryAcrossConfigurationReload
projectsJournalNeverTouchesLibraryAcrossConfigurationReload
tamperedLibraryBindingCannotCrossDelete
legacyVersion2LibraryBooleanFailsClosed
legacyVersion2LibraryBindingUpgradeConverges
postLibraryPreJournalCrashRetriesExactTarget
version3CodecCardinalityTamperRejects
```

The final Chrome 151 run returns true for all seven. The groups cover the six
required design axes plus the optional trusted v2 promotion and an additional
strict-codec/cardinality tamper family:

1. Interrupted old-binding all-clear resumes through a wrapper whose media and
   library bindings both differ, removes only the old exact library, completes
   exact media cleanup, and removes the journal.
2. Cross-configuration projects-clear encodes zero library targets and leaves
   both old and new library sentinels byte-for-byte intact.
3. A changed library descriptor cannot cross-delete either library or a
   not-yet-cleaned media sentinel; the journal remains with a nonretryable
   corrupt diagnostic.
4. A strict v2 library boolean without trusted history retains both sentinels
   and the journal with zero physical I/O.
5. Explicit trusted v2 promotion converges through atomic descriptor plus
   same-ID v3 replacement and clears only the supplied historical binding.
6. A crash after exact library clear but before journal deletion retries
   idempotently under changed configuration without touching the new library.
7. Missing/extra/wrong-cardinality v3 target domains and extra keys are retained
   as corrupt maintenance state and cannot begin cleanup.

## Write set and exclusions

Attempt-3 changed only:

- new `browser-project-store-library-clear-bindings.ts`;
- `browser-project-store-cascade.ts`;
- `browser-project-store-cascade-manager.ts`;
- `browser-storage-mechanisms.ts`;
- `browser-project-store.ts`;
- `browser-project-store-control.ts`;
- `browser-project-store-cascade-round2-probes.ts`;
- `apps/vite-example/src/c5-storage-harness.ts`;
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`.

No public `ProjectStore` port, Host, session, consumer, task list, prior review
artifact, Rust source, generated asset, or production Host configuration was
edited for attempt 3. No commit was created.

## Verification

```text
focused attempt-3 Chromium: PASS 1/1 on Chrome 151.0.7922.34
  store: 19/19
  lifecycle races: 16/16
  attempt-3: 7/7
  attempt-2 M1/M2 and strategy-1 matrices: all retained green
  corrupt rows: 6/6
  active read abort: 7/7

full Chromium config: PASS 3/3
  browser store matrix, C4 forced-none, migration round 1
C4 forced-none clean repeat: PASS 5/5

focused port/storage/negative Bun suite: PASS 48/48, 216 expectations
Vite TypeScript: PASS, zero diagnostics
exact-three TypeScript baseline: PASS, no diagnostic outside the pin

port boundary positive/negative: PASS, 30 contract modules / 22 controls
storage boundary positive/negative: PASS, 722 modules / 19 fixtures
session-state boundary positive/negative: PASS, 10/10 factories and keys / 36 controls
Host composition positive/negative: PASS, two Host roots / 719 modules / 12 controls

focused product ESLint: PASS, 0 errors / 0 warnings
focused Prettier including harness/spec: PASS
diff check with cr-at-eol: PASS
strict Rasen validation: PASS, 1/1 valid, zero issues
```

The full browser report returned `beforeDatabases=[]` and `afterDatabases=[]`
and nonempty exact cleanup proofs for migration, migration-round2, cascade, and
cascade-round2 disposable identities. OPFS cleanup is covered by the same probe
`finally` paths. Ports 4175, 43551, and 43552 have zero listeners. Playwright's
generated `.last-run.json` was removed. No user-profile storage identity was
opened.

## Review-cycle state

This implementing author does not close B1 or call the review cycle clean.
Strategy attempt 3 consumed the final default strategy budget and is ready for
a different reviewer/verifier to reproduce the two-library counterexample,
inspect the strict codecs and transaction/CAS boundaries, and rerun the complete
gates. B1 remains open until that independent confirmation.

