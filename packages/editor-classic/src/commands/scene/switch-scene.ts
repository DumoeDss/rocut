import { Command, type EditorCommandContext } from "../base-command";

export class SwitchSceneCommand extends Command {
	readonly routingClass = "transaction" as const;

	constructor(private readonly sceneId: string) {
		super();
	}

	execute({ editor }: EditorCommandContext) {
		const scenes = editor.scenes.getScenes();
		if (!scenes.some((scene) => scene.id === this.sceneId)) {
			throw new Error("Scene not found");
		}
		editor.scenes.setScenes({ scenes, activeSceneId: this.sceneId });
		return undefined;
	}
}
