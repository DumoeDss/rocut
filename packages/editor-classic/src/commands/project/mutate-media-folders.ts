import {
	revisionOf,
	type MediaFolderMutation,
} from "@opencut/editor-contracts";
import { Command, type EditorCommandContext } from "../base-command";
import { cloneOpaque } from "../../editor/persistence/opaque-value";
import { planMediaFolderMutation } from "../../editor/transactions/opencut/media-folder-policy";
import { projectOpenCutDraft } from "../../editor/transactions/opencut/projection";
import { assetCatalogFromMedia } from "../../editor/transactions/opencut/types";

/** Native planning runs against the queued detached draft; history publishes after save. */
export class MutateMediaFoldersCommand extends Command {
	readonly routingClass = "transaction" as const;
	private readonly mutation: {
		projectId: string;
		operation: MediaFolderMutation;
	};

	constructor(mutation: { projectId: string; operation: MediaFolderMutation }) {
		super();
		this.mutation = cloneOpaque(mutation);
	}

	execute({ editor }: EditorCommandContext): undefined {
		const project = editor.project.getActive();
		if (project.metadata.id !== this.mutation.projectId)
			throw new Error("The media folder project is no longer active");
		const document = projectOpenCutDraft(
			{
				project: { ...project, scenes: editor.scenes.getScenes() },
				assetCatalog: assetCatalogFromMedia(editor.media.getAssets()),
			},
			{ revision: revisionOf(0), idempotency: [] },
		);
		const [update] = planMediaFolderMutation({
			document,
			operation: this.mutation.operation,
		});
		if (update?.kind !== "update-project" || !update.patch.mediaFolders)
			throw new Error("Invalid native media folder result");
		editor.project.setActiveProject({
			project: { ...project, mediaFolders: update.patch.mediaFolders },
		});
	}
}
