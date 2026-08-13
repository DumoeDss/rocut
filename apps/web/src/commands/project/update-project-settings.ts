import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "@/commands/base-command";
import type { TProject, TProjectSettings } from "@/project/types";

export class UpdateProjectSettingsCommand extends Command {
	get routingClass(): "transaction" | "provider-private" {
		return Object.prototype.hasOwnProperty.call(this.updates, "fps") ||
			Object.prototype.hasOwnProperty.call(this.updates, "canvasSize")
			? "transaction"
			: "provider-private";
	}

	private savedSettings: TProjectSettings | null = null;
	private savedUpdatedAt: Date | null = null;

	constructor(private updates: Partial<TProjectSettings>) {
		super();
	}

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		const activeProject = editor.project.getActive();
		if (!activeProject) return;

		this.savedSettings = activeProject.settings;
		this.savedUpdatedAt = activeProject.metadata.updatedAt;

		const updatedProject: TProject = {
			...activeProject,
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
			metadata: { ...activeProject.metadata, updatedAt: this.savedUpdatedAt },
		};

		editor.project.setActiveProject({ project: updatedProject });
		editor.save.markDirty();
	}
}
