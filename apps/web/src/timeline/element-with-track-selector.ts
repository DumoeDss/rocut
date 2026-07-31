import type { EditorCore } from "@/core";
import type { ElementRef, TimelineElement, TimelineTrack } from "./types";

/**
 * Flattens TimelineManager's allocation-heavy match wrapper into stable refs.
 * `useEditor` shallow-compares tuple members, so repeated snapshots remain
 * cacheable while either the owning track or element still updates reactively.
 */
export function selectElementWithTrackTuple({
	editor,
	elements,
}: {
	editor: EditorCore;
	elements: ElementRef[];
}): readonly [TimelineTrack | null, TimelineElement | null] {
	if (elements.length !== 1) return [null, null];
	const match = editor.timeline.getElementsWithTracks({ elements })[0];
	return [match?.track ?? null, match?.element ?? null];
}
