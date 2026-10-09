function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Export options the host relays from the CLI; mirrors `ExportOptions`. */
export interface HostExportOptions {
	readonly format: "mp4" | "webm";
	readonly quality: "low" | "medium" | "high" | "very_high";
	readonly includeAudio?: boolean;
	readonly videoChroma?: "420" | "444";
	readonly videoQuantizer?: number;
	readonly range?: {
		readonly startTime: number;
		readonly endTime: number;
	};
}

export function isHostExportOptions(
	value: Record<string, unknown>,
): value is Record<string, unknown> & HostExportOptions {
	const { format, quality, includeAudio, range, videoChroma, videoQuantizer } =
		value;
	if (
		videoQuantizer !== undefined &&
		(typeof videoQuantizer !== "number" || !Number.isFinite(videoQuantizer))
	)
		return false;
	if (
		videoChroma !== undefined &&
		videoChroma !== "420" &&
		videoChroma !== "444"
	)
		return false;
	if (videoChroma === "444" && format !== "webm") return false;
	if (format !== "mp4" && format !== "webm") return false;
	if (
		quality !== "low" &&
		quality !== "medium" &&
		quality !== "high" &&
		quality !== "very_high"
	) {
		return false;
	}
	if (includeAudio !== undefined && typeof includeAudio !== "boolean") {
		return false;
	}
	return (
		range === undefined ||
		(isRecord(range) &&
			typeof range.startTime === "number" &&
			typeof range.endTime === "number")
	);
}

/** Advertise wire support, not browser/encoder capabilities. */
export function advertiseExportProtocol(query: URLSearchParams) {
	query.set("exportProtocol", "3");
	query.set("exportVideoQuantizer", "true");
	query.set("exportVideoChroma", "444");
}
