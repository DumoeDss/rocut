import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { renderHyperframesAudioRange } from "../../apps/cli/src/programmatic/hyperframes-audio-render";
import { withHyperframesAudioAnalyzer } from "../../apps/cli/src/programmatic/hyperframes-audio-analysis";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import { nativeAudioWav } from "./native-audio-fixture";
import { loadProgrammaticResources, resourceDigest } from "../../apps/cli/src/programmatic/resources";
import { describeResource, saveResourceBytes } from "../../apps/cli/src/programmatic/resource-bytes";
import { resolveHtmlDocumentCode } from "../../apps/cli/src/programmatic/document-resource";
import { createProgrammaticAudioService } from "../../apps/cli/src/programmatic/audio-service";
import type { ProgrammaticSource } from "@opencut/editor-contracts";

const toolchainDirectory = process.argv[2];
const ffmpeg = process.env.ROCUT_TEST_FFMPEG, ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (!toolchainDirectory || !ffmpeg || !ffprobe) throw Error("Configure isolated toolchain and native decoder paths");
const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "rocut-hf-audio-"));
const require = createRequire(new URL("../../apps/vite-example/package.json", import.meta.url));
const { chromium } = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const sourceDirectory = join(root, "author"), storeOptions = { root: join(root, "target"), schemaVersion: 1 };
let context = { store: new FileProjectStore(storeOptions), projectId: "hyperframes-audio-probe" };
const executable = chromium.executablePath(), decoder = { ffmpeg, ffprobe };
const wav = nativeAudioWav({ seconds: 0.12,
	sample: (i, c) => Math.sin(i * 500 * Math.PI * 2 / 48000) * (c ? -0.2 : 0.4) });
const signal = () => AbortSignal.timeout(120000);
const timing = (source: ProgrammaticSource, index: number) => ({ source, clipStart: 0,
	clipDuration: source.durationFrames * 4800, trimStart: 0, timelineTime: index * 4800 });
const render = (source: ProgrammaticSource, firstFrame: number, frameCount: number) => renderHyperframesAudioRange({
	source, firstFrame, frameCount, sampleRate: 48000, executable, decoder, resourceStore: context, signal: signal(),
});
try {
	await mkdir(sourceDirectory);
	await copyFile(fileURLToPath(new URL("./hyperframes/audio.html", import.meta.url)), join(sourceDirectory, "audio.html"));
	await copyFile(fileURLToPath(new URL("./hyperframes/audio-video.html", import.meta.url)), join(sourceDirectory, "audio-video.html"));
	await copyFile(fileURLToPath(new URL("./hyperframes/audio-controls.html", import.meta.url)), join(sourceDirectory, "audio-controls.html"));
	await copyFile(join(toolchainDirectory, "node_modules/gsap/dist/gsap.min.js"), join(sourceDirectory, "gsap.js"));
	await writeFile(join(sourceDirectory, "tone.wav"), wav);
	const compile = async (entryFile = "audio.html", files = ["audio.html", "gsap.js", "tone.wav"], durationFrames = 8) =>
		(await compileProgrammaticProject({ action: "compile", input: { version: 1, engine: "hyperframes", sourceDirectory,
			entryFile, files, width: 64, height: 64, frameRate: { numerator: 25, denominator: 1 }, durationFrames, seed: 7,
			audio: { version: 1, mode: "native" },
		}, toolchainDirectory, context, signal: signal(), enqueue: task => task() })).source;
	const source = await compile();
	let full: Awaited<ReturnType<typeof render>> | undefined;
	if (!process.argv.includes("--video-only")) {
	// Negative control restores only the pinned upstream loop-window defect.
	const documentCode = resolveHtmlDocumentCode(source, await loadProgrammaticResources(context, source.resources!, signal()));
	const corrected = 'isVideo:p.tagName==="VIDEO"||p.loop,sourceDuration:_';
	assert.equal(documentCode.split(corrected).length, 2);
	const controlBody = new TextEncoder().encode(documentCode.replace(corrected, 'isVideo:p.tagName==="VIDEO",sourceDuration:_')).buffer;
	const controlResource = describeResource({ id: source.documentId!, kind: "document", mimeType: "text/html" }, controlBody.byteLength, resourceDigest(controlBody));
	await saveResourceBytes(context, { resource: controlResource, body: controlBody }, signal());
	const controlSource = { ...source, resources: source.resources!.map(item => item.id === source.documentId ? controlResource : item) };
	await withHyperframesAudioAnalyzer({ executable, request: timing(controlSource, 3), resourceStore: context, signal: signal() }, async analyzer => {
		assert.ok(!(await analyzer.frame(timing(controlSource, 3))).assets.some(item => item.id === "loop"));
	});
	await withHyperframesAudioAnalyzer({ executable, request: timing(source, 0), resourceStore: context, signal: signal() }, async analyzer => {
		for (const index of [3, 0, 2, 4, 5, 7]) {
			const result = await analyzer.frame(timing(source, index));
			assert.equal(result.frameIndex, index);
			assert.ok(!result.assets.some(asset => asset.id === "silent"));
			const loop = result.assets.find(asset => asset.id === "loop");
			assert.ok(loop, `Missing loop at ${index}`);
			assert.ok(Math.abs(loop.sourceTime - (index % 2 ? 0.08 : 0.04)) < 1e-7);
			assert.equal(loop.volume, 0.25);
			const nested = result.assets.find(asset => asset.id === "nested");
			assert.equal(Boolean(nested), index === 2 || index === 3);
			if (nested) { assert.equal(nested.volume, 0.5); assert.ok(Math.abs(nested.sourceTime - (index === 2 ? 0.02 : 0.06)) < 1e-7); }
			assert.equal(result.assets.some(asset => asset.id === "nested-loop"), index >= 2 && index < 5);
			assert.equal(result.assets.some(asset => asset.id === "plain"), index < 2);
		}
	});
	full = await render(source, 0, 8);
	assert.equal(full.frames, 15360); assert.equal(full.sampleOrigin, 0); assert.equal(full.hasAudio, true);
	let worst = 0;
	for (let i = 0; i < full.frames; i++) for (let c = 0; c < 2; c++) {
		const frame = Math.floor(i / 1920), local = i % 1920;
		let expected = wav.readFloatLE(44 + (((frame % 2 ? 3840 : 1920) + local) * 2 + c) * 4) * 0.25;
		if (frame < 2) expected += wav.readFloatLE(44 + (((frame + 1) * 1920 + local) * 2 + c) * 4) * 0.0625;
		if (frame === 2 || frame === 3) expected += wav.readFloatLE(44 + (((frame === 2 ? 960 : 2880) + local) * 2 + c) * 4) * 0.5;
		if (frame >= 2 && frame < 5) expected += wav.readFloatLE(44 + (((frame % 2 ? 3840 : 1920) + local) * 2 + c) * 4) * 0.125;
		worst = Math.max(worst, Math.abs(full.pcm.readFloatLE(i * 8 + c * 4) - expected));
	}
	assert.ok(worst < 1e-7, `HyperFrames native PCM sample error ${worst}`);
	const partial = await render(source, 3, 2);
	assert.equal(partial.sampleOrigin, 5760);
	assert.deepEqual(partial.pcm, full.pcm.subarray(5760 * 8, 9600 * 8));
	console.log(JSON.stringify({ phase: "native-hyperframes-pcm", samplesChecked: 30720, worst,
		checks: ["native nested starts", "trim", "loop", "loop host boundary", "upstream negative control", "mute", "random frame order", "partial/full equality"] }));
	const controls = await compile("audio-controls.html", ["audio-controls.html", "gsap.js", "tone.wav"], 4);
	await withHyperframesAudioAnalyzer({ executable, request: timing(controls, 0), resourceStore: context, signal: signal() }, async analyzer => {
		for (const index of [0, 1, 2, 3]) {
			const { assets } = await analyzer.frame(timing(controls, index));
			const fast = assets.find(item => item.id === "fast")!;
			assert.equal(fast.playbackRate, 2); assert.ok(Math.abs(fast.sourceTime - 0.04) < 1e-7);
			assert.ok(Math.abs(assets.find(item => item.id === "fade")!.volume - [0, 0.75, 1.5, 1.5][index]) < 1e-7);
			assert.ok(Math.abs(assets.find(item => item.id === "envelope")!.volume - [0.1, 0.3, 0.5, 0.7][index]) < 1e-7);
		}
	});
	console.log(JSON.stringify({ phase: "native-hyperframes-controls", checks: ["constant rate 2", "native loop sourceTime", "fade", "gain above unity", "volume automation lane"] }));
	}
	const picture = await renderHtmlPng({ executable, request: timing(source, 3), nativeVideoDecoder: decoder,
		resourceStore: context, signal: signal() });
	assert.ok(picture.length > 100);
	const colors = [[40, 240, 0], [80, 210, 0], [120, 180, 0], [160, 150, 0]];
	const rgb = Buffer.alloc(4 * 64 * 64 * 3);
	for (let frame = 0; frame < 4; frame++) for (let pixel = 0; pixel < 64 * 64; pixel++)
		for (let c = 0; c < 3; c++) rgb[(frame * 64 * 64 + pixel) * 3 + c] = colors[frame][c];
	await writeFile(join(root, "picture.rgb"), rgb);
	await writeFile(join(root, "video.wav"), nativeAudioWav({ seconds: 0.16,
		sample: (i, c) => Math.sin(i * 500 * Math.PI * 2 / 48000) * (c ? -0.2 : 0.4) }));
	const nativeOptions = { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 };
	execFileSync(ffmpeg, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "64x64", "-r", "25",
		"-i", join(root, "picture.rgb"), "-i", join(root, "video.wav"), "-c:v", "libvpx-vp9", "-lossless", "1",
		"-c:a", "libopus", "-b:a", "128k", "-avoid_negative_ts", "disabled", join(sourceDirectory, "audible.webm")], nativeOptions);
	const videoFrames = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", join(sourceDirectory, "audible.webm")], nativeOptions).toString());
	assert.deepEqual(videoFrames.frames.map((item: { best_effort_timestamp_time: string }) => Number(item.best_effort_timestamp_time)), [0, 0.04, 0.08, 0.12]);
	const video = await compile("audio-video.html", ["audio-video.html", "gsap.js", "audible.webm"], 4);
	const videoPcm = await render(video, 1, 2);
	assert.equal(videoPcm.hasAudio, true);
	let energy = 0;
	for (let i = 0; i < videoPcm.frames; i++) energy += videoPcm.pcm.readFloatLE(i * 8) ** 2;
	assert.ok(Math.sqrt(energy / videoPcm.frames) > 0.1, "Native video soundtrack was silently discarded");
	for (const index of [1, 3]) {
		const png = await renderHtmlPng({ executable, request: timing(video, index), nativeVideoDecoder: decoder,
			resourceStore: context, signal: signal() });
		const pixels: Buffer = execFileSync(ffmpeg, ["-v", "error", "-f", "image2pipe", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { ...nativeOptions, input: png });
		const pixel: number[] = [...pixels.subarray((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4)];
		assert.equal(pixel[3], 255);
		for (let c = 0; c < 3; c++) assert.ok(Math.abs(pixel[c] - colors[index][c]) <= 5,
			`Native audible video picture ${index}: ${pixel}`);
	}
	const baseline = full?.pcm.subarray(5760 * 8, 7680 * 8) ?? (await render(source, 3, 1)).pcm;
	const service = createProgrammaticAudioService({ resourceStore: context, executable, connectionFile: "", decoder });
	const server = createServer((request, response) => { void service.handle(request, response); });
	try {
		assert.ok(service.capability.configured); assert.ok(service.capability.engines.includes("hyperframes"));
		await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
		const address = server.address(); if (!address || typeof address === "string") throw Error("Missing audio fixture address");
		const response = await fetch(`http://127.0.0.1:${address.port}/programmatic/audio`, { method: "POST",
			headers: { "content-type": "application/json" }, body: JSON.stringify({ source, firstFrame: 3, frameCount: 1, sampleRate: 48000 }), signal: signal() });
		assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/vnd.rocut.audio-pcm");
		for (const [header, value] of Object.entries({ "x-rocut-audio-version": "1", "x-rocut-sample-rate": "48000",
			"x-rocut-channels": "2", "x-rocut-frames": "1920", "x-rocut-sample-origin": "5760", "x-rocut-has-audio": "1" }))
			assert.equal(response.headers.get(header), value);
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), baseline);
		console.log(JSON.stringify({ phase: "native-hyperframes-host-service", frames: 1920, sampleOrigin: 5760, identicalPcm: true }));
	} finally {
		await service.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
	}
	await rename(sourceDirectory, join(root, "author-moved"));
	context = { store: new FileProjectStore(storeOptions), projectId: "hyperframes-audio-probe" };
	const rebuilt = await compileProgrammaticProject({ action: "rebuild", input: JSON.parse(JSON.stringify(source)),
		toolchainDirectory, context, signal: signal(), enqueue: task => task() });
	assert.equal(rebuilt.reusedDocument, true);
	assert.deepEqual((await render(rebuilt.source, 3, 1)).pcm, baseline);
	console.log(JSON.stringify({ passed: true, checks: ["declared source picture", "audible video soundtrack", "exact native video pictures", "archive rebuild"],
		scope: "real pinned HyperFrames compiler + independent Chromium + Rocut native PCM/PNG; not installed/Electron" }));
} finally {
	if (dirname(root) !== parent || !basename(root).startsWith("rocut-hf-audio-")) throw Error("Unsafe HyperFrames audio fixture cleanup");
	await rm(root, { recursive: true, force: true });
}
