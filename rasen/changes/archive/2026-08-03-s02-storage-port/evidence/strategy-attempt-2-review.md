# C5 review-cycle strategy attempt 2 - independent implementation review

Date: 2026-08-02  
Branch/worktree: `feat/s02-storage-port` / `rocut-wt-c5`  
Explicit base and current HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Mode: dispatched report-only; no subagents, product edits, task edits, prior-evidence edits, or commit  
Verdict: **STRATEGY ATTEMPT 2 NOT CONFIRMED - ATTEMPT 3 REQUIRED**  
Tally: **Blocker 1 / Major 0 / Minor 0 / Test-gap 1**

## Executive result

The two strategy-attempt-1 Majors are fixed on their exact acceptance axes.
Real Chromium confirms that a valid attachment tombstone after a pre-intent
migration failure is skipped as logical absence, while a malformed tombstone
remains loud. It also confirms changed-binding masked refusal, certified
old/new cleanup, rev1 non-rebinding, binding-scoped targets, cross-binding queue
serialization, and v2 media-journal retry under another current media binding.

The strategy is not clean because the revision-2 all-clear journal versions
media targets but leaves the library target as an unbound boolean. After an
all-clear logical commit and interrupted media cleanup, reopening the shared
projects control plane with a different library database/store clears the new
configuration's unrelated library and leaves the originally committed library
intact. This is demonstrated in Chromium and is a data-loss/cross-delete path,
so attempt 3 is required.

## Exact attempt-2 acceptance

| Axis | Independent result | Evidence |
| --- | --- | --- |
| M1 pre-intent failure -> valid tombstone -> retry | **PASS** | `preRecoveryIntentLaterRemoveMigrates: true`; migration published the current schema, attachment stayed absent, and stage residue was removed. |
| M1 malformed tombstone | **PASS** | `malformedPreRecoveryTombstoneRejects: true`; repeated retries rejected without publishing or resurrecting content. |
| M2 uncertified changed-binding masked refusal | **PASS** | `uncertifiedBindingMismatchRefusesAtomically: true`; projects/all refusal remained precommit. |
| M2 certified same-ID old/new cleanup | **PASS** | `certifiedBindingHistoryCleansExactNamespaces: true`; both media bindings cleaned without same-ID resurrection. |
| M2 rev1 available/unsupported no rebind | **PASS** | `revision1NeverImplicitlyRebinds: true`; both capability states refused, while the explicit previous-binding path succeeded. |
| M2 binding-scoped targets | **PASS** | `bindingScopedOwnersAvoidCrossProduct: true`; old/B and new/A sentinels survived while old/A and new/B were removed. |
| M2 cross-binding registration/clear race | **PASS** | `crossBindingRegistrationClearRaceIsSerialized: true`; projects-control-plane arbitration ordered registration before clear. |
| M2 v2 media journal other-binding reload | **PASS for media targets** | `version2JournalRetriesAcrossBindingReload: true`; historical certified media targets reauthorized and same-ID save remained blocked until cleanup. |

The strategy-1 M1 matrix remained 6/6 and its M2 matrix remained 5/5. The
attempt-2 result above closes the two prior Majors as stated; the Blocker below
is a new compatibility-state omission in the attempt-2 journal.

## Blocker

### B1 - A pending v2 all-clear journal can delete the wrong library after a configuration reload

**Canonical severity:** Blocker.  
**Axes:** durable clear authorization, configuration binding, postcommit retry,
cross-delete/data loss.

`CascadeEnvelopeV2` records exact certified media targets but represents the
library side effect only as `clearLibrary: boolean`
(`browser-project-store-cascade.ts:24-30`, constructor at `:59-72`). On retry,
the cascade manager does not recover an exact journaled library target. It
executes the boolean against the reopening wrapper's current
`this.identity.libraryDatabase` and `libraryStore`
(`browser-project-store-cascade-manager.ts:287-297`). The journal is stored in
the shared projects maintenance store, so another wrapper with the same
`projectsDatabase`/`projectsStore` legitimately sees it even when its library
binding differs.

Independent real-Chromium counterexample:

1. Create old and new wrappers sharing the projects control plane but using
   distinct media and library bindings; seed one library row under each.
2. Through the old wrapper, run `clear(all)` and inject a cleanup failure after
   the first media target. The logical clear commits and the v2 journal remains;
   both library rows are still present before reload.
3. Reset runtime and reopen through the new wrapper. Initialization retries the
   shared journal.

Observed result:

```text
before reload: old library = { marker: "old" }, new library = { marker: "new" }
after new-binding reload: old library = { marker: "old" }, new library = null
```

The clear committed under the old configuration, yet its old library survived
and unrelated data in the new configuration was destroyed. The retry then
deletes the journal, so reopening the old configuration cannot finish the
originally committed library clear. Media target authorization is exact; the
library authorization is configuration-relative and therefore unsafe.

**Attempt-3 requirement:** journal an exact, versioned library binding/target
for all-clear and validate it on every retry, or fail closed before touching a
library when the reopening wrapper does not match. A retry under another media
or library configuration must clear only the library selected at logical
commit, never the reopening wrapper's unrelated library. Add a Chromium
regression with two library sentinels, an interrupted all-clear, runtime reset,
and cross-configuration reload proving original-target completion and
non-target survival.

## Test gap

1. The v2 reload probe changes only media prefixes and uses `scope: projects`.
   No automated browser test interrupts `scope: all`, changes
   `libraryDatabase`/`libraryStore`, and verifies exact historical library
   authorization. That missing axis allowed B1.

## Complete-diff special checks

- **Certificate upgrade/fingerprint/descriptor codec:** PASS. SHA-256 input is
  the unambiguous JSON encoding of the versioned exact media tuple; descriptor
  decode requires exact keys, validates every field, recomputes the digest,
  and requires the digest-derived row key. Owner/certificate rows cannot become
  usable without the matching descriptor.
- **Rev1 handling:** PASS. Available and unsupported enumeration do not convert
  unbound rev1 coverage to current-binding completeness. Only the explicit
  `previousMediaBinding` path replaces the legacy coverage row, and its
  descriptor/scoped owners/certificate/marker are one object-store transaction.
- **`previousMediaBinding` trust boundary:** no finding. It is an internal
  constructor option, not part of `ProjectStore`; callers capable of constructing
  this adapter already choose the complete physical storage identity. Production
  Hosts do not supply it.
- **Queue key:** PASS. Arbitration is keyed by the actual shared projects
  database/store control plane, while distinct projects databases or stores
  retain separate queues. Conflicts remain scoped by logical mutation identity.
- **Owner exactness:** PASS. v2 owners map one fingerprint/project pair to one
  descriptor; current logical IDs add only the current binding. No global
  owner-by-binding cross-product was found.
- **V2 media journal authorization:** PASS for media. Retry rereads binding
  history, requires a certificate, and re-derives database/directory names.
  The uncovered library half is B1.
- **Migration/cascade/attachment-v2 interaction:** PASS on requested axes. Full
  record staging distinguishes strict tombstones from corruption, validates v2
  body length/digest, and preserves the six recovery-precedence cases.
- **ESLint:** PASS for the ten configured attempt-2 web source/probe files: 0
  errors / 0 warnings. An intentionally broader invocation named two Vite files
  outside the ESLint configuration and emitted only two `ignored file`
  warnings; there were no code diagnostics.

## Verification evidence

- Complete real-Chromium C5 configuration: **3 passed / 0 failed**, Chromium
  `151.0.7922.34`; browser store 19/19, migration lifecycle 16/16, strategy-1
  M1 6/6, attempt-2 M1 2/2, cascade round 1 9/9, cascade round 2 prior 11/11
  plus attempt-2 M2 6/6, corrupt rows 6/6, active abort 7/7.
- Independent library-binding counterexample: **reproduced 1/1**. Its randomized
  disposable identity was cleaned.
- Focused unit/negative suite: **48 passed / 0 failed / 216 expectations**.
- Vite TypeScript: PASS, zero diagnostics. Pinned repository baseline: PASS,
  three inherited diagnostics and none outside the pin.
- Port boundary: PASS, 30 modules / five rules. Session-state boundary: PASS,
  10/10 factories and registry keys. Storage boundary: PASS, 721 modules. Host
  composition: PASS, two roots / 718 production modules.
- Focused Prettier and `git -c core.whitespace=cr-at-eol diff --check`: PASS.
- The `rasen` executable was not available in this reviewer's shell, so strict
  Rasen validation was not independently rerun; both implementation evidence
  reports record it green. This tooling limitation does not cause or weaken B1.

## Hygiene

- Vite/Chromium processes started by this reviewer were stopped; port 4175 is
  free.
- The generated Playwright `.last-run.json` was removed after the run.
- Product, tasks, and prior evidence/handoffs edited by reviewer: **0**.
- New files written by reviewer: this report and
  `handoff/strategy-attempt-2-reviewer.md` only.
- Commit created: **no**.

