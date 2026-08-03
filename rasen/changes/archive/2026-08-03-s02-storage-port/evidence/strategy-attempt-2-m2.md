# C5 review-cycle strategy attempt 2 - M2 implementation evidence

Date: 2026-08-02  
Branch/worktree: `feat/s02-storage-port` / `rocut-wt-c5`  
Base: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Scope: preferred attempt-2 M2-A only  
Disposition: **implementation green; independent confirmation required**

## Result

Media ownership is now durable revision-2 compatibility state scoped to an
exact physical media binding:

- an immutable descriptor stores the exact versioned tuple
  `{mediaDatabasePrefix, mediaStore, mediaDirectoryPrefix}`;
- its key and envelope carry a SHA-256 fingerprint, and every decode recomputes
  the digest from the stored tuple;
- owners and complete-coverage certificates are keyed by that fingerprint;
- certified historical descriptors, owners, and certificates are retained
  after project/all clear;
- revision-1 owners remain physically unbound unless the caller supplies the
  trusted internal `previousMediaBinding` configuration-migration input;
- that explicit upgrade writes the previous descriptor, scoped owners,
  certificate, enumerated owner backfill, and legacy-binding marker in one
  ownership-store transaction.

There is no implicit rev1 rebind. Initialization with enumeration available or
unsupported leaves an unbound rev1 certificate unchanged and projects/all
clear fails precommit with the typed mechanism-neutral `unavailable` result.

The shared mutation queue is now selected by the projects control plane
`{projectsDatabase, projectsStore}`. Full durable identity still scopes
initialization and migration memoization, but attachment registration,
certification, project clear, and all clear from different media bindings are
serialized through one queue.

Clear planning preserves exact owner-to-binding relationships. A scoped owner
produces one target pair under its descriptor; current project and completed
tombstone IDs add only the current binding as a defensive target. There is no
global logical-ID by binding cross-product. Enumeration assigns an orphan only
when exactly one known binding parses the physical name; overlapping matches
are a corrupt precommit refusal.

Projects/all clear now commits a strict revision-2 journal containing
`{fingerprint, projectId, database, directory}` targets. A journal can describe
a historical binding after reload, but it cannot authorize itself: every retry
re-reads strict ownership state, requires the descriptor and its exact
certificate, and re-derives both names from the stored tuple. Revision-1
journals retain their prior current-prefix-only validation and are never
reinterpreted as revision 2. Pending v2 targets block same-ID save by explicit
`projectId`, including when the target is historical.

## RED then GREEN

The existing cascade-round2 Chromium probe was extended before the M2 product
change. Chrome 151 preserved all existing axes but reported the six new groups
false:

```text
uncertifiedBindingMismatchRefusesAtomically: false
certifiedBindingHistoryCleansExactNamespaces: false
revision1NeverImplicitlyRebinds: false
bindingScopedOwnersAvoidCrossProduct: false
crossBindingRegistrationClearRaceIsSerialized: false
version2JournalRetriesAcrossBindingReload: false
```

After implementation, the same six fields are true and every earlier
cascade-round2 field remains true.

### Required M2 transitions

1. An old binding is certified, a same-control-plane wrapper first introduces
   changed media prefixes while enumeration is masked, and both projects/all
   clear reject atomically. Project, old metadata/body, and library remain
   readable.
2. Old and new bindings are certified and own the same logical ID. With
   enumeration masked, both projects and all scope remove both namespaces;
   same-ID recreation under either wrapper cannot resurrect metadata/body, and
   library behavior follows the requested scope.
3. Exact attempt-1 rev1 owner/coverage rows are exercised with enumeration both
   available and unsupported. Neither run emits current-binding v2 coverage;
   clear refuses without changing project/media/library. A separate positive
   path supplies `previousMediaBinding` and proves the atomic legacy marker can
   authorize exact old-binding cleanup.
4. Old owns A and new owns B while direct sentinels occupy old/B and new/A.
   Projects clear deletes old/A and new/B only; both cross-product sentinels
   survive in IndexedDB and OPFS.
5. Old-binding registration pauses immediately after its descriptor/owner
   transaction and before physical media open. New-binding clear cannot settle
   until release, then includes and cleans the old exact target.
6. A postcommit cleanup fault leaves a v2 journal. Reload with the other binding
   current repeatedly fails cleanup and blocks same-ID save; a later reload
   reauthorizes from historical descriptor/certificate state, finishes both
   namespaces, and permits clean reuse.

The forged-maintenance probe also seeds a syntactically valid v2 journal with a
made-up fingerprint. It is diagnosed as corrupt and cannot delete the real
target because no durable descriptor/certificate authorizes it.

## Write set and exclusions

- `browser-project-store-internals.ts`
- `browser-project-store-control.ts`
- `browser-project-store-media-ownership.ts`
- `browser-project-store-cascade.ts`
- `browser-project-store-cascade-manager.ts`
- `browser-project-store.ts`
- `browser-project-store-cascade-round2-probes.ts`
- `c5-storage-harness.ts`
- `browser-store.pw.ts`

No public `ProjectStore` port, Host, consumer, protected session, task list,
review artifact, library schema, Rust source, or generated asset was edited.
Attempt-2 M1 strict tombstone staging and both strategy-1 matrices were retained.
No commit was created.

## Verification

```text
full Chromium config: PASS 3/3 on Chrome 151.0.7922.34
  browser store: 19/19
  migration lifecycle races: 16/16
  strategy-1 M1: 6/6
  attempt-2 M1: 2/2
  cascade round 1: 9/9
  cascade round 2: prior 11/11 plus attempt-2 M2 6/6
  corrupt rows: 6/6
  active read abort: 7/7
  C4 forced-none: PASS
  migration round 1: PASS

C4 public-store-first clean repeat: PASS 5/5
focused port/storage/negative Bun suite: PASS 48/48, 216 expectations
Vite TypeScript: PASS, zero diagnostics
exact-three TypeScript baseline: PASS, no diagnostic outside the pin

port boundary positive/negative: PASS, 30 modules / five rules
storage boundary positive/negative: PASS, 721 modules / 19 fixtures
session-state boundary positive/negative: PASS, 10/10 factories and keys
Host composition positive/negative: PASS, two Host roots / 718 modules

focused ESLint: PASS, 0 errors / 0 warnings
focused Prettier: PASS
diff check with cr-at-eol: PASS
strict Rasen validation: PASS, 1/1 valid, zero issues
```

All disposable browser identities and OPFS directories reported cleanup proof.
Port 4175 has no listener and Playwright `.last-run.json` was removed. No user
profile identity was opened.

## Remaining review-cycle state

Attempt-2 M2-A is ready for independent review together with the already-green
attempt-2 M1-A. This implementing author does not close either Major or call the
review cycle clean. The next role must inspect the exact delta, rerun both
counterexample families, and independently confirm rev1 non-rebinding and
owner-to-binding exactness.
