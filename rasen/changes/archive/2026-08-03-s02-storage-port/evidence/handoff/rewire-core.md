# C5 Core Persistence Consumer Handoff

Status: tasks 8.1–8.6 and 8.10–8.12 complete. Core failure-path work needed for 8.13 is implemented and focused-green; leave 8.13 and 8.14 unchecked until the finalizer combines the core and libraries/UI families. The shared C5 worktree is uncommitted.

## What landed

- `EditorCore.persistence` is the sole core coordinator. It is created from the Host store before managers and destroyed with the core.
- Project/media/scenes managers, media add/remove commands, media processing and its callers, the thumbnail degraded test, C4 forced-none seeding, and the obsolete C5 singleton controls use the owning session store/coordinator.
- `media/persistence.ts` is the mechanism-neutral attachment codec. It preserves known media fields, clones bytes, refuses transient blob thumbnails, and lets the coordinator overlay retained private metadata.
- Project duplication preserves raw attachment bytes/private metadata; project deletion is scoped and cascades attachments without touching other projects or libraries.
- Durable errors produce fixed payload-free session diagnostics plus visible recovery UI. Rejecting APIs rethrow; MediaManager add returns its documented `null` failure; optimistic commands roll back. SaveManager retains dirty state on failure without automatic retry spin, while explicit flush propagates the error.
- Focused evidence is in `evidence/rewire-core.md`.

## Verification snapshot

- Combined focused suite: 39/39 passed, 188 assertions.
- Direct media manager/command internals: 2/2 passed, 14 assertions.
- Direct project/diagnostics internals: 3/3 passed, 15 assertions.
- Direct C5 RED-to-green controls: 9/9 passed, 26 assertions.
- Target ESLint, exact-three type baseline, Vite typecheck, Windows-aware diff check (`core.whitespace=cr-at-eol`), session-state boundary, Host-composition boundary, and strict Rasen validation: green.
- Storage boundary: one known stale-rule red only — it still demands an import of deleted `BrowserHostAdapter` instead of recognizing final `BrowserProjectStore` Host composition.

## Finalizer obligations

1. Complete 8.13 by combining this core evidence with `evidence/rewire-libraries.md`; verify the libraries/UI leaf's real-browser legacy saved-sounds clear regression and its recovery UI/diagnostics assertions.
2. Run task 8.14's combined manager, command, media-processing, sounds, presets, storage-provider, and C4/browser harness family after all shared-tree edits settle, then check 8.13 and 8.14.
3. Update `script/check-storage-boundary.mjs` for the final direct `BrowserProjectStore` Host composition and run its positive/negative controls. Do not resurrect `BrowserHostAdapter`.
4. Attribute or remove shared untracked browser artifacts such as `apps/vite-example/tests/.pw-output-c5-storage/` during final cleanup; this leaf did not create or inspect user-profile storage.
5. Preserve the parent architectural ruling: no second coordinator and no persistence property added to the public `EditorSession`/factory shape. This leaf did not edit `create-session.ts` or `session-types.ts`; current shared-worktree changes there are owned by the Host-composition leaf.
