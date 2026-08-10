import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "@/commands/base-command";
import type { TScene } from "@/timeline";
import { updateSceneInArray } from "@/timeline/scenes";
import {
	getFrameTime,
	removeBookmarkFromArray,
} from "@/timeline/bookmarks/index";
import { type MediaTime, ZERO_MEDIA_TIME } from "@/wasm";

export class RemoveBookmarkCommand extends Command {
	readonly routingClass = "transaction" as const;

	private savedScenes: TScene[] | null = null;
	private frameTime: MediaTime = ZERO_MEDIA_TIME;

	constructor(private time: MediaTime) {
		super();
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		const activeScene = editor.scenes.getActiveScene();
		const activeProject = editor.project.getActive();

		if (!activeScene || !activeProject) {
			return;
		}

		const scenes = editor.scenes.getScenes();
		this.savedScenes = [...scenes];

		this.frameTime = getFrameTime({
			time: this.time,
			fps: activeProject.settings.fps,
		});

		const updatedBookmarks = removeBookmarkFromArray({
			bookmarks: activeScene.bookmarks,
			frameTime: this.frameTime,
		});

		if (updatedBookmarks.length === activeScene.bookmarks.length) {
			return;
		}

		const updatedScenes = updateSceneInArray({
			scenes,
			sceneId: activeScene.id,
			updates: { bookmarks: updatedBookmarks },
		});

		editor.scenes.setScenes({ scenes: updatedScenes });
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.savedScenes) {
			editor.scenes.setScenes({ scenes: this.savedScenes });
		}
	}
}
