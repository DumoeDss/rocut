# C5 section 9 Host-composition handoff

Date: 2026-08-02

Status: tasks 9.1–9.10 complete, uncommitted, shared C5 worktree.

## Delivered architecture

- Vite and Next each own one module-stable, explicitly identified
  `BrowserProjectStore` and final-override the reference store.
- Repeated construction in one Host shares the durable store object. Actual
  two-session coverage proves the coordinators/caches remain per-session while
  a committed project is visible through the shared store.
- `EditorHost` roles are required. The protected session files remain byte
  exact by consuming an identity-only `ResolvedEditorHost` alias/resolver in the
  Host module; there is no optional, cast or fallback behavior.
- ProjectPicker uses `EditorCore.persistence`, not an adapter or private store.
- `browser-host-adapter.ts` and the exported `storageService` instance are gone.
- `BOUNDARIES.md` and the port decision record describe the final production
  boundary, not provisional scaffolding.
- `check-host-composition.mjs` supplies a positive production-graph gate and 10
  independent negative controls.
- The session-state gate now knows the real custom-presets factory and derives
  registry cardinality from the canonical inventory.

## Files owned or deliberately touched

- `apps/vite-example/src/host/vite-host-config.ts`
- `apps/vite-example/src/project-picker.tsx`
- `apps/web/src/editor/host/editor-host.ts`
- `apps/web/src/editor/host/editor-host-context.tsx`
- `apps/web/src/editor/host/next-editor-host.ts`
- `apps/web/src/editor/host/__tests__/production-composition.test.ts`
- `apps/web/src/editor/ports/DECISIONS.md`
- `apps/web/src/editor/ports/index.ts` (documentation only)
- `apps/web/src/editor/ports/__tests__/port-roles.compile-guard.ts`
  (documentation only)
- `apps/web/src/editor/session/__tests__/session-lifecycle.test.ts`
- `apps/web/src/services/storage/service.ts`
- deleted `apps/web/src/services/storage/browser-host-adapter.ts`
- `script/check-host-composition.mjs`
- `script/check-session-state-boundary.mjs`
- `script/fixtures/session-state-ownership.json`
- `BOUNDARIES.md`
- this handoff and `evidence/host-composition.md`

Do not reformat or modify the protected `create-session.ts` or
`session-types.ts`; their worktree blobs match HEAD exactly.

## Verification summary

- Host composition: 5/5, 25 expectations.
- Session lifecycle: 40/40, 102 expectations, including once/retry/concurrent
  migration behavior.
- Host/session/port focused group: 33/33 wrapper/direct tests, 179 expectations.
- Composition positive/negative, port boundary, session-state
  positive/negative, type ceiling, diff check and strict Rasen validation pass.
- Exact protected blobs:
  `ee63d7843fa73df6959aa92030bf4871236b6038` and
  `c67d9822a2a6c994be14f367e6980fbbaa6e454b`.

## Required downstream closure

Task group 10 owns `script/check-storage-boundary.mjs` and its negative
fixtures. It still asserts that a provisional adapter must have a user, so it
fails against this deliberately final architecture. Update it to enforce the
production BrowserProjectStore/Host-store model; do not restore the adapter or
weaken the new composition gate.
