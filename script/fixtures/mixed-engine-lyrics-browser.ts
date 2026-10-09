import { initializeGpu, disposeCompositor, disposeGpu } from "opencut-wasm";
import type { AssetResolver } from "@opencut/editor-ports";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { TProject } from "../../packages/editor-classic/src/project/types";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import {
	encodeProject,
	decodeProject,
} from "../../packages/editor-classic/src/editor/persistence/project-codec";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { MotionTextFontRuntime } from "../../packages/editor-classic/src/services/renderer/motion-text/font-runtime";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { mixedLyricsProject } from "./mixed-engine-lyrics-project";

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw Error(message);
}
const ticks = (value: number) => mediaTime({ ticks: value });
async function run() {
	const input: {
		sources: Record<string, ProgrammaticSource>;
		version: number;
		archived: Record<string, boolean>;
	} = await (await fetch("/api/sources")).json();
	check(
		input.archived.hyperframes && input.archived.remotion,
		"Both engine sources must survive author relocation and rebuild",
	);
	const project = mixedLyricsProject(input.sources, input.version);
	const sequence = project.motionTextSequences[0];
	check(
		sequence.compositionMode === "overlay" && sequence.engine.id === "jizura",
		"Lyrics are not native overlay JIZURA",
	);
	check(
		sequence.resolvedPlan?.cuts.every((cut) => cut.fontId === "mono"),
		"Native factory failed to select the explicit font",
	);
	let fontLoads = 0;
	const fonts = new MotionTextFontRuntime({
		loadBuiltinFont: async ({ font }) => {
			check(
				font.builtinPath === "motion-text/fonts/ibm-plex-mono-medium.ttf",
				`Unexpected font ${font.id}`,
			);
			fontLoads++;
			const response = await fetch("/api/font");
			check(response.ok, "Actual font is unavailable");
			return response.arrayBuffer();
		},
		loadProjectFont: async () => null,
	});
	const provider = createHttpProgrammaticFrames({ base: "/api" });
	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({
			handle,
			label,
		}: {
			handle: number;
			label: string;
		}) => ({
			handle,
			label,
			resourceId: `mixed-lyrics:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	const params = {
		width: 96,
		height: 96,
		fps: project.settings.fps,
		compositor,
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	};
	const scene = (p: TProject) =>
		buildScene({
			tracks: p.scenes[0].tracks,
			motionTextSequences: p.motionTextSequences,
			motionTextFontRuntime: fonts,
			motionTextProjectId: p.metadata.id,
			mediaAssets: [],
			duration: p.metadata.duration,
			canvasSize: p.settings.canvasSize,
			background: p.settings.background,
			programmaticFrames: provider,
			assetResolver: {
				resolve: () => {
					throw Error("Unexpected non-archived asset");
				},
			} as unknown as AssetResolver,
		});
	const capture = async (canvas: CanvasImageSource) => {
		const output = new OffscreenCanvas(96, 96),
			ctx = output.getContext("2d")!;
		ctx.drawImage(canvas, 0, 0);
		return {
			pixels: ctx.getImageData(0, 0, 96, 96).data,
			png: [
				...new Uint8Array(
					await (
						await output.convertToBlob({ type: "image/png" })
					).arrayBuffer(),
				),
			],
		};
	};
	try {
		const renderer = new CanvasRenderer(params);
		const before = await renderer.renderAndCapture({
			node: scene(project),
			time: ticks(48000),
			capture,
		});
		const encoded = JSON.parse(
			JSON.stringify(encodeProject({ project, retained: {} })),
		);
		const saved = await fetch("/api/save", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(encoded),
		});
		check(saved.ok, "Real FileProjectStore save failed");
		const loaded: unknown = await (await fetch("/api/project")).json();
		const reloaded = decodeProject(loaded);
		check(
			JSON.stringify(encodeProject({ project: reloaded, retained: loaded })) ===
				JSON.stringify(encoded),
			"Project codec/store reload changed sources or lyric plans",
		);
		fonts.invalidate();
		const after = await renderer.renderAndCapture({
			node: scene(reloaded),
			time: ticks(48000),
			capture,
		});
		check(
			before.pixels.every((value, i) => value === after.pixels[i]),
			"Saved/reopened native composition pixels differ",
		);
		const videos = [];
		for (const foreground of [false, true]) {
			const variant = decodeProject(JSON.parse(JSON.stringify(loaded)));
			variant.scenes[0].tracks.overlay[0].hidden = !foreground;
			const bytes = await new SceneExporter({
				...params,
				format: "webm",
				quality: "very_high",
				shouldIncludeAudio: false,
			}).export({
				rootNode: scene(variant),
				range: {
					startTime: ticks(48000),
					endTime: ticks(76800),
					duration: ticks(28800),
				},
			});
			check(bytes, "Mixed engine export produced no artifact");
			videos.push({ foreground, bytes: [...new Uint8Array(bytes)] });
		}
		const fontState = fonts.inspect();
		check(
			fontState.loadedFaces === 1 && fontLoads === 2,
			`Actual font lifecycle differs: ${JSON.stringify({ fontLoads, fontState })}`,
		);
		return {
			videos,
			previewPng: after.png,
			reloadedPixelsExact: true,
			archived: input.archived,
			fontLoads,
			fontState,
			layerOrderTopToBottom: reloaded.scenes[0].tracks.overlay.map(
				(track) => track.id,
			),
			sequence: {
				engine: sequence.engine,
				compositionMode: sequence.compositionMode,
				font: sequence.fonts.find((font) => font.id === "mono"),
				cuts: sequence.resolvedPlan?.cuts.map((cut) => ({
					text: cut.text,
					startTime: cut.startTime,
					duration: cut.duration,
					fontId: cut.fontId,
				})),
			},
		};
	} finally {
		fonts.dispose();
		compositor.dispose();
		disposeGpu();
	}
}
void run().then(
	(result) => Reflect.set(globalThis, "__mixedEngineLyrics", result),
	(error) =>
		Reflect.set(globalThis, "__mixedEngineLyrics", {
			error: String(error?.stack ?? error),
		}),
);
