import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { createProgrammaticAudioService } from "../../apps/cli/src/programmatic/audio-service";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { nativeAudioWav } from "./native-audio-fixture";
import type { ProgrammaticFrameRequest, ProgrammaticSource } from "@opencut/editor-contracts";

const toolchainDirectory = process.argv[2];
const ffmpeg = process.env.ROCUT_TEST_FFMPEG, ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (!toolchainDirectory || !ffmpeg || !ffprobe) throw Error("Configure isolated toolchain and native decoders");
const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "rocut-hf-audio-editor-host-"));
const require = createRequire(new URL("../../apps/vite-example/package.json", import.meta.url));
const { chromium } = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const decoder = { ffmpeg, ffprobe }, executable = chromium.executablePath();
const context = { store: new FileProjectStore({ root: join(root, "project"), schemaVersion: 1 }), projectId: "hf-audio-editor" };
const sourceDirectory = join(root, "author");
// These originals are the oracle, not a result from the system under test.
const loopWav = nativeAudioWav({ sampleRate: 44100, seconds: 0.12, sample: (i, c) =>
	(Math.sin(i * 431 * Math.PI * 2 / 44100) * 0.3 + Math.sin(i * 719 * Math.PI * 2 / 44100) * 0.08) * (c ? -0.5 : 1) });
const videoWav = nativeAudioWav({ sampleRate: 44100, seconds: 0.16, sample: (i, c) =>
	(Math.sin(i * 613 * Math.PI * 2 / 44100) * 0.2 + Math.sin(i * 941 * Math.PI * 2 / 44100) * 0.05) * (c ? -0.5 : 1) });
let audioService: ReturnType<typeof createProgrammaticAudioService> | undefined;
let server: ReturnType<typeof createServer> | undefined;
try {
	await mkdir(sourceDirectory);
	for (const name of ["source", "video"])
		await copyFile(fileURLToPath(new URL(`./hyperframes-audio-editor-${name}.html`, import.meta.url)), join(sourceDirectory, `${name}.html`));
	await copyFile(join(toolchainDirectory, "node_modules/gsap/dist/gsap.min.js"), join(sourceDirectory, "gsap.js"));
	await writeFile(join(sourceDirectory, "loop.wav"), loopWav);
	await writeFile(join(root, "video.wav"), videoWav);
	const colors = [[20, 80, 220], [60, 100, 190], [100, 120, 160], [140, 140, 130]];
	const pixels = Buffer.alloc(4 * 64 * 64 * 3);
	for (let frame = 0; frame < 4; frame++) for (let pixel = 0; pixel < 64 * 64; pixel++)
		for (let c = 0; c < 3; c++) pixels[(frame * 64 * 64 + pixel) * 3 + c] = colors[frame][c];
	await writeFile(join(root, "video.rgb"), pixels);
	const native = { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 };
	execFileSync(ffmpeg, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "64x64", "-r", "25", "-i", join(root, "video.rgb"),
		"-i", join(root, "video.wav"), "-c:v", "libvpx-vp9", "-lossless", "1", "-c:a", "libopus", "-b:a", "192k",
		"-avoid_negative_ts", "disabled", join(sourceDirectory, "audible.webm")], native);
	const frames = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries",
		"frame=best_effort_timestamp_time", "-of", "json", join(sourceDirectory, "audible.webm")], native).toString());
	assert.deepEqual(frames.frames.map((frame: { best_effort_timestamp_time: string }) => Number(frame.best_effort_timestamp_time)), [0, 0.04, 0.08, 0.12]);
	const compile = async (entryFile: string, files: string[], durationFrames: number, volumeDb: number) =>
		(await compileProgrammaticProject({ action: "compile", input: { version: 1, engine: "hyperframes", sourceDirectory,
			entryFile, files, width: 64, height: 64, frameRate: { numerator: 25, denominator: 1 }, durationFrames, seed: 11,
			audio: { version: 1, mode: "native", volumeDb },
		}, toolchainDirectory, context, signal: AbortSignal.timeout(30000), enqueue: task => task() })).source;
	const loop = await compile("source.html", ["source.html", "gsap.js", "loop.wav"], 6, -6);
	const video = await compile("video.html", ["video.html", "gsap.js", "audible.webm"], 4, -12);
	await rename(sourceDirectory, join(root, "author-moved"));
	const sources: ProgrammaticSource[] = [];
	for (const source of [loop, video]) {
		const rebuilt = await compileProgrammaticProject({ action: "rebuild", input: JSON.parse(JSON.stringify(source)),
			toolchainDirectory, context, signal: AbortSignal.timeout(30000), enqueue: task => task() });
		assert.equal(rebuilt.reusedDocument, true); sources.push(rebuilt.source);
	}
	audioService = createProgrammaticAudioService({ resourceStore: context, executable, connectionFile: "", decoder });
	assert.ok(audioService.capability.configured && audioService.capability.engines.includes("hyperframes"));
	let audioRequests = 0, pictureRequests = 0;
	server = createServer(async (request, response) => {
		if (request.url === "/api/sources") { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(sources)); return; }
		if (request.url === "/api/oracle/loop" || request.url === "/api/oracle/video") {
			response.writeHead(200, { "content-type": "application/octet-stream" }).end((request.url.endsWith("loop") ? loopWav : videoWav).subarray(44)); return;
		}
		if (request.url === "/api/counts") { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ audioRequests, pictureRequests })); return; }
		if (request.url === "/api/programmatic/audio") { audioRequests++; await audioService!.handle(request, response); return; }
		if (request.url === "/api/programmatic/frame") {
			pictureRequests++;
			const controller = new AbortController(), abort = () => controller.abort(); response.once("close", abort);
			try {
				const chunks: Buffer[] = []; let size = 0;
				for await (const chunk of request) { size += chunk.length; if (size > 2_000_000) throw Error("Fixture frame request too large"); chunks.push(Buffer.from(chunk)); }
				const frameRequest = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProgrammaticFrameRequest;
				const png = await renderHtmlPng({ executable, request: frameRequest, resourceStore: context, nativeVideoDecoder: decoder, signal: controller.signal });
				response.writeHead(200, { "content-type": "image/png" }).end(png);
			} catch (error) { if (!response.destroyed) response.writeHead(422, { "content-type": "application/json" }).end(JSON.stringify({ error: String(error) })); }
			finally { response.removeListener("close", abort); }
			return;
		}
		response.writeHead(404).end();
	});
	await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
	const address = server.address(); if (!address || typeof address === "string") throw Error("Missing HF editor fixture address");
	console.log(JSON.stringify({ endpoint: `http://127.0.0.1:${address.port}`, sourcesArchivedAndRebuilt: 2 }));
	await new Promise<void>(resolve => { process.stdin.once("data", () => resolve()); process.stdin.once("end", resolve); process.stdin.resume(); });
	process.stdin.pause();
} finally {
	await audioService?.dispose();
	if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
	if (dirname(root) !== parent || !basename(root).startsWith("rocut-hf-audio-editor-host-")) throw Error("Unsafe HF editor fixture cleanup");
	await rm(root, { recursive: true, force: true });
}
