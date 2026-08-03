# C5 browser migration evidence

Date: 2026-08-02

The migration probes execute in the same real Chromium run documented in
`conformance-browser.md`. All results below were asserted by Playwright, not
reported from a mock adapter.

## Result matrix

| Probe | Result | Evidence |
| --- | --- | --- |
| current-version no-op | PASS | A raw v31 record containing an opaque provider sentinel remained byte-for-byte structurally equal; outcome was `not-needed`. |
| seeded v1 success | PASS | Real v1 project/timeline/media inputs reached v31; opaque project and attachment sentinels and attachment bytes `0,1,128,255` survived. |
| progress | PASS | The last reported item had `completed === total`, and progress is emitted only after committed readback validates. |
| staged validation failure | PASS | An injected validation failure returned `failed`; the v30 source stayed readable and unchanged. |
| retry after failure | PASS | A new wrapper for the same durable identity retried and returned `migrated`; the loaded record was v31. |
| two-wrapper race | PASS | Two store wrappers sharing one durable identity invoked migration work once and awaited the same migrated result. |
| missing destructive opt-in | PASS | A custom identity without its exact disposable policy returned `failed` while preserving its v30 source. |
| post-commit cleanup failure | PASS | The committed v31 result remained successful, the old timeline DB remained, and a retryable `migration-postcommit-cleanup` warning was emitted. |
| cleanup retry | PASS | A later migration call for the completed durable identity returned `not-needed` after deleting the pending old timeline DB. |
| undefined-name regression | PASS | Neither before/after inventory nor any resolved cleanup target contained `undefined`. |

Final probe booleans were all `true`:

```text
currentVersionNoOp
legacySuccess
sourcePreservedOnFailure
retrySucceeded
wrappersCoalesced
missingOptInRefused
postCommitCleanupDiagnosed
postCommitCleanupRetried
noUndefinedNames
```

## Real legacy discovery and deletion order

The successful v1 probe used randomized project identity
`c5-disposable-24a7a5c7-f72b-408b-859d-74ccb4a03cf7-legacy-v1` and the real
legacy names:

```text
video-editor-timelines-<projectId>-scene-main
video-editor-timelines-<projectId>
video-editor-media-<projectId>
```

Migration reads and transforms without the old `V1toV2Migration.run()` deletion
side effect. It writes project and attachment staging databases, reads staged
keys/schema/counts/opaque values and bytes back, commits current metadata and
project records, re-reads committed project, attachment metadata, and attachment
body, and only then attempts obsolete-source and staging-database cleanup.

Precommit failures clean only internal staging databases and retain readable
legacy input. Postcommit deletion failure is recorded in a durable-identity
pending-cleanup set for the process and is retried without repeating the
transformation. IndexedDB handles are explicitly closed, and blocked deletion
is surfaced instead of being treated as success.

The schema version is sourced from `CURRENT_PROJECT_VERSION` rather than a
second numeric literal.

## Isolation and cleanup proof

Every destructive probe used a new `c5-disposable-<uuid>` identity with an exact
matching migration policy. The final run started with an empty database
inventory and ended with an empty database inventory. Its cleanup proof named
each randomized identity plus each real legacy database it was authorized to
remove; the developer's production profile identity was never targeted.

Focused supporting command:

```powershell
bun test apps/web/src/editor/ports/__tests__/conformance.test.ts `
  apps/web/src/services/storage/migrations/__tests__/v1-to-v2.test.ts
```

Exit: 0, `46 pass / 0 fail / 219 expectations`.

