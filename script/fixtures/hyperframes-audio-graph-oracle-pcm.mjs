import assert from "node:assert/strict";
import { near } from "./hyperframes-audio-graph-oracle-support.mjs";
import { nativeWorklets } from "./hyperframes-audio-graph-oracle-worklets.mjs";

const chainOf = (nodes) => ({ version: 1, nodes });

export async function pcmCases(native, check) {
	check(
		"serial-tail-budget-and-deterministic-impulse",
		"native-control-math",
		() => {
			const input = chainOf([
				{ type: "delay", params: { time: 100, feedback: 0.5, mix: 1 } },
				{ type: "reverb", params: { size: 0.5, wet: 1 } },
			]);
			near(native.tail.chainTailSeconds(input), 2.9);
			assert.equal(
				native.tail.chainTailSeconds(
					chainOf([
						{ type: "delay", params: { time: 5000, feedback: 0.95, mix: 1 } },
					]),
				),
				5,
			);
			assert.equal(
				native.tail.chainTailSeconds(
					chainOf([
						{ type: "reverb", enabled: false, params: { size: 1, wet: 1 } },
					]),
				),
				0,
			);
			assert.equal(
				native.tail.chainTailSeconds(
					chainOf([{ type: "compressor", params: { release: 2000 } }]),
				),
				0,
			);
			const impulse = native.graph.synthesizeReverbImpulse(48000, 0.5, 0.5);
			assert.equal(impulse.length, 91200);
			assert.deepEqual(
				[...impulse.subarray(0, 3)],
				[0.004111000802367926, 0.010505703277885914, -0.006603046786040068],
			);
			assert.deepEqual(
				impulse,
				native.graph.synthesizeReverbImpulse(48000, 0.5, 0.5),
			);
			const energy = impulse.reduce((sum, value) => sum + value * value, 0);
			near(energy, 1, 1e-8);
			return {
				serialTailSeconds: 2.9,
				maximumTailSeconds: 5,
				impulseFrames: impulse.length,
				impulseEnergy: energy,
				convolutionPcm: "not tested",
			};
		},
	);

	const worklets = await nativeWorklets(native.graph);
	check(
		"bus-sum-before-compressor-is-noncommutative",
		"native-worklet-pcm",
		() => {
			const params = {
				threshold: -24,
				ratio: 4,
				attack: 0.01,
				release: 20,
				knee: 1,
			};
			const input = new Float32Array(512).fill(0.15);
			const sum = Float32Array.from(input, (value) => value + value);
			const bus = worklets.render("hf-compressor", params, [sum])[0];
			const trackA = worklets.render("hf-compressor", params, [input])[0];
			const trackB = worklets.render("hf-compressor", params, [input])[0];
			const independentlyProcessed = trackA.at(-1) + trackB.at(-1);
			assert.equal(bus.at(-1), 0.0931709036231041);
			assert.equal(independentlyProcessed, 0.15669415891170502);
			assert.ok(Math.abs(bus.at(-1) - independentlyProcessed) > 0.06);
			return {
				sourceSha256: worklets.sourceSha256,
				framesPerRender: 512,
				sumThenFx: bus.at(-1),
				fxThenSum: independentlyProcessed,
				boundary:
					"Actual upstream compressor process() in Node VM; no browser bus graph execution",
			};
		},
	);

	check(
		"bitcrush-stereo-and-render-quantum-state",
		"native-worklet-pcm",
		() => {
			const left = Float32Array.from([0.3, 0.9, -0.4, -0.7, 0.1, 0.6]);
			const right = Float32Array.from([-0.3, -0.9, 0.4, 0.7, -0.1, -0.6]);
			const params = { bits: 3, samples: 3, mix: 1 };
			const output = worklets.render("hf-bitcrush", params, [left, right]);
			assert.deepEqual([...output[0]], [0.25, 0.25, 0.25, -0.75, -0.75, -0.75]);
			assert.deepEqual([...output[1]], [-0.25, -0.25, -0.25, 0.75, 0.75, 0.75]);
			assert.deepEqual(
				output,
				worklets.render("hf-bitcrush", params, [left, right], 2),
			);
			const input = Float32Array.from(
				{ length: 512 },
				(_, index) => Math.sin(index * 0.37) * 0.9,
			);
			const complete = worklets.render(
				"hf-bitcrush",
				{ ...params, samples: 5 },
				[input],
			)[0];
			const continued = worklets.render(
				"hf-bitcrush",
				{ ...params, samples: 5 },
				[input],
				64,
			)[0];
			assert.deepEqual(complete, continued);
			const emptyStatePartial = worklets.render(
				"hf-bitcrush",
				{ ...params, samples: 5 },
				[input.subarray(129)],
			)[0];
			assert.notDeepEqual(
				emptyStatePartial,
				complete.subarray(129),
				"A partial render cannot silently reset state",
			);
			return {
				stereo: output.map((channel) => [...channel]),
				quantumInvariantFrames: 512,
				emptyStatePartialDiffers: true,
			};
		},
	);
}
