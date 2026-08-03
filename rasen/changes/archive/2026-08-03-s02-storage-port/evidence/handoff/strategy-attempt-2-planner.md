# C5 strategy attempt 2 planner handoff

## Status

Strategy attempt 2 is designed but not verified. Both new Majors remain open:

- M1: pre-recovery-intent staging collapses a valid tombstone and invalid metadata into `null`.
- M2: revision-1 coverage and owners are not bound to an exact media physical configuration.

No product file or task item was edited. This handoff is not a clean review result.

## Selected implementation

### M1

Use `decodeStoredAttachmentRecord` in staging. Skip only an exact valid revision-2 tombstone as logical absence; malformed tombstones and invalid present rows remain corrupt. Do not introduce recovery revision 3 or compact the tombstone.

Required new Chromium axes:

- staging failure through `beforeValidation` -> public remove -> runtime reset -> successful migration with attachment absent;
- the same path with a malformed tombstone -> repeated staging rejection and no published current schema.

Preserve all six strategy-1 M1 axes.

### M2

Replace the unbound boolean with revision-2 internal state:

- exact binding descriptor containing `{mediaDatabasePrefix, mediaStore, mediaDirectoryPrefix}` plus a recomputed fingerprint;
- binding-scoped owner rows;
- one complete-coverage certificate per binding;
- no implicit revision-1 rebinding;
- exact owner-to-binding clear planning;
- backward-readable revision-2 clear journals validated against durable binding history;
- mutation queue sharing by `{projectsDatabase, projectsStore}` across old/new media bindings.

Revision-1 coverage is fail-closed with enumeration both available and unsupported. It may become usable only through an explicit trusted previous-binding migration; a new-prefix sweep cannot overwrite it.

Required new Chromium groups:

1. changed-prefix masked clear refuses atomically when the new binding is uncertified;
2. certified old/new history deletes both namespaces and prevents same-ID resurrection;
3. rev1 never auto-rebinds;
4. binding-scoped owners do not form a destructive cross-product;
5. old-binding registration versus new-binding clear is serialized;
6. a pending v2 journal retries under the other current binding.

Preserve all five strategy-1 M2 axes and the full browser matrix.

## Minimum write set

Expected product/test files are limited to the records, migration, migration-round2 probes, media ownership, internals, browser store, cascade codec/manager, cascade-round2 probes, C5 browser harness, and Playwright assertion. `browser-storage-mechanisms.ts` should not change because its existing `idbPutMany` already supplies the required atomic ownership-store put.

Do not edit public ports, Hosts, sessions, consumers, tasks, protected fixtures, Rust, or generated assets.

## Mechanical gate

The current focused ESLint baseline is 6 errors / 1 warning:

- five unsafe narrowing assertions across records/migration;
- one positional `equalBody` helper;
- one unused `AttachmentEnvelopeV1`.

Remove all seven and keep new codecs assertion-free. Full details, commit points, failure matrices, exact record revisions, and test contracts are in `evidence/strategy-attempt-2-design.md`.

## Review-cycle invariant

The implementing author cannot close either Major. A different reviewer must inspect the exact fix delta and rerun both counterexample families. M1/M2 remain open until then.
