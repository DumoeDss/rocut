# Read-only media import recovery

`rocut media import-status <original-spec.json> --target <id>` observes the exact
original import without importing again. The authenticated HTTP equivalent is
`POST media/import-status`; `context.mediaImport.recovery` advertises support.

Pass the original `filePath`, `expectedRevision`, `idempotencyKey`, and optional
image metadata. The source file must still be available with the original bytes
and basename. This command does not authorize a new import.

The filesystem transport prepares the same batch as `media import`, then asks
the shared transaction engine for a dry run. Only an exact durable replay,
verified retained attachment bytes and metadata, and the unchanged native asset
yield `status: committed`. The response includes the native project ID, original
transaction result, operation key, before revision, asset, and source digest.

No replay, conflicting input, unavailable attachment, or changed asset yields
`status: unknown`. Invalid or unreadable source input raises an error. Neither an
unknown result nor an error proves the original operation failed or permits a
retry. The status route never saves an attachment or applies a transaction.

A host integrating restart recovery must separately retain a private original
intent, bind the target and physical project identity, and verify this evidence
before recording its own relationship. Matching media digests alone are not
original-operation evidence.

Focused transport tests cover read-only behavior, operation-key separation,
damaged or missing evidence, and CLI routing. Native host reopen assertions are
also included in `media-import.test.ts`; they require the native integration
environment and are not implied by the focused transport tests.
