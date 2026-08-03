# Handoff — C5 migration fixer round 1

Date: 2026-08-02  
Findings: B1, M1, M2, M6 / test gaps 1, 4, 5, 9  
State: done, green, uncommitted

## What changed

- v1→v2 preserves provider-private fields at project, metadata, scene, track,
  clip, settings, and attachment-metadata boundaries while canonical migrated
  fields retain precedence.
- A revisioned cleanup journal is persisted before post-commit physical cleanup,
  advances per successful target, and survives runtime memo reset/new wrappers.
- Store initialization and `prepareForSession()` retry maintenance independently
  from migration-once state.
- Next/Vite stable Hosts route mechanism-neutral storage warnings into the same
  stable diagnostics port used by their sessions.
- Current envelopes with an old decoded schema are migration candidates and
  retain their envelope summary/private payload.
- Disposable migration rejects out-of-identity project IDs and validates every
  recognized legacy/stage target before discovery or delete.
- A migration-only Vite/Playwright harness isolates these findings from the
  shared cascade matrix.

## Invariants for the next session

- Never turn the cleanup journal into a source of arbitrary physical names.
  Validate every persisted target before use and keep the allowed-name set exact.
- Journal the complete target set before the first cleanup attempt; remove a
  target only after its deletion succeeds.
- Do not couple maintenance retry back to `createEditorSession`'s migration-once
  memo. Constructor/session-boundary retry must remain independent.
- Store diagnostics must remain mechanism-neutral and payload-free.
- Under disposable policy, reject an out-of-identity project before constructing
  any legacy adapter. Do not weaken this to a broad substring check.
- For old current envelopes, use decoded `record.schemaVersion`; do not infer
  current schema merely from envelope presence.
- Current-schema scenes use `tracks.main/overlay/audio`; v1 reopen assertions
  must inspect the current graph rather than the old flat track array.

## Verification snapshot

- Deterministic RED: provider-private unit fixture **0/1**, first failure at
  metadata preservation.
- Focused GREEN: **20 passed, 0 failed, 46 assertions**.
- Migration-only Chromium: **1 passed**.
- Full shared Chromium: Chrome **151.0.7922.34**, store **19/19**, migration
  **16/16**, cascade **9/9**, no leftover databases.
- Vite TypeScript and repository type baseline: **PASS** (3 inherited diagnostics).
- Storage/port/Host/session boundaries: **PASS** (717 modules; 30 contracts;
  2 roots/714 modules; 10/10 factories and keys).
- Focused ESLint, Prettier, whole-tree diff check, and strict Rasen validation:
  **PASS**.

Full evidence: `evidence/fix-migration-round1.md`.

## Files and ownership notes

The migration-fixer write set is enumerated in the evidence file. Three shared
surfaces also contain concurrent core-fixer work:

- `browser-project-store.ts`
- `browser-project-store-conformance.ts`
- `c5-storage-harness.ts` / `browser-store.pw.ts`

Preserve their cascade/shared-queue fields and assertions. This fixer did not
edit the protected `create-session.ts` or `session-types.ts`, consumer/library
coordinators, task checkboxes, or `review-round1.md`. No commit was created.
