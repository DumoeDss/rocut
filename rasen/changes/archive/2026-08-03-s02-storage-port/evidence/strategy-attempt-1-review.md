# C5 review-cycle strategy attempt 1 - independent implementation review

Date: 2026-08-02  
Branch/worktree: `feat/s02-storage-port` / `rocut-wt-c5`  
Explicit base and current HEAD: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Mode: dispatched report-only; no subagents, product edits, task edits, prior-evidence edits, or commit  
Verdict: **STRATEGY ATTEMPT 1 NOT CONFIRMED - ATTEMPT 2 REQUIRED**  
Tally: **Blocker 0 / Major 2 / Minor 1 / Test-gap 2**

## Executive result

The implementation closes both exact round-3 counterexamples. In real Chromium,
later attachment save/remove wins in both original-project and staged-project
recovery phases; unexplained absence and digest mismatch remain loud and durable;
certified masked projects/all clear removes project-owned and owner-only media;
uncertified masked clear rejects atomically; and owner-registration versus clear
is serialized. The complete existing browser matrix is green.

The strategy nevertheless cannot be confirmed clean. The full implementation
introduces two uncovered durable-state failures:

1. a valid delete tombstone created after a migration failure that occurred
   before the recovery journal makes every later migration retry fail during
   staging;
2. the complete-coverage certificate is not bound to the media physical naming
   configuration, so a prefix/configuration change can reuse a stale certificate
   and report successful masked clear while old media remains and later
   resurfaces.

The new M1 files also contain six configured ESLint errors and one unused-type
warning. These are mechanical standards failures, not the cause of either
durable-state defect.

## Round-3 Major disposition and acceptance 1-7

| Acceptance | Independent result | Evidence |
| --- | --- | --- |
| 1. Staged-project failure, then same-key save | **PASS** | `stagedProjectLaterSaveWins: true`; newer private metadata and bytes survived, initialization succeeded, stage evidence disappeared. |
| 2. Staged-project failure, then same-key remove | **PASS** | `stagedProjectLaterRemoveWins: true`; reopen succeeded, attachment stayed logically absent, no resurrection. |
| 3. Original-project failure after an attachment put, then save/remove | **PASS** | `originalProjectLaterSaveWins: true` and `originalProjectLaterRemoveWins: true`; project put remained last and later attachment winners survived. |
| 4. Physical absence and digest mismatch | **PASS** | Both axes returned true after two independent wrapper retries; initialization rejected and migration stage databases remained. |
| 5. Certified masked projects/all clear | **PASS for an unchanged physical identity** | Both project and all scopes deleted project-owned and legal owner-only targets; same-ID saves exposed no old metadata/body, and library retention/removal matched scope. |
| 6. Uncertified masked projects/all clear | **PASS** | Both scopes rejected typed `unavailable` before project/library commit; project, attachment, and library remained readable. |
| 7. Registration/clear race and complete tail | **PASS** | The paused never-created-owner read kept clear pending, then clear deleted the created target. Full Chromium matrix was 3/3; C4 first-store/upgrade stress was 10/10. |

The round-3 M1 and M2 are therefore **closed as originally stated**. The Majors
below are new counterexamples in the strategy implementation and must not be
confused with a failure of acceptance 1-7.

## Majors

### M1 - A post-failure delete tombstone makes pre-journal migration retry permanently fail

**Canonical severity:** Major.  
**Axes:** migration failure/retry, attachment-v2 tombstones, durable deletion,
session availability.

`removeAttachment` now commits a revision-2 delete tombstone instead of deleting
the metadata row (`browser-project-store.ts:653-717`; constructor at
`browser-project-store-records.ts:302-317`). Public reads correctly hide it
(`browser-project-store.ts:501` and `:593`).

Migration staging, however, still calls the attachment-only decoder
(`browser-project-store-migration.ts:420-441`). That decoder deliberately maps
every valid tombstone to `null` (`browser-project-store-records.ts:327-332`), so
staging throws `Legacy attachment metadata is invalid` rather than treating the
tombstone as logical absence. The M1 acceptance probe begins only at
`beforeProjectCommit` or `beforeCommittedReadback`
(`browser-project-store-migration-round2-probes.ts:171-193`); it does not cover a
failure before recovery intent plus a later delete.

Independent Chromium counterexample, using one disposable schema-30 project and
legacy attachment:

```text
first migration, failed before recovery journal: failed (phase staging)
later public removeAttachment: resolved
stored row after remove: valid tombstone
runtime reset/new wrapper, migration retry 1: failed (phase staging)
runtime reset/new wrapper, migration retry 2: failed (phase staging)
persisted schema after retries: 30
public attachment state: null
```

Session creation rejects a failed migration, so the project cannot return to a
usable current schema even though the later delete is unambiguous and durable.
This is a plausible rare-fault path in a shared store and is not data loss, hence
Major rather than Blocker.

**Attempt-2 requirement:** stage with `decodeStoredAttachmentRecord`; skip a
strictly valid tombstone as logical absence, while malformed rows still fail
loudly. Add a real-Chromium regression that fails before recovery intent,
commits a later remove, resets runtime, migrates successfully, and proves the
attachment remains absent. Preserve the existing six M1 acceptance axes.

### M2 - Coverage certificate is reusable across a different physical media namespace

**Canonical severity:** Major.  
**Axes:** certificate validity, physical ownership, masked clear, configuration
upgrade/rebinding, same-ID resurrection.

The owner store is identified only by projects database/store
(`browser-project-store-media-ownership.ts:44-46`). Its coverage record contains
only revision/kind/`coverage: complete` (`:240-248`), and the decoder accepts it
without binding it to `mediaDatabasePrefix`, `mediaStore`, or
`mediaDirectoryPrefix` (`:251-284`). Once decoded, `state.complete` is
authoritative when enumeration is unavailable (`:100-121`). Clear then derives
targets from whichever current identity object the new wrapper supplied
(`:133-153`; `browser-project-store-cascade-manager.ts:225-238`).

The runtime queue does distinguish the full configured physical tuple
(`browser-project-store-internals.ts:111-121`), but the durable certificate does
not. Thus the projects control plane and certificate can be reused while the
media prefix changes, with no durable proof that the certificate covers the new
or old namespace.

Independent Chromium counterexample changed only the media database/directory
prefixes while retaining the same `identity` field, projects database, projects
store, media store, and owner/certificate rows:

```text
same identity field: true
same projects database/store: true / true
media prefixes differ: true
indexedDB.databases masked, clear(projects): resolved
old media database after clear: still present
save project again through original configuration: resolved
old attachment metadata resurfaced: { sentinel: "old" }
old attachment bytes resurfaced: [4,5,6]
```

This is a successful destructive result with retained data under a plausible
configuration upgrade or mis-bound wrapper, so it remains Major. The existing
certified probes use one unchanged `storageIdentity`
(`browser-project-store-cascade-round2-probes.ts:100-158`) and cannot detect it.

**Attempt-2 requirement:** bind the certificate to the exact physical media
configuration. A binding mismatch must never be treated as complete and must
not be overwritten by a sweep scoped only to the new prefix. Either reject
clear precommit until an explicit namespace migration proves both old and new
targets, or retain enough validated binding history to clean both exact target
sets. Add a masked Chromium regression that changes only the media prefixes,
requires precommit refusal or complete cleanup, and proves same-ID reuse cannot
resurface old metadata/body.

## Minor

### m1 - New M1 files do not pass the configured ESLint rules

A focused configured ESLint run reports six errors and one code warning in new
strategy files:

- unsafe narrowing assertions in `browser-project-store-records.ts:387,400` and
  `browser-project-store-migration.ts:800,875,882`;
- a positional helper rejected by `opencut/prefer-object-params` at
  `browser-project-store-migration-round2-probes.ts:874`;
- unused `AttachmentEnvelopeV1` at
  `browser-project-store-records.ts:22`.

These are mechanical and do not change runtime behavior, but the strategy write
set is not standards-clean. Remove the unused interface and narrow through
validated locals/object parameters without unsafe assertions.

## Test gaps

1. No automated browser regression covers failure before recovery intent,
   followed by a valid attachment delete tombstone and successful migration
   retry after runtime reset.
2. No automated browser regression binds the coverage certificate to the exact
   media configuration or changes only media prefixes before masked clear and
   same-ID reuse.

## Special-check results

- **Upgrade/init ordering:** the projects public store is ensured before cascade,
  owner, and migration maintenance stores. The C4 first-store case passed 10/10
  consecutive Chromium runs. No same-configuration finding.
- **Legal never-created owner and read queue:** list/load registers the owner
  before media dispatch inside the shared project queue; project/all clear
  conflicts with that operation. The paused race passed and exact current targets
  were removed. No finding beyond certificate rebinding M2.
- **Owner/tombstone lifetime:** owner rows intentionally survive clear;
  attachment tombstones remain hidden and are removed by whole-project physical
  cleanup. Postcommit body-orphan cleanup is retryable. No compaction finding;
  pre-journal staging of a valid tombstone is M1.
- **Body digest performance:** a disposable Chromium measurement with a 64 MiB
  attachment observed about 1040 ms save and 151/189 ms repeated loads. Cost is
  linear and worth tracking, but the existing contract already materializes and
  defensively copies complete bodies, the strategy explicitly chose
  correctness-first digests, and no C5 performance threshold was exceeded. No
  B/M/m finding.
- **Provider-private and diagnostics:** v2 mutation IDs/digests, recovery
  fingerprints, owners, and certificates remain internal; public attachment
  values expose only caller metadata/body. Diagnostics and migration outcomes
  contain fixed phases/codes/scopes and no body, opaque metadata, physical target,
  mutation ID, or digest. The custom failures exposed no private data. No
  finding.
- **Control-plane isolation:** migration, cascade, and media ownership remain in
  three separate stores with strict owner-row decoding. No opaque-payload
  collision or private backchannel was introduced.

## Verification evidence

- Complete real-Chromium C5 configuration: **3 passed / 0 failed**, Chromium
  `151.0.7922.34`; browser store 19/19, migration lifecycle 16/16, M1 axes 6/6,
  cascade round 1 9/9, cascade round 2 11/11, corrupt rows 6/6, active abort 7/7.
- C4 public-store-first/upgrade stress: **10 passed / 0 failed**.
- Independent Chromium counterexamples: **2/2 reproduced**, plus the 64 MiB
  digest observation. Every randomized disposable identity was cleaned.
- Focused unit/negative suite: **48 passed / 0 failed / 216 expectations**.
- Full `bun test`: first run had one extra order-sensitive media test failure;
  that test passed in isolation and the immediate full rerun matched the accepted
  baseline exactly: **291 pass / 8 fail / 2 loader-module errors / 788
  expectations**, with only `ZERO_MEDIA_TIME`, WASM startup, and `DEFAULTS`
  identities.
- Vite TypeScript: PASS. Pinned type baseline: PASS, exactly three current
  inherited diagnostics and none outside the pin.
- Storage boundary: PASS, 721 modules. Port boundary: PASS, 30 modules. Host
  composition: PASS, 2 roots / 718 production modules. Session-state boundary:
  PASS, 10/10 factories and registry keys / 52 modules.
- Focused Prettier and `git -c core.whitespace=cr-at-eol diff --check`: PASS.
- Focused ESLint: FAIL as recorded in m1.
- Strict Rasen validation: PASS after this report and handoff, 1/1 valid and zero
  issues.

## Hygiene

- Vite/Chromium processes started by this reviewer were stopped; port 4175 has
  no listener.
- The generated Playwright `.last-run.json` was removed after the run.
- Product, tasks, prior evidence/handoffs edited by reviewer: **0**.
- New files written by reviewer: this report and
  `handoff/strategy-attempt-1-reviewer.md` only.
- Commit created: **no**.
