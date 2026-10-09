import { disposeCompositor, disposeGpu, initializeGpu } from "opencut-wasm";
import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
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
import { check, difference, pixels } from "./mv-type-card-capture";
import {
	typeCardCase,
	typeCardSource,
	TYPE_CARD_START,
	TYPE_CARD_DURATION,
	TYPE_CARD_BEATS,
} from "./mv-type-card-source";
import { display, type TypeCardOracle } from "./mv-type-card-pixels";

export interface TypeCardExportOptions {
	readonly width: number;
	readonly height: number;
	/** Test-only sink; keeps native-frame PNGs out of numeric-array serialization. */
	readonly writeOraclePng?: (frame: number, base64: string) => Promise<void>;
}

async function pngBase64(canvas: OffscreenCanvas) {
	const bytes = new Uint8Array(
		await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
	);
	let text = "";
	for (let offset = 0; offset < bytes.length; offset += 32768)
		text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
	return btoa(text);
}

export async function exportTypeCard(
	resources: readonly ResolvedProgrammaticResource[],
	oracle: TypeCardOracle,
	options: TypeCardExportOptions = { width: 384, height: 216 },
) {
	const { width, height, writeOraclePng } = options;
	check(
		(width === 384 && height === 216) ||
			(width === 1920 && height === 1080 && writeOraclePng),
		"Use default low-resolution or PNG-streamed native acceptance",
	);
	const ticks = (frame: number) => mediaTime({ ticks: frame * 4000 });
	const clips = (["quiet", "flicker"] as const).map((mode, i) => {
		const fixture = typeCardCase(mode),
			source = typeCardSource(
				resources.map((r) => r.resource),
				fixture.settings,
			);
		Reflect.set(source, "frameRate", { numerator: 30, denominator: 1 });
		Reflect.set(source, "durationFrames", 120);
		Reflect.set(source.recipe!.nodes[0]!.scene, "span", {
			startFrame: 0,
			durationFrames: 120,
		});
		return {
			mode,
			args: fixture.args,
			source,
			start: 1 + i * 5,
			trim: i ? 68 : 30,
			duration: 4,
		};
	});
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("Canvas typeCard used DOM provider");
		},
		loadResource: async ({ resource, signal }) => {
			signal.throwIfAborted();
			const item = resources.find(
				(r) => r.resource.id === Reflect.get(resource as object, "id"),
			);
			check(item, "Missing typeCard export resource");
			return new Blob([item.body], { type: item.resource.mimeType });
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
				id: "card",
				name: "TypeCard",
				type: "graphic",
				hidden: false,
				elements: clips.map((clip) => ({
					id: clip.mode,
					name: clip.mode,
					type: "graphic",
					definitionId: "programmatic",
					params: {},
					programmatic: clip.source,
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
			resourceId: `type-card:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	try {
		const scene = (isPreview: boolean) =>
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
		const preview = scene(true),
			output = scene(false),
			params = {
				width,
				height,
				fps: { numerator: 30, denominator: 1 },
				compositor,
				videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
			};
		const renderer = new CanvasRenderer(params),
			expectations: number[][] = [],
			gpuObservations: unknown[] = [],
			oracleFrames: unknown[] = [];
		const progress = Reflect.get(globalThis, "__mvTypeCardProgress") as
			| Record<string, unknown>
			| undefined;
		const originalFrame = async (index: number, save: boolean) => {
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
						args: clip.args,
						time: TYPE_CARD_START + (clip.trim + index - clip.start) / 30,
						shotStart: TYPE_CARD_START,
						duration: TYPE_CARD_DURATION,
						beats: TYPE_CARD_BEATS,
					});
					try {
						ctx.drawImage(result.bitmap, 0, 0, width, height);
						if (save)
							oracleFrames.push({
								frame: index,
								provenance: result.provenance,
							});
					} finally {
						result.bitmap.close();
						result.canvas.width = result.canvas.height = 1;
					}
				}
				if (save && !clip) oracleFrames.push({ frame: index, blank: true });
				const data = ctx.getImageData(0, 0, width, height).data;
				if (save && writeOraclePng)
					await writeOraclePng(index, await pngBase64(canvas));
				return data;
			} finally {
				canvas.width = canvas.height = 1;
			}
		};
		for (let index = 0; index < 12; index++) {
			if (progress) progress.current = `export/original-png/${index}`;
			const expected = await originalFrame(index, true);
			if (!writeOraclePng) expectations.push([...expected]);
		}
		for (const frame of [9, 1, 4, 0, 5, 6, 11, 8, 7, 2, 3, 10, 1]) {
			if (progress) progress.current = `export/gpu/${frame}`;
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
			check(
				difference(a, b).max === 0,
				`TypeCard preview/export mismatch ${frame}`,
			);
			const expected = writeOraclePng
				? await originalFrame(frame, false)
				: new Uint8ClampedArray(expectations[frame]!);
			const error = difference(a, expected);
			gpuObservations.push({ frame, error });
			if (progress) progress.gpuObservations = gpuObservations;
			if (writeOraclePng && frame === 9)
				display(a, expected, "native-export frame 9");
			check(
				error.mae < 0.3 && error.max <= 5,
				`TypeCard GPU/original mismatch ${frame}: ${JSON.stringify(error)}`,
			);
		}
		if (progress) progress.current = "export/SceneExporter";
		const bytes = await new SceneExporter({
			...params,
			format: "webm",
			quality: "very_high",
		}).export({
			rootNode: output,
			range: { startTime: ticks(0), endTime: ticks(12), duration: ticks(12) },
		});
		check(bytes, "TypeCard export produced no video");
		return {
			bytes: [...new Uint8Array(bytes)],
			...(writeOraclePng ? {} : { expectations }),
			exportSize: { width, height },
			oracleStorage: writeOraclePng ? "per-frame-png" : "rgba-number-arrays",
			oracleFrames,
			gpuObservations,
			checks: [
				"Real buildScene/ProgrammaticNode/resources/GPU preview and export parity for quiet+flicker, nonzero clip placement and trim, twelve-frame SceneExporter WebM",
			],
		};
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
