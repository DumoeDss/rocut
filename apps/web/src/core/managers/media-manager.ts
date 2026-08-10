import type { EditorCore } from "@/core";
import { toast } from "sonner";
import type { MediaAsset } from "@/media/types";
import {
	decodePersistedMediaMetadata,
	isStorageQuotaExceeded,
	mediaAssetFromAttachment,
	savePersistedMediaAsset,
} from "@/media/persistence";
import { generateUUID } from "@/utils/id";
import { VideoCache } from "@/services/video-cache/service";
import { WaveformCache } from "@/services/waveform-cache/service";
import { RemoveMediaAssetCommand } from "@/commands";

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

	removeMediaAsset({ projectId, id }: { projectId: string; id: string }): void {
		this.removeMediaAssets({ projectId, ids: [id] });
	}

	removeMediaAssets({
		projectId,
		ids,
	}: {
		projectId: string;
		ids: string[];
	}): void {
		const uniqueIds = [...new Set(ids)];
		if (uniqueIds.length === 0) {
			return;
		}

		for (const assetId of uniqueIds) {
			void this.editor.command.execute({
				command: new RemoveMediaAssetCommand({ projectId, assetId }),
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
