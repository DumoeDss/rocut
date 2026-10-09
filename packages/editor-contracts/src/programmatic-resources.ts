/** Logical IDs, never filesystem paths. Bytes live in project attachments. */
export interface ProgrammaticResource {
	readonly id: string;
	readonly kind:
		| "image"
		| "imageSequence"
		| "font"
		| "video"
		| "model"
		| "environment"
		| "analysis"
		| "document"
		| "source";
	readonly attachmentKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly font?: {
		readonly family: string;
		readonly style: "normal" | "italic";
		readonly weight: number;
		/** OpenType axis tag -> instance coordinate; Rust validates tags/limits.
		 * Distinct instances in one source need distinct family/style/weight faces.
		 */
		readonly axes?: Readonly<Record<string, number>>;
	};
}

/** Emitted by Rust frame resolution, never accepted as authored source policy. */
export interface ProgrammaticResourceLimits {
	readonly maxBytes: number;
	readonly maxDecodedBytes: number;
	readonly maxDimension: number;
	readonly maxObjects: number;
}

/** Ephemeral verified bytes; not serialized into the project/source code. */
export interface ResolvedProgrammaticResource {
	readonly resource: ProgrammaticResource;
	readonly body: ArrayBuffer;
}

/** Transport shape only. Rust owns manifest semantics and resource limits. */
export function isProgrammaticResource(
	value: unknown,
): value is ProgrammaticResource {
	const isRecord = (input: unknown): input is Record<string, unknown> =>
		!!input && typeof input === "object" && !Array.isArray(input);
	if (!isRecord(value)) return false;
	const r = value;
	if (
		Object.keys(r).some(
			(key) =>
				![
					"id",
					"kind",
					"attachmentKey",
					"mimeType",
					"byteLength",
					"sha256",
					"font",
				].includes(key),
		)
	)
		return false;
	if (
		!["id", "attachmentKey", "mimeType", "sha256"].every(
			(key) => typeof r[key] === "string",
		) ||
		typeof r.kind !== "string" ||
		![
			"image",
			"imageSequence",
			"font",
			"video",
			"model",
			"environment",
			"analysis",
			"document",
			"source",
		].includes(r.kind) ||
		!Number.isSafeInteger(r.byteLength)
	)
		return false;
	if (r.font === undefined) return true;
	if (!isRecord(r.font)) return false;
	const font = r.font;
	return (
		Object.keys(font).every((key) =>
			["family", "style", "weight", "axes"].includes(key),
		) &&
		typeof font.family === "string" &&
		(font.style === "normal" || font.style === "italic") &&
		Number.isSafeInteger(font.weight) &&
		(font.axes === undefined ||
			(isRecord(font.axes) &&
				Object.values(font.axes).every((value) => typeof value === "number")))
	);
}
