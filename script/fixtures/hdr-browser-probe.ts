import { Input, BufferSource, ALL_FORMATS, CanvasSink } from "mediabunny";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { AssetResolver } from "@opencut/editor-ports";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { HDR_LUMA_CODES, hdrReference, nativePngDisplayReference, type HdrTransfer } from "./hdr-pixel-oracle";

const provider = createHttpProgrammaticFrames({ base: "/api" });
const pixels = (image: CanvasImageSource) => {
	const ctx = new OffscreenCanvas(64, 64).getContext("2d")!;
	ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, 64, 64).data;
};
function assertLevels(rgba: Uint8ClampedArray, transfer: HdrTransfer, tolerance: number) {
	for (const top of [0, 32]) for (const [band, code] of HDR_LUMA_CODES.entries()) {
		const offset = ((top + 8) * 64 + band * 10 + 5) * 4;
		const expected = nativePngDisplayReference(top === 0 ? hdrReference(code, transfer) : Math.round(255 * (code - 64) / 876));
		for (let channel = 0; channel < 3; channel++) if (Math.abs(rgba[offset + channel] - expected) > tolerance)
			throw Error(`${transfer} top ${top} band ${band}: ${rgba[offset + channel]} vs ${expected}`);
		if (rgba[offset + 3] !== 255) throw Error("Opaque HDR fixture lost alpha");
	}
}

export async function runHdrExportProbe(params: ConstructorParameters<typeof CanvasRenderer>[0]) {
	const response = await fetch("/api/hdr-sources");
	if (!response.ok) throw Error(await response.text());
	const sources = await response.json() as { source: ProgrammaticSource; transfer: HdrTransfer; alpha: number[] | null }[];
	const results: object[] = [];
	for (const { source, transfer, alpha } of sources) {
		const bitmap = await createImageBitmap(await provider.renderPng({
			request: { source, clipStart: 0, clipDuration: 240000, trimStart: 0, timelineTime: 0 }, signal: AbortSignal.timeout(15000),
		}));
		try {
			const rgba = pixels(bitmap);
			if (alpha) {
				for (const top of [0, 32]) for (const [band, expected] of alpha.entries()) {
					const actual = rgba[((top + 8) * 64 + band * 16 + 8) * 4 + 3];
					if (actual !== expected) throw Error(`${transfer} HDR native alpha ${actual} != ${expected}`);
				}
				results.push({ transfer, nativeAlpha: alpha }); continue;
			}
			assertLevels(rgba, transfer, 2);
		} finally { bitmap.close(); }
		const tracks = {
			main: { id: "main", name: "Main", type: "video", elements: [] }, audio: [],
			overlay: [{ id: "hdr", name: "HDR", type: "graphic", elements: [{ id: "hdr", name: "HDR", type: "graphic",
				definitionId: "programmatic", params: {}, programmatic: source, startTime: 0, duration: 240000, trimStart: 0, trimEnd: 0 }] }],
		} as unknown as SceneTracks;
		const scene = (isPreview: boolean) => buildScene({ programmaticFrames: provider, tracks, mediaAssets: [],
			canvasSize: { width: 64, height: 64 }, duration: 240000, background: { type: "color", color: "#0000ff" },
			assetResolver: {} as AssetResolver, isPreview });
		const renderer = new CanvasRenderer(params);
		const preview = await renderer.renderAndCapture({ node: scene(true), time: 0, capture: pixels });
		const exported = await renderer.renderAndCapture({ node: scene(false), time: 0, capture: pixels });
		assertLevels(preview, transfer, 2);
		if (preview.some((value, i) => value !== exported[i])) throw Error("HDR GPU preview/export mismatch");
		const bytes = await new SceneExporter({ ...params, format: "webm", quality: "high" }).export({ rootNode: scene(false), range: {
			startTime: mediaTime({ ticks: 0 }), endTime: mediaTime({ ticks: 8000 }), duration: mediaTime({ ticks: 8000 }),
		} });
		if (!bytes) throw Error("HDR fixture produced no video");
		const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
		try {
			const track = await input.getPrimaryVideoTrack();
			if (!track) throw Error("HDR export missing video track");
			const sink = new CanvasSink(track);
			for (const time of [0, .04]) {
				const decoded = await sink.getCanvas(time); if (!decoded) throw Error("HDR exported frame missing");
				assertLevels(pixels(decoded.canvas), transfer, 4);
			}
		} finally { input.dispose(); }
		results.push({ transfer, encodedBytes: bytes.byteLength, toneMappedAndOptOutVerified: true });
		console.log(`HTML probe: native ${transfer} HDR-to-SDR WebM encode/decode passed`);
	}
	return results;
}
