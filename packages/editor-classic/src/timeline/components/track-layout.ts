import type { TrackType } from "..";
import {
	KEYFRAME_LANE_HEIGHT_PX,
	TIMELINE_TRACK_GAP_PX,
	TIMELINE_TRACK_HEIGHTS_PX,
} from "./layout";

export function getTrackHeight({ type, heightScale = 1 }: { type: TrackType; heightScale?: number }): number {
	return Math.round(TIMELINE_TRACK_HEIGHTS_PX[type] * (Number.isFinite(heightScale) ? Math.max(0.8, Math.min(2, heightScale)) : 1));
}

export function getExpandedTrackHeight({
	type,
	expandedLaneCount,
	heightScale,
}: {
	type: TrackType;
	expandedLaneCount: number;
	heightScale?: number;
}): number {
	return (
		getTrackHeight({ type, heightScale }) +
		expandedLaneCount * KEYFRAME_LANE_HEIGHT_PX
	);
}

export function getCumulativeHeightBefore({
	tracks,
	trackIndex,
	getExtraHeight,
	heightScale,
}: {
	tracks: Array<{ type: TrackType }>;
	trackIndex: number;
	getExtraHeight?: (trackIndex: number) => number;
	heightScale?: number;
}): number {
	return tracks
		.slice(0, trackIndex)
		.reduce(
			(sum, track, i) =>
				sum +
				getTrackHeight({ type: track.type, heightScale }) +
				(getExtraHeight?.(i) ?? 0) +
				TIMELINE_TRACK_GAP_PX,
			0,
		);
}

export function getTotalTracksHeight({
	tracks,
	getExtraHeight,
	heightScale,
}: {
	tracks: Array<{ type: TrackType }>;
	getExtraHeight?: (trackIndex: number) => number;
	heightScale?: number;
}): number {
	const tracksHeight = tracks.reduce(
		(sum, track, i) =>
			sum + getTrackHeight({ type: track.type, heightScale }) + (getExtraHeight?.(i) ?? 0),
		0,
	);
	const gapsHeight = Math.max(0, tracks.length - 1) * TIMELINE_TRACK_GAP_PX;
	return tracksHeight + gapsHeight;
}
