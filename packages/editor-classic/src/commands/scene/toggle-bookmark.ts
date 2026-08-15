import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "../base-command";
import type { TScene } from "../../timeline";
import { updateSceneInArray } from "../../timeline/scenes";
import {
	getFrameTime,
	toggleBookmarkInArray,
} from "../../timeline/bookmarks";
import { type MediaTime, ZERO_MEDIA_TIME } from "../../wasm";

export class ToggleBookmarkCommand extends Command {
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

		const updatedBookmarks = toggleBookmarkInArray({
			bookmarks: activeScene.bookmarks,
			frameTime: this.frameTime,
		});

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
