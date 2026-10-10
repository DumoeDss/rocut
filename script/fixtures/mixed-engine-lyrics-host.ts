import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
	ProgrammaticFrameRequest,
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import { createProgrammaticAudioService } from "../../apps/cli/src/programmatic/audio-service";
import {
	describeResource,
	saveResourceBytes,
} from "../../apps/cli/src/programmatic/resource-bytes";
import {
	loadProgrammaticResource,
	resourceDigest,
} from "../../apps/cli/src/programmatic/resources";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { nativeAudioWav } from "./native-audio-fixture";
import { CURRENT_PROJECT_VERSION } from "../../packages/editor-classic/src/services/storage/migrations/version";

const toolchainDirectory = process.argv[2],
	artifact = process.argv[3],
	ffmpeg = process.env.ROCUT_TEST_FFMPEG;
if (!toolchainDirectory || !artifact || !isAbsolute(artifact) || !ffmpeg)
	throw Error("Configure private toolchain, artifact root and FFmpeg");
const root = join(resolve(artifact), "host");
await mkdir(root);
const require = createRequire(
	new URL("../../apps/vite-example/package.json", import.meta.url),
);
const { chromium } = await import(
	pathToFileURL(require.resolve("@playwright/test")).href
);
const executable = chromium.executablePath(),
	storeRoot = join(root, "project");
const context = {
	store: new FileProjectStore({
		root: storeRoot,
		schemaVersion: CURRENT_PROJECT_VERSION,
	}),
	projectId: "mixed-engine-lyrics",
};
const audioService = createProgrammaticAudioService({
	resourceStore: context,
	executable,
	decoder: {
		ffmpeg: process.env.ROCUT_TEST_FFMPEG!,
		ffprobe: process.env.ROCUT_TEST_FFPROBE!,
	},
	connectionFile: "",
	toolchainDirectory,
});
const sources: Record<string, ProgrammaticSource> = {};
const archived: Record<string, boolean> = {};
for (const engine of ["hyperframes", "remotion"] as const) {
	const directory = join(root, engine),
		moved = join(root, `${engine}-moved`);
	await mkdir(directory);
	const entryFile = engine === "hyperframes" ? "index.html" : "index.tsx";
	await copyFile(
		fileURLToPath(
			new URL(
				`./mixed-engine-lyrics-${engine}.${engine === "hyperframes" ? "html" : "tsx"}`,
				import.meta.url,
			),
		),
		join(directory, entryFile),
	);
	const files = [entryFile];
	if (engine === "hyperframes") {
		await copyFile(
			join(toolchainDirectory, "node_modules/gsap/dist/gsap.min.js"),
			join(directory, "gsap.js"),
		);
		files.push("gsap.js");
		await writeFile(
			join(directory, "hf.wav"),
			nativeAudioWav({
				seconds: 1,
				sample: (frame, channel) =>
					Math.sin((frame * 220 * 2 * Math.PI) / 48000) * (channel ? 0.125 : 0.25),
			}),
		);
		files.push("hf.wav");
	}
	const compiled = await compileProgrammaticProject({
		action: "compile",
		input: {
			version: 1,
			engine,
			sourceDirectory: directory,
			entryFile,
			files,
			width: 96,
			height: 96,
			frameRate: { numerator: 25, denominator: 1 },
			durationFrames: 25,
			seed: 11,
			...(engine === "remotion" ? { compositionId: "MixedLyrics" } : {}),
			...(engine === "hyperframes"
				? {
						audio: {
							version: 1,
							mode: "native",
							profile: "hyperframes-graph-v1",
						},
					}
				: {}),
		},
		toolchainDirectory,
		context,
		signal: AbortSignal.timeout(60000),
		enqueue: (task) => task(),
	});
	assert.equal(dirname(resolve(directory)), root);
	assert.equal(dirname(resolve(moved)), root);
	await rename(directory, moved);
	const rebuilt = await compileProgrammaticProject({
		action: "rebuild",
		input: JSON.parse(JSON.stringify(compiled.source)),
		toolchainDirectory,
		context,
		signal: AbortSignal.timeout(60000),
		enqueue: (task) => task(),
	});
	assert.equal(rebuilt.reusedDocument, true);
	sources[engine] = rebuilt.source;
	archived[engine] = true;
}
async function image(id: string, foreground: boolean) {
	const raw = Buffer.alloc(96 * 96 * 4);
	for (let y = 0; y < 96; y++)
		for (let x = 0; x < 96; x++) {
			const at = (y * 96 + x) * 4;
			if (foreground && !(x >= 40 && x < 56 && y >= 32 && y < 64)) continue;
			raw.set(foreground ? [233, 69, 96, 255] : [255, 0, 255, 255], at);
		}
	const png = execFileSync(
		ffmpeg!,
		[
			"-v",
			"error",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgba",
			"-s",
			"96x96",
			"-i",
			"pipe:0",
			"-frames:v",
			"1",
			"-f",
			"image2pipe",
			"-c:v",
			"png",
			"pipe:1",
		],
		{ input: raw, windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
	);
	await writeFile(join(root, id), png);
	const body = Uint8Array.from(png).buffer;
	const resource = describeResource(
		{ id, kind: "image", mimeType: "image/png" },
		body.byteLength,
		resourceDigest(body),
	);
	await saveResourceBytes(context, { resource, body });
	return resource;
}
const foreground = await image("foreground.png", true),
	omitted = await image("omitted-background.png", false);
const pose = { x: 0.5, y: 0.5, height: 1, rotation: 0, opacity: 1 };
sources.recipe = {
	version: 1,
	runtime: "canvas-worker",
	code: "",
	width: 96,
	height: 96,
	frameRate: { numerator: 25, denominator: 1 },
	durationFrames: 25,
	seed: 11,
	resources: [foreground, omitted],
	recipe: {
		version: 1,
		root: "shot",
		songStartSeconds: 0,
		outputRoles: ["foreground"],
		nodes: [
			{
				id: "shot",
				scene: {
					kind: "illust",
					motion: { startFrame: 0, durationFrames: 25 },
					easing: "linear",
					background: {
						image: omitted.id,
						from: { x: 0, y: 0, zoom: 1 },
						to: { x: 0, y: 0, zoom: 1 },
					},
					sprites: [
						{
							image: foreground.id,
							role: "foreground",
							from: pose,
							to: pose,
							anchor: [0.5, 0.5],
						},
					],
				},
			},
		],
	},
};
await writeFile(
	join(root, "sources.json"),
	JSON.stringify({ sources, archived }, null, 2),
);
const font = await readFile(
	fileURLToPath(
		new URL(
			"../../apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf",
			import.meta.url,
		),
	),
);
const counts = {
	frames: { hyperframes: 0, remotion: 0 },
	resources: 0,
	fontLoads: 0,
	saves: 0,
	reloads: 0,
};
async function body(
	request: import("node:http").IncomingMessage,
): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > 2_000_000) throw Error("Fixture payload too large");
		chunks.push(Buffer.from(chunk));
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const server = createServer(async (request, response) => {
	const controller = new AbortController(),
		abort = () => controller.abort();
	response.once("close", abort);
	const json = (value: unknown) =>
		response
			.writeHead(200, { "content-type": "application/json" })
			.end(JSON.stringify(value));
	try {
		if (request.url === "/api/sources") {
			json({ sources, archived, version: CURRENT_PROJECT_VERSION });
			return;
		}
		if (request.url === "/api/counts") {
			json(counts);
			return;
		}
		if (request.url === "/api/font") {
			counts.fontLoads++;
			response.writeHead(200, { "content-type": "font/ttf" }).end(font);
			return;
		}
		if (request.url === "/api/save") {
			const data = await body(request);
			const now = "2026-10-08T00:00:00.000Z";
			await context.store.save({
				record: {
					id: context.projectId,
					schemaVersion: CURRENT_PROJECT_VERSION,
					data,
				},
				summary: {
					id: context.projectId,
					name: "Mixed engine lyrics",
					createdAt: now,
					updatedAt: now,
				},
			});
			counts.saves++;
			context.store = new FileProjectStore({
				root: storeRoot,
				schemaVersion: CURRENT_PROJECT_VERSION,
			});
			json({ saved: true });
			return;
		}
		if (request.url === "/api/project") {
			counts.reloads++;
			json((await context.store.load({ id: context.projectId }))?.data);
			return;
		}
		if (request.url === "/api/programmatic/resources/load") {
			counts.resources++;
			const resource = (await body(request)) as ProgrammaticResource;
			const loaded = await loadProgrammaticResource({
				...context,
				resource,
				signal: controller.signal,
			});
			response
				.writeHead(200, { "content-type": resource.mimeType })
				.end(Buffer.from(loaded.body));
			return;
		}
		if (request.url === "/api/programmatic/frame") {
			const input = (await body(request)) as ProgrammaticFrameRequest;
			const engine = input.source.build?.engine;
			if (engine !== "hyperframes" && engine !== "remotion")
				throw Error("Unexpected HTML engine");
			counts.frames[engine]++;
			const png = await renderHtmlPng({
				executable,
				request: input,
				resourceStore: context,
				nativeVideoDecoder: {
					ffmpeg: process.env.ROCUT_TEST_FFMPEG!,
					ffprobe: process.env.ROCUT_TEST_FFPROBE!,
				},
				connectionFile: "",
				signal: controller.signal,
			});
			response.writeHead(200, { "content-type": "image/png" }).end(png);
			return;
		}
		if (request.url === "/api/programmatic/audio/identity") {
			await audioService.handle(request, response, "identity");
			counts.audioIdentities = (counts.audioIdentities ?? 0) + 1;
			return;
		}
		if (request.url === "/api/programmatic/audio") {
			counts.audioRenders = (counts.audioRenders ?? 0) + 1;
			await audioService.handle(request, response, "render");
			return;
		}
		response.writeHead(404).end();
	} catch (error) {
		if (!response.destroyed)
			response
				.writeHead(422, { "content-type": "application/json" })
				.end(JSON.stringify({ error: String(error) }));
	} finally {
		response.removeListener("close", abort);
	}
});
try {
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string")
		throw Error("Missing mixed-engine fixture address");
	console.log(
		JSON.stringify({
			endpoint: `http://127.0.0.1:${address.port}`,
			archived,
			artifact: root,
		}),
	);
	await new Promise<void>((done) => {
		process.stdin.once("data", () => done());
		process.stdin.once("end", done);
		process.stdin.resume();
	});
	process.stdin.pause();
} finally {
	server.closeAllConnections();
	await new Promise<void>((done) => server.close(() => done()));
	await writeFile(join(root, "counts.json"), JSON.stringify(counts, null, 2));
}
