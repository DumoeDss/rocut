import type {
	MusicGridAnchorSource,
	MusicGridSourceAvailabilityProbe,
	TransactionRead,
} from "@opencut/editor-contracts";
import { queryMusicGrid } from "../editor/transactions/opencut/music-grid";

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
export interface MusicAnchorFile {
	name: string;
	kind: "lyrics" | "sections";
	anchorSource: MusicGridAnchorSource;
	labels: Array<{ key: string; label: string; hasEnd: boolean }>;
}
export async function loadMusicAnchorFile({
	file,
}: {
	file: File;
}): Promise<MusicAnchorFile> {
	if (file.size > 8 * 1024 ** 2)
		throw Error("Reviewed anchor file exceeds limit");
	const bytes = await file.arrayBuffer();
	const resource: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(bytes),
	);
	if (
		!record(resource) ||
		resource.schema !== "creator-music-anchors/1" ||
		resource.clock !== "source-audio-ticks" ||
		!record(resource.source) ||
		typeof resource.source.sha256 !== "string" ||
		!/^[a-f0-9]{64}$/.test(resource.source.sha256) ||
		(resource.kind !== "lyrics" && resource.kind !== "sections") ||
		typeof resource.reviewReference !== "string" ||
		!resource.reviewReference.trim() ||
		!Array.isArray(resource.anchors) ||
		resource.anchors.length > 5000
	)
		throw Error("Invalid reviewed music anchor resource");
	const anchors: Array<{ key: string; sourceTick: number }> = [];
	const labels: MusicAnchorFile["labels"] = [];
	for (const item of resource.anchors) {
		if (
			!record(item) ||
			typeof item.key !== "string" ||
			!item.key ||
			typeof item.label !== "string" ||
			!Number.isSafeInteger(item.sourceTick) ||
			Number(item.sourceTick) < 0 ||
			(item.endSourceTick !== undefined &&
				(!Number.isSafeInteger(item.endSourceTick) ||
					Number(item.endSourceTick) <= Number(item.sourceTick)))
		)
			throw Error("Invalid reviewed music anchor point");
		anchors.push({
			key: `${item.key}:start`,
			sourceTick: Number(item.sourceTick),
		});
		if (item.endSourceTick !== undefined)
			anchors.push({
				key: `${item.key}:end`,
				sourceTick: Number(item.endSourceTick),
			});
		labels.push({
			key: item.key,
			label: item.label,
			hasEnd: item.endSourceTick !== undefined,
		});
	}
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const resourceSha256 = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return {
		name: file.name,
		kind: resource.kind,
		labels,
		anchorSource: {
			sourceSha256: resource.source.sha256,
			resourceSha256,
			resourceRevision: 1,
			reviewReference: resource.reviewReference,
			anchors,
		},
	};
}

export async function projectMusicAnchorFile({
	engine,
	file,
	bindingId,
	expectedNativeRevision,
	expectedGridRevision,
	expectedMappingHash,
	sourceAvailability,
}: {
	engine: TransactionRead;
	file: MusicAnchorFile;
	bindingId: string;
	expectedNativeRevision?: number;
	expectedGridRevision?: number;
	expectedMappingHash?: string;
	sourceAvailability?: MusicGridSourceAvailabilityProbe;
}) {
	const result = await queryMusicGrid({
		engine,
		sourceAvailability,
		request: {
			kind: "project-anchors",
			bindingId,
			expectedNativeRevision,
			expectedGridRevision,
			expectedMappingHash,
			anchorSource: file.anchorSource,
			frameQuantize: true,
		},
	});
	if (result.status !== "ready")
		return {
			status: String(result.status),
			reason: String(result.reason ?? "Anchor projection unavailable"),
			points: [],
		};
	const results: unknown[] = Array.isArray(result.results)
		? result.results
		: [];
	const points = file.labels.flatMap((label) => {
		const start = results.find(
			(value) => record(value) && value.key === `${label.key}:start`,
		);
		const end = results.find(
			(value) => record(value) && value.key === `${label.key}:end`,
		);
		if (
			!record(start) ||
			start.status !== "projected" ||
			!Number.isSafeInteger(start.frameTick) ||
			(label.hasEnd &&
				(!record(end) ||
					end.status !== "projected" ||
					!Number.isSafeInteger(end.frameTick)))
		)
			return [];
		return [
			{
				...label,
				startTick: Number(start.frameTick),
				endTick: record(end) ? Number(end.frameTick) : Number(start.frameTick),
			},
		];
	});
	return {
		status: "ready",
		nativeRevision: result.nativeRevision,
		gridRevision: result.gridRevision,
		mappingHash: result.mappingHash,
		points,
		unavailableCount: file.labels.length - points.length,
	};
}
