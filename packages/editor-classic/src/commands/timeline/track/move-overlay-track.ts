import { Command, type EditorCommandContext } from "../../base-command";
import type { SceneTracks } from "../../../timeline/types";

/** Move visual layers without crossing the fixed main/audio track boundary. */
export class MoveOverlayTrackCommand extends Command {
	readonly routingClass = "transaction" as const;
	private savedState: SceneTracks | null = null;

	constructor(private options: { trackId: string; direction: "up" | "down" }) {
		super();
	}

	execute({ editor }: EditorCommandContext): undefined {
		const tracks = editor.scenes.getActiveScene().tracks;
		const index = tracks.overlay.findIndex(
			(track) => track.id === this.options.trackId,
		);
		const target = index + (this.options.direction === "up" ? -1 : 1);
		if (index < 0 || target < 0 || target >= tracks.overlay.length) {
			throw new Error("The visual layer cannot move past this boundary");
		}
		this.savedState = tracks;
		const overlay = [...tracks.overlay];
		[overlay[index], overlay[target]] = [overlay[target], overlay[index]];
		editor.timeline.updateTracks({ ...tracks, overlay });
		return undefined;
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.savedState) editor.timeline.updateTracks(this.savedState);
	}
}
