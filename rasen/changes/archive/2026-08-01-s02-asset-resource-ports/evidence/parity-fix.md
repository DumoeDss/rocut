# C4 visible-time parity fix

Date: 2026-08-01  
Implementation worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c4`  
Branch: `feat/s02-asset-resource-ports`  
Baseline: `507cecf456ed68007c60829be5c3c41bebf64a5d`

## Root cause and scope

The report-only investigation proved that `TimecodeDisplay` read
`playback.getCurrentTime()` through the general-only `useEditor` subscription.
Animation-frame progression publishes through `playback.onUpdate`, so the visible
time stayed stale until pause issued a general notification.

The repair is intentionally local to the timecode consumer:

- `apps/web/src/preview/components/toolbar.tsx` uses `usePlaybackTime()` for the
  visible current time.
- `apps/web/src/preview/components/use-playback-time.ts` uses
  `useSyncExternalStore` with the playback manager as its stable source.
- `apps/web/src/preview/components/playback-time-subscription.ts` joins the
  general `subscribe` channel and RAF `onUpdate` channel, and releases both
  subscriptions in cleanup.
- `apps/web/src/preview/components/__tests__/timecode-playback-subscription.test.ts`
  locks down both notification paths and exact cleanup.

`useEditor.subscribeAll` and `PlaybackManager.updateTime()` are unchanged, so
unrelated selectors and general subscribers are not awakened at frame cadence.
No protected parity fixture/oracle, type baseline, C1 port, Rust, or generated
WASM file was edited.

## Red / green evidence

Initial test-only run before the subscription module existed:

```text
bun test apps/web/src/preview/components/__tests__/timecode-playback-subscription.test.ts
exit 1
0 pass, 1 fail, 1 error
Cannot find module '../use-playback-time'
```

The focused negative control then removed only the `onUpdate` join while keeping
the completed test and general subscription. This produced the semantic red in
0.1 seconds:

```text
bun test apps/web/src/preview/components/__tests__/timecode-playback-subscription.test.ts
exit 1
0 pass, 1 fail
expected observed [100, 150000], received [100]
```

After restoring the frame channel, the same test passed:

```text
bun test apps/web/src/preview/components/__tests__/timecode-playback-subscription.test.ts
exit 0
1 pass, 0 fail, 8 expectations
```

The test also proves that cleanup leaves both listener sets empty and invokes
each channel's unsubscriber exactly once. The negative-control mutation was
fully reverted before the final checks.

## Related checks

Focused C4 and port batch:

```text
bun test apps/web/src/editor/ports/__tests__/conformance.test.ts apps/web/src/editor/host/__tests__ apps/web/src/fonts/__tests__ apps/web/src/services/renderer/__tests__ apps/web/src/services/transcription/__tests__ apps/web/src/stickers/__tests__/host-assets.test.ts apps/web/src/preview/components/__tests__/timecode-playback-subscription.test.ts
exit 0
45 pass, 0 fail, 259 expectations across 9 files
```

Vite consumer typecheck:

```text
cd apps/vite-example
bun run typecheck
exit 0
tsc --noEmit -p tsconfig.json
```

Whitespace and protected-file invariants:

```text
git diff --check
exit 0 (line-ending conversion warnings only; no whitespace error)

git diff --exit-code 507cecf456ed68007c60829be5c3c41bebf64a5d -- apps/vite-example/tests/parity script/diff-parity-snapshots.mjs script/fixtures/type-baseline.json
exit 0
```

Per assignment, this implementer did not run the full protected parity suite,
did not check task 12.4, did not edit run-state/provenance files, and did not
commit. The authoritative protected Vite/Next rerun remains for the LEAD or an
independent verifier.
