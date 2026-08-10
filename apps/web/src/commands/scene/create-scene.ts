import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "@/commands/base-command";
import type { TScene } from "@/timeline";
import { buildDefaultScene } from "@/timeline/scenes";

export class CreateSceneCommand extends Command {
	readonly routingClass = "provider-private" as const;

	private savedScenes: TScene[] | null = null;
	private createdScene: TScene | null = null;

	constructor({ name, isMain = false }: { name: string; isMain?: boolean }) {
		super();
		this.name = name;
		this.isMain = isMain;
	}

	private name: string;
	private isMain: boolean;

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedScenes = [...editor.scenes.getScenes()];

		this.createdScene = buildDefaultScene({
			name: this.name,
			isMain: this.isMain,
		});

		const updatedScenes = [...this.savedScenes, this.createdScene];
		editor.scenes.setScenes({ scenes: updatedScenes });
		return undefined;
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.savedScenes) {
			editor.scenes.setScenes({ scenes: this.savedScenes });
		}
	}

	getSceneId(): string {
		return this.createdScene?.id ?? "";
	}
}
