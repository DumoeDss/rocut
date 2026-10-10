import assert from "node:assert/strict";
import test from "node:test";
import type { TunnelNativeCapture } from "./mv-tunnel-pixel-suite";
import {
	diagnoseTunnelFrame4,
	tunnelDiagnosticDifference,
	tunnelFrame4,
} from "./mv-tunnel-native-diagnostic";

test("difference reports first channel, maximum and inclusive pixel bbox", () => {
	const a = new Uint8ClampedArray(16),
		b = a.slice();
	a[5] = 3;
	a[15] = 9;
	const result = tunnelDiagnosticDifference({ a, b, width: 2, height: 2 });
	assert.deepEqual(result.first, {
		x: 1,
		y: 0,
		channel: 1,
		a: 3,
		b: 0,
		delta: 3,
	});
	assert.deepEqual(result.maximum, {
		x: 1,
		y: 1,
		channel: 3,
		a: 9,
		b: 0,
		delta: 9,
	});
	assert.deepEqual(result.bbox, { x0: 1, y0: 0, x1: 1, y1: 1 });
	assert.equal(result.max, 9);
	assert.equal(result.mae, 0.75);
	assert.equal(result.changed, 2);
	assert.equal(
		tunnelDiagnosticDifference({ a, b: a, width: 2, height: 2 }).bbox,
		null,
	);
	assert.throws(
		() => tunnelDiagnosticDifference({ a, b, width: 1, height: 2 }),
		/dimensions/,
	);
});
function captures({ originalReceipt = 1, nativeReceipt = 1 } = {}) {
	const pixels = new Uint8ClampedArray(1920 * 1080 * 4);
	let plan: unknown;
	const requests: string[] = [];
	const oracle = {
		async render({
			frame,
			control,
		}: {
			frame: ReturnType<typeof tunnelFrame4>;
			control?: { applied: Record<string, number> };
		}) {
			assert.equal(frame.time, 12.316666666666666);
			pixels.fill(0);
			pixels[0] = control ? 3 : 1;
			if (control) control.applied.grain = originalReceipt;
			requests.push(control ? "original-omitted" : "original-normal");
			return { pixels, postPixels: pixels, provenance: {} };
		},
	};
	const captureNative: TunnelNativeCapture = async ({ index, control }) => {
		const controlApplications: Record<string, number> = control
			? { grain: nativeReceipt }
			: {};
		assert.equal(index, 4);
		pixels.fill(0);
		pixels[0] = control ? 4 : 2;
		plan = {
			kind: "tunnel",
			commands: [{ kind: "grain" }],
			control: control ?? null,
		};
		requests.push(control ? "native-omitted" : "native-normal");
		return {
			pixels,
			postPixels: pixels,
			post: {},
			metrics: { mincho800: {}, dot400: {} },
			proof: {
				planKind: "tunnel",
				runtime: "renderProgrammaticCanvas",
				pendingMetricRequestsBefore: 3,
				pendingMetricRequestsAfter: 0,
				fontHashes: {},
				sourceIdentity: "a".repeat(64),
				postBackend: "controlled-reference-post-v1",
				controlApplications,
			},
		};
	};
	return { oracle, captureNative, readNativePlan: () => plan, requests };
}
test("diagnostic retains normal and omitted RGBA snapshots and both unchanged native plans", async () => {
	const input = captures();
	const result = await diagnoseTunnelFrame4(input);
	assert.deepEqual(input.requests, [
		"original-normal",
		"native-normal",
		"original-omitted",
		"native-omitted",
	]);
	assert.deepEqual(
		[
			result.original.rgba.scene[0],
			result.production.rgba.scene[0],
			result.originalOmitted.rgba.scene[0],
			result.nativeOmitted.rgba.scene[0],
		],
		[1, 2, 3, 4],
	);
	assert.deepEqual(result.production.plan, {
		kind: "tunnel",
		commands: [{ kind: "grain" }],
		control: null,
	});
	assert.deepEqual(result.nativeOmitted.plan, {
		kind: "tunnel",
		commands: [{ kind: "grain" }],
		control: "grain",
	});
	assert.equal(result.metadata.originalApplied.grain, 1);
	assert.equal(result.metadata.nativeApplied.grain, 1);
	assert.equal(result.metadata.normal.scene.max, 1);
	assert.equal(result.metadata.omitted.scene.max, 1);
	assert.equal(result.metadata.songTicks, 1478000);
});
test("missing either applied grain receipt fails closed", async () => {
	await assert.rejects(
		diagnoseTunnelFrame4(captures({ originalReceipt: 0 })),
		/original grain omission receipt/,
	);
	await assert.rejects(
		diagnoseTunnelFrame4(captures({ nativeReceipt: 0 })),
		/native grain omission receipt/,
	);
});
