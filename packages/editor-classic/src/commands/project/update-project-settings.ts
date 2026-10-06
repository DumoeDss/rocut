import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "../base-command";
import type { TProject, TProjectSettings } from "../../project/types";
import { projectOnFrameGrid } from "./frame-rate-project";
import { frameRatesEqual } from "../../fps/utils";

export class UpdateProjectSettingsCommand extends Command {
	get routingClass(): "transaction" | "provider-private" {
		return Object.prototype.hasOwnProperty.call(this.updates, "fps") ||
			Object.prototype.hasOwnProperty.call(this.updates, "background") ||
			Object.prototype.hasOwnProperty.call(this.updates, "canvasSize")
			? "transaction"
			: "provider-private";
	}

	private savedSettings: TProjectSettings | null = null;
	private savedUpdatedAt: Date | null = null;
	private savedScenes: TProject["scenes"] | null = null;

	constructor(private updates: Partial<TProjectSettings>) {
		super();
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		const activeProject = editor.project.getActive();
		if (!activeProject) return;

		this.savedSettings = activeProject.settings;
		this.savedUpdatedAt = activeProject.metadata.updatedAt;
		this.savedScenes = activeProject.scenes;
		const alignedProject =
			this.updates.fps &&
			!frameRatesEqual({ a: activeProject.settings.fps, b: this.updates.fps })
				? projectOnFrameGrid({
						project: activeProject,
						assets: editor.media.getAssets(),
						fps: this.updates.fps,
					})
				: activeProject;

		const updatedProject: TProject = {
			...alignedProject,
			settings: { ...activeProject.settings, ...this.updates },
			metadata: { ...activeProject.metadata, updatedAt: new Date() },
		};

		editor.project.setActiveProject({ project: updatedProject });
		editor.save.markDirty();
	}

	undo({ editor }: EditorCommandContext): void {
		if (!this.savedSettings || !this.savedUpdatedAt) return;
		const activeProject = editor.project.getActive();
		if (!activeProject) return;

		const updatedProject: TProject = {
			...activeProject,
			settings: this.savedSettings,
			scenes: this.savedScenes ?? activeProject.scenes,
			metadata: { ...activeProject.metadata, updatedAt: this.savedUpdatedAt },
		};

		editor.project.setActiveProject({ project: updatedProject });
		editor.save.markDirty();
	}
}
