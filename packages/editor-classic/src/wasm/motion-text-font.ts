import * as wasm from "opencut-wasm";

export interface MotionTextFontInspection {
	readonly contentDigest: string;
	readonly faceIndex: number;
	readonly glyphCount: number;
	readonly missingCodePoints: readonly number[];
}

export interface MotionTextFontInspectionResult {
	readonly inspection: MotionTextFontInspection | null;
	readonly error: string | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeInspection(value: unknown): MotionTextFontInspectionResult {
	if (!isRecord(value)) {
		throw new TypeError("Motion-text font inspection returned a non-object result.");
	}
	const inspection = value.inspection;
	const error = value.error;
	if (error !== null && typeof error !== "string") {
		throw new TypeError("Motion-text font inspection returned an invalid error.");
	}
	if (inspection === null) return { inspection: null, error };
	if (
		!isRecord(inspection) ||
		typeof inspection.contentDigest !== "string" ||
		typeof inspection.faceIndex !== "number" ||
		typeof inspection.glyphCount !== "number" ||
		!Array.isArray(inspection.missingCodePoints) ||
		!inspection.missingCodePoints.every(
			(codePoint) => typeof codePoint === "number" && Number.isInteger(codePoint),
		)
	) {
		throw new TypeError(
			"Motion-text font inspection returned an invalid inspection payload.",
		);
	}
	return {
		inspection: {
			contentDigest: inspection.contentDigest,
			faceIndex: inspection.faceIndex,
			glyphCount: inspection.glyphCount,
			missingCodePoints: inspection.missingCodePoints,
		},
		error,
	};
}

export function inspectMotionTextFont({
	bytes,
	text,
	faceIndex = 0,
}: {
	bytes: Uint8Array;
	text: string;
	faceIndex?: number;
}): MotionTextFontInspectionResult {
	const candidate: unknown = Reflect.get(wasm, "inspectMotionTextFont");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose inspectMotionTextFont.",
		);
	}
	const result: unknown = candidate({
		bytes,
		text,
		faceIndex,
	});
	return decodeInspection(result);
}
