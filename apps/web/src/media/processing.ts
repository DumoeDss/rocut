import { toast } from "sonner";
import { getMediaTypeFromFile } from "@/media/media-utils";
import { formatStorageBytes } from "@/services/storage/quota";
import type { MediaAsset } from "@/media/types";
import type { ProjectStore } from "@/editor/ports";
import type { SessionResources } from "@/editor/session/resources";
import { readVideoFile } from "./mediabunny";
import type { VideoFileData } from "./mediabunny";
import { renderThumbnailDataUrl } from "./thumbnail";

export type ProcessedMediaAsset = Omit<MediaAsset, "id">;

function captureActivityPublication(resources: SessionResources): {
	isCurrent(): boolean;
} {
	const lifecycle = resources as SessionResources & {
		getActivityGeneration?: () => number;
		assertActivityGeneration?: (args: { generation: number }) => void;
	};
	const generation =
		typeof lifecycle.getActivityGeneration === "function" &&
		typeof lifecycle.assertActivityGeneration === "function"
			? lifecycle.getActivityGeneration()
			: null;
	return {
		isCurrent: () => {
			if (generation === null || !lifecycle.assertActivityGeneration) {
				return true;
			}
			try {
				lifecycle.assertActivityGeneration({ generation });
				return true;
			} catch {
				return false;
			}
		},
	};
}

export async function inspectMediaCapacity({
	store,
	requiredBytes,
}: {
	store: Pick<ProjectStore, "inspect">;
	requiredBytes: number;
}): Promise<{ canStore: boolean; availableBytes: number | null }> {
	const inspection = await store.inspect();
	if (inspection.availability !== "available") {
		return { canStore: false, availableBytes: null };
	}
	const availableBytes = inspection.capacity?.remainingBytes ?? null;
	return {
		canStore: availableBytes === null || requiredBytes <= availableBytes,
		availableBytes,
	};
}

const getUnsupportedVideoDescription = ({
	codec,
}: {
	codec: VideoFileData["codec"];
}): string => {
	const codecLabel = codec ? codec.toUpperCase() : "this video codec";

	return codec === "hevc"
		? `${codecLabel} cannot be decoded in this browser, so this clip may not preview correctly. Convert it to H.264 MP4 or try importing it in Safari.`
		: `${codecLabel} cannot be decoded in this browser, so this clip may not preview correctly. Convert it to H.264 MP4 and reimport it.`;
};

const getStorageLimitDescription = ({
	fileSize,
	availableBytes,
}: {
	fileSize: number;
	availableBytes: number | null;
}): string => {
	const fileSizeLabel = formatStorageBytes({ bytes: fileSize });

	if (availableBytes === null) {
		return `File size is ${fileSizeLabel}.`;
	}

	return `File size is ${fileSizeLabel}, but only ${formatStorageBytes({
		bytes: availableBytes,
	})} is safely available in browser storage.`;
};

async function generateImageThumbnail({
	imageFile,
	resources,
}: {
	imageFile: File;
	resources: SessionResources;
}): Promise<{ thumbnailUrl: string; width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const image = new window.Image();
		const urlHandle = resources.createObjectUrl({ blob: imageFile });

		image.addEventListener("load", () => {
			try {
				const thumbnailUrl = renderThumbnailDataUrl({
					width: image.naturalWidth,
					height: image.naturalHeight,
					draw: ({ context, width, height }) => {
						context.drawImage(image, 0, 0, width, height);
					},
				});
				resolve({
					thumbnailUrl,
					width: image.naturalWidth,
					height: image.naturalHeight,
				});
			} catch (error) {
				reject(
					error instanceof Error ? error : new Error("Could not render image"),
				);
			} finally {
				urlHandle.revoke();
				image.remove();
			}
		});

		image.addEventListener("error", () => {
			urlHandle.revoke();
			image.remove();
			reject(new Error("Could not load image"));
		});

		image.src = urlHandle.url;
	});
}

export async function processMediaAssets({
	files,
	store,
	resources,
	reportPersistenceFailure,
	onProgress,
}: {
	files: FileList | File[];
	store: Pick<ProjectStore, "inspect">;
	resources: SessionResources;
	reportPersistenceFailure: (args: {
		operation: string;
		error: unknown;
	}) => void;
	onProgress?: ({ progress }: { progress: number }) => void;
}): Promise<ProcessedMediaAsset[]> {
	const publication = captureActivityPublication(resources);
	if (!publication.isCurrent()) return [];
	const fileArray = Array.from(files);
	const processedAssets: ProcessedMediaAsset[] = [];

	const total = fileArray.length;
	let completed = 0;

	for (const file of fileArray) {
		if (!publication.isCurrent()) return [];
		const fileType = getMediaTypeFromFile({ file });

		if (!fileType) {
			toast.error(`Unsupported file type: ${file.name}`);
			continue;
		}

		let capacity: Awaited<ReturnType<typeof inspectMediaCapacity>>;
		try {
			capacity = await inspectMediaCapacity({
				store,
				requiredBytes: file.size,
			});
		} catch (error) {
			if (!publication.isCurrent()) return [];
			reportPersistenceFailure({ operation: "inspect-media-capacity", error });
			toast.error("Could not check storage capacity", {
				description: "The media file was not imported. Please try again.",
			});
			throw error;
		}
		if (!publication.isCurrent()) return [];
		const { canStore, availableBytes } = capacity;

		if (!canStore) {
			toast.error(`Not enough browser storage for ${file.name}`, {
				description: getStorageLimitDescription({
					fileSize: file.size,
					availableBytes,
				}),
			});
			continue;
		}

		const urlHandle = resources.createObjectUrl({ blob: file });
		const url = urlHandle.url;
		let thumbnailUrl: string | undefined;
		let duration: number | undefined;
		let width: number | undefined;
		let height: number | undefined;
		let fps: number | undefined;
		let hasAudio: boolean | undefined;

		try {
			if (fileType === "image") {
				const result = await generateImageThumbnail({
					imageFile: file,
					resources,
				});
				thumbnailUrl = result.thumbnailUrl;
				width = result.width;
				height = result.height;
			} else if (fileType === "video") {
				try {
					const videoData = await readVideoFile({ file });
					if (!publication.isCurrent()) {
						throw new Error(
							"Video processing activity generation was invalidated.",
						);
					}
					duration = videoData.duration;
					width = videoData.width;
					height = videoData.height;
					fps = Number.isFinite(videoData.fps)
						? Math.round(videoData.fps)
						: undefined;
					hasAudio = videoData.hasAudio;
					thumbnailUrl = videoData.thumbnailUrl ?? undefined;

					if (!videoData.canDecode) {
						toast.error(`Can't preview ${file.name}`, {
							description: getUnsupportedVideoDescription({
								codec: videoData.codec,
							}),
						});
					}
				} catch (error) {
					if (!publication.isCurrent()) throw error;
					const message =
						error instanceof Error ? error.message : "Could not process video";

					toast.error(`Couldn't process ${file.name}`, {
						description: message,
					});
				}
			} else if (fileType === "audio") {
				duration = await getMediaDuration({ file, resources });
			}
			if (!publication.isCurrent()) {
				throw new Error(
					"Media processing activity generation was invalidated.",
				);
			}

			processedAssets.push({
				name: file.name,
				type: fileType,
				file,
				url,
				urlHandle,
				thumbnailUrl,
				duration,
				width,
				height,
				fps,
				hasAudio,
			});

			await new Promise<void>((resolve) => queueMicrotask(resolve));
			if (!publication.isCurrent()) {
				processedAssets.pop();
				throw new Error(
					"Media processing activity generation was invalidated.",
				);
			}

			completed += 1;
			if (onProgress) {
				const percent = Math.round((completed / total) * 100);
				onProgress({ progress: percent });
			}
		} catch {
			if (publication.isCurrent()) {
				console.error("Failed to process media file");
				toast.error(`Failed to process ${file.name}`);
			}
			urlHandle.revoke();
		}
	}

	return publication.isCurrent() ? processedAssets : [];
}

const getMediaDuration = ({
	file,
	resources,
}: {
	file: File;
	resources: SessionResources;
}): Promise<number> => {
	return new Promise((resolve, reject) => {
		const element = file.type.startsWith("video/")
			? document.createElement("video")
			: document.createElement("audio");
		const urlHandle = resources.createObjectUrl({ blob: file });

		element.addEventListener("loadedmetadata", () => {
			resolve(element.duration);
			urlHandle.revoke();
			element.remove();
		});

		element.addEventListener("error", () => {
			reject(new Error("Could not load media"));
			urlHandle.revoke();
			element.remove();
		});

		element.src = urlHandle.url;
		element.load();
	});
};
