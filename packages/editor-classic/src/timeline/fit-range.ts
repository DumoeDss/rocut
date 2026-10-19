import { BASE_TIMELINE_PIXELS_PER_SECOND, TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN } from "./scale";

export function fitTimelineRange({ startSeconds, endSeconds, viewportWidth, minZoom = TIMELINE_ZOOM_MIN }: { startSeconds: number; endSeconds: number; viewportWidth: number; minZoom?: number }) {
	if (![startSeconds, endSeconds, viewportWidth, minZoom].every(Number.isFinite) || startSeconds < 0 || endSeconds <= startSeconds || viewportWidth <= 0) return null;
	const padding = Math.min(24, viewportWidth / 8);
	const zoom = Math.max(minZoom, Math.min(TIMELINE_ZOOM_MAX, (viewportWidth - padding * 2) / ((endSeconds - startSeconds) * BASE_TIMELINE_PIXELS_PER_SECOND)));
	return { zoom, scrollLeft: Math.max(0, startSeconds * BASE_TIMELINE_PIXELS_PER_SECOND * zoom - padding) };
}
