import type {
	MusicGridQuery,
	MusicGridSourceAvailabilityProbe,
	TransactionRead,
} from "@opencut/editor-contracts";
import { queryMusicGrid } from "../editor/transactions/opencut/music-grid";

export interface TimelineMusicGridView {
	status: string;
	reason?: string;
	nativeRevision?: number;
	gridRevision?: number;
	mappingHash?: string;
	mode?: string;
	reviewReference?: string;
	sourceSha256?: string;
	structureLabels?: string[];
	downbeatsKnown?: boolean;
	points: Array<{
		id: string;
		tick: number;
		frameTick: number;
		downbeat?: boolean;
	}>;
}

/** UI consumes native points verbatim. It never derives beats, downbeats or frame boundaries. */
// eslint-disable-next-line opencut/prefer-object-params -- Shared transport adapter keeps injected query in its established test slot.
export async function readTimelineMusicGrid(
	engine: TransactionRead,
	request: MusicGridQuery,
	query = queryMusicGrid,
	sourceAvailability?: MusicGridSourceAvailabilityProbe,
): Promise<TimelineMusicGridView> {
	const result = await query({ engine, request, sourceAvailability });
	if (result.status !== "ready")
		return {
			status: String(result.status),
			reason:
				typeof result.reason === "string"
					? result.reason
					: "Music grid is unavailable",
			points: [],
		};
	if (
		result.clock !== "scene-timeline-ticks" ||
		!Number.isSafeInteger(result.nativeRevision) ||
		!Number.isSafeInteger(result.gridRevision) ||
		typeof result.mappingHash !== "string" ||
		!Array.isArray(result.points)
	)
		throw Error("Invalid native music-grid view");
	const points = result.points.map((value: unknown) => {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw Error("Invalid native music-grid point");
		// Runtime fields are validated immediately below before use.
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
		const point = value as Record<string, unknown>;
		if (
			typeof point.id !== "string" ||
			!Number.isSafeInteger(point.tick) ||
			!Number.isSafeInteger(point.frameTick) ||
			(point.downbeat !== undefined && typeof point.downbeat !== "boolean")
		)
			throw Error("Invalid native music-grid point");
		return {
			id: point.id,
			tick: Number(point.tick),
			frameTick: Number(point.frameTick),
			...(point.downbeat === undefined
				? {}
				: { downbeat: point.downbeat as boolean }),
		};
	});
	return {
		status: "ready",
		nativeRevision: Number(result.nativeRevision),
		gridRevision: Number(result.gridRevision),
		mappingHash: result.mappingHash,
		mode: String(result.mode),
		reviewReference:
			typeof result.reviewReference === "string"
				? result.reviewReference
				: undefined,
		sourceSha256:
			typeof result.sourceSha256 === "string" ? result.sourceSha256 : undefined,
		structureLabels: Array.isArray(result.meterSegments)
			? result.meterSegments.map((value: unknown) => {
					if (!value || typeof value !== "object") return "拍号未知";
					const meter = Reflect.get(value, "meter"),
						beatUnit = Reflect.get(value, "beatUnit");
					if (
						!meter ||
						typeof meter !== "object" ||
						!beatUnit ||
						typeof beatUnit !== "object"
					)
						return "拍号未知";
					return `${String(Reflect.get(meter, "numerator"))}/${String(Reflect.get(meter, "denominator"))} · 拍单位 ${String(Reflect.get(beatUnit, "numerator"))}/${String(Reflect.get(beatUnit, "denominator"))}`;
				})
			: [],
		downbeatsKnown: result.downbeatsKnown === true,
		points,
	};
}

// eslint-disable-next-line opencut/prefer-object-params -- Same transport contract as the read adapter.
export async function snapTimelineMusicGrid(
	engine: TransactionRead,
	request: MusicGridQuery,
	query = queryMusicGrid,
	sourceAvailability?: MusicGridSourceAvailabilityProbe,
) {
	const result = await query({ engine, request, sourceAvailability });
	if (result.status !== "ready")
		return {
			status: String(result.status),
			reason: String(result.reason ?? "Music grid is unavailable"),
		};
	const sample = Array.isArray(result.results) ? result.results[0] : undefined;
	if (
		!sample ||
		typeof sample !== "object" ||
		sample.key !== "playhead" ||
		sample.status !== "matched" ||
		!Number.isSafeInteger(sample.snappedTick)
	)
		return {
			status: "unmatched",
			reason: String(sample?.reason ?? "No reviewed point within tolerance"),
		};
	return {
		status: "matched",
		tick: Number(sample.snappedTick),
		nativeRevision: result.nativeRevision,
		gridRevision: result.gridRevision,
		mappingHash: result.mappingHash,
	};
}
