# C6 fix round 2 — emitted resource-boundary remediation

Date: 2026-08-04 +08:00  
Leaf: bounded emitted-resource-boundary only  
Product worktree: `E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut-wt-c6`

## Remediation

- `script/check-session-resource-boundary.mjs` now validates exact emitted
  entries (`vite-host-config.ts` or `next-editor-host.ts`, plus
  `editor/session/create-session.ts`) and every mandated editor root.
- `script/collect-next-editor-module-ids.mjs` follows the Next
  `/editor/[project_id]/page` client-reference manifest, route NFT, referenced
  SSR/client chunks, and their source maps. It does not require the unavailable
  `.next/module-graph.json`.
- The source boundary now includes `no-unkeyed-compositor` and
  `no-second-acquisition-mediator` alongside the five existing acquisition
  rules. Negative fixtures assert both rule ID and expected path; positive
  mediated/keyed controls are also present.
- Empty, missing-root, truncated-but-nonempty emitted graphs, and truncated
  source inventories fail closed. The emitted lower bound is applied to both
  total IDs and attributable source IDs, so unrelated package-ID padding cannot
  make a one-file-per-root graph pass. The negative-control command exercises
  each case.

## Verification

Commands run from the product worktree:

```text
node script/check-session-resource-boundary.mjs
node script/check-session-resource-boundary.mjs --negative-control
C6_VITE_DIST=apps/vite-example/dist-c6-fix1-vite-20260804-3 C6_NEXT_DIST=apps/web/.next node script/check-session-resource-boundary.mjs
bun test script/__tests__/c6-session-resource-boundary.test.mjs
bunx prettier --check script/check-session-resource-boundary.mjs script/collect-next-editor-module-ids.mjs script/__tests__/c6-session-resource-boundary.test.mjs
node --check script/check-session-resource-boundary.mjs
node --check script/collect-next-editor-module-ids.mjs
node --check script/__tests__/c6-session-resource-boundary.test.mjs
```

Results:

- Source gate: 711 web modules; all 15 required roots non-zero; all seven rule
  IDs pass with zero violations.
- Negative gate: every rule/path fixture, every omitted-root control,
  truncated source inventory, truncated emitted graph, and missing-root graph
  control passed; command ended with `C6 session-resource boundary negative
  controls clean`.
- Fresh Vite output: 2,889 module IDs, 590 web-source IDs, exact Vite Host and
  `create-session.ts` entries, non-empty asset build marker, all roots complete.
- Fresh Next output: 82 attributable files, 78 source maps, 2,557 normalized
  module IDs (596 source IDs), non-empty `BUILD_ID`, exact Next Host and
  `create-session.ts` entries, all roots complete. Normalized mandated-root
  counts are `components/editor=24`, `preview=25`, `selection=11`,
  `timeline=98`, `sounds=3`, `export=3`, `utils=8`, `core=13`, `editor=32`,
  `media=11`, `retime=6`, `services/renderer=22`,
  `services/transcription=1`, `services/video-cache=1`,
  `services/waveform-cache=1`.
  The total is intentionally larger than the prior map-only audit because the
  collector also retains manifest IDs and all route-mapped SSR/client files;
  the mandated source-root counts are the attributable boundary assertion.
- Focused Bun suite: 5 tests passed, 0 failed, 45 assertions passed.
- Prettier and all three Node syntax checks passed.

## Scope/caveat

Only the checker, its focused test, the narrowly named Next inventory helper,
and this evidence file were changed for this leaf. No app product source,
protected C5 artifact, task/reviewer artifact, commit, ship, or cleanup action
was performed. The recorded Vite asset marker in the supplied `fix1-vite-3`
directory is `development`; the checker records it but relies on the emitted
module graph's generated topology and exact entries rather than treating that
legacy marker field as the module-boundary inventory.
