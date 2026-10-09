import {
	chain,
	check,
	distance,
	nativeRender,
	pcmArtifact,
	renderGraph,
	scale,
	sum,
} from "./hyperframes-audio-graph-browser-support.mjs";

export async function verifyOrder() {
	const frames = 4096;
	const dry = (left, right) => [
		new Float32Array(frames).fill(left),
		new Float32Array(frames).fill(right),
	];
	const saturate = chain([
		{
			type: "saturate",
			params: { type: "hard", threshold: -6, output: 0, oversample: 1 },
		},
	]);
	const compressor = chain([
		{
			type: "compressor",
			params: {
				threshold: -18,
				ratio: 4,
				attack: 0.01,
				release: 20,
				knee: 1,
				makeup: 0,
				mix: 1,
			},
		},
	]);
	const tracks = [
		{ channels: dry(0.9, -0.7), fx: saturate, gain: 0.4 },
		{ channels: dry(0.6, -0.4), fx: saturate, gain: 0.2 },
	];
	const options = { tracks, busFx: compressor, busGain: 0.6 };
	const actual = await renderGraph(options);
	// Independent topology oracle: each native inline runtime call owns its real
	// OfflineAudioContext. Only gain and summation are mathematical operations.
	const a = scale(
		await nativeRender(tracks[0].channels, saturate),
		tracks[0].gain,
	);
	const b = scale(
		await nativeRender(tracks[1].channels, saturate),
		tracks[1].gain,
	);
	const oracle = scale(
		await nativeRender(sum(a, b), compressor),
		options.busGain,
	);
	const correct = distance(actual, oracle);
	check(
		correct.max < 2e-6,
		`Real full graph differs from native stage oracle: ${JSON.stringify(correct)}`,
	);
	const trackSwap = distance(
		actual,
		await renderGraph({ ...options, gainBeforeTrackFx: true }),
	);
	const busSwap = distance(
		actual,
		await renderGraph({ ...options, gainBeforeBusFx: true }),
	);
	check(trackSwap.rms > 0.001, "Track gain/FX permutation was not observable");
	check(busSwap.rms > 0.001, "Bus gain/FX permutation was not observable");
	const one = dry(0.15, -0.15),
		identity = chain([]);
	const bus = await renderGraph({
		tracks: [
			{ channels: one, fx: identity, gain: 1 },
			{ channels: one, fx: identity, gain: 1 },
		],
		busFx: compressor,
	});
	const distributed = await renderGraph({
		tracks: [
			{ channels: one, fx: compressor, gain: 1 },
			{ channels: one, fx: compressor, gain: 1 },
		],
	});
	const nonlinear = distance(bus, distributed);
	check(
		nonlinear.rms > 0.02,
		`Nonlinear bus was incorrectly distributable: ${JSON.stringify(nonlinear)}`,
	);
	return {
		name: "real-track-and-bus-order",
		correct,
		wrongTrackOrder: trackSwap,
		wrongBusOrder: busSwap,
		nonlinearBusDifference: nonlinear,
		finalSamples: {
			bus: bus.map((c) => c.at(-1)),
			distributed: distributed.map((c) => c.at(-1)),
		},
		artifacts: [
			await pcmArtifact("ordered-graph.f32", actual),
			await pcmArtifact("native-staged-oracle.f32", oracle),
		],
	};
}
