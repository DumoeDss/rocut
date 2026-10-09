import {
	disposeCompositor,
	disposeGpu,
	initializeGpu,
	resolveVideoExportJson,
} from "opencut-wasm";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects/definitions/index.ts";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor.ts";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter.ts";
import { cancelPendingRenderFrames } from "../../packages/editor-classic/src/services/renderer/cancel-tree.ts";
import { scene, temporal, ticks } from "./master-effects-browser-scene.ts";
import {
	WIDTH,
	HEIGHT,
	FPS,
	FIRST_FRAME,
	FRAME_COUNT,
} from "./master-effects-browser-oracle.ts";
import { decodeContainer } from "./vp9-quantizer-source-decode.mjs";
import { installEditorTrace } from "./vp9-quantizer-editor-trace.mjs";

export async function runEditorCase({ testCase, audio, cancel = false }) {
	registerDefaultEffects();
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `vp9-editor:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	});
	const node = scene(temporal());
	const request = {
		codec: "vp9",
		quality: "very_high",
		width: WIDTH,
		height: HEIGHT,
		frameRate: { numerator: FPS, denominator: 1 },
		...(testCase.adapter
			? {
					format: "webm",
					videoQuantizer: testCase.quantizer,
					...(testCase.profile === 1 ? { videoChroma: "444" } : {}),
				}
			: {}),
	};
	const rustResponse = JSON.parse(
		resolveVideoExportJson(JSON.stringify(request)),
	);
	if (rustResponse.error) throw Error(rustResponse.error);
	const buffer = new AudioBuffer({
		numberOfChannels: audio.channels,
		length: audio.samples.length,
		sampleRate: audio.sampleRate,
	});
	buffer.copyToChannel(Float32Array.from(audio.samples), 0);
	const trace = installEditorTrace();
	let completeCount = 0,
		cancelledCount = 0;
	const exporter = new SceneExporter({
		width: WIDTH,
		height: HEIGHT,
		fps: request.frameRate,
		compositor,
		videoCache: { getFrameAt: async () => null },
		format: "webm",
		quality: "very_high",
		shouldIncludeAudio: true,
		audioBuffer: buffer,
		...(testCase.adapter
			? {
					videoQuantizer: testCase.quantizer,
					...(testCase.profile === 1 ? { videoChroma: "444" } : {}),
				}
			: {}),
	});
	exporter.on("complete", () => {
		completeCount++;
	});
	exporter.on("cancelled", () => {
		cancelledCount++;
	});
	if (cancel)
		exporter.on("progress", () => {
			void exporter.cancel();
		});
	try {
		const output = await exporter.export({
			rootNode: node,
			range: {
				startTime: ticks(FIRST_FRAME),
				endTime: ticks(FIRST_FRAME + FRAME_COUNT),
				duration: ticks(FRAME_COUNT),
			},
		});
		const frames = await trace.frames();
		const evidence = {
			...trace.evidence,
			frames,
			rustRequest: request,
			rustResponse,
			completeCount,
			cancelledCount,
			bufferPublished: output !== null,
			cancelled: cancel,
		};
		if (cancel) return evidence;
		if (!output) throw Error("Real SceneExporter produced no video");
		const bytes = new Uint8Array(output);
		return { ...evidence, webm: [...bytes], ...(await decodeContainer(bytes)) };
	} finally {
		trace.restore();
		cancelPendingRenderFrames(node);
		compositor.dispose();
		disposeGpu();
	}
}
globalThis.__vp9EditorRun = runEditorCase;
