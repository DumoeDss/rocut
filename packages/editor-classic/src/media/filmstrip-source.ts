import type { VideoElement } from "../timeline/types";
import { resolveVideoSourceTime } from "../wasm/video-time";
import { TICKS_PER_SECOND } from "../wasm";

/** Translate UI pixels to clip time before asking the shared source-time policy. */
export function resolveFilmstripSourceTime({
	element,
	offset,
	pixelsPerSecond,
}: {
	element: VideoElement;
	offset: number;
	pixelsPerSecond: number;
}) {
	if (!(pixelsPerSecond > 0) || element.duration <= 0) return null;
	return resolveVideoSourceTime({
		clipTime: Math.min(
			element.duration - 1,
			Math.round((offset / pixelsPerSecond) * TICKS_PER_SECOND),
		),
		trimStart: element.trimStart,
		playbackRate: element.retime?.rate ?? 1,
		freezeFrame: element.freezeFrame,
		reverse: element.retime?.reverse,
		clipDuration: element.duration,
		sourceDuration: element.sourceDuration,
	});
}
