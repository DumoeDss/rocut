import type { EditorCore } from "..";
import type {
	MediaFolder,
	MediaFolderMutation,
} from "@opencut/editor-contracts";
import { isMediaFolderEditingAvailable } from "../../editor/transactions/opencut/media-folder-policy";
import { MutateMediaFoldersCommand } from "../../commands/project/mutate-media-folders";
import { assetCatalogFromMedia } from "../../editor/transactions/opencut/types";
import {
	diffOpenCutProjection,
	projectOpenCutDraft,
} from "../../editor/transactions/opencut/projection";
import type { MediaPreviewProvider } from "@opencut/editor-ports/host";
import { toast } from "sonner";
import type { MediaAsset } from "../../media/types";
import {
	mediaAttachmentsForHydration,
	decodePersistedMediaMetadata,
	isStorageQuotaExceeded,
	mediaAssetFromAttachment,
	savePersistedMediaAsset,
} from "../../media/persistence";
import { generateUUID } from "../../utils/id";
import { VideoCache } from "../../services/video-cache/service";
import { WaveformCache } from "../../services/waveform-cache/service";
import { MediaPreviewResources } from "../../media/preview-resource";
import { buildWaveformSourceKey } from "../../media/waveform-summary";
import { MotionTextAudioAnalysisCache } from "../../services/motion-text-audio-analysis/service";
import { assertMediaRemovalUnlocked } from "../../editor/transactions/opencut/track-lock-policy";

export class MediaManager {
	private readonly videoCache: VideoCache;
	private readonly waveformCache: WaveformCache;
	private readonly previewResources: MediaPreviewResources;
	private readonly motionTextAudioAnalysisCache: MotionTextAudioAnalysisCache;
	private assets: MediaAsset[] = [];
	private isLoading = false;
	private listeners = new Set<() => void>();

	private readonly editor: EditorCore;

	constructor({
		editor,
		nativeProvider,
	}: {
		editor: EditorCore;
		nativeProvider?: MediaPreviewProvider;
	}) {
		this.editor = editor;
		this.previewResources = new MediaPreviewResources({ nativeProvider });
		this.videoCache = new VideoCache();
		this.waveformCache = new WaveformCache({ resources: editor.resources });
		this.motionTextAudioAnalysisCache = new MotionTextAudioAnalysisCache({
			resources: editor.resources,
		});
	}

	async addMediaAsset({
		projectId,
		asset,
		canPublish = () => true,
	}: {
		projectId: string;
		asset: Omit<MediaAsset, "id">;
		canPublish?: () => boolean;
	}): Promise<MediaAsset | null> {
		if (!canPublish()) return null;
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
			if (!canPublish()) {
				await this.editor.persistence.removeAttachment({
					projectId,
					key: newAsset.id,
				});
				return null;
			}
			await this.editor.transactions.commitUi({
				returnCommittedDraft: false,
				baseDraft: () => {
					const project = this.editor.project.getActive();
					if (!canPublish() || project.metadata.id !== projectId)
						throw new Error("The media import project is no longer active");
					return {
						project: { ...project, scenes: this.editor.scenes.getScenes() },
						assetCatalog: assetCatalogFromMedia([...this.assets, newAsset]),
					};
				},
				prepare: ({ draft, baseRevision, baseDocument }) => ({
					draft,
					operations: diffOpenCutProjection({
						before: baseDocument,
						after: projectOpenCutDraft(draft, {
							revision: baseRevision,
							idempotency: [],
						}),
					}),
					payload: undefined,
				}),
			});
		} catch (error) {
			// A store may commit before losing its acknowledgement. Preserve saved
			// source bytes on failure; a later open reconciles missing catalog entries.
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

		assertMediaRemovalUnlocked({
			project: {
				...this.editor.project.getActive(),
				scenes: this.editor.scenes.getScenes(),
			},
			assetIds: uniqueIds,
		});
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
				projectId,
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
			const persistence = this.editor.persistence;
			const attachments = persistence.listAttachmentHeaders
				? await Promise.all(
						mediaAttachmentsForHydration(
							await persistence.listAttachmentHeaders({ projectId }),
						).map(async ({ key }) => {
							const attachment = await persistence.loadAttachment({
								projectId,
								key,
								decodeMetadata: decodePersistedMediaMetadata,
							});
							if (!attachment) {
								throw new Error("Persisted media attachment body is missing");
							}
							return attachment;
						}),
					)
				: mediaAttachmentsForHydration(
						await persistence.listAttachments({ projectId }),
					);
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
		const project = await this.editor.persistence.loadProject({
			id: projectId,
		});
		if (project)
			assertMediaRemovalUnlocked({
				project,
				assetIds: assetsToClear.map((asset) => asset.id),
			});
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

		this.previewResources.clearAll();
		await Promise.all([
			this.videoCache.clearAll(),
			this.waveformCache.clearAll(),
			this.motionTextAudioAnalysisCache.clearProject({ projectId }),
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
		this.previewResources.clearAll();
		await Promise.all([
			this.videoCache.clearAll(),
			this.waveformCache.clearAll(),
			this.motionTextAudioAnalysisCache.clearAll(),
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

	getFolders(): readonly MediaFolder[] {
		return this.editor.project.getActiveOrNull()?.mediaFolders?.folders ?? [];
	}

	getAssetFolder(assetId: string): string | undefined {
		return this.editor.project
			.getActiveOrNull()
			?.mediaFolders?.assignments.find((item) => item.assetId === assetId)
			?.folderId;
	}

	isFolderEditingAvailable(): boolean {
		return isMediaFolderEditingAvailable();
	}

	async mutateFolders(operation: MediaFolderMutation): Promise<void> {
		await this.editor.command.execute({
			command: new MutateMediaFoldersCommand({
				projectId: this.editor.project.getActive().metadata.id,
				operation,
			}),
		});
		this.notify();
	}

	getVideoCache(): VideoCache {
		return this.videoCache;
	}

	getWaveformCache(): WaveformCache {
		return this.waveformCache;
	}

	getPreviewResources(): MediaPreviewResources {
		return this.previewResources;
	}

	getMotionTextAudioAnalysisCache(): MotionTextAudioAnalysisCache {
		return this.motionTextAudioAnalysisCache;
	}

	setAssets({ assets }: { assets: MediaAsset[] }): void {
		this.assets = assets;
		this.notify();
	}

	async clearCachedMedia({
		projectId,
		sourceKey,
		mediaId,
	}: {
		projectId?: string;
		sourceKey?: string;
		mediaId?: string;
	}): Promise<void> {
		await Promise.all([
			...(mediaId ? [this.videoCache.clearVideo({ mediaId })] : []),
			...(sourceKey ? [this.waveformCache.clearSource({ sourceKey })] : []),
			...(projectId && mediaId
				? [
						this.motionTextAudioAnalysisCache.clearSource({
							projectId,
							assetId: mediaId,
						}),
					]
				: []),
		]);
	}

	async dispose(): Promise<void> {
		this.previewResources.clearAll();
		await Promise.all([
			this.videoCache.dispose(),
			this.waveformCache.dispose(),
			this.motionTextAudioAnalysisCache.dispose(),
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
