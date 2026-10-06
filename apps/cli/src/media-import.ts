import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import type { AutomationApi } from "@opencut/editor-automation";
import {
	assetId,
	mediaTime,
	revisionOf,
	TransactionError,
	type Asset,
} from "@opencut/editor-contracts";
import type { ProjectStore, ProjectId } from "@opencut/editor-ports";
import { probeMediaImport } from "@opencut/editor-classic/media-import";

export const MEDIA_IMPORT_CAPABILITY = {
	route: "media/import",
	maxBytes: 512 * 1024 * 1024,
	input: "absolute-local-file",
	probe: "audio-video-container",
	images: "explicit-mime-and-dimensions",
	createsTimelineClip: false,
} as const;

interface ImportSpec {
	filePath: string;
	expectedRevision: number;
	idempotencyKey: string;
	image?: { mimeType: string; width: number; height: number };
}

function parseSpec(value: unknown): ImportSpec {
	if (!value || typeof value !== "object")
		throw new Error("invalid-media-import");
	const spec = value as ImportSpec;
	if (
		Object.keys(spec).some(
			(key) =>
				!["filePath", "expectedRevision", "idempotencyKey", "image"].includes(
					key,
				),
		) ||
		typeof spec.filePath !== "string" ||
		!path.isAbsolute(spec.filePath) ||
		!Number.isSafeInteger(spec.expectedRevision) ||
		spec.expectedRevision < 0 ||
		typeof spec.idempotencyKey !== "string" ||
		!spec.idempotencyKey.trim()
	)
		throw new Error("invalid-media-import");
	if (spec.image !== undefined) {
		const image = spec.image;
		if (
			!image ||
			typeof image !== "object" ||
			Object.keys(image).some(
				(key) => !["mimeType", "width", "height"].includes(key),
			) ||
			![
				"image/png",
				"image/jpeg",
				"image/webp",
				"image/gif",
				"image/avif",
			].includes(image.mimeType) ||
			![image.width, image.height].every(
				(n) => Number.isSafeInteger(n) && n > 0 && n <= 32768,
			)
		)
			throw new Error("invalid-media-image-metadata");
	}
	return spec;
}

const digest = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");

/** Local filesystem transport only. Assets still commit through the shared engine. */
export async function importLocalMedia({
	input,
	store,
	projectId,
	automation,
}: {
	input: unknown;
	store: ProjectStore;
	projectId: ProjectId;
	automation: AutomationApi;
}) {
	const spec = parseSpec(input);
	const file = await open(spec.filePath, "r");
	let bytes: Buffer;
	try {
		const before = await file.stat();
		if (
			!before.isFile() ||
			before.size <= 0 ||
			before.size > MEDIA_IMPORT_CAPABILITY.maxBytes
		)
			throw new Error("media-import-file-size-or-type");
		// Bounded read, even if another process grows the file during import.
		bytes = Buffer.alloc(before.size);
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await file.read(
				bytes,
				offset,
				bytes.length - offset,
				offset,
			);
			if (!bytesRead) throw new Error("media-import-source-changed");
			offset += bytesRead;
		}
		const after = await file.stat();
		if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
			throw new Error("media-import-source-changed");
	} finally {
		await file.close();
	}
	const sourceSha256 = digest(bytes);
	const probed = spec.image
		? {
				type: "image" as const,
				mimeType: spec.image.mimeType,
				width: spec.image.width,
				height: spec.image.height,
			}
		: await probeMediaImport(bytes);
	const name = path.basename(spec.filePath);
	// The identity binds BOTH bytes and declared metadata to durable batch replay.
	const id = assetId(
		`media-${digest(JSON.stringify([spec.idempotencyKey, sourceSha256, name, probed]))}`,
	);
	const metadata = { id, name, ...probed, lastModified: 0 };
	const asset: Asset = {
		id,
		name,
		kind: probed.type,
		...(probed.width !== undefined && { width: probed.width }),
		...(probed.height !== undefined && { height: probed.height }),
		...("duration" in probed && {
			duration: mediaTime({ ticks: Math.round(probed.duration * 120_000) }),
		}),
		...("hasAudio" in probed && { hasAudio: probed.hasAudio }),
	};
	const batch = {
		expectedRevision: revisionOf(spec.expectedRevision),
		idempotencyKey: spec.idempotencyKey,
		operations: [{ kind: "create-asset" as const, asset }],
	};
	const preview = await automation.engine.dryRun(batch);
	if (!preview.accepted) {
		const issue = preview.issues[0];
		throw new TransactionError({
			code:
				issue.code === "expected-revision-conflict"
					? "conflict"
					: issue.code === "idempotency-conflict"
						? "duplicate"
						: "validation",
			message: issue.message,
			expectedRevision: issue.expectedRevision,
			actualRevision: issue.actualRevision,
		});
	}
	const existing = await store.loadAttachment({ projectId, key: id });
	if (preview.replayed) {
		if (!existing || digest(new Uint8Array(existing.body)) !== sourceSha256)
			throw new Error("media-import-replay-attachment-missing-or-changed");
		return {
			asset,
			sourceSha256,
			metadataSource: spec.image ? "caller" : "container",
			replayed: true,
			result: preview.result,
		};
	}
	if (
		existing &&
		(digest(new Uint8Array(existing.body)) !== sourceSha256 ||
			JSON.stringify(existing.metadata) !== JSON.stringify(metadata))
	)
		throw new Error("media-import-attachment-conflict");
	if (!existing)
		await store.saveAttachment({
			projectId,
			key: id,
			metadata,
			body: bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			) as ArrayBuffer,
		});
	// Retain a prepared attachment on failure: retry can finish it safely. Never
	// delete it after an uncertain commit; another durable record may reference it.
	const result = await automation.apply(batch);
	return {
		asset,
		sourceSha256,
		metadataSource: spec.image ? "caller" : "container",
		replayed: false,
		result,
	};
}
