import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "@/commands/base-command";
import type { SceneTracks } from "@/timeline";

export class TracksSnapshotCommand extends Command {
	constructor({ before, after }: { before: SceneTracks; after: SceneTracks }) {
		super();
		this.before = before;
		this.after = after;
	}

	private before: SceneTracks;
	private after: SceneTracks;

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		editor.timeline.updateTracks(this.after);
		return undefined;
	}

	undo({ editor }: EditorCommandContext): void {
		editor.timeline.updateTracks(this.before);
	}
}
