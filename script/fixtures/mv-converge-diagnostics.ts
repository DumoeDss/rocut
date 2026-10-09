import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { MV_CONVERGE_RENDERER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-converge-renderer";
import type { ConvergeReferenceFrame } from "./mv-converge-reference-contract";
import type { createConvergeReference } from "./mv-converge-reference-browser";
import {
	traceConvergeCanvas,
	type ConvergePaintTrace,
} from "./mv-converge-trace";
import { difference, pixels } from "./mv-converge-capture";

type Pixel = {
	x: number;
	y: number;
	max: number;
	actual: number[];
	expected: number[];
};
/** Bounded statistics even if an entirely different frame is accidentally compared. */
export function convergeDifferenceDetails(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
	width: number,
	height: number,
) {
	const histogram = Array<number>(256).fill(0),
		largest: Pixel[][] = Array.from({ length: 256 }, () => []);
	const regions = new Map<
		string,
		{
			x: number;
			y: number;
			width: number;
			height: number;
			changedPixels: number;
			absoluteError: number;
			max: number;
		}
	>();
	let changedPixels = 0,
		x0 = width,
		y0 = height,
		x1 = -1,
		y1 = -1;
	for (let p = 0; p < width * height; p++) {
		let max = 0,
			total = 0;
		for (let c = 0; c < 4; c++) {
			const d = Math.abs(actual[p * 4 + c]! - expected[p * 4 + c]!);
			histogram[d] = histogram[d]! + 1;
			max = Math.max(max, d);
			total += d;
		}
		if (!max) continue;
		const x = p % width,
			y = Math.floor(p / width);
		changedPixels++;
		x0 = Math.min(x0, x);
		y0 = Math.min(y0, y);
		x1 = Math.max(x1, x);
		y1 = Math.max(y1, y);
		if (largest[max]!.length < 32)
			largest[max]!.push({
				x,
				y,
				max,
				actual: [...actual.subarray(p * 4, p * 4 + 4)],
				expected: [...expected.subarray(p * 4, p * 4 + 4)],
			});
		const rx = Math.floor(x / 64) * 64,
			ry = Math.floor(y / 64) * 64,
			key = `${rx}:${ry}`;
		const region = regions.get(key) ?? {
			x: rx,
			y: ry,
			width: Math.min(64, width - rx),
			height: Math.min(64, height - ry),
			changedPixels: 0,
			absoluteError: 0,
			max: 0,
		};
		region.changedPixels++;
		region.absoluteError += total;
		region.max = Math.max(region.max, max);
		regions.set(key, region);
	}
	return {
		width,
		height,
		changedPixels,
		boundingBox: changedPixels
			? { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
			: null,
		histogram: histogram.flatMap((count, delta) =>
			delta && count ? [{ delta, channels: count }] : [],
		),
		topPixels: largest.reverse().flat().slice(0, 32),
		regions: [...regions.values()]
			.sort((a, b) => b.max - a.max || b.absoluteError - a.absoluteError)
			.slice(0, 12),
	};
}

async function png(data: Uint8ClampedArray, width: number, height: number) {
	const canvas = new OffscreenCanvas(width, height),
		ctx = canvas.getContext("2d")!;
	try {
		ctx.putImageData(
			new ImageData(new Uint8ClampedArray(data), width, height),
			0,
			0,
		);
		const bytes = new Uint8Array(
			await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
		);
		let text = "";
		for (let i = 0; i < bytes.length; i += 32768)
			text += String.fromCharCode(...bytes.subarray(i, i + 32768));
		return btoa(text);
	} finally {
		canvas.width = canvas.height = 1;
	}
}
function traceDifferences(
	actual: readonly ConvergePaintTrace[],
	expected: readonly ConvergePaintTrace[],
) {
	const differences: unknown[] = [];
	const matrices: {
		paint: number;
		delta: number[];
		actual: readonly number[];
		expected: readonly number[];
	}[] = [];
	for (let i = 0; i < Math.min(actual.length, expected.length); i++) {
		const a = actual[i]!,
			b = expected[i]!;
		const matrixDelta = a.transform.map((value, j) => value - b.transform[j]!);
		if (matrixDelta.some((value) => value !== 0))
			matrices.push({
				paint: i,
				delta: matrixDelta,
				actual: a.transform,
				expected: b.transform,
			});
		const changed = {
			operation: a.op !== b.op,
			matrix: matrixDelta.some((value) => value !== 0),
			path: JSON.stringify(a.path) !== JSON.stringify(b.path),
			style: JSON.stringify(a.style) !== JSON.stringify(b.style),
			state:
				a.opacity !== b.opacity ||
				a.composite !== b.composite ||
				(a.op.startsWith("stroke") &&
					(a.width !== b.width || a.cap !== b.cap || a.join !== b.join)),
		};
		if (Object.values(changed).some(Boolean))
			differences.push({
				paint: i,
				changed,
				matrixDelta,
				actual: a,
				expected: b,
			});
	}
	return {
		actualPaints: actual.length,
		expectedPaints: expected.length,
		differenceCount: differences.length,
		matrixDifferenceCount: matrices.length,
		matrixDifferences: matrices.slice(0, 100),
		firstDifferences: differences.slice(0, 100),
	};
}

export function createConvergeDiagnostics() {
	const saved = new Set<string>();
	return async ({
		label,
		source,
		index,
		actual,
		expected,
		oracle,
		originalFrame,
	}: {
		label: string;
		source: ProgrammaticSource;
		index: number;
		actual: Uint8ClampedArray;
		expected: Uint8ClampedArray;
		oracle: Awaited<ReturnType<typeof createConvergeReference>>;
		originalFrame: ConvergeReferenceFrame;
	}) => {
		const details = convergeDifferenceDetails(
			actual,
			expected,
			source.width,
			source.height,
		);
		const sink: unknown = Reflect.get(globalThis, "__writeConvergeDiagnostic");
		if (typeof sink !== "function" || saved.has(label) || saved.size >= 6)
			return details;
		saved.add(label);
		await sink(label, "actual", await png(actual, source.width, source.height));
		await sink(
			label,
			"expected",
			await png(expected, source.width, source.height),
		);
		const step =
			(120000 * source.frameRate.denominator) / source.frameRate.numerator;
		const frame = resolveProgrammaticFrame({
			source,
			clipStart: 0,
			clipDuration: source.durationFrames * step,
			trimStart: 0,
			timelineTime: index * step,
		});
		if (frame?.recipePlan?.root.kind !== "converge")
			throw Error("Diagnostic source must resolve to the real converge plan");
		const plan = frame.recipePlan.root.data;
		await sink(
			label,
			"plan",
			JSON.stringify({
				source,
				frame: { ...frame, recipePlan: undefined },
				plan,
			}),
		);
		const native = new OffscreenCanvas(source.width, source.height),
			nativeContext = native.getContext("2d")!;
		const rasterTape = traceConvergeCanvas(nativeContext);
		try {
			// This is the actual production raster helper, replayed only for observation.
			// The separately captured sandbox bitmap remains the acceptance result.
			new Function(
				"ctx",
				"data",
				`${MV_CONVERGE_RENDERER_SOURCE}\ndrawMvConverge(ctx, data);`,
			)(rasterTape.context, plan);
			const replayError = difference(
				pixels(native, source.width, source.height),
				actual,
			);
			const original = await oracle.render(originalFrame, { trace: true });
			try {
				const originalTraceError = difference(
					pixels(original.bitmap, source.width, source.height),
					expected,
				);
				const comparison = traceDifferences(
					rasterTape.paints,
					original.trace ?? [],
				);
				const trace = {
					details,
					replayError,
					originalTraceError,
					instrumentationEquivalent:
						replayError.max === 0 && originalTraceError.max === 0,
					comparison,
					actual: rasterTape.paints,
					expected: original.trace,
				};
				await sink(label, "trace", JSON.stringify(trace));
				return {
					...details,
					diagnosticsSaved: true,
					replayError,
					originalTraceError,
					instrumentationEquivalent: trace.instrumentationEquivalent,
					paintCount: {
						actual: rasterTape.paints.length,
						expected: original.trace?.length,
					},
					traceDifferenceCount: comparison.differenceCount,
				};
			} finally {
				original.bitmap.close();
				original.canvas.width = original.canvas.height = 1;
			}
		} finally {
			native.width = native.height = 1;
		}
	};
}
