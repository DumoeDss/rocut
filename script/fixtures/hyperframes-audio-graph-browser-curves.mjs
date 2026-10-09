import {
	chain,
	check,
	distance,
	nativeRender,
	pcmArtifact,
	rate,
	renderGraph,
} from "./hyperframes-audio-graph-browser-support.mjs";

export async function verifyCurves() {
	const frames = Math.round(rate * 1.1),
		dry = [
			new Float32Array(frames).fill(0.5),
			new Float32Array(frames).fill(-0.25),
		];
	const identity = chain([]),
		results = [];
	let quadratic;
	for (const curve of [0, 0.5]) {
		const lane = {
			target: "volume",
			points: [
				{ t: 0, v: 0, curve },
				{ t: 1, v: 1 },
			],
		};
		const actual = await renderGraph({
			tracks: [{ channels: dry, fx: identity, gain: lane }],
		});
		const expected = dry.map((channel) =>
			Float32Array.from(
				channel,
				(value, i) => value * Math.min(1, i / rate) ** (curve ? 2 : 1),
			),
		);
		const error = distance(actual, expected);
		check(
			error.max < (curve ? 2e-5 : 2e-7),
			`Native AudioParam curve differs from independent ${curve ? "quadratic" : "linear"} envelope: ${JSON.stringify(error)}`,
		);
		results.push({
			curve,
			error,
			quarter: actual[0][12000],
			afterEndpoint: actual[0][50000],
		});
		if (curve) quadratic = actual;
		const inline = await nativeRender(dry, identity, {
			version: 1,
			lanes: [lane],
		});
		check(
			distance(inline, dry).max === 0,
			"Pinned inline FX runtime unexpectedly applies volume lanes itself",
		);
	}
	const fx = chain([{ type: "gain", id: "g", params: { gain: -12 } }]);
	const gained = await nativeRender(dry, fx, {
		version: 1,
		lanes: [
			{
				target: "fx.g.gain",
				points: [
					{ t: 0, v: -12, curve: 0.5 },
					{ t: 1, v: 0 },
				],
			},
		],
	});
	const expected = dry.map((channel) =>
		Float32Array.from(
			channel,
			(value, i) =>
				value * 10 ** ((-12 + 12 * Math.min(1, i / rate) ** 2) / 20),
		),
	);
	const fxError = distance(gained, expected);
	check(
		fxError.max < 1e-4,
		`Native FX dB gain curve differs from independent math: ${JSON.stringify(fxError)}`,
	);
	return {
		name: "real-audio-param-curves",
		volume: results,
		fxDbGain: fxError,
		upstreamLimit:
			"Inline render schedules FX/preset lanes only. Outer volume must be separately routed. Curved lanes are sampled near 100 Hz before AudioParam interpolation, not analytically exact.",
		artifacts: [await pcmArtifact("quadratic-volume.f32", quadratic)],
	};
}
