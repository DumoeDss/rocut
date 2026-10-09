import { cloudsDifference } from "./clouds-oracle";
import { pipelineSize } from "./clouds-pipeline-cases";
import { expectedAt, type CloudsScene } from "./clouds-pipeline-scenes";
import {
	base64,
	check,
	fingerprint,
	pixels,
	type CloudsPipeline,
} from "./clouds-pipeline-support";

export async function captureClouds(
	pipeline: CloudsPipeline,
	scene: CloudsScene,
	time: number,
) {
	const actual = await pipeline.renderer.renderAndCapture({
		node: scene.node,
		time,
		capture: pixels,
	});
	const expected = expectedAt(scene, time);
	const difference = cloudsDifference(actual, expected, expected.baseline);
	if (difference.failed || difference.identityFailed) {
		Reflect.set(globalThis, "__cloudsPipelineDiagnostics", {
			stage: "independent production capture",
			kind: scene.kind,
			placement: scene.placement,
			timelineTicks: time,
			localTicks: expected.local,
			animated: scene.animated,
			onlyChannel: scene.onlyChannel,
			params: expected.params,
			...pipelineSize,
			source: base64([scene.source]),
			baseline: base64([expected.baseline]),
			expected: base64([expected.pixels]),
			actual: base64([actual]),
			difference,
		});
	}
	check(
		!difference.failed && !difference.identityFailed,
		`${scene.placement}/${scene.kind} t${time} differs from independent oracle: ${JSON.stringify(difference)}`,
	);
	return {
		actual,
		expected,
		result: {
			name: "production capture vs independent oracle",
			kind: scene.kind,
			placement: scene.placement,
			animated: scene.animated,
			onlyChannel: scene.onlyChannel,
			time,
			localTime: expected.local,
			active: expected.active,
			activePixels: expected.activePixels,
			alphaFilledPixels: expected.alphaFilledPixels,
			exteriorSamples: expected.exteriorSamples,
			...difference,
			fingerprint: fingerprint(actual),
		},
	};
}
