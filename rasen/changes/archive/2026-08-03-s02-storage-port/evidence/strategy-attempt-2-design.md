# C5 review-cycle strategy attempt 2 - versioned compatibility state

Date: 2026-08-02  
Change: `s02-storage-port`  
Mode: report-only planner strategy; no subagents, product edits, task edits, prior-evidence edits, or commit  
Inputs: review-cycle H.5/H.6, `strategy-attempt-1-design.md`, `strategy-attempt-1-review.md`, and the current combined product worktree  
Open findings: strategy-attempt-1 review M1 and M2  
Disposition: **design selected; both Majors remain open until implementation and independent non-author confirmation**

## H.5/H.6 strategy accounting

This is strategy attempt **2/3**. It changes two material variables rather than repeating attempt 1:

1. a different planner independently traced the live staging, ownership, queue, and cascade code; and
2. both compatibility cases are isolated in versioned internal state instead of being inferred from a null decoder result or a configuration-free boolean certificate.

The explicit no-subagent constraint overrides the parallel procedure in `DESIGN-IT-TWICE`; the candidates below were developed as independent alternatives in one planner context. That does not satisfy author-versus-verifier independence. H.6 therefore keeps both Majors open after this document.

## Current-code facts that constrain every design

- `stageLegacyAttachments` runs before the recovery journal. It currently calls `decodeStoredAttachment`, which intentionally maps a valid tombstone and an invalid record to the same `null` result.
- A strategy-1 attachment removal commits a revision-2 tombstone in the media metadata row. The tombstone is already the durable, versioned proof of logical absence; deleting or ignoring that proof would reopen the original resurrection ambiguity.
- A failed pre-intent staging run has no recovery journal and cleans its stage databases. Its next run must classify the current source rows afresh.
- Media ownership currently has revision-1 global owner rows and one revision-1 `coverage: complete` row. Neither row identifies `mediaDatabasePrefix`, `mediaStore`, or `mediaDirectoryPrefix`.
- `opportunisticallyCertifyMediaOwnership` runs during initialization. On a new prefix it can sweep only that prefix and overwrite/reuse the unbound revision-1 certificate.
- `prepareMediaOwnershipForClear` returns only a set of logical IDs. The cascade manager then derives every target from the wrapper's current identity, losing any prior binding.
- Revision-1 clear journals store exact database/directory strings, but ownership validation accepts only the current prefixes. A history-aware cleanup must remain safe and retryable after another binding becomes current.
- The runtime mutation queue is keyed by the full physical tuple. Two wrappers sharing the projects database/store but using different media bindings receive different queues, so registration and projects/all clear are not serialized across the exact compatibility case under review.
- IndexedDB and OPFS are local-substitutable dependencies exercised by the real Chromium harness. The external `ProjectStore` interface must remain unchanged; all new seams are internal to the browser adapter.

## Module/seam decision

The deep internal module remains media ownership. Its interface should become:

```ts
registerMediaOwner({ identity, projectId, context }): Promise<void>
planMediaClear({ identity, logicalProjectIds, diagnostic }): Promise<MediaClearPlan>
validateMediaClearPlan({ identity, plan, context }): Promise<void>
```

Callers do not learn record revisions, binding fingerprints, enumeration capability, legacy upgrade state, or target derivation. `MediaClearPlan` is internal and is consumed only by the cascade implementation and its browser probes. This concentrates the compatibility behavior behind one seam and leaves the public port, Hosts, sessions, and consumers untouched.

## M1 - pre-recovery-intent staging versus attachment tombstones

### Candidate M1-A - strict full-record classification during staging (preferred)

Replace the attachment-only decode in `stageLegacyAttachments` with `decodeStoredAttachmentRecord` and branch on its discriminant:

```text
decode failure                       -> corrupt staging failure
strict revision-2 tombstone          -> logical absence; do not read a body; continue
legacy/revision-1/revision-2 content -> read and validate its body; stage migration value
```

The tombstone codec must require the exact revision-2 tombstone envelope fields (`revision`, `kind`, `projectId`, `key`, `mutationId`) and the existing identity/mutation checks. Missing, mistyped, empty, mismatched, or unexpected tombstone fields are not absence; they decode as invalid and staging fails loudly.

This design uses the existing versioned durable state at the correct seam. It adds no migration journal revision because there is deliberately no recovery intent yet. Once a valid tombstone is omitted from the new stage, the staged project and its attachment count consistently describe logical absence.

### Candidate M1-B - stage an explicit absent disposition in recovery revision 3

Introduce a `StagedAttachmentDisposition` union with `present` and `deleted` variants, write tombstones into the attachment stage, bump recovery to revision 3, and teach validation/recovery to carry a deleted winner through every later phase.

This is correct but not selected. The finding occurs before recovery intent, where the tombstone already contains all required evidence. Propagating absence into stage/recovery expands codecs, count rules, and reconciliation states without adding safety. Its interface is shallower: more state must be learned by every downstream migration function.

### Rejected non-option - compact the tombstone before staging

Physical deletion would turn a proven later remove into unexplained absence if migration failed again before intent. That directly violates the strategy-1 invariant and is not an admissible fix.

### Selected M1 staging state machine

| Stored media row | Classification | Body action | Migration action |
| --- | --- | --- | --- |
| No attachment envelope, valid legacy row | present/legacy | body required and digested | stage revision-2 attachment |
| Valid revision-1 attachment envelope | present/v1 | body required and digested | stage revision-2 attachment |
| Valid revision-2 attachment envelope | present/v2 | body and recorded digest/length must validate | stage a fresh migration mutation as today |
| Strict valid revision-2 delete tombstone | logical absence | no body read | omit the key and continue project migration |
| Tombstone with missing/extra/wrong field, wrong project/key, or invalid mutation ID | corrupt | none | fail staging; source remains untouched |
| Present attachment with missing body or invalid revision-2 digest/length | corrupt/ambiguous | validation fails | fail staging; source remains untouched |

### M1 commit points

1. **Later remove:** unchanged; the revision-2 tombstone metadata put is the logical delete commit. Body cleanup remains postcommit.
2. **Staging:** read-only with respect to the source. A valid tombstone produces no staged attachment row; malformed state produces no migration commit.
3. **Recovery intent:** unchanged and still occurs only after every project stage validates. The new path reaches it with a stage that accurately excludes logically deleted keys.
4. **Destination commit:** attachment metadata puts remain before the project-row put; the project-row put remains the migration commit point.
5. **Finalization:** recovery/stage cleanup remains after committed readback. A skipped tombstone is not compacted by migration.

### M1 failure matrix

| Failure/event | Durable state on retry | Required result |
| --- | --- | --- |
| Staging fails before recovery intent, then public remove succeeds | legacy project plus strict v2 tombstone | retry skips the key, migrates the project, returns attachment `null`, and removes stage residue |
| Same sequence, but tombstone is malformed after removal | legacy project plus invalid envelope | retry fails during staging as corrupt/unavailable; project schema stays old; no recovery journal is fabricated |
| Tombstone body cleanup failed | valid tombstone plus orphan body | migration still treats the row as logical absence; orphan cleanup remains independent |
| Staging fails before intent, then later save succeeds | valid attachment row/body | retry stages the later content and migrates it; no older body is resurrected |
| Present v2 row has digest/length mismatch | ambiguous content | retry fails loudly; it is never treated as a tombstone |
| Crash after stage validation but before recovery intent | source unchanged; disposable stage may remain | the existing no-intent cleanup/retry path rebuilds the stage and applies the same classification |
| Crash after recovery intent | revision-2 recovery journal exists | existing six strategy-1 reconciliation axes remain authoritative and unchanged |

### Required M1 tests

Extend the existing migration-round2 Chromium probe, not a parallel harness:

1. Add `preRecoveryIntentLaterRemoveMigrates`: seed v30 plus attachment, fail once through the existing `beforeValidation` hook, commit public remove, reset runtime/new wrapper, require initialization/migration success, current schema, `loadAttachment === null`, and no migration-stage database.
2. Add `malformedPreRecoveryTombstoneRejects`: repeat through public remove, corrupt one required tombstone field, reset twice, require both retries to reject, current schema not to publish, and no logical resurrection.
3. Preserve the existing M1 6/6 axes and the complete migration/lifecycle matrix.

## M2 - certificate/configuration binding and historical exact cleanup

### Candidate M2-A - per-binding revision-2 history, scoped owners, and versioned clear plan (preferred)

Persist immutable exact media bindings, owners scoped to those bindings, and one coverage certificate per binding. Retain every certified historical binding. Clear plans targets from the exact owner-to-binding relationship and writes a revision-2 journal that can be validated against certified history after a wrapper/configuration change.

This design can safely clean old and new namespaces, preserves same-ID protection, and makes optional enumeration an evidence producer rather than a boolean fallback.

### Candidate M2-B - single current-binding certificate with fail-closed mismatch

Store one revision-2 certificate containing only the current binding fingerprint. If it differs from the wrapper, reject projects/all clear before commit. Never clean historical namespaces automatically; the caller must reopen the old configuration and clear there before changing configuration.

This is a safe fallback and materially smaller, but it strands legitimate upgrade cleanup and cannot make a successful new-config clear protect same-ID reuse from old media. It is not selected while a bounded history can preserve locality inside the ownership module.

### Rejected non-option - overwrite revision 1 with a new-prefix sweep

Hashing only the current prefix and overwriting the old boolean certificate repeats the finding. A new-prefix sweep says nothing about the namespace that produced the old certificate and cannot derive old targets.

### Selected M2 internal record revisions

All rows remain in the existing media-ownership object store. Physical names never enter the public port or diagnostics.

```text
binding descriptor v2
  key: .c5-media-binding:<fingerprint>
  envelope: { revision: 2, kind: binding, fingerprint,
              binding: { revision: 1,
                         mediaDatabasePrefix, mediaStore,
                         mediaDirectoryPrefix } }

binding-scoped owner v2
  key: .c5-media-owner-v2:<fingerprint>:<encoded projectId>
  envelope: { revision: 2, kind: owner, fingerprint, projectId }

coverage certificate v2
  key: .c5-media-coverage:<fingerprint>
  envelope: { revision: 2, kind: coverage,
              fingerprint, coverage: complete }

legacy upgrade marker v2 (only from an explicit migration)
  key: the old .c5-media-owner-coverage key
  envelope: { revision: 2, kind: legacy-binding, fingerprint }
```

The fingerprint is SHA-256 over a canonical versioned tuple of the exact three physical media fields. The exact tuple is also stored because a digest alone cannot derive historical targets. Every decode recomputes and compares the fingerprint, requires exact keys, validates all strings, and rejects duplicate/conflicting descriptors.

Revision-1 owner rows remain readable only as `legacy-unbound-owner`. They become usable for cleanup only when the revision-1 coverage key has been atomically replaced by a valid `legacy-binding` marker and the matching descriptor/certificate exists. New registration never writes revision-1 rows.

### Revision-1 certificate upgrade policy

There is **no implicit upgrade to the wrapper's current binding**. The old certificate proves completeness for some physical configuration but contains no evidence naming which one.

- With enumeration unsupported: revision 1 is unbound, so projects/all clear rejects precommit with mechanism-neutral `unavailable`.
- With enumeration available: a sweep of only the current/new prefix still cannot identify the old certified prefix, so opportunistic certification must leave revision 1 untouched and clear still rejects.
- An explicit internal migration may bind revision 1 only when supplied a versioned, trusted previous physical binding from configuration migration data. In one ownership-store transaction it writes the exact descriptor, maps the legacy owner set through the `legacy-binding` marker, writes the per-binding coverage certificate, and backfills any enumerated exact owners. Failure leaves revision 1 unbound.
- If no trusted previous binding exists, refusal is permanent and safe. Because strategy attempt 1 is not landed, production has no required deployed revision-1 upgrade; direct test seeders must move to revision 2. Developer profiles that exercised the unlanded branch fail closed rather than silently rebinding.

### Binding and owner registration state machine

Before any creation-capable media database/directory access, `registerMediaOwner` atomically puts the binding descriptor and the binding-scoped owner in one IndexedDB transaction. The transaction is write-ahead to the physical open. A crash can create a false-positive exact owner but cannot create an untracked target.

| Binding state | Meaning | Clear eligibility |
| --- | --- | --- |
| descriptor absent | this code has not registered the binding | establish descriptor, then certify or refuse |
| descriptor present, no certificate | exact binding is known but legacy/orphan coverage is unproved | enumerate and certify, or refuse |
| descriptor plus exact certificate | owner set is authoritative for that binding | usable with enumeration masked |
| revision-1 certificate, no legacy marker | complete but physically unbound | always refuse until explicit migration |
| descriptor/fingerprint/owner/certificate mismatch | durable control state corrupt | reject as `corrupt`; never delete |

The shared mutation queue key changes from the full physical tuple to the projects control plane `{projectsDatabase, projectsStore}`. Full `durableIdentityKey` may remain for per-configuration initialization/migration memoization, but all operations from wrappers sharing the control plane then use one queue. Registration under an old binding cannot race a new-binding `all-projects` clear between inventory and commit.

### Capability-aware certification

1. Read/decode the full ownership state strictly.
2. If unbound revision-1 coverage exists, emit a fixed internal warning and do not write a new certificate.
3. Ensure the current binding descriptor exists.
4. If `indexedDB.databases()` is available, take one database snapshot and one OPFS-root snapshot while holding the `all-projects` queue operation. Sweep each known uncertified binding independently, backfill binding-scoped owners, and write its certificate without deleting any historical descriptor/certificate.
5. A discovered name that maps ambiguously across overlapping binding prefixes is a precommit `corrupt`/`unavailable` refusal; never manufacture owner IDs and cross-product them.
6. If database enumeration is unsupported or a required sweep fails, only already-certified exact bindings remain usable. Any known uncertified binding makes clear reject before commit.
7. When every known binding is certified, an optional enumeration failure is diagnostic-only; durable binding-scoped owners remain authoritative.

### Exact owner-to-binding target planning

Do **not** cross-product one global owner set with every binding. The plan is:

- revision-2 owner `{fingerprint, projectId}` -> exactly one binding target pair;
- revision-1 owner -> exactly the binding named by the explicit legacy marker;
- current project/tombstone IDs -> the current binding only, as defensive idempotent targets;
- the same logical ID recorded under two bindings -> two exact target pairs, one per binding;
- enumerated orphan -> the single unambiguous binding that parsed it, persisted before commit.

Each target entry contains `{fingerprint, projectId, database, directory}` and is validated by deriving its names from the stored exact binding. Targets are sorted and deduplicated by exact physical name. The union of logical project IDs and all scoped owner IDs still drives project tombstones, but it never drives a blind physical cross-product.

### Versioned cascade journal

Create a revision-2 clear journal containing the binding fingerprints and exact target entries, rather than only two flat arrays. Its strict decoder checks shape and duplicates. Before deletion, the cascade manager asynchronously confirms every fingerprint/tuple is present in the durable binding history and every database/directory exactly re-derives from its project ID.

Revision-1 journals remain readable only under their existing current-prefix validation; a configuration mismatch leaves them pending and requires the old configuration or explicit migration. They are never reinterpreted as revision 2.

The v2 journal is self-describing for retry but not self-authorizing: a forged arbitrary tuple without a matching durable binding descriptor/certificate is rejected, preserving the existing forged-maintenance control. `pendingCleanupForProject` uses the v2 target's explicit project ID, so a same-ID save remains blocked even when the pending target belongs to a historical prefix.

### M2 clear state machine and commit points

1. **Collect:** strictly decode project rows, cascade rows, v1 compatibility rows, v2 bindings, scoped owners, and certificates. Malformed present state is `corrupt` precommit.
2. **Coordinate:** run registration, certification, planning, and clear under the projects-control-plane queue key.
3. **Prove:** upgrade explicit legacy state or refuse; certify every known binding from complete DB+OPFS enumeration, or require its existing exact certificate.
4. **Plan:** build the exact owner-to-binding target list and validate all fingerprints/names. No target is accepted from journal text or the current wrapper alone.
5. **Recheck abort:** cancellation still wins only before logical commit.
6. **Logical commit:** atomically clear project rows and write project tombstones plus the revision-2 clear journal (and `clearLibrary`) in the existing projects/cascade transaction. Ownership history is retained.
7. **Physical cleanup:** delete only the exact journaled targets and optional library. Failure retains the journal and blocks same-ID project save until retry completes.
8. **Completion:** complete tombstones/journal only after every exact target succeeds. Same-ID reuse under either historical or current binding then observes no old metadata/body.

### M2 failure matrix

| State/capability/event | Required result |
| --- | --- |
| Unbound rev1 certificate; enumeration unsupported | reject precommit; project/media/library remain readable |
| Unbound rev1 certificate; enumeration available only for new prefix | reject precommit; do not overwrite or mark rev1 complete for new prefix |
| Unbound rev1 plus trusted explicit previous binding | atomically write descriptor, legacy marker, scoped/backfilled owners, and exact certificate; partial upgrade is impossible |
| Certified old binding; new current binding uncertified; enumeration unsupported | reject precommit; old proof is retained and never relabeled |
| Certified old binding; new binding sweep succeeds | add a second certificate, retain old history, plan both exact namespaces |
| Every used binding certified; enumeration unsupported | commit and clean from exact scoped owner history |
| Optional enumeration throws with all bindings certified | proceed from durable history and emit a fixed retryable diagnostic |
| Required enumeration or OPFS sweep throws for any uncertified binding | reject precommit; no project/library clear |
| Owner/descriptor registration fails | reject the media operation before physical open |
| Crash after owner+descriptor commit but before media open | harmless exact false positive; future delete is idempotent |
| Old-binding registration races new-binding clear | one projects-control-plane queue orders them; earlier registration is included, or later access observes the clear tombstone |
| Same project ID has media under old and new bindings | v2 plan contains both exact pairs; both are deleted before reuse |
| Overlapping prefixes make an enumerated owner ambiguous | fail before certificate/clear; never cross-product guessed IDs |
| Binding fingerprint/tuple mismatch or malformed v2 row | reject `corrupt` before logical clear |
| Project/cascade transaction fails | projects and library remain visible; no physical target is deleted |
| Crash/failure after logical clear commit | v2 journal retains certified exact history; reopen under either configuration retries it |
| Wrapper changes again while a v2 journal is pending | journal validates against retained binding history, not the new current prefix; cleanup remains exact |
| Forged v2 journal names an uncertified binding or non-derived target | reject cleanup; no cross-delete |

### Required M2 tests

Extend the cascade-round2 Chromium probe and existing browser assertion:

1. **Uncertified mismatch refusal:** seed/certify old binding, construct a same-control-plane wrapper with only media prefixes changed, mask database enumeration, attempt projects and all clear, and require typed precommit refusal plus readable project, old attachment metadata/body, and library.
2. **Certified history cleanup:** certify both old and new bindings, store the same logical ID under both, mask enumeration, clear projects/all, recreate the ID under each configuration, and prove neither old metadata nor body resurfaces; library behavior must still match scope.
3. **Rev1 no-rebind:** seed the exact attempt-1 rev1 certificate/owner rows, run initialization with changed prefixes with enumeration available and unsupported, and prove neither path converts it to current-binding completeness; clear refuses atomically.
4. **Binding-scoped exactness:** old binding owns A and new binding owns B; place unrelated sentinels at old/B and new/A. The plan may delete old/A and new/B only. This proves there is no global owner cross-product.
5. **Cross-binding registration/clear race:** pause old-binding registration before physical open while new-binding clear starts; require serialization and exact cleanup.
6. **V2 journal reload:** interrupt physical cleanup after the logical commit, reopen with the other binding current, and require exact historical cleanup plus same-ID protection.
7. Preserve the existing M2 5/5 axes, forged-maintenance controls, namespace/all-clear recovery, corrupt rows, abort behavior, and complete Chromium matrix.

## Combined minimum implementation write set

No public port, Host, session, consumer, library schema, protected fixture, Rust, or generated asset should change.

1. `browser-project-store-records.ts` - strict tombstone-v2 shape and existing lint cleanup.
2. `browser-project-store-migration.ts` - full-record staging classifier and narrowing cleanup.
3. `browser-project-store-migration-round2-probes.ts` - two pre-intent tombstone axes and object-parameter lint cleanup.
4. `browser-project-store-media-ownership.ts` - v1 compatibility decoder, v2 binding/owner/certificate codecs, registration, certification, explicit legacy binding, exact planning, and plan validation. Split a private codec file only if the configured file-size rule requires it; do not expose another port.
5. `browser-project-store-internals.ts` - exact media-binding value/fingerprint helper and projects-control-plane queue key.
6. `browser-project-store.ts` - use the control-plane queue and retain write-ahead binding-scoped registration at every creation-capable access.
7. `browser-project-store-cascade.ts` - backward-readable revision-2 clear-journal codec with explicit binding target entries.
8. `browser-project-store-cascade-manager.ts` - consume/validate `MediaClearPlan`, handle v1/v2 retry, and block same-ID reuse by explicit target project ID.
9. `browser-project-store-cascade-round2-probes.ts` - binding mismatch/history/rev1/exactness/race/reload axes; replace direct rev1 “certified” seeders with exact v2 seed helpers except the deliberate rev1 compatibility case.
10. `apps/vite-example/src/c5-storage-harness.ts` and `apps/vite-example/tests/c5-storage/browser-store.pw.ts` - expose and assert the new result fields.

`browser-storage-mechanisms.ts` need not change: `idbPutMany` already commits multiple rows in one object-store transaction. `browser-project-store-control.ts` changes only if the existing pause hooks cannot express the cross-binding race; prefer reuse.

## ESLint repair checklist

The current focused lint run reports exactly six errors and one warning. The implementation must clear all seven while keeping new code assertion-free:

1. Remove unused `AttachmentEnvelopeV1` from `browser-project-store-records.ts`.
2. Add a real type guard such as `isNonNegativeSafeInteger(value): value is number`; use it for `byteLength` validation at the current records lines 387/400, with no `as number`.
3. Capture validated `project.id` in a local string before the attachment-map closure in migration (current line 800); remove `as string`.
4. Use the same typed non-negative integer guard in `decodeAttachmentFingerprint` (current migration lines 875/882); remove both `as number` assertions.
5. Change `equalBody(body, expected)` in migration-round2 probes to one destructured object parameter and update callers.
6. New binding/journal codecs must use exact-key checks and narrowing helpers, never `as`, non-null assertions, or positional multi-parameter helpers.
7. Re-run the exact focused ESLint file set and require 0 errors / 0 warnings. The repository-level Next pages-directory notice is environmental output, not permission to ignore a file diagnostic.

## Implementation acceptance gate

The fixer must provide real-Chromium evidence for both new M1 axes and all six M2 groups above, then regress:

- strategy-1 M1 6/6 and M2 5/5;
- migration lifecycle 16/16, migration R1, cascade R1/R2, corrupt 6/6, abort 7/7;
- C4 forced-none/public-store-first stress;
- focused port/storage/session/project suites;
- all four positive/negative boundaries;
- exact-three TypeScript baseline, focused ESLint, Prettier, diff check, and strict Rasen validation;
- disposable database, OPFS, ports, and runner-output cleanup.

The independent reviewer must inspect the exact delta, confirm revision-1 never auto-rebinds, confirm v2 owner IDs are binding-scoped rather than cross-producted, and rerun the two counterexamples. Until that non-author confirmation exists:

- M1: **OPEN Major**
- M2: **OPEN Major**
- strategy attempt 2: **DESIGNED, NOT CLEAN**
