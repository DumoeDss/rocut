# C5 review-cycle strategy attempt 2 - M1 implementation evidence

Date: 2026-08-02  
Branch/worktree: `feat/s02-storage-port` / `rocut-wt-c5`  
Base: `0ef35459f685d5d41a25d0ef959aff691b7519cd`  
Scope: preferred attempt-2 M1-A and focused lint cleanup only  
Disposition: **implementation green; independent confirmation required**

## Result

`stageLegacyAttachments` now classifies the full stored record with
`decodeStoredAttachmentRecord`:

- decoder failure is a loud staging failure;
- an exact revision-2 tombstone is logical absence, so staging skips it without
  reading a body;
- legacy, revision-1, and revision-2 attachments require a readable body;
- revision-2 content additionally requires actual length and SHA-256 digest to
  match its committed envelope before staging.

The tombstone codec now requires exactly `revision`, `kind`, `projectId`, `key`,
and `mutationId` inside the v2 tombstone envelope, in addition to the existing
revision, identity, and non-empty mutation checks. Missing, mistyped,
mismatched, empty, or extra fields decode as invalid. Migration neither compacts
a valid tombstone nor introduces a recovery-journal absent variant; before
recovery intent, the tombstone itself is the durable deletion proof.

## RED then GREEN

The migration-round2 Chromium suite was extended before product changes. Initial
Chrome 151 output preserved strategy-1 M1 but showed both new axes false:

```text
preRecoveryIntentLaterRemoveMigrates: false
malformedPreRecoveryTombstoneRejects: false
```

Final output:

```text
preRecoveryIntentLaterRemoveMigrates: true
malformedPreRecoveryTombstoneRejects: true
stagedProjectLaterSaveWins: true
stagedProjectLaterRemoveWins: true
originalProjectLaterSaveWins: true
originalProjectLaterRemoveWins: true
physicalAbsenceRetainsRecovery: true
digestMismatchRetainsRecovery: true
```

### New Chromium transitions

1. A schema-30 project and legacy attachment are staged; `beforeValidation`
   fails once before recovery intent. Public remove commits a valid v2
   tombstone. After runtime reset/new wrapper, migration succeeds, publishes the
   current project schema, returns `loadAttachment === null`, and leaves no
   migration-stage database.
2. The same sequence adds an unexpected field to the tombstone envelope. Two
   fresh-wrapper migration attempts both return `failed`, the raw project stays
   schema 30, public attachment load reports corruption instead of absence, and
   both no-intent failures remove their stage databases without fabricating
   recovery evidence.

All probes use randomized disposable identities and existing exact cleanup
helpers. No user-profile identity was opened.

## Lint repair

The exact focused ESLint baseline was reproduced at six errors and one warning.
It is now zero errors and zero warnings:

- removed unused `AttachmentEnvelopeV1`;
- added `isNonNegativeSafeInteger` and removed four unsafe number assertions;
- captured narrowed recovery `projectId` before the attachment-map closure;
- changed probe `equalBody` to one destructured object parameter.

The only emitted ESLint text is the repository's environmental Next
pages-directory notice; no file diagnostic remains.

## Write set and exclusions

- `apps/web/src/services/storage/browser-project-store-records.ts`
- `apps/web/src/services/storage/browser-project-store-migration.ts`
- `apps/web/src/services/storage/browser-project-store-migration-round2-probes.ts`
- `apps/vite-example/src/c5-storage-harness.ts`
- `apps/vite-example/tests/c5-storage/browser-store.pw.ts`

No attempt-2 M2 binding history, queue key, cascade codec/manager, public port,
Host, consumer, protected session, task list, or prior review artifact was
edited by this M1 pass. The combined worktree's existing strategy-1 M2 5/5 axes
remained green but are not attempt-2 M2 evidence.

## Verification

```text
focused Chromium: PASS 1/1
  store 19/19; lifecycle races 16/16; strategy-1 M1 6/6;
  strategy-attempt-2 M1 2/2

full Chromium config: PASS 3/3
  browser-store, C4 forced-none, migration round 1
  Chromium 151.0.7922.34

focused C5 Bun: PASS 21/21, 43 expectations
Vite TypeScript: PASS, zero diagnostics

port boundary: PASS, 30 contract modules / five rules
session-state boundary: PASS, 10/10 factories and registry keys
storage boundary: PASS, 721 modules, zero forbidden hits
Host composition: PASS, two Host roots / 718 modules

focused ESLint: PASS, 0 errors / 0 warnings
Prettier: PASS
diff check with cr-at-eol: PASS
strict Rasen validation: PASS, 1/1 valid, zero issues
```

Port 4175 has zero listeners, Playwright `.last-run.json` was removed, no
runner-output path appears in git status, disposable fixtures/stages were
cleaned, and no commit was created.

## Remaining state

Attempt-2 M1 is ready for independent review. Attempt-2 M2 remains outside this
pass and must follow `strategy-attempt-2-design.md`. This implementing author
does not close either Major or the review cycle.
