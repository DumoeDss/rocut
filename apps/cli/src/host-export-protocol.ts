/** Wire support only; the selected pane must still test its actual encoder. */
export const LEGACY_EXPORT_PROTOCOL = Object.freeze({
	version: 2,
	videoChroma: Object.freeze(["420", "444"] as const),
});
export const EXPORT_PROTOCOL = Object.freeze({
	...LEGACY_EXPORT_PROTOCOL,
	version: 3,
	videoQuantizer: true,
});

export function supportsHighChromaProtocol(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const protocol = value as Record<string, unknown>;
	return (
		(protocol.version === 2 || protocol.version === 3) &&
		Array.isArray(protocol.videoChroma) &&
		protocol.videoChroma.includes("444")
	);
}

export function surfaceExportProtocol(query: URLSearchParams) {
	if (
		query.get("exportProtocol") === "3" &&
		(query.get("exportVideoQuantizer") === "true" ||
			query.get("exportVideoChroma") === "444")
	)
		return {
			version: 3,
			...(query.get("exportVideoQuantizer") === "true"
				? { videoQuantizer: true }
				: {}),
			...(query.get("exportVideoChroma") === "444"
				? { videoChroma: LEGACY_EXPORT_PROTOCOL.videoChroma }
				: {}),
		};
	return query.get("exportProtocol") === "2" &&
		query.get("exportVideoChroma") === "444"
		? LEGACY_EXPORT_PROTOCOL
		: undefined;
}

export function supportsQuantizerProtocol(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return (
		"version" in value &&
		value.version === 3 &&
		"videoQuantizer" in value &&
		value.videoQuantizer === true
	);
}

export async function requireQuantizerHost(
	readExportStatus: () => Promise<unknown>,
) {
	const status = await readExportStatus();
	if (
		!status ||
		typeof status !== "object" ||
		!("protocol" in status) ||
		!supportsQuantizerProtocol(status.protocol)
	)
		throw Error(
			"This Host does not declare explicit VP9 quantizer export support; update the Host and editor pane before retrying.",
		);
}

/** CLI text decoding only; Rust owns the integer range and format admission. */
export function parseVideoQuantizerFlag(
	value: string | true | undefined,
): number | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== "string" ||
		value.trim() !== value ||
		value === "" ||
		!Number.isFinite(Number(value))
	)
		throw Error("--video-quantizer requires a numeric value");
	return Number(value);
}

/** Explicit 4:4:4 must never reach an old Host that would discard the field. */
export async function requireHighChromaHost(
	readExportStatus: () => Promise<unknown>,
) {
	const status = await readExportStatus();
	if (
		!status ||
		typeof status !== "object" ||
		!supportsHighChromaProtocol((status as Record<string, unknown>).protocol)
	)
		throw new Error(
			"This Host does not declare WebM 4:4:4 export protocol support; update the Host and editor pane before retrying.",
		);
}

export function parseVideoChromaFlag(
	value: string | true | undefined,
	format: string,
): "420" | "444" | undefined {
	if (value === undefined) return undefined;
	if (value !== "420" && value !== "444")
		throw new Error("--video-chroma requires 420 or 444");
	if (value === "444" && format !== "webm")
		throw new Error("--video-chroma 444 requires --format webm");
	return value;
}
