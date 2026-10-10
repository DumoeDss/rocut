import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { captureBlazePipeline } from "./blaze-pipeline-capture";
import {
	blackComposite,
	pipelineAnimated,
	pipelineFps,
	pipelineFrameTicks,
	pipelineLocalTicks,
	pipelineOffset,
	pipelineReference,
	pipelineSize,
	pipelineThresholds,
	type PipelineChannel,
} from "./blaze-pipeline-cases";
import { decodeBlazePipeline } from "./blaze-pipeline-decode";
import { codecDifference } from "./blaze-pipeline-metrics";
import { blazeScene, expectedAt } from "./blaze-pipeline-scenes";
import {
	base64,
	check,
	pixels,
	same,
	type BlazePipeline,
} from "./blaze-pipeline-support";

export async function checkBlazePipelineExport(
	pipeline: BlazePipeline,
	requestedVideoChroma: "default" | "444",
) {
	const scene = blazeScene({
		placement: "attached",
		kind: "holes",
		animated: true,
		black: true,
	});
	const timelineTicks = pipelineLocalTicks.map(
		(local) => local + pipelineOffset,
	);
	const expected = timelineTicks.map((time) => expectedAt(scene, time).pixels),
		baseline = blackComposite(scene.source);
	const referenceChecks = [];
	for (const [index, time] of timelineTicks.entries()) {
		const capture = await captureBlazePipeline(
			pipeline,
			scene,
			time,
			`export-reference-${index}`,
		);
		const disabled = await pipeline.renderer.renderAndCapture({
			node: scene.baselineNode,
			time,
			capture: pixels,
		});
		(
			Reflect.get(globalThis, "__blazePipelineCaptures") as Record<
				string,
				unknown
			>[]
		).push({
			label: `export-disabled-${index}`,
			...pipelineSize,
			timelineTicks: time,
			localTicks: pipelineLocalTicks[index],
			offset: pipelineOffset,
			enabled: false,
			source: base64([scene.source]),
			actual: base64([disabled]),
			expected: base64([baseline]),
			baseline: base64([baseline]),
			exact: same(disabled, baseline),
		});
		check(
			same(disabled, baseline),
			`Actual disabled effect stack changed frame ${index}`,
		);
		const baselineCounterfactual = codecDifference(
			baseline,
			expected[index],
			baseline,
		);
		check(
			!baselineCounterfactual.accepted,
			`No-effect counterfactual escaped frame ${index}`,
		);
		referenceChecks.push({
			index,
			raw: capture.metric,
			baselineCounterfactual,
			disabledExact: true,
		});
	}
	const repeatedFirst = expected.map((frame) =>
		codecDifference(expected[0], frame, baseline),
	);
	check(
		repeatedFirst.slice(1).some((metric) => !metric.accepted),
		"Repeated-first counterfactual escaped every later frame",
	);
	for (const channel of Object.keys(pipelineAnimated) as PipelineChannel[]) {
		const isolated = blazeScene({
			placement: "attached",
			kind: "holes",
			animated: true,
			onlyChannel: channel,
		});
		for (const index of [0, 5])
			await captureBlazePipeline(
				pipeline,
				isolated,
				timelineTicks[index],
				`only-${channel}-${index}`,
			);
	}
	const shifted = blazeScene({
		placement: "attached",
		kind: "holes",
		animated: true,
		offset: pipelineOffset + 40040,
	});
	const shiftedCapture = await captureBlazePipeline(
		pipeline,
		shifted,
		pipelineLocalTicks[5] + shifted.offset,
		"shifted-offset-local-equivalence",
	);
	const untrimmed = blazeScene({
		placement: "attached",
		kind: "holes",
		animated: true,
		trimmed: false,
	});
	const untrimmedCapture = await captureBlazePipeline(
		pipeline,
		untrimmed,
		timelineTicks[5],
		"trim-does-not-rephase",
	);
	check(
		same(shiftedCapture.actual, untrimmedCapture.actual),
		"Offset or source trim rephased clip-local Blaze",
	);
	const reset = await pipeline.renderer.renderAndCapture({
		node: scene.baselineNode,
		time: timelineTicks[0],
		capture: pixels,
	});
	check(
		same(reset, baseline),
		"Disabled baseline reset failed before fresh production export",
	);
	const exporter = new SceneExporter({
		...pipelineSize,
		fps: pipelineFps,
		compositor: pipeline.compositor,
		videoCache: pipeline.videoCache,
		format: "webm",
		quality: "very_high",
		...(requestedVideoChroma === "444" ? { videoChroma: "444" as const } : {}),
	});
	const events = { complete: 0, cancelled: 0, error: 0, progress: 0 };
	for (const event of ["complete", "cancelled", "error", "progress"] as const)
		exporter.on(event, () => {
			events[event]++;
		});
	const bytes = await exporter.export({
		rootNode: scene.node,
		range: {
			startTime: mediaTime({ ticks: timelineTicks[0] }),
			endTime: mediaTime({
				ticks: timelineTicks[0] + expected.length * pipelineFrameTicks,
			}),
			duration: mediaTime({ ticks: expected.length * pipelineFrameTicks }),
		},
	});
	check(bytes?.byteLength, "Real SceneExporter returned no Blaze media");
	check(
		events.complete === 1 && events.cancelled === 0 && events.error === 0,
		"Invalid Blaze export terminal events",
	);
	Reflect.set(globalThis, "__blazePipelineMedia", {
		version: 1,
		requestedVideoChroma,
		video: base64([new Uint8Array(bytes)]),
		expected: base64(expected),
		baseline: base64([baseline]),
		source: base64([scene.source]),
		...pipelineSize,
		fps: pipelineFps.numerator / pipelineFps.denominator,
		frameRate: pipelineFps,
		frameTicks: pipelineFrameTicks,
		frames: expected.length,
		codec: "vp9",
		mimeType: "video/webm",
		quality: "very_high",
		timelineTicks,
		localTicks: pipelineLocalTicks,
		clipOffset: pipelineOffset,
		trimStart: 16016,
		trimEnd: 8008,
		keyframeLocalTicks: [48048, 68068],
		paramsPerFrame: timelineTicks.map((time) => expectedAt(scene, time).params),
		thresholds: pipelineThresholds,
		reference: pipelineReference,
		events,
	});
	const decoded = await decodeBlazePipeline(bytes, expected, baseline);
	check(
		decoded.accepted,
		`Decoded ${requestedVideoChroma} Blaze video failed frozen pixel/timing gates: ${JSON.stringify(decoded)}`,
	);
	return {
		name: "six-frame production CanvasRenderer and SceneExporter with native attached animation",
		requestedVideoChroma,
		events,
		referenceChecks,
		repeatedFirst,
		decoded,
	};
}
