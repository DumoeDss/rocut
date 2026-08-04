import {
	Command,
	type EditorCommandContext,
	type CommandResult,
} from "@/commands/base-command";
import type { MediaAsset } from "@/media/types";
import { buildWaveformSourceKey } from "@/media/waveform-summary";
import { savePersistedMediaAsset } from "@/media/persistence";
import { hasMediaId } from "@/timeline/element-utils";
import type { SceneTracks } from "@/timeline";
import { toast } from "sonner";

export class RemoveMediaAssetCommand extends Command {
	private savedAssets: MediaAsset[] | null = null;
	private savedTracks: SceneTracks | null = null;
	private removedAsset: MediaAsset | null = null;

	constructor({ projectId, assetId }: { projectId: string; assetId: string }) {
		super();
		this.projectId = projectId;
		this.assetId = assetId;
	}

	private projectId: string;
	private assetId: string;

	execute({ editor }: EditorCommandContext): CommandResult | undefined {
		const assets = editor.media.getAssets();

		this.savedAssets = [...assets];
		this.savedTracks = editor.scenes.getActiveScene().tracks;

		this.removedAsset =
			assets.find((media) => media.id === this.assetId) ?? null;

		if (!this.removedAsset) {
			console.error(
				"Media asset could not be removed because it was not found",
			);
			return;
		}

		if (this.removedAsset.urlHandle) {
			this.removedAsset.urlHandle.revoke();
		} else if (this.removedAsset.url) {
			URL.revokeObjectURL(this.removedAsset.url);
		}
		if (this.removedAsset.thumbnailUrl) {
			if (this.removedAsset.thumbnailUrl.startsWith("blob:")) {
				URL.revokeObjectURL(this.removedAsset.thumbnailUrl);
			}
		}

		const cacheClear = editor.media.clearCachedMedia?.({
			mediaId: this.assetId,
			sourceKey: buildWaveformSourceKey({ kind: "media", id: this.assetId }),
		});
		if (cacheClear) {
			void cacheClear.catch((error) => {
				editor.reportPersistenceFailure({
					operation: "command-remove-media-cache",
					error,
				});
			});
		}

		editor.media.setAssets({
			assets: assets.filter((media) => media.id !== this.assetId),
		});

		const elementsToRemove: Array<{ trackId: string; elementId: string }> = [];

		for (const track of [
			...this.savedTracks.overlay,
			this.savedTracks.main,
			...this.savedTracks.audio,
		]) {
			for (const element of track.elements) {
				if (hasMediaId(element) && element.mediaId === this.assetId) {
					elementsToRemove.push({ trackId: track.id, elementId: element.id });
				}
			}
		}

		if (elementsToRemove.length > 0) {
			editor.timeline.deleteElements({ elements: elementsToRemove });
		}

		editor.persistence
			.removeAttachment({
				projectId: this.projectId,
				key: this.assetId,
			})
			.catch((error) => {
				editor.reportPersistenceFailure({
					operation: "command-remove-media",
					error,
				});
				this.restoreLiveState({ editor });
				toast.error("Failed to remove media item", {
					description: "The media item was restored. Please try again.",
				});
			});
	}

	undo({ editor }: EditorCommandContext): void {
		if (this.savedAssets && this.removedAsset) {
			const restoredAsset = this.restoreLiveState({ editor });

			if (restoredAsset)
				savePersistedMediaAsset({
					persistence: editor.persistence,
					projectId: this.projectId,
					asset: restoredAsset,
				}).catch((error) => {
					editor.reportPersistenceFailure({
						operation: "command-undo-remove-media",
						error,
					});
					toast.error("Failed to restore media item", {
						description: "The media item could not be saved again.",
					});
				});
		}
	}

	private restoreLiveState({
		editor,
	}: {
		editor: EditorCommandContext["editor"];
	}): MediaAsset | null {
		if (!this.savedAssets || !this.removedAsset) return null;
		const restoredAsset: MediaAsset = {
			...this.removedAsset,
		};
		// Production sessions always provide the mediated URL seam. Narrow command
		// harnesses may intentionally omit it; restore their prior URL without
		// widening the test double or reaching for a new global URL.
		const urlHandle = editor.resources?.createObjectUrl?.({
			blob: this.removedAsset.file,
		});
		if (urlHandle) {
			restoredAsset.url = urlHandle.url;
			restoredAsset.urlHandle = urlHandle;
		} else {
			restoredAsset.urlHandle = undefined;
			restoredAsset.url = this.removedAsset.url;
		}
		editor.media.setAssets({
			assets: this.savedAssets.map((asset) =>
				asset.id === this.assetId ? restoredAsset : asset,
			),
		});
		if (this.savedTracks) editor.timeline.updateTracks(this.savedTracks);
		return restoredAsset;
	}
}
