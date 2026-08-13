import type { AddMediaAssetCommand } from "@/commands/media/add-media-asset";

export interface ProjectStore {
	command(): AddMediaAssetCommand;
}
