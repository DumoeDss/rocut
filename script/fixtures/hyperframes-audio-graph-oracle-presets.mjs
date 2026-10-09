import assert from "node:assert/strict";
import { recordingContext } from "./hyperframes-audio-graph-oracle-support.mjs";

const chainOf = (nodes) => ({ version: 1, nodes });
const gainNode = (id, preset) => ({
	id,
	type: "gain",
	params: { gain: 0 },
	...(preset ? { fromPreset: preset, presetAmount: 0.25 } : {}),
});
const timing = { scheduledAt: 0, elapsed: 0, rate: 1 };

export function presetCases(native, check) {
	check("preset-contiguous-and-split-runs", "native-graph-construction", () => {
		const continuous = native.graph.buildFxChain(
			recordingContext(),
			chainOf([gainNode("a", "p"), gainNode("b", "p")]),
		);
		assert.equal(continuous.presets.p.length, 2);
		assert.deepEqual(
			continuous.presets.p.map((target) => target.param.value),
			[0.25, 0.75],
		);
		assert.ok(
			continuous.nodes[0].handle.output.connections.includes(
				continuous.nodes[1].handle.input,
			),
		);
		const input = chainOf([
			gainNode("a", "p"),
			gainNode("ordinary"),
			gainNode("c", "p"),
		]);
		const split = native.graph.buildFxChain(recordingContext(), input);
		assert.deepEqual(
			split.nodes.map((node) => node.id),
			["a", "ordinary", "c"],
		);
		assert.equal(split.presets.p.length, 4);
		assert.deepEqual(
			split.presets.p.map((target) => target.param.value),
			[0.25, 0.75, 0.25, 0.75],
		);
		const scheduled = native.fxAutomation.scheduleChainAutomation(
			{
				version: 1,
				lanes: [
					{
						target: native.automation.presetAutomationTarget("p"),
						points: [
							{ t: 0, v: 0.2 },
							{ t: 1, v: 0.8 },
						],
					},
				],
			},
			input,
			split.nodes,
			timing,
			split.presets,
		);
		assert.equal(scheduled.length, 4);
		assert.deepEqual(
			split.presets.p.map((target) => target.param.events[1].kind),
			["set", "curve", "set", "curve"],
		);
		assert.equal(
			split.nodes[1].handle.input.gain.events.length,
			0,
			"Preset must not automate the intervening ordinary node",
		);
		const next = chainOf(
			input.nodes.map((node) =>
				node.fromPreset ? { ...node, presetAmount: 0.6 } : node,
			),
		);
		assert.equal(split.update(next), true);
		assert.deepEqual(
			split.presets.p.map((target) => target.param.value),
			[0.6, 0.4, 0.6, 0.4],
		);
		assert.equal(
			split.update(
				chainOf([gainNode("a", "p"), gainNode("c", "p"), gainNode("ordinary")]),
			),
			false,
		);
		continuous.dispose();
		split.dispose();
		return {
			contiguousTargets: 2,
			splitTargets: 4,
			splitAutomationTargets: 4,
			boundaryChangeRequiresRebuild: true,
		};
	});
}
