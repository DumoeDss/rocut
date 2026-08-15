import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "../base-command";
import { toast } from "sonner";
import type { MediaAsset } from "../../media/types";
import { generateUUID } from "../../utils/id";
import {
	isStorageQuotaExceeded,
	savePersistedMediaAsset,
} from "../../media/persistence";
import { hasMediaId } from "../../timeline/element-utils";

export class AddMediaAssetCommand extends Command {
	readonly routingClass = "immediate" as const;

	private assetId: string;
	private savedAssets: MediaAsset[] | null = null;
	private createdAsset: MediaAsset | null = null;

	constructor({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: Omit<MediaAsset, "id">;
	}) {
		super();
		this.projectId = projectId;
		this.asset = asset;
		this.assetId = generateUUID();
	}

	private projectId: string;
	private asset: Omit<MediaAsset, "id">;

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		this.savedAssets = [...editor.media.getAssets()];

		this.createdAsset = {
			...this.asset,
			id: this.assetId,
		};

		editor.media.setAssets({
			assets: [...this.savedAssets, this.createdAsset],
		});
		savePersistedMediaAsset({
			persistence: editor.persistence,
			projectId: this.projectId,
			asset: this.createdAsset,
		})
			.then(() => {
				const createdAsset = this.createdAsset;
				if (
					!createdAsset ||
					!editor.media
						.getAssets()
						.some((asset) => asset.id === createdAsset.id)
				) {
					return;
				}
				return Promise.resolve(
					editor.project.ratchetFpsForImportedMedia({
						importedAssets: [createdAsset],
					}),
				).catch((error) => {
					editor.reportPersistenceFailure({
						operation: "command-ratchet-imported-media-fps",
						error,
					});
				});
			})
			.catch((error) => {
				editor.reportPersistenceFailure({
					operation: "command-add-media",
					error,
				});

				const currentAssets = editor.media.getAssets();
				editor.media.setAssets({
					assets: currentAssets.filter((asset) => asset.id !== this.assetId),
				});

				const currentTracks = editor.scenes.getActiveScene().tracks;
				const orphanedElements: Array<{ trackId: string; elementId: string }> =
					[];

				for (const track of [
					...currentTracks.overlay,
					currentTracks.main,
					...currentTracks.audio,
				]) {
					for (const element of track.elements) {
						if (hasMediaId(element) && element.mediaId === this.assetId) {
							orphanedElements.push({
								trackId: track.id,
								elementId: element.id,
							});
						}
					}
				}

				if (orphanedElements.length > 0) {
					editor.timeline.deleteElements({ elements: orphanedElements });
				}

				if (isStorageQuotaExceeded(error)) {
					toast.error("Not enough browser storage", {
						description: "Free some space, then try importing this file again.",
					});
				} else {
					toast.error("Failed to add media", {
						description: "The media item was removed from the editor.",
					});
				}
			});

		return undefined;
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.savedAssets) {
			editor.media.setAssets({ assets: this.savedAssets });

			if (this.createdAsset) {
				editor.persistence
					.removeAttachment({
						projectId: this.projectId,
						key: this.assetId,
					})
					.catch((error) => {
						editor.reportPersistenceFailure({
							operation: "command-undo-add-media",
							error,
						});
						toast.error("Failed to undo media import", {
							description: "The stored media item could not be removed.",
						});
					});
			}
		}
	}

	getAssetId(): string {
		return this.assetId;
	}
}
