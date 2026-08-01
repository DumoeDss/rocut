import type { PlaybackManager } from "@/core/managers/playback-manager";

type PlaybackTimeSource = Pick<
	PlaybackManager,
	"getCurrentTime" | "subscribe" | "onUpdate"
>;

export function subscribeToPlaybackTime(
	playback: PlaybackTimeSource,
	onChange: () => void,
): () => void {
	const unsubscribeGeneral = playback.subscribe(onChange);
	const unsubscribeUpdate = playback.onUpdate(onChange);

	return () => {
		unsubscribeGeneral();
		unsubscribeUpdate();
	};
}
