# Durable native export receipts

The admission and receipt contract lives in
`rust/crates/editor-api/src/native_export.rs`, exposed as
`resolveNativeExportJobJson`. The CLI owns filesystem publication and surface
transport; it does not implement a second admission or export state machine.

## Request identity

`rocut export` requires `--revision <n>` and `--idempotency-key <key>`. The Rust
request binds the project, source projection, profile and range. The same key and
request replays the original receipt before the current revision check. A changed
request is a conflict, not an invitation to run another render.

The source projection includes `motionTextSequences`. It normalizes supported
missing defaults and excludes non-render scene save timestamps. The editor's
persistence coordinator captures live scenes through the existing native codec
with retained project data, including unsaved edits. The renderer fences both
revision and source before and after encoding; reading the saved project alone
cannot stand in for this live check.

## Dispatch and publication

The Host persists dispatch intent before sending to one compatible, token-owned
surface. An interrupted or unknown dispatch is never resent. Cancellation is a
durable request, not proof that encoding or publication stopped; terminal receipts
retain its history.

After validating upload bytes, Rust freezes candidate evidence in a publication
intent before output IO. The CLI creates a staging file exclusively, flushes it,
then links it to the final name without overwriting an existing different file.
Actual stage/final bytes, length and SHA-256 must match the frozen candidate before
Rust confirms completion. The stage is retained until the completed ledger is
durable.

Recovery checks only that original publication intent and its fixed files. Missing
or mismatched files remain outcome-unknown, retaining candidate evidence. Matching
bytes can confirm the original encoded snapshot even if subsequent edits changed
the current project; recovery does not encode again or retarget the receipt.
Completed single-item and list readbacks verify the actual file evidence.

## Verification boundary

Missing, trapping or malformed WASM is refused as
`native-export-kernel-unavailable`. No TypeScript semantic fallback is permitted.
MP4/WebM container signatures, byte hashes and receipt checks are not independent
codec/decode acceptance. Isolated Rust and adapter tests do not prove the installed
WASM, browser surface, GPU, audio mix or full export workflow. A new runtime build
and real export acceptance must be recorded separately.
