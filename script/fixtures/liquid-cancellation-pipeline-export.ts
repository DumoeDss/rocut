import { ALL_FORMATS, BufferSource, CanvasSink, Input } from "mediabunny";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import type { RootNode } from "../../packages/editor-classic/src/services/renderer/nodes/root-node";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import {
	check,
	fingerprint,
	observationResult,
	pipelineFrameTicks,
	pipelineSize,
	pipelineStart,
	pixels,
	same,
	timerSnapshot,
	visible,
	type Pipeline,
} from "./liquid-cancellation-pipeline-support";

const exportFrames = 3;
const thresholds = Object.freeze({
	meanRgba: 10,
	activeRgb: 15,
	activePixels: 64,
	timestamp: 0.0011,
});

function base64(chunks: Iterable<Uint8Array | Uint8ClampedArray>): string {
	let binary = "";
	for (const chunk of chunks)
		for (const byte of chunk) binary += String.fromCharCode(byte);
	return btoa(binary);
}

export async function checkPipelineExport(
	pipeline: Pipeline,
	node: RootNode,
	baseline: Uint8ClampedArray,
	baselineNode: RootNode,
) {
	const params = {
		...pipelineSize,
		fps: pipeline.fps,
		compositor: pipeline.compositor,
		videoCache: pipeline.videoCache,
		format: "webm" as const,
		quality: "very_high" as const,
	};
	const range = {
		startTime: mediaTime({ ticks: pipelineStart }),
		endTime: mediaTime({
			ticks: pipelineStart + exportFrames * pipelineFrameTicks,
		}),
		duration: mediaTime({ ticks: exportFrames * pipelineFrameTicks }),
	};
	const first = new SceneExporter(params);
	const cancelledEvents = { cancelled: 0, complete: 0, progress: 0, error: 0 };
	first.on("cancelled", () => {
		cancelledEvents.cancelled++;
	});
	first.on("complete", () => {
		cancelledEvents.complete++;
	});
	first.on("progress", () => {
		cancelledEvents.progress++;
	});
	first.on("error", () => {
		cancelledEvents.error++;
	});
	const observation = pipeline.compositor.arm(
		"SceneExporter first-frame replay",
		() => first.cancel(),
	);
	const cancelled = await first.export({ rootNode: node, range });
	const cancellation = await observationResult(observation);
	await pipeline.compositor.cancelAndDrain();
	const cancelledTimers = timerSnapshot(pipeline);
	check(cancelled === null, "Cancelled export returned bytes");
	check(
		cancelledEvents.cancelled === 1 &&
			cancelledEvents.complete === 0 &&
			cancelledEvents.progress === 0 &&
			cancelledEvents.error === 0,
		"Cancelled export emitted stale terminal/progress events",
	);
	check(
		same(baseline, pixels(pipeline.compositor.getCanvas())),
		"Cancelled first export changed the baseline canvas",
	);

	// These are real recovered production frames at the exact export times.
	// They validate pipeline/codec recovery, not independent solver correctness.
	const expected: Uint8ClampedArray[] = [];
	for (let index = 0; index < exportFrames; index++) {
		expected.push(
			await pipeline.renderer.renderAndCapture({
				node,
				time: pipelineStart + index * pipelineFrameTicks,
				capture: pixels,
			}),
		);
	}
	check(
		expected.every((frame) => visible(frame) && !same(frame, baseline)),
		"Recovery reference contains a baseline/empty frame",
	);
	check(
		!same(expected[0], expected[1]) && !same(expected[1], expected[2]),
		"Recovery reference is not time-varying",
	);
	const reset = await pipeline.renderer.renderAndCapture({
		node: baselineNode,
		time: pipelineStart,
		capture: pixels,
	});
	check(same(reset, baseline), "Baseline reset failed before fresh export");
	const fresh = new SceneExporter(params);
	const recoveryEvents = { cancelled: 0, complete: 0, progress: 0, error: 0 };
	fresh.on("cancelled", () => {
		recoveryEvents.cancelled++;
	});
	fresh.on("complete", () => {
		recoveryEvents.complete++;
	});
	fresh.on("progress", () => {
		recoveryEvents.progress++;
	});
	fresh.on("error", () => {
		recoveryEvents.error++;
	});
	const bytes = await fresh.export({ rootNode: node, range });
	check(
		bytes && bytes.byteLength > 0,
		"Fresh export did not return encoded media",
	);
	check(
		recoveryEvents.complete === 1 &&
			recoveryEvents.cancelled === 0 &&
			recoveryEvents.error === 0,
		"Fresh export terminal events are invalid",
	);
	Reflect.set(globalThis, "__liquidPipelineMedia", {
		video: base64([new Uint8Array(bytes)]),
		expected: base64(expected),
		baseline: base64([baseline]),
		...pipelineSize,
		fps: 30,
		frames: exportFrames,
		codec: "vp9",
		mimeType: "video/webm",
		timelineTicks: expected.map(
			(_, index) => pipelineStart + index * pipelineFrameTicks,
		),
		reference:
			"Recovered production CanvasRenderer RGBA; not an independent solver oracle",
	});
	const input = new Input({
		source: new BufferSource(bytes),
		formats: ALL_FORMATS,
	});
	const metrics: {
		timestamp: number;
		duration: number;
		meanRgba: number;
		activeRgb: number;
		activePixels: number;
		fingerprint: string;
	}[] = [];
	try {
		const track = await input.getPrimaryVideoTrack();
		check(track, "Export has no primary video track");
		check((await track.getCodec()) === "vp9", "Expected real VP9 output");
		check(
			(await track.getDisplayWidth()) === pipelineSize.width &&
				(await track.getDisplayHeight()) === pipelineSize.height,
			"Unexpected encoded dimensions",
		);
		for await (const sample of new CanvasSink(track).canvases()) {
			const reference = expected[metrics.length];
			check(reference, "Export decoded more frames than requested");
			check(
				sample.canvas.width === pipelineSize.width &&
					sample.canvas.height === pipelineSize.height,
				"Unexpected decoded canvas dimensions",
			);
			const actual = pixels(sample.canvas);
			let total = 0,
				activeError = 0,
				activePixels = 0;
			for (let offset = 0; offset < actual.length; offset += 4) {
				for (let channel = 0; channel < 4; channel++)
					total += Math.abs(
						actual[offset + channel] - reference[offset + channel],
					);
				if (
					[0, 1, 2].some(
						(channel) =>
							Math.abs(
								reference[offset + channel] - baseline[offset + channel],
							) > 15,
					)
				) {
					activePixels++;
					for (let channel = 0; channel < 3; channel++)
						activeError += Math.abs(
							actual[offset + channel] - reference[offset + channel],
						);
				}
			}
			const meanRgba = total / actual.length;
			const activeRgb = activePixels
				? activeError / (activePixels * 3)
				: Number.MAX_VALUE;
			check(
				visible(actual) &&
					meanRgba <= thresholds.meanRgba &&
					activeRgb <= thresholds.activeRgb &&
					activePixels >= thresholds.activePixels,
				"Decoded recovery frame exceeds predeclared pixel thresholds",
			);
			check(
				Math.abs(sample.timestamp - metrics.length / 30) <=
					thresholds.timestamp &&
					Math.abs(sample.duration - 1 / 30) <= thresholds.timestamp,
				"Decoded recovery frame timing is not 30 fps",
			);
			metrics.push({
				timestamp: sample.timestamp,
				duration: sample.duration,
				meanRgba,
				activeRgb,
				activePixels,
				fingerprint: fingerprint(actual),
			});
		}
	} finally {
		input.dispose();
	}
	check(
		metrics.length === exportFrames,
		"Export did not decode exactly three frames",
	);
	return {
		name: "SceneExporter cancellation and real VP9 recovery",
		cancellation,
		cancelledEvents,
		cancelledTimers,
		recoveryEvents,
		codec: "vp9",
		...pipelineSize,
		fps: 30,
		frames: metrics.length,
		bytes: bytes.byteLength,
		thresholds,
		metrics,
		referenceFingerprints: expected.map(fingerprint),
		reference: "Production recovered frames; not independent solver acceptance",
		recoveryTimers: timerSnapshot(pipeline),
	};
}
