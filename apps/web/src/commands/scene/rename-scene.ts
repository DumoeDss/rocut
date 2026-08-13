import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "@/commands/base-command";
import type { TScene } from "@/timeline";
import { updateSceneInArray } from "@/timeline/scenes";

export class RenameSceneCommand extends Command {
	readonly routingClass = "provider-private" as const;

	private savedScenes: TScene[] | null = null;
	private previousName: string | null = null;

	constructor({ sceneId, newName }: { sceneId: string; newName: string }) {
		super();
		this.sceneId = sceneId;
		this.newName = newName;
	}

	private sceneId: string;
	private newName: string;

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		const scenes = editor.scenes.getScenes();

		this.savedScenes = [...scenes];

		const scene = scenes.find((s) => s.id === this.sceneId);
		if (!scene) {
			console.error("Scene not found:", this.sceneId);
			return;
		}

		this.previousName = scene.name;

		const updatedScenes = updateSceneInArray({
			scenes,
			sceneId: this.sceneId,
			updates: { name: this.newName, updatedAt: new Date() },
		});

		editor.scenes.setScenes({ scenes: updatedScenes });
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.savedScenes && this.previousName !== null) {
			editor.scenes.setScenes({ scenes: this.savedScenes });
		}
	}
}
