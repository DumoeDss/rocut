import type { SceneTracks, TimelineTrack } from "../../timeline/types";

/** Editor track rows are top-first; canvas drawing is bottom-first. */
export function visibleTracksBottomToTop({ tracks }: { tracks: SceneTracks }) {
	return [...tracks.overlay, tracks.main]
		.filter((track) => !track.hidden)
		.reverse();
}

/** Shared UI draw order; codepoint comparison makes offline proofs locale-independent. */
export function visibleElementsInDrawOrder({
	track,
}: {
	track: TimelineTrack;
}) {
	return track.elements
		.filter((element) => !("hidden" in element && element.hidden))
		.slice()
		.sort((left, right) =>
			left.startTime !== right.startTime
				? left.startTime - right.startTime
				: left.id < right.id
					? -1
					: left.id > right.id
						? 1
						: 0,
		);
}
