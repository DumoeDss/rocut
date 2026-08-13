import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "../../base-command";
import type { SceneTracks } from "../../../timeline";
import {
	canTrackHaveAudio,
	findTrackInSceneTracks,
	updateTrackInSceneTracks,
} from "../../../timeline";

export class ToggleTrackMuteCommand extends Command {
	readonly routingClass = "provider-private" as const;

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
			update: (track) =>
				canTrackHaveAudio(track) ? { ...track, muted: !track.muted } : track,
		});

		editor.timeline.updateTracks(updatedTracks);
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.savedState) {
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
