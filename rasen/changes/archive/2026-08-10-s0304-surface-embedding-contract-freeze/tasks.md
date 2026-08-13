## 1. Surface embedding type module

- [x] 1.1 Create `apps/web/src/editor/surface/embedding/types.ts` with the `FocusMode` union (`'passive' | 'focused' | 'full'`), `EditorSurfaceProps` (required `session: EditorSession`; optional `focusMode`, `onFocusModeChange`, `visibility`, `cssNamespace`, `commitBinding`, `onReady`, `onError`, `className`), `SurfaceLifecycleBinding` mapping type, `CssNamespaceStrategy` type, and the opaque `SurfaceCommitBinding` interface
- [x] 1.2 Author `CssNamespaceStrategy` with the three-layer contract: `namespaceAttribute: string` (the `data-editor-surface` value), `containment: 'layout-style-paint'`, and a `noBodyOwnership: true` guarantee flag
- [x] 1.3 Author `SurfaceLifecycleBinding` as a readonly mapping object documenting the five lifecycle transitions (mount→`session.mount`, hidden→`session.suspend`, visible→`session.resume`, unmount→`session.unmount`, dispose→`session.dispose` host-driven) with JSDoc citing the S02 session-types line numbers
- [x] 1.4 Author `SurfaceCommitBinding` as an opaque interface with a single `commit(args: { edit: unknown }): void` method — `unknown` deliberately, so no transaction type is named (per A1=(a)); JSDoc states R1 replaces `unknown` with T0's frozen types
- [x] 1.5 Create `apps/web/src/editor/surface/embedding/index.ts` barrel re-exporting all public types

## 2. Boundary and build verification

- [x] 2.1 Confirm no file outside `apps/web/src/editor/surface/embedding/` is modified (`git diff --name-only` shows only additions under that path)
- [x] 2.2 Run `tsc --noEmit` and confirm zero new type errors (type baseline stays at ceiling 3)
- [x] 2.3 Build the Next Host and confirm it succeeds
- [x] 2.4 Build the Vite Host and confirm it succeeds
- [x] 2.5 Run the parity fixture on both Hosts and confirm the snapshot is unchanged

## 3. Spec-falsification sweep

- [x] 3.1 Grep all 15 existing capability specs for assertions R0's new types could make false: search for `EditorRoot`, `EditorSurface`, `surface`, `focus`, `mount`, `suspend`, `CSS`, `body`, `:root` in `rasen/specs/**/*.md`
- [x] 3.2 Specifically check `editor-session-runtime` for any assertion about what the session lifecycle binds to (R0 consumes, does not redefine, the session)
- [x] 3.3 Specifically check `host-service-boundary` for any assertion about the commit seam (R0 leaves a typed slot, does not define the seam)
- [x] 3.4 Specifically check `next-free-distributable-boundary` for any assertion about mounting requirements (R0's contract must not contradict it)
- [x] 3.5 Record any falsified assertion as a finding in the change's evidence directory; if none are falsified, record that explicitly
