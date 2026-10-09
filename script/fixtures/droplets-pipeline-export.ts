import { ALL_FORMATS, BufferSource, CanvasSink, Input } from "mediabunny";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { dropletsDifference } from "./droplets-oracle";
import {
	blackComposite,
	codecDifference,
	pipelineFps,
	pipelineLocalTicks,
	pipelineOffset,
	pipelineSize,
	pipelineThresholds,
} from "./droplets-pipeline-cases";
import { dropletsScene, expectedAt } from "./droplets-pipeline-scenes";
import {
	base64,
	check,
	fingerprint,
	pixels,
	same,
	type DropletsPipeline,
} from "./droplets-pipeline-support";

export async function checkDropletsExport(pipeline: DropletsPipeline) {
	const scene = dropletsScene({
		placement: "attached",
		kind: "opaque",
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
		const capture = await pipeline.renderer.renderAndCapture({
			node: scene.node,
			time,
			capture: pixels,
		});
		const oracle = expectedAt(scene, time);
		const difference = dropletsDifference(
			capture,
			{ ...oracle, pixels: expected[index] },
			baseline,
		);
		if (difference.failed || difference.outsideFailed)
			Reflect.set(globalThis, "__dropletsPipelineDiagnostics", {
				stage: "black-backdrop production capture",
				...pipelineSize,
				index,
				timelineTicks: time,
				localTicks: pipelineLocalTicks[index],
				source: base64([scene.source]),
				expected: base64([expected[index]]),
				baseline: base64([baseline]),
				actual: base64([capture]),
				difference,
			});
		check(
			!difference.failed && !difference.outsideFailed,
			`Opaque-backdrop export capture differs from independent oracle: ${JSON.stringify(difference)}`,
		);
		const identity = codecDifference(baseline, expected[index], baseline);
		check(
			!identity.accepted,
			"Export reference cannot reject a no-op baseline sequence",
		);
		referenceChecks.push({
			index,
			difference,
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
		"Baseline reset failed before fresh Droplets export",
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
		"Droplets exporter returned no encoded video",
	);
	check(
		events.complete === 1 && events.cancelled === 0 && events.error === 0,
		"Droplets export terminal events are invalid",
	);
	const reference =
		"Independent dropletsExpected on legal canvas RGBA, explicitly composited over black ColorNode; not production capture pixels";
	Reflect.set(globalThis, "__dropletsPipelineMedia", {
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
	const input = new Input({
		source: new BufferSource(bytes),
		formats: ALL_FORMATS,
	});
	const metrics: Record<string, unknown>[] = [];
	const decoded: Uint8ClampedArray[] = [];
	try {
		const track = await input.getPrimaryVideoTrack();
		check(
			track && (await track.getCodec()) === "vp9",
			"Expected an actual VP9 video track",
		);
		check(
			(await track.getDisplayWidth()) === pipelineSize.width &&
				(await track.getDisplayHeight()) === pipelineSize.height,
			"Encoded dimensions changed",
		);
		for await (const sample of new CanvasSink(track).canvases()) {
			const index = decoded.length;
			check(index < expected.length, "Encoded video contains too many frames");
			check(
				sample.canvas.width === pipelineSize.width &&
					sample.canvas.height === pipelineSize.height,
				"Decoded dimensions changed",
			);
			const actual = pixels(sample.canvas);
			const difference = codecDifference(actual, expected[index], baseline);
			if (!difference.accepted)
				Reflect.set(globalThis, "__dropletsPipelineDiagnostics", {
					stage: "decoded production video",
					...pipelineSize,
					index,
					expected: base64([expected[index]]),
					baseline: base64([baseline]),
					actual: base64([actual]),
					difference,
				});
			check(
				difference.accepted,
				`Decoded frame ${index} exceeds declared thresholds: ${JSON.stringify(difference)}`,
			);
			check(
				Math.abs(sample.timestamp - index / 30) <=
					pipelineThresholds.exportTimestampSeconds &&
					Math.abs(sample.duration - 1 / 30) <=
						pipelineThresholds.exportTimestampSeconds,
				`Decoded frame ${index} is not positioned at 30 fps`,
			);
			decoded.push(actual);
			metrics.push({
				index,
				timestamp: sample.timestamp,
				duration: sample.duration,
				...difference,
				fingerprint: fingerprint(actual),
			});
		}
	} finally {
		input.dispose();
	}
	check(
		decoded.length === expected.length,
		"Droplets export did not decode exactly six frames",
	);
	const repeatedDecoded = expected.map((frame) =>
		codecDifference(decoded[0], frame, baseline),
	);
	check(
		repeatedDecoded.slice(1).some((result) => !result.accepted),
		"Decoded first-frame repetition would evade sequence validation",
	);
	return {
		name: "SceneExporter real six-frame VP9 with independent oracle",
		codec: "vp9",
		...pipelineSize,
		fps: 30,
		frames: decoded.length,
		bytes: bytes.byteLength,
		events,
		reference,
		thresholds: pipelineThresholds,
		timelineTicks,
		metrics,
		referenceChecks,
		repeatedReference,
		repeatedDecoded,
		referenceFingerprints: expected.map(fingerprint),
	};
}
