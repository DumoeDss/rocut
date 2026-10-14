import type {
	ProjectAttachment,
	ProjectAttachmentHeader,
} from "@opencut/editor-ports";
import { ProjectStoreError } from "@opencut/editor-ports";
import type { SessionPersistenceCoordinator } from "../editor/persistence";
import type { MediaAsset, MediaType } from "./types";
import type { SessionResources } from "../editor/session/resources";
import type { MediaFacts } from "@opencut/editor-contracts";
import { decodeMediaFacts, sourceBytesSha256 } from "./media-facts";

interface PersistedMediaMetadata {
	readonly sourceSha256?: string;
	readonly mediaFacts?: MediaFacts;
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

	const mediaFacts =
		"mediaFacts" in value ? decodeMediaFacts(value.mediaFacts) : undefined;
	return {
		id: value.id,
		...("sourceSha256" in value &&
			typeof value.sourceSha256 === "string" && {
				sourceSha256: value.sourceSha256,
			}),
		...(mediaFacts !== undefined && { mediaFacts }),
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

/** Attachments also contain programmatic resources and archived source files.
 * Those belong to the programmatic provider, which validates their version,
 * digest and bytes on use. Do not turn them into media assets or discard them.
 * All other attachments retain strict legacy media metadata validation. */
export function mediaAttachmentsForHydration<
	Attachment extends ProjectAttachmentHeader,
>(attachments: readonly Attachment[]) {
	return attachments.flatMap((attachment) => {
		const metadata = attachment.metadata;
		if (
			typeof metadata === "object" &&
			metadata !== null &&
			"kind" in metadata &&
			metadata.kind === "programmatic-resource"
		)
			return [];
		return [
			{ ...attachment, metadata: decodePersistedMediaMetadata(metadata) },
		];
	});
}

function metadataFor(asset: MediaAsset): PersistedMediaMetadata {
	return {
		id: asset.id,
		...(asset.sourceSha256 !== undefined && {
			sourceSha256: asset.sourceSha256,
		}),
		...(asset.mediaFacts !== undefined && { mediaFacts: asset.mediaFacts }),
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
	persistence: Pick<SessionPersistenceCoordinator, "saveAttachment">;
	projectId: string;
	asset: MediaAsset;
}): Promise<void> {
	const bytes = await asset.file.arrayBuffer();
	const sourceSha256 = await sourceBytesSha256(new Uint8Array(bytes));
	if (
		(asset.sourceSha256 !== undefined && asset.sourceSha256 !== sourceSha256) ||
		(asset.mediaFacts !== undefined && asset.mediaFacts.sha256 !== sourceSha256)
	)
		throw new Error("Media attachment does not match its source fingerprint");
	await persistence.saveAttachment({
		projectId,
		key: asset.id,
		metadata: metadataFor({ ...asset, sourceSha256 }),
		body: bytes,
	});
}

export async function mediaAssetFromAttachment({
	attachment,
	resources,
}: {
	attachment: Omit<ProjectAttachment, "metadata"> & {
		metadata: PersistedMediaMetadata;
	};
	resources: Pick<SessionResources, "createObjectUrl">;
}): Promise<MediaAsset> {
	const { metadata } = attachment;
	const sourceSha256 = await sourceBytesSha256(new Uint8Array(attachment.body));
	if (
		(metadata.sourceSha256 !== undefined &&
			metadata.sourceSha256 !== sourceSha256) ||
		(metadata.mediaFacts !== undefined &&
			metadata.mediaFacts.sha256 !== sourceSha256)
	)
		throw new Error(
			"Persisted media bytes do not match their source fingerprint",
		);
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
		sourceSha256,
		...(metadata.mediaFacts !== undefined && {
			mediaFacts: metadata.mediaFacts,
		}),
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
