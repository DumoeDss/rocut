import { Input, BufferSource, ALL_FORMATS, CanvasSink } from "mediabunny";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { readNativeVideoFrame } from "./remotion-video-browser-probe";
import { runHyperframesVideoProbe } from "./hyperframes-video-browser-probe";

const provider = createHttpProgrammaticFrames({ base: "/api" });
const pixel = (image: CanvasImageSource, x: number, y: number) => {
	const c = new OffscreenCanvas(64, 64).getContext("2d")!;
	c.drawImage(image, 0, 0);
	return [...c.getImageData(x, y, 1, 1).data];
};
function equal(actual: unknown, expected: unknown, label: string) {
	if (JSON.stringify(actual) !== JSON.stringify(expected))
		throw Error(`HyperFrames ${label}: ${JSON.stringify({ actual, expected })}`);
}

export async function runHyperframesSourceProbe(): Promise<ProgrammaticSource | undefined> {
	const filePath = Reflect.get(globalThis, "__engineDocumentPath");
	const spec = Reflect.get(globalThis, "__engineBuildSpec");
	if (spec && spec.engine !== "hyperframes") return;
	if (!spec && typeof filePath !== "string") return;
	console.log("HTML probe: preparing native HyperFrames through the production API");
	const response = await fetch(spec ? "/api/programmatic/build/compile" : "/api/programmatic/resources/import", {
		method: "POST",
		body: JSON.stringify(spec ?? { filePath, id: "build/hyperframes.html", kind: "document", mimeType: "text/html" }),
	});
	if (!response.ok) throw Error(await response.text());
	const result = await response.json();
	const resource = spec ? result.source.resources[0] : result.resource;
	if (resource.byteLength <= 262144) throw Error("Native fixture did not include the large upstream runtime");
	const source: ProgrammaticSource = spec ? result.source : {
		version: 1, runtime: "html-document", code: "", documentId: resource.id, resources: [resource],
		width: 64, height: 64, frameRate: { numerator: 30, denominator: 1 }, durationFrames: 60, seed: 7,
	};
	for (const [time, redX, greenX, markerX] of [
		[120000, 20, 20, 20], [72000, 8, null, 12], [156000, 32, null, 24],
		[0, null, null, 4], [96000, 16, 8, 16], [120000, 20, 20, 20],
	] as const) {
		const bitmap = await createImageBitmap(await provider.renderPng({
			request: { source, clipStart: 0, clipDuration: 240000, trimStart: 0, timelineTime: time },
			signal: new AbortController().signal,
		}));
		try {
			equal(pixel(bitmap, redX ?? 8, 8), redX === null ? [0, 0, 0, 0] : [255, 0, 0, 128], `parent at ${time}`);
			equal(pixel(bitmap, greenX ?? 8, 40), greenX === null ? [0, 0, 0, 0] : [0, 255, 0, 255], `child at ${time}`);
			equal(pixel(bitmap, markerX, 60), [0, 0, 255, 255], `root at ${time}`);
			equal(pixel(bitmap, 60, 24), [0, 0, 0, 0], "transparent background");
			equal(pixel(bitmap, 50, 50), [255, 255, 255, 255], "compiler-inlined project image");
			equal(pixel(bitmap, 60, 50), [0, 255, 0, 255], "compiler-inlined font, not fallback");
		} finally { bitmap.close(); }
	}
	console.log("HTML probe: native HyperFrames nesting and random seek passed");
	if (spec?.files?.includes("media.html")) await runHyperframesVideoProbe(spec);
	return source;
}

export async function runNativeEngineExportProbe(
	source: ProgrammaticSource,
	params: ConstructorParameters<typeof CanvasRenderer>[0],
	nativeVideo?: { indices: readonly [number, number]; startTime: number; frameTicks: number },
): Promise<number> {
	const tracks = {
		main: { id: "main", name: "Main", type: "video", elements: [] }, audio: [],
		overlay: [{ id: "native-track", name: "Native", type: "graphic", elements: [{
			id: "native", name: "Native", type: "graphic", definitionId: "programmatic", params: {},
			programmatic: source, startTime: 0, duration: 240000, trimStart: 0, trimEnd: 0,
		}] }],
	} as unknown as SceneTracks;
	const scene = (isPreview: boolean) => buildScene({
		programmaticFrames: provider, tracks, mediaAssets: [], canvasSize: { width: 64, height: 64 },
		duration: 240000, background: { type: "color", color: "#0000ff" },
		assetResolver: {} as AssetResolver, isPreview,
	});
	const renderer = new CanvasRenderer(params);
	const capture = (canvas: OffscreenCanvas | HTMLCanvasElement) => nativeVideo ? readNativeVideoFrame(canvas) : pixel(canvas, 8, 40);
	const captureTime = nativeVideo ? nativeVideo.startTime + nativeVideo.frameTicks : 92000;
	const preview = await renderer.renderAndCapture({ node: scene(true), time: captureTime, capture });
	const exported = await renderer.renderAndCapture({ node: scene(false), time: captureTime, capture });
	equal(preview, nativeVideo ? nativeVideo.indices[1] : [0, 255, 0, 255], "native GPU frame");
	equal(preview, exported, "native preview/export parity");
	const bytes = await new SceneExporter({ ...params, format: "webm", quality: "high" }).export({
		rootNode: scene(false), range: {
			startTime: mediaTime({ ticks: nativeVideo?.startTime ?? 88000 }),
			endTime: mediaTime({ ticks: nativeVideo ? nativeVideo.startTime + nativeVideo.frameTicks * 2 : 96000 }),
			duration: mediaTime({ ticks: nativeVideo ? nativeVideo.frameTicks * 2 : 8000 }),
		},
	});
	if (!bytes) throw Error("Native HyperFrames export produced no video");
	const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
	try {
		const video = await input.getPrimaryVideoTrack();
		if (!video) throw Error("Native export has no video track");
		const sink = new CanvasSink(video);
		const before = await sink.getCanvas(0);
		const first = before && pixel(before.canvas, 8, 40);
		const firstIndex = nativeVideo && before ? readNativeVideoFrame(before.canvas) : null;
		const after = await sink.getCanvas(nativeVideo ? nativeVideo.frameTicks * 1.2 / 120000 : 0.04);
		const second = after && pixel(after.canvas, 8, 40);
		if (nativeVideo) {
			if (firstIndex !== nativeVideo.indices[0] || !after || readNativeVideoFrame(after.canvas) !== nativeVideo.indices[1])
				throw Error(`Native video WebM lost exact source frames ${nativeVideo.indices.join(" → ")}`);
		} else if (!first || !second || first[1] > 20 || second[1] < 220 || second[2] > 25)
			throw Error(`Native WebM lost nested visibility: ${JSON.stringify({ first, second })}`);
	} finally { input.dispose(); }
	console.log(`HTML probe: native ${source.build?.engine ?? "HyperFrames"} Rocut WebM encode/decode passed`);
	return bytes.byteLength;
}
