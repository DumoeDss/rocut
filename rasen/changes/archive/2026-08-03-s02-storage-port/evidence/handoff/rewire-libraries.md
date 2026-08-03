# C5 libraries/UI consumer implementer handoff

Status: tasks 8.7, 8.8 and 8.9 complete; the libraries/storage-provider portion of 8.13 is green, but 8.13 remains unchecked pending combined core failure-path repair. The shared C5 worktree remains uncommitted.

## Product changes

- `EditorCore.persistence` is acquired lazily by the existing session-store registry. No public `EditorSession` shape or second persistence owner was added.
- The registry now contains ten distinct StoreApi instances, adding `customPresets`; ownership inventory and isolation expectations were updated and the session-state gate is green.
- Saved sounds and graph presets use separate coordinator library namespaces, serialize same-family mutations, retain provider-private siblings through the coordinator codec, and never publish success before durability.
- `StorageProvider` exposes the existing coordinator/Host store, inspection/capacity, refresh, `clearProjects`, and `clearAll`; its diagnostics are logical and payload-free.
- Coordinator namespace clear is conflict-aware: same-namespace record operations and clear are ordered, different namespaces remain independent, and snapshots are invalidated only after durable success.

## Verification

- Focused async libraries: 7/7 tests, 51 expectations.
- Coordinator opaque/isolation suite: 4/4 tests, 32 expectations.
- Session state suite: green.
- Type baseline: exactly three inherited diagnostics, no new identity.
- Session-state boundary: 10/10 factories and keys, 52 classified imperative modules.
- Strict Rasen validation and `git diff --check`: green.
- Storage boundary currently has only the concurrent section-9 transition red: its old positive rule still requires a `BrowserHostAdapter` user after that adapter was intentionally retired.

## Finalizer obligations

1. Add the real-browser legacy saved-sounds clear regression in `services/storage/browser-project-store-conformance.ts` plus the existing C5 harness assertion: legacy raw `user-sounds` loads once, namespace clear removes it, later load is null, preset namespace survives.
2. Run task 8.14's combined focused consumer family after all core/Host leaves stop editing.
3. Run the updated canonical storage boundary after the section-9 rule switches from provisional-adapter presence to final BrowserProjectStore composition.
4. Finish 8.13 in the core consumer delta. Current review targets include raw-error/silent-resolution catches in `project-manager.ts` (save-current, list, delete, rename), `media-manager.ts` (save/load), `scenes-manager.ts` (load), and media command undo/failure paths. Require payload-free session diagnostics, a visible retry/recovery state, and rejection/no false in-memory success before checking the task.

No browser storage mechanism, Host root, core manager/media command, protected parity fixture, public port, PATCHES, inventory, runstate, portfolio, or commit was changed by this leaf except the independently approved internal coordinator `clearLibraryNamespace` method.
