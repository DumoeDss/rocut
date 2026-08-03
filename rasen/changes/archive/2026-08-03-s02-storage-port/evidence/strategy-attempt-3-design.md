# C5 review-cycle strategy attempt 3 - domain-complete exact-target journal

Date: 2026-08-02  
Change: `s02-storage-port`  
Mode: report-only planner; no subagents, product edits, task edits, prior-evidence edits, or commit  
Inputs: strategy-attempt-2 design, implementation/verification evidence, independent review, and the current combined product worktree  
Open finding: strategy-attempt-2 B1  
Disposition: **design selected; Blocker remains open and is escalated to implementation plus independent non-author confirmation**

## H.5/H.6 strategy accounting

This is strategy attempt **3/3**, the final default strategy budget. Its material
variable is the durable authorization boundary: attempt 2 versioned only media
targets, while attempt 3 makes the clear journal domain-complete and binds the
library side effect to an exact historical target at logical commit. It is not a
repeat of the media-only fingerprint work.

The explicit no-subagent constraint overrides the review-cycle parallel path.
This document is planner evidence, not independent verification. Because the
strategy budget is exhausted, B1 may not be silently carried or called clean:
it remains an open Blocker and is explicitly handed to an implementer, followed
by a different non-author reviewer/verifier.

## Confirmed current-code cause

- `CascadeEnvelopeV2` stores certified exact media targets but only
  `clearLibrary: boolean` for the library domain.
- `commitProjectsClear` writes that boolean in the same projects/cascade
  transaction as the logical project clear.
- `cleanup` validates the v2 media plan, but resolves a true library boolean to
  `this.identity.libraryDatabase` and `this.identity.libraryStore` at retry
  time.
- The queue and maintenance journal are intentionally shared by wrappers with
  the same `{projectsDatabase, projectsStore}`. Therefore a wrapper with a
  different library binding legitimately sees the old journal and currently
  clears its own unrelated library.
- The media descriptor/certificate history is retained outside the maintenance
  rows and the v2 media journal cannot self-authorize. That pattern is sound and
  must not regress.
- `idbCommitProjectsClear` currently transacts only the project and cascade
  stores. A library authorization record written before or after that
  transaction could be missing while the logical clear is committed, so the
  transaction boundary must expand for `scope: all`.

The required invariant is:

> After an all-clear logical commit, every later retry derives every destructive
> target exclusively from exact, versioned state committed for that clear under
> the shared projects control plane. The reopening wrapper's current media or
> library configuration is never a substitute for missing historical state.

## Candidate designs

### Candidate A - dedicated library-clear authorization store plus v3 journal (selected)

Add a small internal library-clear binding module and a dedicated object store
inside `projectsDatabase`. At all-clear logical commit, write an immutable exact
library-binding descriptor into that store and a v3 journal containing the
matching exact target. The project clear, cascade replacement, and descriptor
put are one three-store IndexedDB transaction. Every cleanup preflights both
media and library authorization before the first physical delete.

This keeps media ownership semantics intact, makes cross-configuration retry
convergent, and gives library binding rows a narrow codec and lifecycle.

### Candidate B - domain-tagged library rows in the media-ownership store

Keep the same v3 journal and exact target, but add `library-binding` rows to
`<projectsStore>-media-ownership`; expand the clear transaction across the
existing ownership store rather than adding a store. The row is domain-tagged,
fingerprinted, and validated separately from media coverage. This also meets
the atomicity and cross-configuration requirements.

This is implementable but not selected. `readMediaOwnership` currently treats
every unknown row as corruption and its descriptor/certificate state machine is
specifically about per-project media enumeration. Teaching it about unrelated
library-clear capabilities broadens the attempt-2 media blast radius and makes
the module name and invariants misleading. Saving one object store is not worth
changing the already-confirmed media design.

### Rejected non-option - journal-only target or current-wrapper match

An exact tuple plus a digest stored only in the journal is self-authorizing; a
forged tuple could name an arbitrary IndexedDB store. Requiring the reopening
wrapper to match the tuple is fail-safe but does not converge under the required
different-wrapper retry. Neither closes B1.

## Selected internal records

### Versioned library clear binding

Introduce an internal binding whose authority is scoped to the projects control
plane as well as the physical library target:

```text
BrowserLibraryClearBindingV1
  revision: 1
  projectsDatabase: string
  projectsStore: string
  libraryDatabase: string
  libraryStore: string
```

The fingerprint is lowercase SHA-256 of UTF-8 canonical JSON:

```text
["opencut-library-clear-binding", 1,
 projectsDatabase, projectsStore, libraryDatabase, libraryStore]
```

The domain tag prevents a media digest or another future binding type from
being reinterpreted as a library capability. Including the projects control
plane prevents a descriptor copied from another project store from being
accepted merely because it names the same library database/store.

### Dedicated authorization row

Store name:

```text
<projectsStore>-library-clear-bindings
```

Row:

```text
id: .c5-library-clear-binding:<fingerprint>
__opencutLibraryClearBinding: {
  revision: 1,
  kind: "clear-authorization",
  fingerprint,
  binding: BrowserLibraryClearBindingV1
}
```

The descriptor is both a binding description and the durable authorization to
execute that exact target for a journal committed in this control plane. It is
small and retained; attempt 3 should not add garbage collection. Deleting a
descriptor while any journal might reference it would turn a recoverable
postcommit failure into an unrecoverable one.

### Domain-complete cascade envelope

New clears write revision 3; they never write `clearLibrary`:

```text
CascadeEnvelopeV3 {
  revision: 3,
  kind: "clear-journal",
  operation: "clear",
  scope: { kind: "store" },
  clearScope: "projects" | "all",
  targets: {
    media: MediaClearTarget[],
    library: LibraryClearTargetV1[]
  }
}

LibraryClearTargetV1 {
  revision: 1,
  kind: "library",
  fingerprint: string,
  database: string,
  store: string
}
```

Cardinality is part of the codec, not a caller convention:

- `clearScope: projects` requires `targets.library.length === 0`.
- `clearScope: all` requires `targets.library.length === 1`.
- More than one library target, a target on projects scope, or an all scope
  without exactly one target is corrupt.
- A projects clear with no media targets needs no journal. An all clear always
  has its one library target and therefore always has a journal.

The nested domain keys make an omitted domain visible and prevent a future
boolean side effect from escaping target authorization again.

## Strict codec, fingerprint, and authorization rules

All rules apply before any media database deletion, OPFS removal, or library
store clear:

1. Require exact outer, envelope, `targets`, target, descriptor-envelope, and
   binding keys. Reject missing and additional keys.
2. Require the fixed revisions/kinds, exact store scope, legal `clearScope`,
   nonempty strings, no `undefined` names, and no duplicate media or library
   target identity.
3. Recompute the descriptor fingerprint from the canonical tuple and require it
   to match both the descriptor field and digest-derived row key.
4. Require descriptor `projectsDatabase/projectsStore` to equal the control
   plane containing the journal. This comparison deliberately does **not**
   compare the current wrapper's library fields.
5. Require journal target fingerprint/database/store to equal the independently
   decoded descriptor exactly.
6. Continue to validate every media target through the attempt-2 durable media
   descriptor and coverage certificate and re-derive its names.
7. Complete this entire preflight before starting either domain's physical I/O.
   A valid media half must not make an invalid library half partially executable.
8. A malformed maintenance row must be reported as retained corrupt state; it
   must not be silently skipped, deleted, or interpreted through current config.

SHA-256 is an integrity/coupling mechanism, not a secret signature. The safety
boundary assumes product code controls the internal stores. A same-origin actor
that can coherently forge both authorization and journal rows is outside this
adapter's threat model; independent journal or descriptor tampering fails
closed.

## State machine

```text
READY
  | clear(projects): media plan, no library target
  | clear(all): build exact library descriptor + target
  v
PREPARED_AND_PREFLIGHTED
  | abort/failure before IDB transaction -> READY, projects unchanged
  | one atomic logical-commit transaction
  v
V3_PENDING_EXACT_CLEANUP
  | validate media history + library authorization for every retry
  | validation failure -> BLOCKED_RETAINED (no physical I/O)
  | exact idempotent media deletes and exact library store clear
  | cleanup failure/crash -> V3_PENDING_EXACT_CLEANUP
  | journal delete commits
  v
COMPLETE

LEGACY_V2 clearLibrary:false
  -> validate/execute its exact media targets; never touch library

LEGACY_V2 clearLibrary:true
  -> no trusted previousLibraryBinding: BLOCKED_RETAINED
  -> explicit trusted previousLibraryBinding:
       atomic descriptor + same-id v3 journal replacement
       -> V3_PENDING_EXACT_CLEANUP
```

Revision-1 clear journals with `clearLibrary:true` have the same ambiguity and
must also fail closed before library I/O. Their existing current-prefix media
compatibility may remain only when `clearLibrary:false`; they are never promoted
to current-library authorization.

## Legacy v2 boolean compatibility policy

A v2 `clearLibrary:true` record cannot reveal the library selected at its
logical commit. The current wrapper is evidence of the present configuration,
not evidence of that historical choice. Therefore:

- Default behavior is fail closed before all physical cleanup, retain the
  journal, and emit a fixed `project-cascade-library-binding-required`
  diagnostic with `code: unavailable` and `retryable: false`. Repeating the same
  retry cannot synthesize missing history.
- Add an optional internal `previousLibraryBinding` constructor input, analogous
  to `previousMediaBinding`, only if compatibility with unlanded/developer v2
  state is required. It must be explicitly supplied trusted configuration
  migration data; production Hosts do not infer or populate it.
- With that input, strictly validate the v2 media journal first, construct the
  exact library binding/target, then atomically put the descriptor and replace
  the same journal ID with v3 in a transaction over the cascade and binding
  stores. Only after this transaction commits may normal v3 cleanup run.
- A conflicting existing descriptor aborts the upgrade. No overwrite is used to
  bless malformed state.
- `clearLibrary:false` remains compatible as a projects-only v2 cleanup: finish
  its certified media targets and perform zero library I/O.

This gives a bounded recovery path without ever treating v2's boolean as an
instruction to clear the current wrapper.

## Commit points

1. **Preparation:** compute and validate media plan, library descriptor,
   fingerprint, and v3 record. No durable logical state changes.
2. **Logical clear commit:** for `all`, one transaction spans project store,
   cascade maintenance store, and library-clear-binding store. It clears project
   rows, replaces maintenance rows with tombstones plus the v3 journal, and puts
   the exact descriptor. Transaction completion is the only logical commit.
   For `projects`, retain the existing two-store transaction and encode zero
   library targets.
3. **Postcommit authorization:** reread and validate both durable authorization
   domains. The in-memory prepared object is not sufficient proof.
4. **Physical cleanup:** delete only journaled media names and call `idbClear`
   with `target.database/target.store`; never use
   `this.identity.libraryDatabase/libraryStore` for a v3 journal.
5. **Cleanup completion:** delete the cascade journal only after all exact
   targets succeed. Descriptor rows remain as bounded historical authority.
6. **Legacy upgrade commit:** a separate atomic cascade+descriptor transaction
   is the point at which an explicitly supplied v2 library binding becomes v3
   authority. It cannot be interleaved with physical cleanup.

The order of puts inside an IndexedDB transaction is not the safety property;
transaction completion is. Store creation/version upgrade must finish before
the transaction starts, and a blocked/failed upgrade leaves projects unchanged.

## Failure matrix

| Failure/event | Durable result | Required behavior |
| --- | --- | --- |
| Descriptor/fingerprint construction or preflight fails | old projects and maintenance unchanged | Reject precommit; no media/library I/O. |
| Abort before logical transaction | old projects and maintenance unchanged | Return aborted; no descriptor/journal residue. |
| Object-store version upgrade blocked or three-store transaction aborts | all three logical writes roll back | Projects remain; no partial authorization. |
| Crash immediately after logical commit | projects absent; tombstones, v3 journal, descriptor durable | Any wrapper sharing the projects control plane can resume exact cleanup. |
| Failure after media target N and before library | partial idempotent media cleanup; exact journal retained | Different-config retry revalidates all domains, redoes/finishes media, clears only original library. |
| Library `idbClear` fails | exact original library may be unchanged/transaction-aborted; journal retained | Retry same exact target; unrelated current library untouched. |
| Crash after library clear but before journal delete | original library empty; journal retained | Idempotently re-clear original target, then delete journal; never clear reopening wrapper's target. |
| Journal delete fails | all physical targets complete; journal retained | Same exact idempotent retry converges. |
| Wrapper media and library bindings both change | v3 descriptor/history remain under shared projects control plane | Current physical fields are ignored; original targets complete and new targets survive. |
| `clear(projects)` journal is retried by an all-config wrapper | library target array is exactly empty | Perform zero library reads/writes/clears. |
| Journal target is changed without matching descriptor | target/descriptor mismatch | `corrupt`, retained, no physical I/O. |
| Descriptor row/key/fingerprint/binding is altered or removed | authorization cannot validate | `corrupt` (or unavailable for a missing required row), retained, no physical I/O and no cross-delete. |
| Extra library target or projects/all cardinality mismatch | strict v3 decode fails | Retain/report corrupt; no physical I/O. |
| Legacy v2 `clearLibrary:true`, no trusted prior binding | ambiguous historical target | Retain/report binding-required; do not clear current or original library. |
| Legacy v2 `clearLibrary:true`, trusted prior binding supplied | descriptor plus v3 replacement commit atomically | Then clear only supplied historical target and converge normally. |
| Legacy v2 `clearLibrary:false` | exact v2 media targets | Preserve compatibility; no library I/O. |
| New wrapper writes unrelated new library after an old-target cleanup failure | old exact journal remains | Later retry still names only old database/store; new binding survives. |

Exact tuple reuse is the same physical binding, not a distinguishable new
generation. If the product later permits new writes into the identical tuple
while its clear journal remains pending, generation fencing is a separate
requirement. B1's cross-configuration case uses distinct exact bindings.

## Minimum implementation write set

No public `ProjectStore` port or Host/session contract changes are required.

1. `browser-project-store-internals.ts`: add internal library-clear binding type,
   validation, canonical fingerprint, and current-identity constructor (or keep
   these entirely in the new deep module).
2. New `browser-project-store-library-clear-bindings.ts`: store name, row/target
   codecs, descriptor creation, durable validation, and optional v2 upgrade
   preparation. This module owns all library clear authorization details.
3. `browser-project-store-cascade.ts`: add strict v3 envelope/target codec and
   constructor; retain v1/v2 decoders only under the compatibility rules.
4. `browser-project-store-cascade-manager.ts`: pass logical clear scope, preflight
   both domains, execute exact library target, reject ambiguous legacy booleans,
   and retain/report malformed pending rows.
5. `browser-storage-mechanisms.ts`: add a specialized atomic clear helper whose
   all-scope transaction spans project, maintenance, and descriptor stores, plus
   the two-store CAS-style legacy journal upgrade helper.
6. `browser-project-store.ts`: pass `projects` versus `all`; optionally validate
   and pass trusted `previousLibraryBinding`. Do not expose it through the port.
7. `browser-project-store-cascade-round2-probes.ts`, Vite C5 harness, and
   Playwright expectation: add the browser acceptance axes below.
8. Focused negative tests: pin exact codecs, cardinality, fingerprint/key binding,
   descriptor/target mismatch, and v1/v2 fail-closed handling.

Do not modify the attempt-2 media target derivation, coverage certificate
meaning, binding-scoped owners, projects-control-plane queue key, or same-ID
pending-save barrier except where v3 field access requires a mechanical update.

## Required real-Chromium acceptance

Extend the existing cascade round-2 probe and its Playwright assertion. At
minimum require these booleans:

1. `version3AllJournalRetriesExactLibraryAcrossConfigurationReload`: create old
   and new wrappers sharing projects DB/store but differing in both media and
   library bindings; seed one sentinel in each library; interrupt old
   `clear(all)` after one media target; prove logical project clear committed and
   both sentinels still exist; reset runtime/reopen new; require old sentinel
   absent, new sentinel byte-for-byte unchanged, exact media cleanup complete,
   and journal removed.
2. `projectsJournalNeverTouchesLibraryAcrossConfigurationReload`: interrupt and
   resume `clear(projects)` across the same configuration change; both library
   sentinels survive and any v3 journal contains zero library targets.
3. `tamperedLibraryBindingCannotCrossDelete`: interrupt all-clear, alter one
   descriptor field/key/fingerprint or journal target, reset/reopen new, and
   require both library sentinels plus a not-yet-cleaned media sentinel to
   survive, journal to remain, and a nonretryable corrupt diagnostic.
4. `legacyVersion2LibraryBooleanFailsClosed`: seed a strict v2
   `clearLibrary:true` record, reopen under a different library binding without
   trusted previous state, and require both sentinels and the journal to remain.
5. `legacyVersion2LibraryBindingUpgradeConverges` if the optional compatibility
   path is implemented: reopen with the explicit old binding, require atomic v3
   promotion, old sentinel removal, new sentinel survival, and journal removal.
6. `postLibraryPreJournalCrashRetriesExactTarget`: fail after the exact library
   clear but before journal deletion, change configuration, and prove retry is
   idempotent and cannot touch the new library.

Also preserve the complete existing Chromium result, especially attempt-2 M1
2/2, M2 6/6, strategy-1 matrices, forged-maintenance protection, recoverable
all-clear, corrupt rows, and active abort. The focused unit/negative suite,
TypeScript, ESLint, port/storage/session/Host boundaries, formatter, and diff
checks must remain green.

## Exit gate

B1 is **not closed by this design**. It closes only when:

1. the selected design is implemented in the product worktree;
2. the exact cross-library Chromium counterexample is green along with the
   legacy/tamper/projects-scope axes;
3. all prior attempt-2 acceptance remains green; and
4. a non-author reviewer/verifier confirms the implementation and evidence.

Until then the review-cycle status is **Blocker open; attempt budget exhausted;
implementation and independent confirmation required**.
