import { strict as assert } from "node:assert";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ProgrammaticFrameRequest } from "@opencut/editor-contracts";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { createProgrammaticAudioService } from "../../apps/cli/src/programmatic/audio-service";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { nativeAudioWav } from "./native-audio-fixture";
import { graphToneSample } from "./hyperframes-graph-editor-oracle.mjs";

const toolchainDirectory = process.argv[2],
	artifact = process.argv[3];
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (
	!toolchainDirectory ||
	!artifact ||
	!isAbsolute(artifact) ||
	!ffmpeg ||
	!ffprobe
)
	throw Error("Provide isolated toolchain, artifact root, and native decoders");
const root = join(resolve(artifact), "host");
await mkdir(root);
const require = createRequire(
	new URL("../../apps/vite-example/package.json", import.meta.url),
);
const { chromium } = await import(
	pathToFileURL(require.resolve("@playwright/test")).href
);
const decoder = { ffmpeg, ffprobe },
	executable = chromium.executablePath();
const context = {
	store: new FileProjectStore({
		root: join(root, "project"),
		schemaVersion: 1,
	}),
	projectId: "hf-graph-editor",
};
let service: ReturnType<typeof createProgrammaticAudioService> | undefined;
let server: ReturnType<typeof createServer> | undefined;
try {
	const authored = join(root, "author"),
		archived = join(root, "author-archived");
	await mkdir(authored);
	await copyFile(
		fileURLToPath(
			new URL("./hyperframes-graph-editor-source.html", import.meta.url),
		),
		join(authored, "index.html"),
	);
	await copyFile(
		join(toolchainDirectory, "node_modules/gsap/dist/gsap.min.js"),
		join(authored, "gsap.js"),
	);
	await writeFile(
		join(authored, "tone.wav"),
		nativeAudioWav({
			sampleRate: 44100,
			seconds: 0.08,
			sample: graphToneSample,
		}),
	);
	const built = await compileProgrammaticProject({
		action: "compile",
		input: {
			version: 1,
			engine: "hyperframes",
			sourceDirectory: authored,
			entryFile: "index.html",
			files: ["index.html", "gsap.js", "tone.wav"],
			width: 64,
			height: 64,
			frameRate: { numerator: 25, denominator: 1 },
			durationFrames: 8,
			seed: 11,
			audio: {
				version: 1,
				mode: "native",
				profile: "hyperframes-graph-v1",
				volumeDb: -6,
			},
		},
		toolchainDirectory,
		context,
		signal: AbortSignal.timeout(45000),
		enqueue: (task) => task(),
	});
	assert.equal(dirname(resolve(authored)), root);
	assert.equal(dirname(resolve(archived)), root);
	await rename(authored, archived);
	const rebuilt = await compileProgrammaticProject({
		action: "rebuild",
		input: JSON.parse(JSON.stringify(built.source)),
		toolchainDirectory,
		context,
		signal: AbortSignal.timeout(45000),
		enqueue: (task) => task(),
	});
	assert.equal(rebuilt.reusedDocument, true);
	await writeFile(
		join(root, "source.json"),
		JSON.stringify(rebuilt.source, null, 2),
	);
	service = createProgrammaticAudioService({
		resourceStore: context,
		executable,
		connectionFile: "",
		decoder,
		toolchainDirectory,
	});
	assert.equal(service.capability.hyperframesGraph.configured, true);
	const counts = { identityRequests: 0, audioRequests: 0, pictureRequests: 0 };
	server = createServer(async (request, response) => {
		if (request.url === "/api/source") {
			response
				.writeHead(200, { "content-type": "application/json" })
				.end(JSON.stringify(rebuilt.source));
			return;
		}
		if (request.url === "/api/counts") {
			response
				.writeHead(200, { "content-type": "application/json" })
				.end(JSON.stringify(counts));
			return;
		}
		if (request.url === "/api/programmatic/audio/identity") {
			counts.identityRequests++;
			await service!.handle(request, response, "identity");
			return;
		}
		if (request.url === "/api/programmatic/audio") {
			counts.audioRequests++;
			await service!.handle(request, response);
			return;
		}
		if (request.url === "/api/programmatic/frame") {
			counts.pictureRequests++;
			const controller = new AbortController(),
				abort = () => controller.abort();
			response.once("close", abort);
			try {
				const chunks: Buffer[] = [];
				let size = 0;
				for await (const chunk of request) {
					size += chunk.length;
					if (size > 2_000_000) throw Error("Fixture frame request too large");
					chunks.push(Buffer.from(chunk));
				}
				const frameRequest = JSON.parse(
					Buffer.concat(chunks).toString("utf8"),
				) as ProgrammaticFrameRequest;
				const png = await renderHtmlPng({
					executable,
					request: frameRequest,
					resourceStore: context,
					nativeVideoDecoder: decoder,
					connectionFile: "",
					signal: controller.signal,
				});
				response.writeHead(200, { "content-type": "image/png" }).end(png);
			} catch (error) {
				if (!response.destroyed)
					response
						.writeHead(422, { "content-type": "application/json" })
						.end(JSON.stringify({ error: String(error) }));
			} finally {
				response.removeListener("close", abort);
			}
			return;
		}
		response.writeHead(404).end();
	});
	await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string")
		throw Error("Missing graph editor Host address");
	console.log(
		JSON.stringify({
			endpoint: `http://127.0.0.1:${address.port}`,
			artifact: root,
			archivedAndRebuilt: true,
		}),
	);
	await new Promise<void>((done) => {
		process.stdin.once("data", () => done());
		process.stdin.once("end", done);
		process.stdin.resume();
	});
	process.stdin.pause();
	await writeFile(join(root, "counts.json"), JSON.stringify(counts, null, 2));
} finally {
	await service?.dispose();
	if (server) {
		server.closeAllConnections();
		await new Promise<void>((done) => server!.close(() => done()));
	}
	// Evidence is intentionally retained, including failures and archived inputs.
}
