import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "@/commands/base-command";
import type { Bookmark, TScene } from "@/timeline";
import { updateSceneInArray } from "@/timeline/scenes";
import {
	getFrameTime,
	updateBookmarkInArray,
} from "@/timeline/bookmarks/index";
import type { MediaTime } from "@/wasm";

export class UpdateBookmarkCommand extends Command {
	readonly routingClass = "transaction" as const;

	private savedScenes: TScene[] | null = null;

	constructor({
		time,
		updates,
	}: {
		time: MediaTime;
		updates: Partial<Omit<Bookmark, "time">>;
	}) {
		super();
		this.time = time;
		this.updates = updates;
	}

	private time: MediaTime;
	private updates: Partial<Omit<Bookmark, "time">>;

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		const activeScene = editor.scenes.getActiveScene();
		const activeProject = editor.project.getActive();

		if (!activeScene || !activeProject) {
			return;
		}

		const scenes = editor.scenes.getScenes();
		this.savedScenes = [...scenes];

		const frameTime = getFrameTime({
			time: this.time,
			fps: activeProject.settings.fps,
		});

		const updatedBookmarks = updateBookmarkInArray({
			bookmarks: activeScene.bookmarks,
			frameTime,
			updates: this.updates,
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
