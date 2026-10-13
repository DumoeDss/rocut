# Preview playback starvation fix — 2026-10-13

## Cause and behavior

The installed 0.6.4 Surface cancelled its in-flight preview request whenever the
playback clock crossed a frame boundary. Both the playback update subscription
and the RAF busy path did this. Asynchronous programmatic/frame preparation that
took longer than the 30 fps frame interval could repeatedly be cancelled before
publication. Pausing stopped the clock and allowed a frame to finish.

Preview invalidation now distinguishes time progression from ownership/content
invalidation:

- Ordinary playback lets the single in-flight frame finish. The next RAF submits
  the latest time, dropping intermediate frames rather than queuing them.
- Explicit seeks, including same-frame seeks, cancel the pending request.
- Render-tree replacement, preview revision changes, session suspension and
  component/renderer cleanup still cancel it. Renderer publication guards remain
  intact.

The shared policy is in
`packages/editor-classic/src/preview/components/preview-render-invalidation.ts`;
both subscription and RAF paths in `index.tsx` use it.

## Validation

- 24 tests passed across preview invalidation, timecode subscriptions, resource
  notices, performance observation, async render cancellation and canvas
  publication. The canvas boundary test also invokes its isolated child suite.
- Vite-example TypeScript check passed.
- Focused ESLint passed using an existing dependency installation with a
  byte-identical `eslint.config.mjs`; no dependencies were reinstalled.
- Focused Prettier check and `git diff --check` passed.
- Production Surface built with the same core WASM as the installed plugin:
  `f9c69798a7642ee9bb8cbf9b1e416406b8ed55312f9de8dca2281761fc91fb7d`.

The repaired Surface was installed through Elftia's normal local-plugin installer
and reopened using its real workspace recovery button. Only the owned `gunjou`
daemon was stopped; Elftia itself was not restarted. Runtime, main, skills and
core WASM were retained. Installation preparation additionally verified prior
epkg text newline normalization and restored seven tslib files to their exact
producer-pinned CRLF bytes in the candidate, without changing their text content.
The candidate passed the complete plugin-tree/toolchain validation.

Installed UI acceptance used the 1080p/30 fps `gunjou` project, revision 125:

- The playhead advanced from `00:00:29:16` to `00:00:38:12`.
- All four samples taken while playing had distinct preview canvas screenshots.
- 27 render submissions completed during playback, with no cancellations in
  those recorded samples. The paused final sample recorded 30/30 completions.
- No preview console/page errors; project revision remained 125.
- The previously active chat tab was restored after the test. No chat message
  was sent, no project edit was made, and no paid service was used.

The normal editor-close path refreshes the thumbnail/updatedAt metadata, so the
project file's byte hash changed during the daemon stop. The committed edit
revision remained 125; this is not a claim of unchanged project-file bytes.

Evidence is retained in the local production project's `mv/qa/` directory as
`live-preview-before-fix.json`, `live-preview-after-fix.json`,
`preview-fix-preparation.json` and installation receipts.

## Limits

This validates the installed playback-freeze repair, not full MV creation through
the Creator Studio agent and not a new versioned release. The complex scene still
renders at approximately 3 fps on this machine during the instrumented test;
continuous updates do not constitute a 30 fps performance claim. Export was not
re-run because its path and runtime bytes were unchanged.
