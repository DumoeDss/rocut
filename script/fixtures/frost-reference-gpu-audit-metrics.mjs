import { referenceRgba } from "./frost-reference-fixture.mjs";

export const FROST_AUDIT_GATES = Object.freeze({
	native: { maxRgbError: 2, meanRgbError: 0.15, maxAlphaError: 0 },
	presentation: { maxRgbError: 5, meanRgbError: 0.5, maxAlphaError: 0 },
	source: {
		mode: "premultiplied",
		maxRgbError: 1,
		meanRgbError: 0.1,
		maxAlphaError: 0,
	},
	presentationFidelity: {
		mode: "premultiplied",
		maxRgbError: 1,
		meanRgbError: 0.1,
		maxAlphaError: 0,
	},
});

export function createFrostMetricAuditor(allmetrics, fail) {
	return function metric(id, check, a, b, gate, premultiplied) {
		if (!a || !b) return;
		let maxRgbError = 0,
			sum = 0,
			maxAlphaError = 0;
		for (let i = 0; i < a.length; i += 4) {
			maxAlphaError = Math.max(maxAlphaError, Math.abs(a[i + 3] - b[i + 3]));
			for (let c = 0; c < 3; c++) {
				const error = Math.abs(
					premultiplied
						? (a[i + c] * a[i + 3]) / 255 - (b[i + c] * b[i + 3]) / 255
						: a[i + c] - b[i + c],
				);
				maxRgbError = Math.max(maxRgbError, error);
				sum += error;
			}
		}
		const meanRgbError = sum / ((a.length / 4) * 3);
		const pass =
			maxRgbError <= gate.maxRgbError &&
			meanRgbError <= gate.meanRgbError &&
			maxAlphaError <= gate.maxAlphaError;
		allmetrics.push({
			id,
			check,
			mode: premultiplied ? "premultiplied" : "straight",
			maxRgbError,
			meanRgbError,
			maxAlphaError,
			gate,
			pass,
		});
		if (!pass) fail(id, check, { maxRgbError, meanRgbError, maxAlphaError });
	};
}

export function auditFrostCaseMetrics(item, out, canonical, metric) {
	const gates = FROST_AUDIT_GATES;
	const canonicalExpected = canonical ? referenceRgba(item, canonical) : null;
	const comparisons = [
		["nativeReference", out.nativeRgba, item.expected, gates.native, false],
		[
			"canonicalNativeReference",
			out.canonicalNativeRgba,
			canonicalExpected,
			gates.native,
			false,
		],
		[
			"defaultPresentation",
			out.defaultCanvasRgba,
			item.expected,
			gates.presentation,
			true,
		],
		[
			"rawPresentation",
			out.rawCanvasRgba,
			item.expected,
			gates.presentation,
			true,
		],
		[
			"rawPresentationFidelity",
			out.rawCanvasRgba,
			out.nativeRgba,
			gates.presentationFidelity,
			true,
		],
		[
			"defaultPresentationFidelity",
			out.defaultCanvasRgba,
			out.canonicalNativeRgba,
			gates.presentationFidelity,
			true,
		],
		[
			"readbackPresentationFidelity",
			out.readbackCanvasRgba,
			out.canonicalNativeRgba,
			gates.presentationFidelity,
			true,
		],
	];
	for (const [check, a, b, gate, premultiplied] of comparisons)
		metric(item.id, check, a, b, gate, premultiplied);
}
