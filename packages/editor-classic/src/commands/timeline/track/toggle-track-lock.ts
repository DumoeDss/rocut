import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "../../base-command";
import { updateTrackInSceneTracks, type SceneTracks } from "../../../timeline";

export class ToggleTrackLockCommand extends Command {
	readonly routingClass = "transaction" as const;
	private savedState: SceneTracks | null = null;
	constructor(private trackId: string) {
		super();
	}
	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedState = editor.scenes.getActiveScene().tracks;
		editor.timeline.updateTracks(
			updateTrackInSceneTracks({
				tracks: this.savedState,
				trackId: this.trackId,
				update: (track) => ({ ...track, locked: !track.locked }),
			}),
		);
		return undefined;
	}
	undo({ editor }: EditorCommandContext): void {
		if (this.savedState) editor.timeline.updateTracks(this.savedState);
	}
}
