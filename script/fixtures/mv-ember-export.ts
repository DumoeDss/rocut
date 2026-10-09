import { disposeCompositor, disposeGpu, initializeGpu } from "opencut-wasm";
import {
	isProgrammaticResource,
	type ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
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
import { emberCase, emberSource, emberOriginalFrame } from "./mv-ember-source";
import type { EmberAudioFacts } from "./mv-ember-reference-contract";
import type { createEmberReference } from "./mv-ember-reference-browser";
import { check, difference, pixels } from "./mv-ember-capture";
import { emberPngBase64 } from "./mv-ember-diagnostics";

export async function exportEmber(
	oracle: Awaited<ReturnType<typeof createEmberReference>>,
	audio: EmberAudioFacts,
	resources: readonly ResolvedProgrammaticResource[],
	writeOraclePng: (frame: number, base64: string) => Promise<void>,
) {
	const width = 1920,
		height = 1080,
		ticks = (frame: number) => mediaTime({ ticks: frame * 4000 });
	const clips = [
		{ mode: "breathe", start: 1, trim: 57, duration: 4 },
		{ mode: "ignite", start: 6, trim: 90, duration: 2 },
		{ mode: "collapse", start: 8, trim: 75, duration: 2 },
	] as const;
	const shots = clips.map((clip) => {
		const test = emberCase(clip.mode, audio);
		return {
			...clip,
			test,
			source: emberSource(
				test,
				resources.map((r) => r.resource),
			),
		};
	});
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("Ember unexpectedly used the external HTML frame provider");
		},
		loadResource: async ({ resource }) => {
			check(
				isProgrammaticResource(resource),
				"Invalid export attachment identity",
			);
			const found = resources.find(
				(item) => JSON.stringify(item.resource) === JSON.stringify(resource),
			);
			check(found, "Unknown export attachment");
			return new Blob([found.body], { type: resource.mimeType });
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
				id: "ember",
				name: "Ember",
				type: "graphic",
				hidden: false,
				elements: shots.map((shot) => ({
					id: shot.mode,
					name: shot.mode,
					type: "graphic",
					definitionId: "programmatic",
					params: {},
					programmatic: shot.source,
					startTime: ticks(shot.start),
					duration: ticks(shot.duration),
					trimStart: ticks(shot.trim),
					trimEnd: ticks(
						shot.source.durationFrames - shot.trim - shot.duration,
					),
				})),
			},
		],
	};
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `ember:${handle}`,
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
		const progress = Reflect.get(globalThis, "__mvEmberProgress") as Record<
			string,
			unknown
		>;
		const expectedFrame = async (index: number, save: boolean) => {
			const canvas = new OffscreenCanvas(width, height),
				ctx = canvas.getContext("2d")!;
			try {
				ctx.fillStyle = "black";
				ctx.fillRect(0, 0, width, height);
				const shot = shots.find(
					(s) => index >= s.start && index < s.start + s.duration,
				);
				if (shot) {
					const result = await oracle.render(
						emberOriginalFrame(
							shot.test,
							shot.source,
							shot.trim + index - shot.start,
						),
					);
					try {
						ctx.drawImage(result.bitmap, 0, 0);
						if (save)
							oracleFrames.push({
								frame: index,
								mode: shot.mode,
								provenance: result.provenance,
							});
					} finally {
						result.bitmap.close();
						result.canvas.width = result.canvas.height = 1;
					}
				} else if (save) oracleFrames.push({ frame: index, blank: true });
				if (save) await writeOraclePng(index, await emberPngBase64(canvas));
				return ctx.getImageData(0, 0, width, height).data;
			} finally {
				canvas.width = canvas.height = 1;
			}
		};
		for (let index = 0; index < 12; index++) {
			progress.current = `export/original/${index}`;
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
				error = difference(a, await expectedFrame(frame, false));
			gpuObservations.push({ frame, parity, error });
			progress.gpuObservations = gpuObservations;
			check(
				parity.max === 0,
				`Ember preview/export mismatch ${frame}: ${JSON.stringify(parity)}`,
			);
			check(
				error.max <= 2 && error.mae < 0.025,
				`Ember GPU/original mismatch ${frame}: ${JSON.stringify(error)}`,
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
		check(bytes, "Ember produced no encoded output");
		return {
			bytes: [...new Uint8Array(bytes)],
			exportSize: { width, height },
			oracleStorage: "per-frame-png",
			oracleFrames,
			gpuObservations,
			checks: [
				"Three complete modes via real buildScene/GPU preview-export equality, nonzero placement+trim, native1080p30fps twelve-frame VP9 export",
			],
		};
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
