import type { AddMediaAssetCommand } from "../../editor-classic/src/commands/media/add-media-asset";

export interface ProjectStore {
	command(): AddMediaAssetCommand;
}
