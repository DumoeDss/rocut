import type {
	TunnelNativeCapture,
	TunnelNativeOutput,
} from "./mv-tunnel-pixel-suite";
import type { TunnelOracleFrame } from "./mv-tunnel-oracle";
import type { TunnelCanvasControl } from "./mv-tunnel-canvas-controls";

const WIDTH = 1920,
	HEIGHT = 1080;
interface DifferencePoint {
	x: number;
	y: number;
	channel: number;
	a: number;
	b: number;
	delta: number;
}
export function tunnelFrame4(): TunnelOracleFrame {
	return {
		time: 12.25 + 4 / 60,
		shotStart: 12.25,
		duration: 6,
		beats: Array.from({ length: 61 }, (_, i) => i * 0.5),
		bpm: 120,
		downbeatIndex0: 1,
		args: {},
	};
}
export function tunnelDiagnosticDifference({
	a,
	b,
	width = WIDTH,
	height = HEIGHT,
}: {
	a: Uint8ClampedArray;
	b: Uint8ClampedArray;
	width?: number;
	height?: number;
}) {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width <= 0 ||
		height <= 0 ||
		a.length !== width * height * 4 ||
		b.length !== a.length
	)
		throw Error("Tunnel diagnostic requires complete RGBA dimensions");
	let max = 0,
		total = 0,
		changed = 0;
	let first: {
		x: number;
		y: number;
		channel: number;
		a: number;
		b: number;
		delta: number;
	} | null = null;
	let maximum: DifferencePoint | null = null;
	let x0 = width,
		y0 = height,
		x1 = -1,
		y1 = -1;
	for (let i = 0; i < a.length; i++) {
		const delta = a[i]! - b[i]!,
			d = Math.abs(delta);
		if (!d) continue;
		const pixel = Math.floor(i / 4),
			x = pixel % width,
			y = Math.floor(pixel / width);
		const point = { x, y, channel: i % 4, a: a[i]!, b: b[i]!, delta };
		first ??= point;
		if (d > max) {
			max = d;
			maximum = point;
		}
		total += d;
		changed++;
		x0 = Math.min(x0, x);
		y0 = Math.min(y0, y);
		x1 = Math.max(x1, x);
		y1 = Math.max(y1, y);
	}
	return {
		max,
		mae: total / a.length,
		changed,
		first,
		maximum,
		bbox: changed ? { x0, y0, x1, y1 } : null,
	};
}
interface OriginalCapture {
	render(request: {
		frame: TunnelOracleFrame;
		control?: TunnelCanvasControl;
	}): Promise<{
		pixels: Uint8ClampedArray;
		postPixels: Uint8ClampedArray;
		provenance: unknown;
	}>;
}
/** Pass a native capture created with onPlan storing its latest root, and
 * readNativePlan returning that root. Persist returned typed-array buffers as
 * .rgba files (1920x1080 RGBA8) and metadata/plans as JSON; never stringify the
 * binary bundle. No threshold/producer policy or original algorithm is changed. */
export async function diagnoseTunnelFrame4({
	oracle,
	captureNative,
	readNativePlan,
}: {
	oracle: OriginalCapture;
	captureNative: TunnelNativeCapture;
	readNativePlan(): unknown;
}) {
	const frame = tunnelFrame4();
	const snapshot = (v: {
		pixels: Uint8ClampedArray;
		postPixels: Uint8ClampedArray;
	}) => {
		if (
			v.pixels.length !== WIDTH * HEIGHT * 4 ||
			v.postPixels.length !== v.pixels.length
		)
			throw Error("Tunnel diagnostic requires full scene/post RGBA");
		return { scene: v.pixels.slice(), post: v.postPixels.slice() };
	};
	const native = async (control?: string) => {
		const output: TunnelNativeOutput = await captureNative({
			frame,
			index: 4,
			control,
		});
		const plan = readNativePlan();
		if (!plan || typeof plan !== "object")
			throw Error("Tunnel diagnostic native plan missing");
		return {
			rgba: snapshot(output),
			plan: structuredClone(plan),
			proof: structuredClone(output.proof),
		};
	};
	// Snapshot each output before another render can reuse a backing buffer.
	const originalOutput = await oracle.render({ frame });
	const original = {
		rgba: snapshot(originalOutput),
		provenance: structuredClone(originalOutput.provenance),
	};
	const production = await native();
	const originalControl: TunnelCanvasControl = { name: "grain", applied: {} };
	const omittedOutput = await oracle.render({
		frame,
		control: originalControl,
	});
	const originalOmitted = {
		rgba: snapshot(omittedOutput),
		provenance: structuredClone(omittedOutput.provenance),
	};
	if (!(originalControl.applied.grain! > 0))
		throw Error("Tunnel original grain omission receipt missing");
	const nativeOmitted = await native("grain");
	if (!((nativeOmitted.proof.controlApplications?.grain ?? 0) > 0))
		throw Error("Tunnel native grain omission receipt missing");
	const compare = ({
		a,
		b,
	}: {
		a: ReturnType<typeof snapshot>;
		b: ReturnType<typeof snapshot>;
	}) => ({
		scene: tunnelDiagnosticDifference({ a: a.scene, b: b.scene }),
		post: tunnelDiagnosticDifference({ a: a.post, b: b.post }),
	});
	return {
		metadata: {
			frame,
			songTicks: 1478000,
			index: 4,
			width: WIDTH,
			height: HEIGHT,
			format: "rgba8",
			originalApplied: { ...originalControl.applied },
			nativeApplied: { ...nativeOmitted.proof.controlApplications },
			normal: compare({ a: production.rgba, b: original.rgba }),
			omitted: compare({ a: nativeOmitted.rgba, b: originalOmitted.rgba }),
			originalGrainEffect: compare({
				a: originalOmitted.rgba,
				b: original.rgba,
			}),
			nativeGrainEffect: compare({ a: nativeOmitted.rgba, b: production.rgba }),
			scope:
				"frame4 diagnosis only; normal production and original captures retained; no acceptance decision",
		},
		original,
		production,
		originalOmitted,
		nativeOmitted,
	};
}
