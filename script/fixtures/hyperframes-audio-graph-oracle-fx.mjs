import assert from "node:assert/strict";
import {
	RecordedWorkletNode,
	near,
	recordingContext,
} from "./hyperframes-audio-graph-oracle-support.mjs";

const chainOf = (nodes) => ({ version: 1, nodes });
const timing = { scheduledAt: 0, elapsed: 0, rate: 1 };

export function fxCases(native, check) {
	const previous = Object.getOwnPropertyDescriptor(
		globalThis,
		"AudioWorkletNode",
	);
	Object.defineProperty(globalThis, "AudioWorkletNode", {
		configurable: true,
		value: RecordedWorkletNode,
	});
	try {
		check(
			"fx-audio-param-exposure-and-scheduler-gating",
			"native-graph-construction",
			() => {
				const expected = {
					gain: ["gain"],
					peaking: ["frequency", "gain", "q"],
					lowshelf: ["frequency", "gain"],
					highshelf: ["frequency", "gain"],
					highpass: ["frequency", "q"],
					lowpass: ["frequency", "q"],
					compressor: [],
					limiter: [],
					gate: [],
					saturate: ["output"],
					bitcrush: [],
					pitchshift: [],
					delay: ["feedback", "mix", "time"],
					chorus: ["delay", "depth", "mix", "speed"],
					phaser: ["in_gain", "out_gain", "speed"],
					reverb: ["dry", "wet"],
				};
				assert.deepEqual(
					[...native.fx.HF_AUDIO_FX_IDS].sort(),
					Object.keys(expected).sort(),
				);
				for (const [type, parameters] of Object.entries(expected)) {
					const handle = native.graph.buildFxNode(recordingContext(), type, {
						poles: "2",
					});
					assert.deepEqual(
						Object.keys(handle.automation ?? {}).sort(),
						parameters,
						type,
					);
					handle.dispose();
				}
				for (const type of ["highpass", "lowpass"]) {
					const handle = native.graph.buildFxNode(recordingContext(), type, {
						poles: "1",
						frequency: 100,
					});
					assert.equal(handle.input.kind, "iir");
					assert.deepEqual(Object.keys(handle.automation ?? {}), []);
					if (type === "highpass") {
						near(handle.input.feedforward[0], 0.9934974813407758);
						near(handle.input.feedback[1], -0.9869949626815514);
					}
					handle.dispose();
				}
				const input = chainOf([
					{ id: "one", type: "highpass", params: { poles: "1" } },
					{ id: "comp", type: "compressor", params: {} },
					{ id: "sat", type: "saturate", params: {} },
					{ id: "room", type: "reverb", params: {} },
				]);
				const built = native.graph.buildFxChain(recordingContext(), input);
				const targets = [
					["fx.one.frequency", 100, 200],
					["fx.comp.threshold", -24, -12],
					["fx.sat.threshold", -12, -6],
					["fx.sat.output", -20, 0],
					["fx.room.size", 0.2, 0.8],
					["fx.room.wet", 0.2, 0.8],
				];
				for (const [target] of targets)
					assert.ok(
						native.automation.resolveAutomationRange(target, input),
						target,
					);
				const automation = {
					version: 1,
					lanes: targets.map(([target, from, to]) => ({
						target,
						points: [
							{ t: 0, v: from },
							{ t: 1, v: to },
						],
					})),
				};
				const scheduled = native.fxAutomation.scheduleChainAutomation(
					automation,
					input,
					built.nodes,
					timing,
					built.presets,
				);
				assert.equal(
					scheduled.length,
					2,
					"Numeric registry knobs without actual AudioParams must be skipped",
				);
				const output =
					built.nodes[2].handle.automation.output[0].param.events[1];
				assert.equal(
					output.kind,
					"curve",
					"dB-to-linear unit mapping cannot use a straight ramp",
				);
				assert.equal(output.values[0], Math.fround(0.1));
				assert.equal(output.values.at(-1), 1);
				built.dispose();
				return {
					exposedParameters: expected,
					onePoleParameters: [],
					numericLanes: 6,
					scheduledLanes: 2,
				};
			},
		);
	} finally {
		if (previous)
			Object.defineProperty(globalThis, "AudioWorkletNode", previous);
		else delete globalThis.AudioWorkletNode;
	}
}
