import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { base64, check } from "./droplets-pipeline-support";
import {
	highChromaContract,
	type HighChromaCaseId,
} from "./high-chroma-contract";
import { decodeHighChromaVideo } from "./high-chroma-decode";
import {
	prepareHighChromaScene,
	type HighChromaPipeline,
} from "./high-chroma-scenes";

export async function checkHighChromaExport({
	caseId,
	pipeline,
	videoChroma,
}: {
	caseId: HighChromaCaseId;
	pipeline: HighChromaPipeline;
	videoChroma?: "420" | "444";
}) {
	const scene = await prepareHighChromaScene(caseId, pipeline);
	const exporter = new SceneExporter({
		width: scene.width,
		height: scene.height,
		fps: { numerator: scene.fps, denominator: 1 },
		format: "webm",
		quality: "very_high",
		...(videoChroma === undefined ? {} : { videoChroma }),
		compositor: pipeline.compositor,
		videoCache: pipeline.videoCache,
	});
	const events = { complete: 0, cancelled: 0, error: 0, progress: 0 };
	for (const event of ["complete", "cancelled", "error", "progress"] as const)
		exporter.on(event, () => {
			events[event]++;
		});
	const durationTicks = scene.frames * scene.frameTicks;
	const bytes = await exporter.export({
		rootNode: scene.rootNode,
		range: {
			startTime: mediaTime({ ticks: scene.timelineTicks[0] }),
			endTime: mediaTime({ ticks: scene.timelineTicks[0] + durationTicks }),
			duration: mediaTime({ ticks: durationTicks }),
		},
	});
	check(bytes?.byteLength, "Real SceneExporter returned no media");
	check(
		events.complete === 1 && events.cancelled === 0 && events.error === 0,
		"Invalid export terminal events",
	);
	Reflect.set(globalThis, "__highChromaMedia", {
		caseId,
		requestedVideoChroma: videoChroma ?? "default",
		video: base64([new Uint8Array(bytes)]),
		expected: base64(scene.expected),
		baseline: base64([scene.baseline]),
		captureEvidence: scene.captureEvidence,
		width: scene.width,
		height: scene.height,
		fps: scene.fps,
		frames: scene.frames,
		codec: "vp9",
		mimeType: "video/webm",
		quality: "very_high",
		timelineTicks: scene.timelineTicks,
		...("localTicks" in scene
			? { localTicks: scene.localTicks, paramsPerFrame: scene.paramsPerFrame }
			: {}),
		thresholds: highChromaContract.thresholds,
		reference: scene.reference,
	});
	const decoded = await decodeHighChromaVideo({
		bytes,
		expected: scene.expected,
		baseline: scene.baseline,
		width: scene.width,
		height: scene.height,
		fps: scene.fps,
		videoChroma,
	});
	Reflect.set(globalThis, "__highChromaDecode", decoded);
	return {
		caseId,
		requestedVideoChroma: videoChroma ?? "default",
		bytes: bytes.byteLength,
		events,
		referenceChecks: scene.referenceChecks,
		decoded,
	};
}
