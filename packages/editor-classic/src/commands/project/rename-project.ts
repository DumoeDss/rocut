import { Command, type EditorCommandContext } from "../base-command";

/** Applied to an isolated draft; the transaction owns persistence and history. */
export class RenameProjectCommand extends Command {
	readonly routingClass = "transaction" as const;

	constructor(private readonly rename: { projectId: string; name: string }) {
		super();
	}

	execute({ editor }: EditorCommandContext): undefined {
		const project = editor.project.getActive();
		if (!project || project.metadata.id !== this.rename.projectId) {
			throw new Error("The project to rename is no longer active");
		}
		editor.project.setActiveProject({
			project: {
				...project,
				metadata: {
					...project.metadata,
					name: this.rename.name,
					updatedAt: new Date(),
				},
			},
		});
		editor.save.markDirty();
	}
}
