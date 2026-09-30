# Rocut / JIZURA in Elftia: repair and acceptance

Status: in progress. No complete-functionality claim. Started 2026-10-01.

## Required end state

Use elftia-cli against real Elftia to prove the installed plugin works through Creator Studio: navigation, accessible controls, scrolling, file import, timeline edits, preview, save/reopen, and export. Prove JIZURA import, preset selection/application, lyrics/cues/cuts, font/color editing, locks, variations, audio binding/tapping, mixed-media editing, and export. Improve the editor UI without restoring the duplicate host/project/Export/theme header previously removed. Verify wide and constrained panes and light/dark presentation. Do not redefine completion as unit tests or standalone browser success.

## Evidence and current findings

| Area | Evidence | Status |
| --- | --- | --- |
| Real host | elftia-cli attached to existing dev SPA on localhost:5375; installed Rocut 0.5.0; creator-studio-test project | Baseline inspected only; original project not edited |
| Motion panel wheel | Real iframe: 473px viewport / 1124px content; native mouse wheel leaves scrollTop 0 | Root cause: surface-focus unconditionally cancels wheel default |
| Wheel correction | Focused/full mode preserve native descendant scrolling, contain exhausted edges and Ctrl zoom; 8 focused unit tests | Implemented, standalone built probe scrollTop 500; real installed acceptance pending |
| Preset card clipping | Fixed 132px row + width-dependent 16:9 preview hides names at wide pane sizes | Preview height bounded to 80px; screenshot shows names; responsive regression pending |
| Motion insertion | Add action originally below catalog and offscreen | Shared PanelView footer keeps action visible; standalone insertion adds 15-second sequence |
| Visual hierarchy | Vite imports unlayered preflight over layered base styles; invalid missing --font-inter fallback; black borders / inconsistent type | Layered Vite imports, scoped system/CJK fallback, thin scrollbars; screenshot checked |
| Initial layout | Timeline default consumes 50% height even when empty | Changed default to 35%; respects existing persisted layout |
| Media | Standalone real installed backend + rebuilt UI imports fixture MP4/WAV, persists attachments across reload | User-reported failure in Elftia still requires reproduction; not declared fixed |
| Navigation | Standalone probes open preview zoom menu and all asset tabs | Not a full control audit |
| Missing features | Sounds says host lacks server endpoint; Transitions and Adjustment say coming soon | Explicit remaining gaps, not hidden or counted as passing |

## Test ownership and environment

- Main Elftia worktree has pre-existing unrelated changes; preserve them. The current source fixes are being committed/pushed at the user's request; no real plugin replacement has been performed for this repair.
- Rocut source: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`.
- Plugin producer: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-rocut`.
- Isolated Elftia test folder: main worktree `.tmp-rocut-e2e/project`.
- Test chat session created through real preload: `5b7fd2fa-b386-4f15-ab52-98514193ddd8`, title `Rocut E2E 2026-10-01`; provider/model `e2e-no-generation`, no generation sent.
- Elftia's new-project folder chooser no longer blocks the page (`newDisabled: false`). Refreshing and opening the owned test project card succeeded, but waiting for `[data-workspace-id="rocut"]` timed out. Inspect the current session/navigation error before retrying; do not reopen the folder chooser or kill/restart the user's Elftia.
- Existing `creator-studio-test` session is not test-owned; do not import or edit its project.
- Main worktree `.tmp-rocut-e2e.ts` uses the elftia-cli connection API for actual renderer/iframe probes. CDP returns an empty frame URL for the loaded Rocut frame; select via verified document title/DOM, never assume only nonempty frame URLs are real.
- Never print editorUrl or registry secrets: authenticated URLs contain bearer tokens.

## Reproducible verification

```powershell
bun test packages/editor-classic/src/editor/surface/embedding/__tests__/surface-focus.test.ts
$env:OPENCUT_PUBLIC_BASE='./'
# run in apps/vite-example
bun run build
# run in Rocut root; isolated backend/project, NOT a real-host acceptance substitute
node script/probe-embedded-interactions.mjs 'C:/Users/Sayo/.elftia/plugins/rocut' apps/vite-example/dist
```

Probe evidence directories (temporary generated artifacts):

- `C:/Users/Sayo/AppData/Local/Temp/rocut-interactions-3fJW1O`: first successful wheel/insertion/media screenshots.
- `C:/Users/Sayo/AppData/Local/Temp/rocut-interactions-fvp2e3`: menu, reload + second import, tab inventory; optional absent library entries returned 404.

The probe is incremental, not the final acceptance gate. Final gate must assert all required behavior, not just collect text. Rebuild after the latest source edits before trusting artifact results.

## Remaining work (do not omit at handoff)

1. Resume the isolated project through actual Creator Studio; reproduce media error in Electron with local MP4, WAV, image fixtures and file-picker interaction. Capture actionable errors and failed responses without secrets.
2. Audit pointer/keyboard actions, dialogs, dropdowns, scroll, drag/drop, split/trim/delete/undo/redo, resizing, preview, and save/reopen at several pane sizes. Fix discovered causes, not just click selectors.
3. Make JIZURA presets usable (catalog is currently preview-only articles); retain Rust-owned mutation semantics, provenance, cue/group locks, and revision handling. Audit all imported JIZURA controls and missing functionality against upstream project.
4. Resolve Transitions/Adjustment placeholders and sound-service capability gap with real behavior or explicit necessary external prerequisites. Do not silently shrink scope by hiding these pages.
5. Finish visual design: coherent host light/dark presentation, balanced panel density, visible focus/scroll, narrow-pane wrapping and popover containment; preserve editor-only embedding.
6. Test export with audio, selected ranges, standard/motion mixed timeline, reopening persisted projects and existing-project migration. Avoid paid model/ASR calls without separate authority.
7. Run relevant types/tests/lint/UTF-8 checks, build a provenance-correct candidate plugin, obtain/confirm real-install scope as needed, then repeat the complete installed Elftia E2E matrix. No version bump or release package yet.
8. Only mark the thread goal complete when full installed functionality and UI requirements are proved. Current fixes and standalone checks are partial progress.
