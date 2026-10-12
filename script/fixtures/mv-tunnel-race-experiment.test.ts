import { expect, test } from "bun:test";
import { tunnelRaceFailureRecorder } from "./mv-tunnel-race-experiment";
import { observeTunnelCanvas } from "./mv-tunnel-oracle-observation";
import { controlledTunnelContext } from "./mv-tunnel-canvas-controls";

test("observer permits the existing gradient wrapper and delegates each stop once", () => {
	let calls = 0;
	const gradient = { addColorStop() { calls++; } };
	const context = {
		getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
		getContextAttributes: () => ({ alpha: true }),
		createRadialGradient: () => gradient,
	} as unknown as CanvasRenderingContext2D;
	const observed = observeTunnelCanvas(context);
	const controlled = controlledTunnelContext({ ctx: observed.ctx });
	controlled.createRadialGradient(0, 0, 0, 0, 0, 1).addColorStop(0, "#000");
	expect(calls).toBe(1);
	expect(observed.records.filter(record => (record as { method: string }).method === "addColorStop")).toHaveLength(1);
});

test("failed follow-up retains original failing bytes and does not replace the gate failure", async () => {
	const expected = new Uint8ClampedArray(1920 * 1080 * 4).fill(1);
	const actual = new Uint8ClampedArray(expected.length).fill(2);
	const record = tunnelRaceFailureRecorder({
		oracle: {
			async render() {
				expected[0] = 99;
				actual[0] = 100;
				throw Error("follow-up oracle failed");
			},
			dispose() { return; },
		},
		async captureNative() { throw Error("not reached"); },
		readPlan: () => ({ kind: "tunnel", preflight: true }),
	});
	await record({ key: "original-failure", frame: {
		time: 12.25, shotStart: 12.25, duration: 6, beats: [], bpm: 120,
		downbeatIndex0: 1, args: {},
	}, index: 0, expected: { pixels: expected, postPixels: expected },
	actual: { pixels: actual, postPixels: actual } });
	expect(globalThis.__tunnelRaceFailure?.buffers.original?.pixels[0]).toBe(1);
	expect(globalThis.__tunnelRaceFailure?.buffers.native?.pixels[0]).toBe(2);
	expect(globalThis.__tunnelRaceFailure?.metadata.key).toBe("original-failure");
	expect(globalThis.__tunnelRaceFailure?.metadata.diagnosticError).toBe("Error: follow-up oracle failed");
	globalThis.__tunnelRaceFailure = undefined;
});
