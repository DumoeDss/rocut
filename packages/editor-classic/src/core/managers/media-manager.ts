import type { EditorCore } from "..";
import { toast } from "sonner";
import type { MediaAsset } from "../../media/types";
import {
	decodePersistedMediaMetadata,
	isStorageQuotaExceeded,
	mediaAssetFromAttachment,
	savePersistedMediaAsset,
} from "../../media/persistence";
import { generateUUID } from "../../utils/id";
import { VideoCache } from "../../services/video-cache/service";
import { WaveformCache } from "../../services/waveform-cache/service";
import { buildWaveformSourceKey } from "../../media/waveform-summary";

export class MediaManager {
	private readonly videoCache: VideoCache;
	private readonly waveformCache: WaveformCache;
	private assets: MediaAsset[] = [];
	private isLoading = false;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {
		this.videoCache = new VideoCache();
		this.waveformCache = new WaveformCache(editor.resources);
	}

	async addMediaAsset({
		projectId,
		asset,
	}: {
		projectId: string;
		asset: Omit<MediaAsset, "id">;
	}): Promise<MediaAsset | null> {
		const newAsset: MediaAsset = {
			...asset,
			id: generateUUID(),
		};

		try {
			await savePersistedMediaAsset({
				persistence: this.editor.persistence,
				projectId,
				asset: newAsset,
			});
		} catch (error) {
			this.editor.reportPersistenceFailure({
				operation: "save-media-attachment",
				error,
			});
			if (isStorageQuotaExceeded(error)) {
				toast.error("Not enough browser storage", {
					description: "Free some space, then try importing this file again.",
				});
			} else {
				toast.error("Failed to save media", {
					description: "The media item was not added. Please try again.",
				});
			}

			return null;
		}

		this.assets = [...this.assets, newAsset];
		this.notify();
		try {
			await this.editor.project.ratchetFpsForImportedMedia({
				importedAssets: [newAsset],
			});
		} catch (error) {
			this.editor.reportPersistenceFailure({
				operation: "ratchet-imported-media-fps",
				error,
			});
		}
		return newAsset;
	}

	async removeMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		await this.removeMediaAssets({ projectId, ids: [id] });
	}

	async removeMediaAssets({
		projectId,
		ids,
	}: {
		projectId: string;
		ids: string[];
	}): Promise<void> {
		const uniqueIds = [...new Set(ids)];
		if (uniqueIds.length === 0) {
			return;
		}

		for (const assetId of uniqueIds) {
			await this.removeMediaAssetAtomically({ projectId, assetId });
		}
	}

	private async removeMediaAssetAtomically({
		projectId,
		assetId,
	}: {
		projectId: string;
		assetId: string;
	}): Promise<void> {
		const asset = this.assets.find((candidate) => candidate.id === assetId);
		if (!asset) return;

		try {
			await this.editor.persistence.removeAttachment({
				projectId,
				key: assetId,
			});
		} catch (error) {
			this.editor.reportPersistenceFailure({
				operation: "command-remove-media-attachment",
				error,
			});
			toast.error("Failed to remove media item", {
				description: "The media item and its timeline clips were not changed.",
			});
			throw error;
		}

		try {
			await this.editor.command.removeMediaAssetReferences({ assetId });
		} catch (error) {
			try {
				await savePersistedMediaAsset({
					persistence: this.editor.persistence,
					projectId,
					asset,
				});
			} catch (restoreError) {
				this.editor.reportPersistenceFailure({
					operation: "command-restore-media-after-project-failure",
					error: restoreError,
				});
				throw new AggregateError(
					[error, restoreError],
					"Project media removal failed and its attachment could not be restored",
				);
			}
			this.editor.reportPersistenceFailure({
				operation: "command-remove-media-project",
				error,
			});
			toast.error("Failed to remove media item", {
				description: "The media item and its timeline clips were restored.",
			});
			throw error;
		}

		this.assets = this.assets.filter((candidate) => candidate.id !== assetId);
		this.notify();
		if (asset.urlHandle) asset.urlHandle.revoke();
		else if (asset.url) URL.revokeObjectURL(asset.url);
		if (asset.thumbnailUrl?.startsWith("blob:")) {
			URL.revokeObjectURL(asset.thumbnailUrl);
		}
		try {
			await this.clearCachedMedia({
				mediaId: assetId,
				sourceKey: buildWaveformSourceKey({ kind: "media", id: assetId }),
			});
		} catch (error) {
			this.editor.reportPersistenceFailure({
				operation: "command-remove-media-cache",
				error,
			});
		}
	}

	async loadProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		this.isLoading = true;
		this.notify();

		try {
			const attachments = await this.editor.persistence.listAttachments({
				projectId,
				decodeMetadata: decodePersistedMediaMetadata,
			});
			const mediaAssets = await Promise.all(
				attachments.map((attachment) =>
					mediaAssetFromAttachment({
						attachment,
						resources: this.editor.resources,
					}),
				),
			);
			this.assets = mediaAssets;
			this.notify();
		} catch (error) {
			this.editor.reportPersistenceFailure({
				operation: "load-media-attachments",
				error,
			});
			toast.error("Failed to load project media", {
				description: "Your stored media was not changed. Please try again.",
			});
			throw error;
		} finally {
			this.isLoading = false;
			this.notify();
		}
	}

	async clearProjectMedia({ projectId }: { projectId: string }): Promise<void> {
		const assetsToClear = [...this.assets];
		try {
			await Promise.all(
				assetsToClear.map(({ id }) =>
					this.editor.persistence.removeAttachment({
						projectId,
						key: id,
					}),
				),
			);
		} catch (error) {
			this.editor.reportPersistenceFailure({
				operation: "clear-media-attachments",
				error,
			});
			toast.error("Failed to clear project media", {
				description: "Your stored media was not cleared. Please try again.",
			});
			throw error;
		}

		await Promise.all([
			this.videoCache.clearAll(),
			this.waveformCache.clearAll(),
		]);
		assetsToClear.forEach((asset) => {
			if (asset.urlHandle) {
				asset.urlHandle.revoke();
			} else if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		this.assets = [];
		this.notify();
	}

	async clearAllAssets(): Promise<void> {
		await Promise.all([
			this.videoCache.clearAll(),
			this.waveformCache.clearAll(),
		]);

		this.assets.forEach((asset) => {
			if (asset.urlHandle) {
				asset.urlHandle.revoke();
			} else if (asset.url) {
				URL.revokeObjectURL(asset.url);
			}
			if (asset.thumbnailUrl) {
				URL.revokeObjectURL(asset.thumbnailUrl);
			}
		});

		this.assets = [];
		this.notify();
	}

	getAssets(): MediaAsset[] {
		return this.assets;
	}

	getVideoCache(): VideoCache {
		return this.videoCache;
	}

	getWaveformCache(): WaveformCache {
		return this.waveformCache;
	}

	setAssets({ assets }: { assets: MediaAsset[] }): void {
		this.assets = assets;
		this.notify();
	}

	async clearCachedMedia({
		sourceKey,
		mediaId,
	}: {
		sourceKey?: string;
		mediaId?: string;
	}): Promise<void> {
		await Promise.all([
			...(mediaId ? [this.videoCache.clearVideo({ mediaId })] : []),
			...(sourceKey ? [this.waveformCache.clearSource({ sourceKey })] : []),
		]);
	}

	async dispose(): Promise<void> {
		await Promise.all([
			this.videoCache.dispose(),
			this.waveformCache.dispose(),
		]);
	}

	isLoadingMedia(): boolean {
		return this.isLoading;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}
