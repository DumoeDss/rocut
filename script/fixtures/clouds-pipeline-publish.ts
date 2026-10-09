import { captureClouds } from "./clouds-pipeline-capture";
import { pipelineOffset, pipelineSize } from "./clouds-pipeline-cases";
import { cloudsScene } from "./clouds-pipeline-scenes";
import {
	base64,
	check,
	fingerprint,
	pixels,
	same,
	type CloudsPipeline,
} from "./clouds-pipeline-support";

export async function checkCloudsPublication(pipeline: CloudsPipeline) {
	// Scene effects can expose alpha after composition; attached images flatten first.
	const scene = cloudsScene({ placement: "effect-layer", kind: "holes" });
	const time = pipelineOffset + 68000;
	const capture = await captureClouds(pipeline, scene, time);
	const target = document.createElement("canvas");
	Object.assign(target, pipelineSize);
	const context = target.getContext("2d");
	check(context, "Missing preview target context");
	context.fillStyle = "#ec2ba4";
	context.fillRect(0, 0, target.width, target.height);
	const sentinel = pixels(target);
	context.globalCompositeOperation = "multiply";
	await pipeline.renderer.renderToCanvas({
		node: scene.node,
		time,
		targetCanvas: target,
	});
	const actual = pixels(target),
		reference = capture.actual;
	check(
		context.globalCompositeOperation === "multiply",
		"Preview changed caller composite mode",
	);
	check(
		reference.some((value, index) => index % 4 === 3 && value < 255),
		"Alpha preview fixture is opaque",
	);
	if (!same(actual, reference))
		Reflect.set(globalThis, "__cloudsPipelineDiagnostics", {
			stage: "preview full-frame replacement",
			...pipelineSize,
			actual: base64([actual]),
			expected: base64([reference]),
			baseline: base64([sentinel]),
		});
	check(
		same(actual, reference) && !same(actual, sentinel),
		"Preview retained previous target content",
	);
	return {
		name: "alpha preview replaces old content and preserves composite mode",
		mode: context.globalCompositeOperation,
		fingerprint: fingerprint(actual),
		exactCaptureParity: true,
		independentCapture: capture.result,
	};
}
