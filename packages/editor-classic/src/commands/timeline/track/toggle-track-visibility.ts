import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "../../base-command";
import type { SceneTracks } from "../../../timeline";
import {
	canTrackBeHidden,
	findTrackInSceneTracks,
	updateTrackInSceneTracks,
} from "../../../timeline";

export class ToggleTrackVisibilityCommand extends Command {
	readonly routingClass = "transaction" as const;

	private savedState: SceneTracks | null = null;

	constructor(private trackId: string) {
		super();
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedState = editor.scenes.getActiveScene().tracks;

		const targetTrack = findTrackInSceneTracks({
			tracks: this.savedState,
			trackId: this.trackId,
		});
		if (!targetTrack) {
			return;
		}

		const updatedTracks = updateTrackInSceneTracks({
			tracks: this.savedState,
			trackId: this.trackId,
			update: (track) => {
				if (canTrackBeHidden(track)) {
					return { ...track, hidden: !track.hidden };
				}
				return track;
			},
		});

		editor.timeline.updateTracks(updatedTracks);
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.savedState) {
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
