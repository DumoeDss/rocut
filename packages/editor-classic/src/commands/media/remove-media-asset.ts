import { Command, type EditorCommandContext } from "../base-command";

export class RemoveMediaAssetCommand extends Command {
	readonly routingClass = "immediate" as const;

	constructor({ projectId, assetId }: { projectId: string; assetId: string }) {
		super();
		this.projectId = projectId;
		this.assetId = assetId;
	}

	private projectId: string;
	private assetId: string;

	execute({ editor }: EditorCommandContext): undefined {
		void editor.media
			.removeMediaAsset({ projectId: this.projectId, id: this.assetId })
			.catch(() => undefined);
		return undefined;
	}
}
