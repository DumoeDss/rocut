import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "@/commands/base-command";
import type { TScene } from "@/timeline";
import { updateSceneInArray } from "@/timeline/scenes";
import { getFrameTime, moveBookmarkInArray } from "@/timeline/bookmarks/index";
import type { MediaTime } from "@/wasm";

export class MoveBookmarkCommand extends Command {
	private savedScenes: TScene[] | null = null;

	constructor({
		fromTime,
		toTime,
	}: {
		fromTime: MediaTime;
		toTime: MediaTime;
	}) {
		super();
		this.fromTime = fromTime;
		this.toTime = toTime;
	}

	private fromTime: MediaTime;
	private toTime: MediaTime;

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		const activeScene = editor.scenes.getActiveScene();
		const activeProject = editor.project.getActive();

		if (!activeScene || !activeProject) {
			return;
		}

		const scenes = editor.scenes.getScenes();
		this.savedScenes = [...scenes];

		const fromFrameTime = getFrameTime({
			time: this.fromTime,
			fps: activeProject.settings.fps,
		});
		const toFrameTime = getFrameTime({
			time: this.toTime,
			fps: activeProject.settings.fps,
		});

		const updatedBookmarks = moveBookmarkInArray({
			bookmarks: activeScene.bookmarks,
			fromTime: fromFrameTime,
			toTime: toFrameTime,
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
