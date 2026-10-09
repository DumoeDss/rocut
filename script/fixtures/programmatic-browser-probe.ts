import { Input, BufferSource, ALL_FORMATS, CanvasSink } from "mediabunny";
import { disposeCompositor, disposeGpu, initializeGpu } from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { SceneTracks } from "../../packages/editor-classic/src/timeline/types";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { mediaTime } from "../../packages/editor-classic/src/wasm/media-time";
import type { AssetResolver } from "@opencut/editor-ports";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { buildScene } from "../../packages/editor-classic/src/services/renderer/scene-builder";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { SceneExporter } from "../../packages/editor-classic/src/services/renderer/scene-exporter";

const source: ProgrammaticSource = {
	version: 1,
	runtime: "canvas-worker",
	width: 64,
	height: 64,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 30,
	seed: 7,
	code: `const ctx = canvas.getContext('2d');
ctx.fillStyle = 'rgba(255,0,0,0.5)'; ctx.fillRect(frame.index,0,32,64);
ctx.fillStyle = 'rgb(' + Math.floor(frame.random()*256) + ',255,0)'; ctx.fillRect(0,0,2,2);`,
};
const frame = (timelineTime: number, s = source) =>
	resolveProgrammaticFrame({
		source: s,
		clipStart: 0,
		clipDuration: 120000,
		trimStart: 0,
		timelineTime,
	})!;
const equal = (name: string, actual: unknown, expected: unknown) => {
	if (JSON.stringify(actual) !== JSON.stringify(expected))
		throw Error(`${name}: ${JSON.stringify({ actual, expected })}`);
};
const pixel = (image: CanvasImageSource, x = 16, y = 16) => {
	const c = new OffscreenCanvas(64, 64),
		ctx = c.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	return Array.from(ctx.getImageData(x, y, 1, 1).data);
};
const digest = async (image: CanvasImageSource) => {
	const c = new OffscreenCanvas(64, 64),
		ctx = c.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	return Array.from(
		new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				ctx.getImageData(0, 0, 64, 64).data,
			),
		),
	).join(",");
};
async function rejected(operation: () => Promise<unknown>, pattern: RegExp) {
	try {
		await operation();
	} catch (error) {
		if (pattern.test(String(error))) return;
		throw error;
	}
	throw Error(`Expected failure: ${pattern}`);
}

export async function runProgrammaticProbe() {
	const checks: string[] = [];
	const hashes = [];
	for (const time of [0, 40000, 0]) {
		const bitmap = await renderProgrammaticCanvas({
			source,
			frame: frame(time),
		});
		try {
			hashes.push(await digest(bitmap));
			equal("transparent pixel", pixel(bitmap, 63), [0, 0, 0, 0]);
			equal("half alpha pixel", pixel(bitmap), [255, 0, 0, 128]);
		} finally {
			bitmap.close();
		}
	}
	equal("repeat after seek", hashes[0], hashes[2]);
	if (hashes[0] === hashes[1]) throw Error("Stale source frame");
	checks.push("real isolated Canvas pixels, alpha and random seek");
	const glSource = {
		...source,
		code: `const gl=canvas.getContext('webgl2'); if(!gl) throw Error('WebGL2 unavailable'); gl.clearColor(0,1,0,0.5); gl.clear(gl.COLOR_BUFFER_BIT); gl.finish();`,
	};
	const glBitmap = await renderProgrammaticCanvas({
		source: glSource,
		frame: frame(0, glSource),
	});
	try {
		equal("WebGL2 pixel", pixel(glBitmap), [0, 255, 0, 128]);
	} finally {
		glBitmap.close();
	}
	checks.push("real isolated WebGL2 alpha frame");
	for (const code of [
		"await fetch('https://example.invalid/blocked')",
		"importScripts('https://example.invalid/blocked.js')",
		"document.body.innerHTML = 'escape'",
		"localStorage.getItem('host')",
	]) {
		await rejected(
			() =>
				renderProgrammaticCanvas({
					source: { ...source, code },
					frame: frame(0),
				}),
			/failed/i,
		);
	}
	checks.push("CSP denies network/script imports; Worker has no DOM/storage");
	await rejected(
		() =>
			renderProgrammaticCanvas({
				source: { ...source, code: "throw Error('test failure')" },
				frame: frame(0),
			}),
		/test failure/,
	);
	const abort = new AbortController();
	const pending = renderProgrammaticCanvas({
		source: { ...source, code: "while(true){}" },
		frame: frame(0),
		signal: abort.signal,
	});
	setTimeout(() => abort.abort(), 100);
	await rejected(() => pending, /abort/i);
	equal("no remaining sandbox", document.querySelectorAll("iframe").length, 0);
	checks.push("errors and cancellation reject and remove sandbox");
	await rejected(
		() =>
			renderProgrammaticCanvas({
				source: { ...source, code: "while(true){}" },
				frame: frame(0),
			}),
		/timed out/,
	);
	equal(
		"timeout removes sandbox",
		document.querySelectorAll("iframe").length,
		0,
	);
	checks.push("runaway Worker times out without blocking editor thread");

	await initializeGpu();
	const compositor = new WasmCompositor({
		trackGpuResource: ({ handle, label }) => ({
			handle,
			label,
			resourceId: `test:${handle}`,
			release: () => disposeCompositor(handle),
		}),
	} as SessionResources);
	const params = {
		width: 64,
		height: 64,
		fps: source.frameRate,
		compositor,
		// No video assets in this fixture: the only sampled sources are real Workers.
		videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
	};
	const tracks = {
		overlay: [
			{
				id: "p",
				name: "Programmatic",
				type: "graphic",
				hidden: false,
				elements: [
					{
						id: "clip",
						name: "Canvas",
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
		main: {
			id: "main",
			name: "Main",
			type: "video",
			hidden: false,
			muted: false,
			elements: [],
		},
		audio: [],
	} as unknown as SceneTracks;
	const scene = (isPreview: boolean) =>
		buildScene({
			canvasSize: { width: 64, height: 64 },
			tracks,
			mediaAssets: [],
			duration: 120000,
			background: { type: "color", color: "#0000ff" },
			isPreview,
			assetResolver: {} as AssetResolver,
		});
	try {
		const renderer = new CanvasRenderer(params);
		const preview = scene(true),
			exporting = scene(false);
		const previewHashes = [];
		for (const time of [0, 40000, 0]) {
			const a = await renderer.renderAndCapture({
				node: preview,
				time,
				capture: digest,
			});
			const b = await renderer.renderAndCapture({
				node: exporting,
				time,
				capture: digest,
			});
			equal("preview/export graph parity", a, b);
			previewHashes.push(a);
		}
		equal("GPU reverse seek", previewHashes[0], previewHashes[2]);
		if (previewHashes[0] === previewHashes[1]) throw Error("GPU stale frame");
		const rgba = await renderer.renderAndCapture({
			node: preview,
			time: 0,
			capture: (c) => pixel(c),
		});
		if (rgba.some((v, i) => Math.abs(v - [128, 0, 127, 255][i]) > 3))
			throw Error(`Alpha composition: ${rgba}`);
		checks.push(
			"Rocut GPU composition, source alpha and preview/export parity",
		);
		const audioBuffer = new AudioBuffer({
			numberOfChannels: 1,
			length: 24000,
			sampleRate: 48000,
		});
		const pcm = audioBuffer.getChannelData(0);
		for (let i = 0; i < pcm.length; i++)
			pcm[i] = 0.1 * Math.sin((i * 2 * Math.PI * 440) / 48000);
		const exporter = new SceneExporter({
			...params,
			format: "webm",
			quality: "high",
			shouldIncludeAudio: true,
			audioBuffer,
		});
		const buffer = await exporter.export({
			rootNode: exporting,
			range: {
				startTime: mediaTime({ ticks: 0 }),
				endTime: mediaTime({ ticks: 60000 }),
				duration: mediaTime({ ticks: 60000 }),
			},
		});
		if (!buffer) throw Error("Export produced no output");
		const input = new Input({
			source: new BufferSource(buffer),
			formats: ALL_FORMATS,
		});
		try {
			const video = await input.getPrimaryVideoTrack();
			if (!video || !(await input.getPrimaryAudioTrack()))
				throw Error("Missing picture or audio track");
			const sink = new CanvasSink(video);
			const decoded = await sink.getCanvas(0);
			if (!decoded) throw Error("Encoded frame did not decode");
			const rgba = pixel(decoded.canvas);
			if (rgba.some((v, i) => Math.abs(v - [128, 0, 127, 255][i]) > 12))
				throw Error(`Encoded alpha composition: ${rgba}`);
			const later = await sink.getCanvas(0.4);
			if (
				!later ||
				(await digest(later.canvas)) === (await digest(decoded.canvas))
			)
				throw Error("Encoded frames did not advance");
			checks.push(
				"real WebM encode/decode with programmatic picture and separate audio track",
			);
		} finally {
			input.dispose();
		}
		const lane = tracks.overlay[0];
		if (lane.type !== "graphic" || lane.elements[0].type !== "graphic")
			throw Error("Wrong test lane");
		lane.elements[0].programmatic = { ...source, code: "while(true){}" };
		const cancelling = new SceneExporter({
			...params,
			format: "webm",
			quality: "low",
		});
		let completed = false;
		cancelling.on("complete", () => {
			completed = true;
		});
		const run = cancelling.export({
			rootNode: scene(false),
			range: {
				startTime: mediaTime({ ticks: 0 }),
				endTime: mediaTime({ ticks: 4000 }),
				duration: mediaTime({ ticks: 4000 }),
			},
		});
		const deadline = performance.now() + 3000;
		while (!document.querySelector("iframe") && performance.now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, 10));
		if (!document.querySelector("iframe"))
			throw Error("Cancellation never reached source execution");
		await cancelling.cancel();
		equal("cancelled output", await run, null);
		equal("cancelled exporter never succeeds", completed, false);
		equal(
			"cancelled exporter removes sandbox",
			document.querySelectorAll("iframe").length,
			0,
		);
		lane.elements[0].programmatic = {
			...source,
			code: "canvas.getContext('2d').fillRect(0,0,64,64)",
		};
		const recovered = await renderer.renderAndCapture({
			node: scene(true),
			time: 0,
			capture: (c) => pixel(c),
		});
		equal("new source after cancelled export", recovered, [0, 0, 0, 255]);
		checks.push(
			"export cancellation stops source, publishes no success and allows a fresh render",
		);
		return { passed: true, checks, encodedBytes: buffer.byteLength };
	} finally {
		compositor.dispose();
		disposeGpu();
	}
}
