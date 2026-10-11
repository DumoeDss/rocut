import { Input, BufferSource, ALL_FORMATS, CanvasSink } from "mediabunny";
import { initializeGpu, disposeCompositor, disposeGpu } from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { AssetResolver } from "@opencut/editor-ports";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";
import { runResourceProbe } from "./programmatic-resource-browser-probe";
import { runHyperframesSourceProbe, runNativeEngineExportProbe } from "./hyperframes-browser-probe";
import { runRemotionSourceProbe } from "./remotion-browser-probe";
import { remotionVideoSource } from "./remotion-video-browser-probe";
import { hyperframesVideoSource } from "./hyperframes-video-browser-probe";

const source: ProgrammaticSource = {
	version: 1,
	runtime: "html-document",
	width: 64,
	height: 64,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 30,
	seed: 7,
	code: `<style>body{margin:0} #box{position:absolute;width:16px;height:64px;background:rgba(255,0,0,.5)}</style>
<div id="box"></div><script>window.rocut={ready:Promise.resolve(),async renderFrame(frame){
await Promise.resolve(); document.getElementById('box').style.left=(frame.index*10)+'px';
if ('elftia' in window || 'require' in window) throw Error('host capability leaked');
try { void parent.document; throw Error('parent access leaked'); } catch(e) { if(e.name!=='SecurityError') throw e; }
try { localStorage.getItem('private'); throw Error('storage leaked'); } catch(e) { if(e.name!=='SecurityError') throw e; }
}};</script>`,
};
const provider = createHttpProgrammaticFrames({ base: "/api" });
const request = (time = 0, code = source.code) => ({
	source: { ...source, code },
	clipStart: 0,
	clipDuration: 120000,
	trimStart: 0,
	timelineTime: time,
});
const equal = (name: string, actual: unknown, expected: unknown) => {
	if (JSON.stringify(actual) !== JSON.stringify(expected))
		throw Error(`${name}: ${JSON.stringify({ actual, expected })}`);
};
const pixel = (image: CanvasImageSource, x = 8) => {
	const canvas = new OffscreenCanvas(64, 64),
		ctx = canvas.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	return [...ctx.getImageData(x, 16, 1, 1).data];
};
async function png(time = 0, code = source.code) {
	return createImageBitmap(
		await provider.renderPng({
			request: request(time, code),
			signal: new AbortController().signal,
		}),
	);
}
async function rejected(run: () => Promise<unknown>, match: RegExp) {
	try {
		await run();
	} catch (error) {
		if (match.test(String(error))) return;
		throw error;
	}
	throw Error(`Expected failure: ${match}`);
}

export async function runHtmlFrameProbe() {
	Reflect.set(globalThis, "__htmlProbeStarted", true);
	Reflect.set(globalThis, "__htmlProbeStartedAt", Date.now());
	const phase = (name: string) => {
		Reflect.set(globalThis, "__htmlProbePhase", name);
		console.log(`HTML probe: phase ${name}`);
	};
	console.log("HTML probe: starting real Tool Host requests");
	const checks: string[] = [];
	phase("native-engine-sources");
	const nativeSource = await runHyperframesSourceProbe() ?? await runRemotionSourceProbe();
	if (nativeSource) checks.push(`native ${nativeSource.build?.engine ?? "HyperFrames"} runtime, nested compositions, resources, alpha and random seek`);
	if (Reflect.get(globalThis, "__nativeOnly")) {
		if (!nativeSource) throw Error("Native-only probe requires an engine fixture");
		return { passed: true, nativeOnly: true, checks };
	}
	phase("project-resources");
	checks.push(await runResourceProbe());
	console.log("HTML probe: project images/fonts passed in Worker and DOM");
	phase("html-alpha-and-seek");
	const catalog = await (await fetch("/api/editing/catalog")).json();
	if (!catalog.programmatic.runtimes.includes("html-document"))
		throw Error("Host did not advertise configured HTML rasterizer");
	for (const time of [0, 8000, 0]) {
		const bitmap = await png(time);
		try {
			equal("HTML half alpha", pixel(bitmap, time ? 24 : 8), [255, 0, 0, 128]);
			equal("HTML transparent pixel", pixel(bitmap, 60), [0, 0, 0, 0]);
			equal(
				"seek previous location",
				pixel(bitmap, time ? 8 : 24),
				[0, 0, 0, 0],
			);
		} finally {
			bitmap.close();
		}
	}
	checks.push(
		"authenticated Tool Host → isolated HTML DOM → alpha PNG; repeat/reverse seek; no parent/storage/host bridge",
	);
	console.log("HTML probe: alpha and seek passed");
	phase("css-and-inline-resources");
	const css = `<style>body{margin:0}div{width:16px;height:64px;background:lime;animation:move 1s linear both}@keyframes move{from{transform:translateX(0)}to{transform:translateX(30px)}}</style><div></div>`;
	for (const time of [60000, 0, 60000]) {
		const bitmap = await png(time, css);
		try {
			equal("CSS fixed frame", pixel(bitmap, time ? 20 : 8), [0, 255, 0, 255]);
			equal(
				"CSS previous position",
				pixel(bitmap, time ? 8 : 20),
				[0, 0, 0, 0],
			);
		} finally {
			bitmap.close();
		}
	}
	checks.push("CSS animations paused and seeked to quantized source time");
	for (const code of [
		`<style>body{margin:0}</style><img src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="lime"/></svg>')}">`,
		`<style>body{margin:0}</style><canvas width="64" height="64"></canvas><script>window.rocut={renderFrame:async()=>{const c=document.querySelector('canvas').getContext('2d');c.fillStyle='lime';c.fillRect(0,0,64,64);}}</script>`,
	]) {
		const bitmap = await png(0, code);
		try {
			equal("inline resource/hook", pixel(bitmap), [0, 255, 0, 255]);
		} finally {
			bitmap.close();
		}
	}
	checks.push("data image readiness and explicit HTML Canvas frame hook");
	phase("isolation-and-validation");
	for (const code of [
		`<script>window.rocut={renderFrame:()=>fetch('http://127.0.0.1:1/private')}</script>`,
		`<img src="https://example.invalid/blocked.png">`,
		`<script src="https://example.invalid/blocked.js"></script>`,
		`<video src="file:///private.mp4"></video>`,
		`<canvas></canvas>`,
		`<script>throw Error('author failed')</script>`,
	])
		await rejected(() => png(0, code), /HTML frame evaluation failed/);
	await rejected(
		() =>
			provider.renderPng({
				request: { ...request(), source: { ...source, width: 99999 } },
				signal: new AbortController().signal,
			}),
		/dimensions/,
	);
	checks.push(
		"network/local media/unseeked Canvas/script errors reject; Rust rejects invalid size before launch",
	);
	console.log("HTML probe: isolation and validation passed");
	phase("provider-cancellation-and-recovery");
	const abort = new AbortController();
	const pending = provider.renderPng({
		request: request(0, `<script>while(true){}</script>`),
		signal: abort.signal,
	});
	setTimeout(() => abort.abort(), 1500);
	await rejected(() => pending, /abort/i);
	await rejected(() => png(0, `<script>while(true){}</script>`), /timed out/);
	const recovered = await png();
	recovered.close();
	checks.push(
		"abort and watchdog stop runaway HTML; subsequent request recovers",
	);
	console.log("HTML probe: cancellation passed; running compositor/export");
	phase("gpu-initialization");
	await initializeGpu();
	console.log("HTML probe: GPU initialized; starting native export checks");
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `html:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	const params = {
		width: 64,
		height: 64,
		fps: source.frameRate,
		compositor,
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	};
	const tracks = {
		overlay: [
			{
				id: "html",
				type: "graphic",
				name: "HTML",
				elements: [
					{
						id: "clip",
						name: "HTML",
						type: "graphic",
						definitionId: "programmatic",
						programmatic: source,
						params: {},
						startTime: 0,
						duration: 120000,
						trimStart: 0,
						trimEnd: 0,
					},
				],
			},
		],
		main: { id: "main", name: "Main", type: "video", elements: [] },
		audio: [],
	} as unknown as SceneTracks;
	const scene = (isPreview: boolean) =>
		buildScene({
			programmaticFrames: provider,
			tracks,
			mediaAssets: [],
			canvasSize: { width: 64, height: 64 },
			duration: 120000,
			background: { type: "color", color: "#0000ff" },
			assetResolver: {} as AssetResolver,
			isPreview,
		});
	try {
		phase("native-engine-exports");
		const nativeEncodedBytes = nativeSource ? await runNativeEngineExportProbe(nativeSource, params) : undefined;
		if (remotionVideoSource || hyperframesVideoSource) phase("native-video-export-started");
		const nativeVideoEncodedBytes = remotionVideoSource
			? await runNativeEngineExportProbe(remotionVideoSource, params, { indices: [40, 42], startTime: 88000, frameTicks: 4000 })
			: hyperframesVideoSource ? await runNativeEngineExportProbe(hyperframesVideoSource, { ...params, fps: hyperframesVideoSource.frameRate }, { indices: [16, 18], startTime: 26400, frameTicks: 1200 }) : undefined;
		if (remotionVideoSource || hyperframesVideoSource) phase("native-video-export-completed");
		phase("gpu-alpha-preview-export");
		const renderer = new CanvasRenderer(params);
		const preview = await renderer.renderAndCapture({
			node: scene(true),
			time: 0,
			capture: (c) => pixel(c),
		});
		const exported = await renderer.renderAndCapture({
			node: scene(false),
			time: 0,
			capture: (c) => pixel(c),
		});
		equal("preview/export graph parity", preview, exported);
		if (preview.some((value, i) => Math.abs(value - [128, 0, 127, 255][i]) > 3))
			throw Error(`GPU alpha: ${preview}`);
		phase("html-webm-encode-decode");
		const exporter = new SceneExporter({
			...params,
			format: "webm",
			quality: "high",
		});
		const bytes = await exporter.export({
			rootNode: scene(false),
			range: {
				startTime: mediaTime({ ticks: 0 }),
				endTime: mediaTime({ ticks: 8000 }),
				duration: mediaTime({ ticks: 8000 }),
			},
		});
		if (!bytes) throw Error("No encoded HTML video");
		const input = new Input({
			source: new BufferSource(bytes),
			formats: ALL_FORMATS,
		});
		try {
			const video = await input.getPrimaryVideoTrack();
			if (!video) throw Error("Missing HTML video track");
			const sink = new CanvasSink(video);
			const first = await sink.getCanvas(0);
			// Stay away from the moving edge: lossy chroma subsampling bleeds there.
			const firstPixel = first ? pixel(first.canvas, 2) : null;
			const later = await sink.getCanvas(0.04);
			if (!first || !later) throw Error("Missing decoded HTML frames");
			if (!firstPixel || firstPixel[0] < 100 || pixel(later.canvas, 2)[0] > 20)
				throw Error(
					`Encoded HTML motion missing: ${JSON.stringify({ firstPixel, later: pixel(later.canvas, 2) })}`,
				);
		} finally {
			input.dispose();
		}
		checks.push(
			"real Rocut GPU alpha composition, preview/export parity and WebM encode/decode with frame changes",
		);
		phase("export-cancellation-and-recovery");
		const lane = tracks.overlay[0];
		if (lane.type !== "graphic" || lane.elements[0].type !== "graphic")
			throw Error("Wrong fixture lane");
		lane.elements[0].programmatic = {
			...source,
			code: `<script>while(true){}</script>`,
		};
		const cancelling = new SceneExporter({
			...params,
			format: "webm",
			quality: "low",
		});
		let completed = false;
		cancelling.on("complete", () => {
			completed = true;
		});
		const running = cancelling.export({
			rootNode: scene(false),
			range: {
				startTime: mediaTime({ ticks: 0 }),
				endTime: mediaTime({ ticks: 4000 }),
				duration: mediaTime({ ticks: 4000 }),
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 1500));
		await cancelling.cancel();
		equal("HTML cancelled export", await running, null);
		equal("HTML cancellation cannot report success", completed, false);
		lane.elements[0].programmatic = source;
		const afterCancel = await renderer.renderAndCapture({
			node: scene(true),
			time: 0,
			capture: (c) => pixel(c),
		});
		equal(
			"HTML renderer recovers after export cancellation",
			afterCancel,
			preview,
		);
		checks.push(
			"SceneExporter cancellation aborts HTML provider, emits no success, and fresh source recovers",
		);
		if (nativeEncodedBytes) checks.push(`native ${nativeSource?.build?.engine ?? "HyperFrames"} attachment through Rocut GPU preview/export parity and WebM decode across child visibility boundary`);
		if (nativeVideoEncodedBytes) checks.push("native engine video exact decoded source frames through Rocut GPU preview/export and WebM encode/decode");
		phase("completed");
		return { passed: true, checks, encodedBytes: bytes.byteLength, nativeEncodedBytes, nativeVideoEncodedBytes };
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
