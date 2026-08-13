import type { ProjectAttachment } from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";
import type { SessionPersistenceCoordinator } from "../editor/persistence";
import type { MediaAsset, MediaType } from "./types";
import type { SessionResources } from "../editor/session/resources";

interface PersistedMediaMetadata {
	readonly id: string;
	readonly name: string;
	readonly type: MediaType;
	readonly mimeType: string;
	readonly lastModified: number;
	readonly width?: number;
	readonly height?: number;
	readonly duration?: number;
	readonly fps?: number;
	readonly hasAudio?: boolean;
	readonly ephemeral?: boolean;
	readonly thumbnailUrl?: string;
}

function isMediaType(value: unknown): value is MediaType {
	return value === "image" || value === "video" || value === "audio";
}

function optionalFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function decodePersistedMediaMetadata(
	value: unknown,
): PersistedMediaMetadata {
	if (
		typeof value !== "object" ||
		value === null ||
		!("id" in value) ||
		typeof value.id !== "string" ||
		!("name" in value) ||
		typeof value.name !== "string" ||
		!("type" in value) ||
		!isMediaType(value.type)
	) {
		throw new Error("Persisted media attachment metadata is corrupt");
	}

	return {
		id: value.id,
		name: value.name,
		type: value.type,
		mimeType:
			"mimeType" in value && typeof value.mimeType === "string"
				? value.mimeType
				: "",
		lastModified:
			"lastModified" in value
				? (optionalFiniteNumber(value.lastModified) ?? 0)
				: 0,
		width: "width" in value ? optionalFiniteNumber(value.width) : undefined,
		height: "height" in value ? optionalFiniteNumber(value.height) : undefined,
		duration:
			"duration" in value ? optionalFiniteNumber(value.duration) : undefined,
		fps: "fps" in value ? optionalFiniteNumber(value.fps) : undefined,
		hasAudio:
			"hasAudio" in value && typeof value.hasAudio === "boolean"
				? value.hasAudio
				: undefined,
		ephemeral:
			"ephemeral" in value && typeof value.ephemeral === "boolean"
				? value.ephemeral
				: undefined,
		thumbnailUrl:
			"thumbnailUrl" in value &&
			typeof value.thumbnailUrl === "string" &&
			!value.thumbnailUrl.startsWith("blob:")
				? value.thumbnailUrl
				: undefined,
	};
}

function metadataFor(asset: MediaAsset): PersistedMediaMetadata {
	return {
		id: asset.id,
		name: asset.name,
		type: asset.type,
		mimeType: asset.file.type,
		lastModified: asset.file.lastModified,
		width: asset.width,
		height: asset.height,
		duration: asset.duration,
		fps: asset.fps,
		hasAudio: asset.hasAudio,
		ephemeral: asset.ephemeral,
		thumbnailUrl:
			asset.thumbnailUrl && !asset.thumbnailUrl.startsWith("blob:")
				? asset.thumbnailUrl
				: undefined,
	};
}

export async function savePersistedMediaAsset({
	persistence,
	projectId,
	asset,
}: {
	persistence: SessionPersistenceCoordinator;
	projectId: string;
	asset: MediaAsset;
}): Promise<void> {
	await persistence.saveAttachment({
		projectId,
		key: asset.id,
		metadata: metadataFor(asset),
		body: asset.file.arrayBuffer(),
	});
}

export async function mediaAssetFromAttachment({
	attachment,
	resources,
}: {
	attachment: Omit<ProjectAttachment, "metadata"> & {
		metadata: PersistedMediaMetadata;
	};
	resources: SessionResources;
}): Promise<MediaAsset> {
	const { metadata } = attachment;
	const file = new File([attachment.body], metadata.name, {
		type: metadata.mimeType,
		lastModified: metadata.lastModified,
	});
	let urlHandle = resources.createObjectUrl({ blob: file });
	let url = urlHandle.url;

	if (metadata.type === "image" && !metadata.mimeType) {
		try {
			const text = await file.text();
			if (text.trim().startsWith("<svg")) {
				urlHandle.revoke();
				const svgBlob = new Blob([text], { type: "image/svg+xml" });
				urlHandle = resources.createObjectUrl({ blob: svgBlob });
				url = urlHandle.url;
			}
		} catch {
			// The original file URL remains valid when legacy SVG sniffing fails.
		}
	}

	return {
		id: metadata.id,
		name: metadata.name,
		type: metadata.type,
		file,
		url,
		urlHandle,
		width: metadata.width,
		height: metadata.height,
		duration: metadata.duration,
		fps: metadata.fps,
		hasAudio: metadata.hasAudio,
		ephemeral: metadata.ephemeral,
		thumbnailUrl: metadata.thumbnailUrl,
	};
}

export function isStorageQuotaExceeded(error: unknown): boolean {
	return error instanceof ProjectStoreError && error.code === "quota-exceeded";
}
