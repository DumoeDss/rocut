import { disposeCompositor, disposeGpu, initializeGpu } from "opencut-wasm";
import type { AssetResolver } from "@opencut/editor-ports";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { check, difference, pixels } from "./mv-converge-capture";
import { display } from "./mv-type-card-pixels";
import {
	convergeSource,
	CONVERGE_START,
	CONVERGE_DURATION,
	CONVERGE_WHITE_AT,
} from "./mv-converge-source";
import type { ConvergeOracle } from "./mv-converge-pixels";

async function pngBase64(canvas: OffscreenCanvas) {
	const bytes = new Uint8Array(
		await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
	);
	let text = "";
	for (let offset = 0; offset < bytes.length; offset += 32768)
		text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
	return btoa(text);
}

export async function exportConverge(
	oracle: ConvergeOracle,
	writeOraclePng: (frame: number, base64: string) => Promise<void>,
) {
	const width = 1920,
		height = 1080,
		ticks = (frame: number) => mediaTime({ ticks: frame * 4000 });
	const source = convergeSource();
	Reflect.set(source, "frameRate", { numerator: 30, denominator: 1 });
	Reflect.set(source, "durationFrames", 120);
	Reflect.set(source.recipe!.nodes[0]!.scene, "span", {
		startFrame: 0,
		durationFrames: 120,
	});
	// Two nonzero-trim excerpts exercise motifs and the authored white boundary;
	// all twelve fixed frames (including blanks) are independently decoded.
	const clips = [
		{ start: 1, trim: 30, duration: 4 },
		{ start: 6, trim: 103, duration: 4 },
	];
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("Converge unexpectedly used DOM rendering");
		},
		loadResource: async () => {
			throw Error(
				"Pure procedural converge unexpectedly requested an external resource",
			);
		},
	};
	const tracks: SceneTracks = {
		main: {
			id: "main",
			name: "Main",
			type: "video",
			elements: [],
			hidden: false,
			muted: false,
		},
		audio: [],
		overlay: [
			{
				id: "converge",
				name: "Converge",
				type: "graphic",
				hidden: false,
				elements: clips.map((clip, index) => ({
					id: `clip-${index}`,
					name: `Converge ${index}`,
					type: "graphic",
					definitionId: "programmatic",
					params: {},
					programmatic: source,
					startTime: ticks(clip.start),
					duration: ticks(clip.duration),
					trimStart: ticks(clip.trim),
					trimEnd: ticks(120 - clip.trim - clip.duration),
				})),
			},
		],
	};
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `converge:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	try {
		const build = (isPreview: boolean) =>
			buildScene({
				tracks,
				mediaAssets: [],
				duration: ticks(12),
				canvasSize: { width, height },
				background: { type: "color", color: "#000000" },
				isPreview,
				assetResolver: {} as AssetResolver,
				programmaticFrames: provider,
			});
		const preview = build(true),
			output = build(false),
			params = {
				width,
				height,
				fps: { numerator: 30, denominator: 1 },
				compositor,
				videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
			};
		const renderer = new CanvasRenderer(params),
			oracleFrames: unknown[] = [],
			gpuObservations: unknown[] = [];
		const progress = Reflect.get(globalThis, "__mvConvergeProgress") as Record<
			string,
			unknown
		>;
		const expectedFrame = async (index: number, save: boolean) => {
			const canvas = new OffscreenCanvas(width, height),
				ctx = canvas.getContext("2d")!;
			try {
				ctx.fillStyle = "black";
				ctx.fillRect(0, 0, width, height);
				const clip = clips.find(
					(item) => index >= item.start && index < item.start + item.duration,
				);
				if (clip) {
					const result = await oracle.render({
						time: CONVERGE_START + (clip.trim + index - clip.start) / 30,
						shotStart: CONVERGE_START,
						duration: CONVERGE_DURATION,
						args: { seed: 7, grain: 0.07, whiteAt: CONVERGE_WHITE_AT },
					});
					try {
						ctx.drawImage(result.bitmap, 0, 0);
						if (save)
							oracleFrames.push({
								frame: index,
								provenance: result.provenance,
							});
					} finally {
						result.bitmap.close();
						result.canvas.width = result.canvas.height = 1;
					}
				} else if (save) oracleFrames.push({ frame: index, blank: true });
				if (save) await writeOraclePng(index, await pngBase64(canvas));
				return ctx.getImageData(0, 0, width, height).data;
			} finally {
				canvas.width = canvas.height = 1;
			}
		};
		for (let index = 0; index < 12; index++) {
			progress.current = `export/original-png/${index}`;
			await expectedFrame(index, true);
		}
		for (const frame of [9, 1, 4, 0, 5, 6, 11, 8, 7, 2, 3, 10, 1]) {
			progress.current = `export/gpu/${frame}`;
			const a = await renderer.renderAndCapture({
				node: preview,
				time: ticks(frame),
				capture: (image) => pixels(image, width, height),
			});
			const b = await renderer.renderAndCapture({
				node: output,
				time: ticks(frame),
				capture: (image) => pixels(image, width, height),
			});
			const parity = difference(a, b),
				expected = await expectedFrame(frame, false),
				error = difference(a, expected);
			gpuObservations.push({ frame, parity, error });
			progress.gpuObservations = gpuObservations;
			if (frame === 1 || frame === 7)
				display(a, expected, `converge-export-${frame} frame ${frame}`);
			check(
				parity.max === 0,
				`Converge preview/export mismatch ${frame}: ${JSON.stringify(parity)}`,
			);
			check(
				error.max <= 2 && error.mae < 0.025,
				`Converge GPU/original mismatch ${frame}: ${JSON.stringify(error)}`,
			);
		}
		progress.current = "export/SceneExporter";
		const bytes = await new SceneExporter({
			...params,
			format: "webm",
			quality: "very_high",
		}).export({
			rootNode: output,
			range: { startTime: ticks(0), endTime: ticks(12), duration: ticks(12) },
		});
		check(bytes, "Converge produced no encoded output");
		return {
			bytes: [...new Uint8Array(bytes)],
			exportSize: { width, height },
			oracleStorage: "per-frame-png",
			oracleFrames,
			gpuObservations,
			checks: [
				"Native 1920x1080 real buildScene/ProgrammaticNode/GPU preview-export equality, nonzero placement and trim, full original oracle, twelve-frame VP9 export including authored white boundary",
			],
		};
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
