# R2 implementer successor #10 handoff — 2026-08-12

## Status

**HANDOFF.** The nine requested React 18 compatibility source adaptations are applied across nine files. Runtime behavior is preserved: mutable callback refs retain nullable DOM state, Shift reads default only a type-level null to `false`, and JSX-facing ref props now match the React 18 `useRef<HTMLDivElement>(null)` objects supplied by their inspected call sites. The canonical type baseline was attempted but command execution required approval and did not run, so type evidence remains for LEAD.

## Exact changed paths and rationale

1. `apps/web/src/preview/components/index.tsx`
   - Changed the callback-assigned `containerRef` initializer to `useRef<HTMLDivElement | null>(null)`.
   - React 18 selects a mutable ref overload when `null` belongs to the generic, allowing the existing `containerRef.current = node` assignment without changing callback-ref/fullscreen behavior.
2. `apps/web/src/preview/hooks/use-preview-interaction.ts`
3. `apps/web/src/preview/hooks/use-transform-handles.ts`
4. `apps/web/src/timeline/hooks/element/use-element-interaction.ts`
5. `apps/web/src/timeline/hooks/use-timeline-playhead.ts`
6. `apps/web/src/timeline/hooks/use-timeline-resize.ts`
   - Changed each controller-facing Shift reader from `isShiftHeldRef.current` to `isShiftHeldRef.current ?? false`.
   - `useShiftKey` was inspected: it initializes to `false`, writes only booleans, and resets on blur. The fallback therefore preserves all reachable runtime behavior while satisfying React 18's `RefObject<boolean>.current` nullability.
7. `apps/web/src/timeline/components/index.tsx`
   - Narrowed `TrackLabelsPanel`'s two JSX ref prop declarations to `React.RefObject<HTMLDivElement>`.
   - Both call sites were inspected and pass refs created by `useRef<HTMLDivElement>(null)`, which is the React 18-compatible shape accepted by intrinsic `ref`.
8. `apps/web/src/timeline/components/timeline-element.tsx`
   - Narrowed `ExpandedKeyframeLanes.containerRef` to `React.RefObject<HTMLDivElement>`.
   - The call site was inspected: `useKeyframeBoxSelect` creates the supplied ref with `useRef<HTMLDivElement>(null)`.
9. `apps/web/src/timeline/components/timeline-playhead.tsx`
   - Narrowed optional `TimelinePlayheadProps.playheadRef` to `React.RefObject<HTMLDivElement>`.
   - The external call site and internal fallback both use `useRef<HTMLDivElement>(null)`; downstream reads remain nullable through React 18's ref definition.

No dependency manifest or lock file was edited. No public Surface/lifecycle/transaction/Host boundary was widened. Inherited coordinator edits visible in two timeline hooks were preserved and not authored or reverted here.

## Inspection performed

Before editing, inspected:

- `useShiftKey` implementation and every requested adapter context;
- `useFullscreen` and the callback-ref assignment;
- `TrackLabelsPanel` ref declarations plus their `useRef` producers;
- `useKeyframeBoxSelect` plus the expanded-lanes call site;
- `TimelinePlayhead` external ref call site, internal fallback, and hook handoff;
- nearby ref consumers such as `useContainerSize`.

A semantic scoped diff was reviewed with `git diff --ignore-space-at-eol`; it shows the nine intended adaptations, plus inherited pre-existing Surface drag coordinator changes in `use-element-interaction.ts` and `use-timeline-resize.ts` that were deliberately preserved.

## Gates attempted

1. `node script/check-type-baseline.mjs`
   - **Not run:** executable command required approval through the bridge.
2. Scoped `git diff --check -- <nine edited paths>`
   - **Failed:** reported CR-at-EOL/trailing-whitespace across the already dirty `apps/web/src/preview/components/index.tsx` diff (output was truncated after many such lines).
   - I did not normalize the file because the assignment explicitly forbids unrelated EOL normalization. A semantic diff confirmed the requested change itself is one line.
3. Scoped semantic diff inspection
   - **Completed:** confirmed only the requested compatibility adaptations from this relay; inherited dirty work remains intact.

## Remaining work for LEAD

1. Run `node script/check-type-baseline.mjs` and confirm all nine newly reported React 18 diagnostics are gone while the accepted baseline remains unchanged.
2. Run the project's intended EOL-aware scoped whitespace check (the plain scoped `git diff --check` is noisy on inherited CRLF/dirty content).
3. If type baseline reveals another React 18 variance, adapt only the exact failing private prop/type; do not widen public Surface/lifecycle/transaction/Host boundaries.
4. Preserve dependency manifests, lock, unrelated dirty work, and final evidence until the owning phase.

## Constraints observed

- Worked only in the existing rocut worktree/branch.
- No subagents, workflow, worktree creation, commit, index mutation, push, archive, T4, or `.rasen` run-state mutation.
- React 18 was not reverted.
- No final evidence was touched other than this required durable handoff.
