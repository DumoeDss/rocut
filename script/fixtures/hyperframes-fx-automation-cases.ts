import type {
	FxAutomationLane,
	FxAutomationRequest,
} from "./hyperframes-fx-automation-fixture";

export const fxLane = (
	target: string,
	points: FxAutomationLane["points"],
): FxAutomationLane => ({ target, points });
export const fxNode = (
	type: string,
	params: Record<string, unknown> = {},
	id = "n1",
	extra: Record<string, unknown> = {},
) => ({ type, params, id, ...extra });
export const fxRequest = (
	nodes: Record<string, unknown>[],
	lanes: FxAutomationLane[] = [],
	sampleRate = 48000,
): FxAutomationRequest => ({
	sampleRate,
	chain: { version: 1, nodes },
	automation: { version: 1, lanes },
});

/** Small real-PCM cases; geometry is derived from the actual native tail oracle. */
export function fxAutomationCases(sampleRate: number): FxAutomationRequest[] {
	const cases: FxAutomationRequest[] = [];
	const add = (
		name: string,
		nodes: Record<string, unknown>[],
		lanes: FxAutomationLane[],
	) => cases.push({ name, ...fxRequest(nodes, lanes, sampleRate) });
	add(
		"gain-db-linear",
		[fxNode("gain")],
		[
			fxLane("fx.n1.gain", [
				{ t: 0, v: -18 },
				{ t: 0.100017, v: 6 },
			]),
		],
	);
	add(
		"gain-db-curve",
		[fxNode("gain")],
		[
			fxLane("fx.n1.gain", [
				{ t: 0, v: -18, curve: -0.6 },
				{ t: 0.100017, v: 6 },
			]),
		],
	);
	add(
		"gain-db-via",
		[fxNode("gain")],
		[
			fxLane("fx.n1.gain", [
				{ t: 0, v: -18, curve: -1, viaX: 0.5, viaY: 0.1 },
				{ t: 0.100017, v: 6 },
			]),
		],
	);
	add(
		"filter-log-frequency",
		[fxNode("lowpass", { frequency: 800 })],
		[
			fxLane("fx.n1.frequency", [
				{ t: 0, v: 80 },
				{ t: 0.100017, v: 8000 },
			]),
		],
	);
	add(
		"serial-multiple-lanes",
		[fxNode("gain", {}, "n1"), fxNode("gain", {}, "n2")],
		[
			fxLane("fx.n1.gain", [
				{ t: 0, v: -12 },
				{ t: 0.1, v: 6 },
			]),
			fxLane("fx.n2.gain", [
				{ t: 0, v: 3 },
				{ t: 0.1, v: -6 },
			]),
		],
	);
	add(
		"delay-mapped-time-and-complement-mix",
		[fxNode("delay", { time: 10, feedback: 0, mix: 0.5 })],
		[
			fxLane("fx.n1.time", [
				{ t: 0, v: 10 },
				{ t: 0.1, v: 30 },
			]),
			fxLane("fx.n1.mix", [
				{ t: 0, v: 0 },
				{ t: 0.1, v: 1 },
			]),
		],
	);
	add(
		"duplicate-gain-last-schedule",
		[fxNode("gain")],
		[
			fxLane("fx.n1.gain", [{ t: 0, v: -12 }]),
			fxLane("fx.n1.gain", [{ t: 0, v: 6 }]),
		],
	);
	add(
		"duplicate-delay-first-tail-last-schedule",
		[fxNode("delay", { time: 200, feedback: 0, mix: 1 })],
		[
			fxLane("fx.n1.time", [{ t: 0, v: 20 }]),
			fxLane("fx.n1.time", [{ t: 0, v: 200 }]),
		],
	);
	add(
		"split-preset-blends",
		[
			fxNode("gain", { gain: 6 }, "n1", { fromPreset: "voice" }),
			fxNode("gain", {}, "n2"),
			fxNode("gain", { gain: 6 }, "n3", { fromPreset: "voice" }),
		],
		[
			fxLane("fx.preset.voice", [
				{ t: 0, v: 0 },
				{ t: 0.1, v: 1 },
			]),
		],
	);
	add(
		"disabled-valid-noop",
		[fxNode("gain", { gain: 6 }, "n1", { enabled: false })],
		[
			fxLane("fx.n1.gain", [
				{ t: 0, v: -12 },
				{ t: 0.1, v: 6 },
			]),
		],
	);
	add(
		"onepole-frequency-valid-noop",
		[fxNode("lowpass", { frequency: 800, poles: "1" })],
		[
			fxLane("fx.n1.frequency", [
				{ t: 0, v: 80 },
				{ t: 0.1, v: 8000 },
			]),
		],
	);
	add(
		"worklet-param-valid-noop",
		[fxNode("bitcrush", { bits: 8 })],
		[
			fxLane("fx.n1.bits", [
				{ t: 0, v: 2 },
				{ t: 0.1, v: 16 },
			]),
		],
	);
	add(
		"orphan-and-enum-drop",
		[fxNode("saturate", { threshold: -6 })],
		[
			fxLane("fx.absent.gain", [{ t: 0, v: -6 }]),
			fxLane("fx.n1.type", [{ t: 0, v: 1 }]),
		],
	);
	add(
		"reverb-size-noop-but-longer-tail",
		[fxNode("reverb", { size: 0, wet: 0.5, dry: 0.5 })],
		[fxLane("fx.n1.size", [{ t: 0, v: 1 }])],
	);
	add(
		"reverb-size-noop-but-shorter-tail",
		[fxNode("reverb", { size: 1, wet: 0.5, dry: 0.5 })],
		[fxLane("fx.n1.size", [{ t: 0, v: 0 }])],
	);
	return cases;
}

export function fxAutomationInput(
	frames: number,
	sampleRate: number,
	offsetFrames = 0,
) {
	const input = Buffer.alloc(frames * 8);
	for (let frame = offsetFrames; frame < frames; frame++) {
		const t = (frame - offsetFrames) / sampleRate;
		input.writeFloatLE(
			0.45 * Math.sin(2 * Math.PI * 211 * t) +
				0.15 * Math.sin(2 * Math.PI * 2300 * t),
			frame * 8,
		);
		input.writeFloatLE(0.37 * Math.sin(2 * Math.PI * 397 * t), frame * 8 + 4);
	}
	return input;
}

export function compareFxAutomationPcm(actual: Buffer, expected: Buffer) {
	if (actual.length !== expected.length) throw Error("PCM geometry mismatch");
	let maxAbs = 0,
		square = 0;
	for (let byte = 0; byte < actual.length; byte += 4) {
		const a = actual.readFloatLE(byte),
			b = expected.readFloatLE(byte);
		if (!Number.isFinite(a) || !Number.isFinite(b))
			throw Error("Nonfinite FX oracle PCM");
		const delta = Math.abs(a - b);
		maxAbs = Math.max(maxAbs, delta);
		square += delta * delta;
	}
	return {
		maxAbs,
		rms: Math.sqrt(square / (actual.length / 4)),
		samples: actual.length / 4,
	};
}
