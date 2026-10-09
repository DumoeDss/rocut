import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { captureClouds } from "./clouds-pipeline-capture";
import {
	blackComposite,
	pipelineFps,
	pipelineLocalTicks,
	pipelineOffset,
	pipelineSize,
	pipelineThresholds,
} from "./clouds-pipeline-cases";
import { decodeCloudsVideo } from "./clouds-pipeline-decode";
import { codecDifference } from "./clouds-pipeline-metrics";
import { cloudsScene, expectedAt } from "./clouds-pipeline-scenes";
import {
	base64,
	check,
	fingerprint,
	pixels,
	same,
	type CloudsPipeline,
} from "./clouds-pipeline-support";

export async function checkCloudsExport(pipeline: CloudsPipeline) {
	const scene = cloudsScene({
		placement: "attached",
		kind: "holes",
		animated: true,
		black: true,
	});
	const timelineTicks = pipelineLocalTicks.map(
		(local) => local + pipelineOffset,
	);
	const expected = timelineTicks.map((time) => expectedAt(scene, time).pixels);
	const baseline = blackComposite(scene.source);
	const referenceChecks = [];
	for (const [index, time] of timelineTicks.entries()) {
		const capture = await captureClouds(pipeline, scene, time);
		const identity = codecDifference(baseline, expected[index], baseline);
		check(
			!identity.accepted,
			"Export reference cannot reject a no-effect baseline sequence",
		);
		referenceChecks.push({
			index,
			capture: capture.result,
			baselineCounterfactual: identity,
		});
	}
	const repeatedReference = expected.map((frame) =>
		codecDifference(expected[0], frame, baseline),
	);
	check(
		repeatedReference.slice(1).some((result) => !result.accepted),
		"Export reference cannot reject a repeated first-frame sequence",
	);
	const reset = await pipeline.renderer.renderAndCapture({
		node: scene.baselineNode,
		time: timelineTicks[0],
		capture: pixels,
	});
	check(
		same(reset, baseline),
		"Baseline reset failed before fresh Clouds export",
	);
	const exporter = new SceneExporter({
		...pipelineSize,
		fps: pipelineFps,
		compositor: pipeline.compositor,
		videoCache: pipeline.videoCache,
		format: "webm",
		quality: "very_high",
	});
	const events = { complete: 0, cancelled: 0, error: 0, progress: 0 };
	exporter.on("complete", () => {
		events.complete++;
	});
	exporter.on("cancelled", () => {
		events.cancelled++;
	});
	exporter.on("error", () => {
		events.error++;
	});
	exporter.on("progress", () => {
		events.progress++;
	});
	const frameTicks = 4000;
	const bytes = await exporter.export({
		rootNode: scene.node,
		range: {
			startTime: mediaTime({ ticks: timelineTicks[0] }),
			endTime: mediaTime({
				ticks: timelineTicks[0] + expected.length * frameTicks,
			}),
			duration: mediaTime({ ticks: expected.length * frameTicks }),
		},
	});
	check(
		bytes && bytes.byteLength > 0,
		"Clouds exporter returned no encoded video",
	);
	check(
		events.complete === 1 && events.cancelled === 0 && events.error === 0,
		"Clouds export terminal events are invalid",
	);
	const reference =
		"Independent cloudsExpected on fixed cut-out source RGBA, composited over black ColorNode; not production capture pixels";
	Reflect.set(globalThis, "__cloudsPipelineMedia", {
		video: base64([new Uint8Array(bytes)]),
		expected: base64(expected),
		baseline: base64([baseline]),
		...pipelineSize,
		fps: 30,
		frames: expected.length,
		codec: "vp9",
		mimeType: "video/webm",
		timelineTicks,
		localTicks: pipelineLocalTicks,
		paramsPerFrame: timelineTicks.map((time) => expectedAt(scene, time).params),
		thresholds: pipelineThresholds,
		reference,
	});
	const decoded = await decodeCloudsVideo(bytes, expected, baseline);
	return {
		name: "SceneExporter real six-frame VP9 with independent oracle",
		codec: "vp9",
		...pipelineSize,
		fps: 30,
		bytes: bytes.byteLength,
		events,
		reference,
		thresholds: pipelineThresholds,
		timelineTicks,
		...decoded,
		referenceChecks,
		repeatedReference,
		referenceFingerprints: expected.map(fingerprint),
	};
}
