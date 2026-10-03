import { Command, type EditorCommandContext } from "../../base-command";
import type { SceneTracks } from "../../../timeline/types";
import {
	findTrackInSceneTracks,
	updateElementInSceneTracks,
} from "../../../timeline/track-element-update";
import {
	mediaTimeFromSeconds,
	planVideoFreezeFrame,
	type MediaTime,
} from "../../../wasm";

export class ToggleVideoFreezeCommand extends Command {
	readonly routingClass = "transaction" as const;
	private previous: SceneTracks | null = null;

	constructor(
		private readonly options: {
			trackId: string;
			elementId: string;
			playhead: MediaTime;
		},
	) {
		super();
	}

	execute({ editor }: EditorCommandContext): undefined {
		const tracks = editor.scenes.getActiveScene().tracks;
		const track = findTrackInSceneTracks({
			tracks,
			trackId: this.options.trackId,
		});
		const element = track?.elements.find(
			(entry) => entry.id === this.options.elementId,
		);
		if (!element || element.type !== "video")
			throw new Error("Select one video clip to freeze.");
		let freezeFrame: MediaTime | undefined;
		if (element.freezeFrame === undefined) {
			const asset = editor.media
				.getAssets()
				.find((entry) => entry.id === element.mediaId);
			const duration =
				element.sourceDuration ??
				(asset?.duration === undefined
					? undefined
					: mediaTimeFromSeconds({ seconds: asset.duration }));
			if (duration === undefined)
				throw new Error("The video's source duration is unavailable.");
			const planned = planVideoFreezeFrame({
				clipStart: element.startTime,
				clipDuration: element.duration,
				playhead: this.options.playhead,
				trimStart: element.trimStart,
				playbackRate: element.retime?.rate ?? 1,
				sourceDuration: duration,
			});
			if (planned === null)
				throw new Error(
					"Move the playhead inside the selected video clip to freeze a valid source frame.",
				);
			freezeFrame = planned;
		}
		this.previous = tracks;
		editor.timeline.updateTracks(
			updateElementInSceneTracks({
				tracks,
				trackId: this.options.trackId,
				elementId: this.options.elementId,
				update: (entry) =>
					entry.type === "video" ? { ...entry, freezeFrame } : entry,
			}),
		);
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.previous) editor.timeline.updateTracks(this.previous);
	}
}
