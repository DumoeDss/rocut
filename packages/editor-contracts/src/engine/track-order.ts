import type { Track, TrackId } from "../domain";

/** Structural transaction reduction shared by the durable engine and its fake. */
export function orderedTracks({
	tracks,
	ids,
}: {
	tracks: ReadonlyMap<TrackId, Track>;
	ids: readonly TrackId[];
}): Track[] | null {
	if (
		!Array.isArray(ids) ||
		ids.length !== tracks.size ||
		new Set(ids).size !== ids.length
	)
		return null;
	const result: Track[] = [];
	for (const id of ids) {
		const track = tracks.get(id);
		if (!track) return null;
		result.push(track);
	}
	return result;
}
