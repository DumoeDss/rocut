import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "@/commands/base-command";
import type { SceneTracks } from "@/timeline";

export class RemoveTrackCommand extends Command {
	readonly routingClass = "transaction" as const;

	private savedState: SceneTracks | null = null;

	constructor(private trackId: string) {
		super();
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedState = editor.scenes.getActiveScene().tracks;
		const updatedTracks: SceneTracks = {
			...this.savedState,
			overlay: this.savedState.overlay.filter(
				(track) => track.id !== this.trackId,
			),
			audio: this.savedState.audio.filter((track) => track.id !== this.trackId),
		};
		editor.timeline.updateTracks(updatedTracks);
		return undefined;
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.savedState) {
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
