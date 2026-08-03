# C5 section 7 implementer handoff

Status: complete, uncommitted, shared C5 worktree.

## Files owned

- `apps/web/src/editor/persistence/opaque-value.ts`
- `apps/web/src/editor/persistence/project-codec.ts`
- `apps/web/src/editor/persistence/session-persistence-coordinator.ts`
- `apps/web/src/editor/persistence/index.ts`
- `apps/web/src/editor/persistence/__tests__/opaque-roundtrip.test.ts`
- `rasen/changes/s02-storage-port/evidence/opaque-roundtrip.md`
- this handoff

## Consumer integration contract for section 8

Construct exactly one `SessionPersistenceCoordinator` per editor session from that session's accepted `host.store`. Inject the same instance into project/media/scenes managers and durable sound/preset consumers. Do not create a second store/context or import a browser service.

- Projects: `loadProject`, `saveProject`, `removeProject`, `listProjects`.
- Media attachments: call `loadAttachment` with a decoder that returns only known media metadata, then `saveAttachment`; the retained snapshot preserves provider-private siblings and bytes remain defensive.
- Sounds/presets: call `loadLibraryRecord` with the namespace codec's known projection, then `saveLibraryRecord`; identified members retain private siblings by id.
- UI success: update manager/UI state only after the coordinator promise resolves. Rejections are intentionally not swallowed.
- Lifecycle: call `destroy()` when the owning session is disposed. Resource teardown semantics beyond local state clearing remain C6.

The coordinator intentionally does not edit the C1/C5 port contract, Host roots, session public API, browser mechanics, or the nine consumers. Section 8 owns that wiring.

## Verification

- Focused isolated suite: 4/4, 32 assertions.
- ESLint and Prettier: clean.
- Session/storage/port boundaries: clean.
- Strict Rasen validation and diff check: clean.
- Type baseline: clean, exactly three current diagnostics and no identity outside the pinned inherited set.

No commit was created.
