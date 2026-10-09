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
import { ProgrammaticAudioRuntime } from "../../packages/editor-classic/src/media/programmatic-audio-runtime";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { MotionTextFontRuntime } from "../../packages/editor-classic/src/services/renderer/motion-text/font-runtime";
import { multishotProject, multishotTicks } from "./multishot-mv-project";
import { multishotMix } from "./multishot-mv-mix";

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw Error(message);
}
async function run() {
	const input: {
		sources: Record<string, ProgrammaticSource>;
		version: number;
		archived: Record<string, boolean>;
	} = await (await fetch("/api/sources")).json();
	check(
		input.archived.hyperframes && input.archived.remotion,
		"Source relocation/rebuild is required",
	);
	const project = multishotProject(input.sources, input.version),
		sequence = project.motionTextSequences[0];
	check(
		sequence.compositionMode === "overlay" && sequence.engine.id === "jizura",
		"Native JIZURA overlay required",
	);
	check(
		sequence.resolvedPlan?.cuts.every((cut) => cut.fontId === "mono"),
		"Explicit native font required",
	);
	let fontLoads = 0,
		nativeAudioRequests = 0;
	const fonts = new MotionTextFontRuntime({
		loadBuiltinFont: async ({ font }) => {
			check(
				font.builtinPath === "motion-text/fonts/ibm-plex-mono-medium.ttf",
				`Unexpected font ${font.id}`,
			);
			fontLoads++;
			const response = await fetch("/api/font");
			check(response.ok, "Font unavailable");
			return response.arrayBuffer();
		},
		loadProjectFont: async () => null,
	});
	const http = createHttpProgrammaticFrames({ base: "/api" });
	const provider = {
		...http,
		renderAudio: async (
			args: Parameters<NonNullable<typeof http.renderAudio>>[0],
		) => {
			nativeAudioRequests++;
			return http.renderAudio!(args);
		},
	};
	const runtime = new ProgrammaticAudioRuntime(provider),
		context = new AudioContext({ sampleRate: 48000 });
	await initializeGpu();
	const resources = {
		trackGpuResource: ({
			handle,
			label,
		}: {
			handle: number;
			label: string;
		}) => ({
			handle,
			label,
			resourceId: `multishot:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources;
	const compositor = new WasmCompositor(resources);
	const params = {
		width: 160,
		height: 90,
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
					throw Error("Unexpected external asset");
				},
			} as unknown as AssetResolver,
		});
	const capture = async (canvas: CanvasImageSource) => {
		const output = new OffscreenCanvas(160, 90),
			ctx = output.getContext("2d")!;
		ctx.drawImage(canvas, 0, 0);
		return {
			rgba: [...ctx.getImageData(0, 0, 160, 90).data],
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
			time: multishotTicks(25),
			capture,
		});
		const encoded = JSON.parse(
			JSON.stringify(encodeProject({ project, retained: {} })),
		);
		check(
			(
				await fetch("/api/save", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(encoded),
				})
			).ok,
			"Save failed",
		);
		const loaded: unknown = await (await fetch("/api/project")).json(),
			reloaded = decodeProject(loaded);
		check(
			JSON.stringify(encodeProject({ project: reloaded, retained: loaded })) ===
				JSON.stringify(encoded),
			"Codec/store reload changed project",
		);
		fonts.invalidate();
		const after = await renderer.renderAndCapture({
			node: scene(reloaded),
			time: multishotTicks(25),
			capture,
		});
		check(
			before.rgba.every((value, i) => value === after.rgba[i]),
			"Reloaded pixels differ",
		);
		const snapshots = [];
		for (const frame of [25, 75, 125]) {
			const variant = decodeProject(JSON.parse(JSON.stringify(loaded)));
			variant.scenes[0].tracks.overlay[0].hidden = true;
			snapshots.push({
				frame,
				...(await renderer.renderAndCapture({
					node: scene(variant),
					time: multishotTicks(frame),
					capture,
				})),
			});
		}
		const wrong = decodeProject(JSON.parse(JSON.stringify(loaded))),
			overlays = wrong.scenes[0].tracks.overlay;
		[overlays[0], overlays[1]] = [overlays[1], overlays[0]];
		const wrongOrder = await renderer.renderAndCapture({
			node: scene(wrong),
			time: multishotTicks(75),
			capture,
		});
		Reflect.set(globalThis, "__multishotMvCheckpoint", {
			snapshots,
			wrongOrder,
			previewPng: after.png,
			reloadedPixelsExact: true,
			archived: input.archived,
		});
		console.log(
			"multishot: native layer snapshots and persistence passed; preparing audio",
		);
		const mixed = await multishotMix(
			reloaded.scenes[0].tracks,
			context,
			resources,
			runtime,
		);
		check(
			nativeAudioRequests === 1,
			"Full/partial mix did not share native PCM",
		);
		console.log("multishot: exact PCM passed; exporting all 150 frames");
		const exporter = new SceneExporter({
			...params,
			format: "webm",
			quality: "very_high",
			shouldIncludeAudio: true,
			audioBuffer: mixed.mixed,
		});
		let lastProgress = -1;
		exporter.on("progress", (progress) => {
			const step = Math.floor(progress * 10);
			if (step !== lastProgress) {
				lastProgress = step;
				console.log(`multishot: export ${Math.round(progress * 100)}%`);
			}
		});
		const bytes = await exporter.export({
			rootNode: scene(reloaded),
			range: {
				startTime: multishotTicks(0),
				endTime: multishotTicks(150),
				duration: multishotTicks(150),
			},
		});
		check(bytes, "Full MV export produced no artifact");
		const fontState = fonts.inspect();
		check(
			fontState.loadedFaces === 1 && fontLoads === 2,
			"Font reload lifecycle changed",
		);
		return {
			bytes: [...new Uint8Array(bytes)],
			pcm: mixed.pcm,
			mix: mixed.measurements,
			snapshots,
			wrongOrder,
			previewPng: after.png,
			reloadedPixelsExact: true,
			archived: input.archived,
			nativeAudioRequests,
			fontLoads,
			fontState,
			frames: 150,
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
		await runtime.invalidate();
		await context.close();
		fonts.dispose();
		compositor.dispose();
		disposeGpu();
	}
}
void run().then(
	(result) => Reflect.set(globalThis, "__multishotMv", result),
	(error) =>
		Reflect.set(globalThis, "__multishotMv", {
			error: String(error?.stack ?? error),
		}),
);
