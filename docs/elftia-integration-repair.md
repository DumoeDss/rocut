# Rocut / JIZURA in Elftia: repair and acceptance

Status: in progress. No complete-functionality claim. Started 2026-10-01.

## Required end state

Use elftia-cli against real Elftia to prove the installed plugin works through Creator Studio: navigation, accessible controls, scrolling, file import, timeline edits, preview, save/reopen, and export. Prove JIZURA import, preset selection/application, lyrics/cues/cuts, font/color editing, locks, variations, audio binding/tapping, mixed-media editing, and export. Improve the editor UI without restoring the duplicate host/project/Export/theme header previously removed. Verify wide and constrained panes and light/dark presentation. Do not redefine completion as unit tests or standalone browser success.

## Evidence and current findings

| Area | Evidence | Status |
| --- | --- | --- |
| Real host | elftia-cli attached to existing dev SPA on localhost:5375; installed Rocut 0.5.0 | Owned test project opened through Creator Studio card and Rocut tab; original project not edited |
| Motion panel wheel | Real iframe: 473px viewport / 1124px content; native mouse wheel leaves scrollTop 0 | Root cause: surface-focus unconditionally cancels wheel default |
| Wheel correction | Focused/full mode preserve native descendant scrolling, contain exhausted edges and Ctrl zoom; 8 focused unit tests | Implemented, standalone built probe scrollTop 500; real installed acceptance pending |
| Preset card clipping | Fixed 132px row + width-dependent 16:9 preview hides names at wide pane sizes | Preview height bounded to 80px; screenshot shows names; responsive regression pending |
| Motion insertion | Add action originally below catalog and offscreen | Shared PanelView footer keeps action visible; standalone insertion adds 15-second sequence |
| Visual hierarchy | Vite imports unlayered preflight over layered base styles; invalid missing --font-inter fallback; black borders / inconsistent type | Layered Vite imports, scoped system/CJK fallback, thin scrollbars; screenshot checked |
| Initial layout | Timeline default consumes 50% height even when empty | Changed default to 35%; respects existing persisted layout |
| Media | Real Elftia owned project: fixture MP4 imported through actual iframe file input, persisted attachments 0 → 1, no pageerror; standalone MP4/WAV persist across reload | Broader formats and user-reported failing media still require reproduction; not declared universally fixed |
| Catalog application | Added Rust `apply-preset` mutation and selectable preset cards / explicit Apply action targeting the selected timeline motion-text clip | Full Rust catalog application matrix passes; standalone UI applies Crimson, persists, undoes/redoes, survives reload; real installed candidate pending |
| Project resume | Host serialized resume behind a pending new-project folder picker, preventing entry to the editor | Resume bypasses only the picker lock; regression fails before fix, all 14 tests pass after; actual Creator Studio navigation succeeds |
| Media and timeline controls | Visible, labeled Add buttons in grid/list views; labeled timecode, zoom and timeline actions; selection-only actions disabled without selection | Isolated probe adds media in list view, splits, duplicates, deletes, persists and plays after reload |
| Embedded appearance | Host sends an appearance-only, source/origin-checked theme message; Rocut accepts parent messages without overwriting standalone preferences | Host workspace 16 tests pass; real host handshake and isolated iframe live light/dark updates pass; installed candidate rendering pending |
| Navigation | Standalone probes open preview zoom menu and all asset tabs | Not a full control audit |
| Missing features | Sounds says host lacks server endpoint; Transitions and Adjustment say coming soon | Explicit remaining gaps, not hidden or counted as passing |

## Test ownership and environment

- Main Elftia worktree has pre-existing unrelated changes; preserve them. Scroll/layout fixes were committed/pushed as `1da79e3e`. Subsequent catalog, media-control, host-resume and theme fixes form the next source-only checkpoint; no real plugin replacement has been performed for this repair.
- Rocut source: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut`.
- Plugin producer: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-rocut`.
- Isolated Elftia test folder: main worktree `.tmp-rocut-e2e/project`.
- Test chat session created through real preload: `5b7fd2fa-b386-4f15-ab52-98514193ddd8`, title `Rocut E2E 2026-10-01`; provider/model `e2e-no-generation`, no generation sent.
- The host `pendingCreation` guard was rejecting resumed projects while an earlier folder picker remained pending. The host fix lets validated resume requests proceed without changing the picker guard for new projects. Actual card/tab navigation now works. Do not reopen the folder chooser or kill/restart the user's Elftia.
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
- `C:/Users/Sayo/AppData/Local/Temp/rocut-interactions-ag6y1k`: new catalog UI applies/persists Crimson, keyboard undo/redo persists, reload retains preset; MP4/WAV import and tab inventory pass.
- Main worktree `.tmp-rocut-e2e/import.png`: actual Electron owned-project MP4 import; driver asserts active owned session and that the iframe port belongs to its tool-host project before writing.
- Main worktree `.tmp-rocut-e2e/import-fixture-tone-a4.wav.png`: actual owned-project WAV import, attachment count 1 → 2, no pageerror.
- `C:/Users/Sayo/AppData/Local/Temp/rocut-interactions-Vu1EkB`: catalog apply/undo/redo, list-view media insertion, split/duplicate/delete, reload, playback advance/pause and parent theme handshake/source guard/live switching pass. Optional preset/sound library endpoints return 404. Playback timing success does not prove every rendered frame; an earlier reload-at-zero screenshot was black and needs follow-up.

Host boundary check remains red outside the changed files: `packages/renderer/src/shared/media/readSavedScreenshot.ts` has an unannotated `media://localhost/` reference. No suppression was added.

Current checks: Rust motion-text 80/80 tests; canonical WASM factory seam 21/21 tests; Rocut focused ESLint and Vite typecheck/build pass. Elftia host-resume tests 14/14 and focused ESLint pass; whole `typecheck:web` fails outside the changed files (`provider-presets.test.ts` missing `category`, `decision.ts` unresolved `@omnicross/contracts/logjev`). `check-wasm-source` reports stale generated WASM copies under root/apps-web `node_modules`; synchronize local build dependency artifacts and rerun before packaging. Do not hide this gate or count the current artifact as release-ready. Real-plugin replacement authorization has been requested, not assumed.

The probe is incremental, not the final acceptance gate. Final gate must assert all required behavior, not just collect text. Rebuild after the latest source edits before trusting artifact results.

## Remaining work (do not omit at handoff)

1. Extend actual Creator Studio media coverage beyond the passing MP4 fixture to WAV/images, file-picker interaction, unsupported/corrupt inputs and the user's failing media. Capture actionable errors and failed responses without secrets.
2. Audit pointer/keyboard actions, dialogs, dropdowns, scroll, drag/drop, split/trim/delete/undo/redo, resizing, preview, and save/reopen at several pane sizes. Fix discovered causes, not just click selectors.
3. Complete real-installed acceptance of the new catalog application (including cue-scoped editing UI, mixed locks, preview/render results and undo/redo). Audit all imported JIZURA controls and missing functionality against upstream project.
4. Resolve Transitions/Adjustment placeholders and sound-service capability gap with real behavior or explicit necessary external prerequisites. Do not silently shrink scope by hiding these pages.
5. Finish visual design: coherent host light/dark presentation, balanced panel density, visible focus/scroll, narrow-pane wrapping and popover containment; preserve editor-only embedding.
6. Test export with audio, selected ranges, standard/motion mixed timeline, reopening persisted projects and existing-project migration. Avoid paid model/ASR calls without separate authority.
7. Run relevant types/tests/lint/UTF-8 checks, build a provenance-correct candidate plugin, obtain/confirm real-install scope as needed, then repeat the complete installed Elftia E2E matrix. No version bump or release package yet.
8. Only mark the thread goal complete when full installed functionality and UI requirements are proved. Current fixes and standalone checks are partial progress.
