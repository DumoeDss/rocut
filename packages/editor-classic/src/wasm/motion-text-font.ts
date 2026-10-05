import * as wasm from "opencut-wasm";

export interface MotionTextFontCoverage {
	readonly faceIndex: number;
	readonly glyphCount: number;
	readonly missingCodePoints: readonly number[];
}

export interface MotionTextFontInspection extends MotionTextFontCoverage {
	readonly contentDigest: string;
}

export interface MotionTextFontCoverageResult {
	readonly inspection: MotionTextFontCoverage | null;
	readonly error: string | null;
}

export interface MotionTextFontInspectionResult {
	readonly inspection: MotionTextFontInspection | null;
	readonly error: string | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeCoverage(value: unknown): MotionTextFontCoverageResult {
	if (!isRecord(value)) {
		throw new TypeError(
			"Motion-text font inspection returned a non-object result.",
		);
	}
	const inspection = value.inspection;
	const error = value.error;
	if (error !== null && typeof error !== "string") {
		throw new TypeError(
			"Motion-text font inspection returned an invalid error.",
		);
	}
	if (inspection === null) return { inspection: null, error };
	if (
		!isRecord(inspection) ||
		typeof inspection.faceIndex !== "number" ||
		typeof inspection.glyphCount !== "number" ||
		!Array.isArray(inspection.missingCodePoints) ||
		!inspection.missingCodePoints.every(
			(codePoint) =>
				typeof codePoint === "number" && Number.isInteger(codePoint),
		)
	) {
		throw new TypeError(
			"Motion-text font inspection returned an invalid inspection payload.",
		);
	}
	return {
		inspection: {
			faceIndex: inspection.faceIndex,
			glyphCount: inspection.glyphCount,
			missingCodePoints: inspection.missingCodePoints,
		},
		error,
	};
}

function decodeInspection(value: unknown): MotionTextFontInspectionResult {
	const result = decodeCoverage(value);
	if (!result.inspection) return { inspection: null, error: result.error };
	if (
		!isRecord(value) ||
		!isRecord(value.inspection) ||
		typeof value.inspection.contentDigest !== "string"
	) {
		throw new TypeError(
			"Motion-text font inspection returned an invalid content digest.",
		);
	}
	return {
		inspection: {
			...result.inspection,
			contentDigest: value.inspection.contentDigest,
		},
		error: result.error,
	};
}

export function inspectMotionTextFontCoverage({
	bytes,
	text,
	faceIndex = 0,
}: {
	bytes: Uint8Array;
	text: string;
	faceIndex?: number;
}): MotionTextFontCoverageResult {
	const candidate: unknown = Reflect.get(wasm, "inspectMotionTextFontCoverage");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose inspectMotionTextFontCoverage.",
		);
	}
	return decodeCoverage(candidate({ bytes, text, faceIndex }));
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
