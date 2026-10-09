import { strict as assert } from "node:assert";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
	ProgrammaticFrameRequest,
	ProgrammaticResource,
} from "@opencut/editor-contracts";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { createProgrammaticAudioService } from "../../apps/cli/src/programmatic/audio-service";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import { loadProgrammaticResource } from "../../apps/cli/src/programmatic/resources";
import { CURRENT_PROJECT_VERSION } from "../../packages/editor-classic/src/services/storage/migrations/version";
import { multishotSources } from "./multishot-mv-sources";

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
	throw Error("Provide private toolchain, artifact root and FFmpeg/FFprobe");
const root = join(resolve(artifact), "host");
await mkdir(root);
const require = createRequire(
	new URL("../../apps/vite-example/package.json", import.meta.url),
);
const { chromium } = await import(
	pathToFileURL(require.resolve("@playwright/test")).href
);
const executable = chromium.executablePath(),
	decoder = { ffmpeg, ffprobe },
	storeRoot = join(root, "project");
const context = {
	store: new FileProjectStore({
		root: storeRoot,
		schemaVersion: CURRENT_PROJECT_VERSION,
	}),
	projectId: "multishot-mv",
};
const prepared = await multishotSources({
	root,
	toolchainDirectory,
	ffmpeg,
	context,
});
const font = await readFile(
	fileURLToPath(
		new URL(
			"../../apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf",
			import.meta.url,
		),
	),
);
const audio = createProgrammaticAudioService({
	resourceStore: context,
	executable,
	connectionFile: "",
	decoder,
	toolchainDirectory,
});
assert.ok(audio.capability.configured);
const counts = {
	frames: { hyperframes: 0, remotion: 0 },
	audioRequests: 0,
	resources: 0,
	fontLoads: 0,
	saves: 0,
	reloads: 0,
	ordinaryLoads: 0,
};
async function body(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > 2_000_000) throw Error("Fixture request exceeds 2 MB");
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
			json({
				sources: prepared.sources,
				archived: prepared.archived,
				version: CURRENT_PROJECT_VERSION,
			});
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
		if (request.url === "/api/ordinary.wav") {
			counts.ordinaryLoads++;
			response
				.writeHead(200, { "content-type": "audio/wav" })
				.end(prepared.ordinary);
			return;
		}
		if (request.url === "/api/expected.f32") {
			response
				.writeHead(200, { "content-type": "application/octet-stream" })
				.end(prepared.expected);
			return;
		}
		if (request.url === "/api/save") {
			const data = await body(request),
				now = "2026-10-08T00:00:00.000Z";
			await context.store.save({
				record: {
					id: context.projectId,
					schemaVersion: CURRENT_PROJECT_VERSION,
					data,
				},
				summary: {
					id: context.projectId,
					name: "Multishot integration MV",
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
		if (request.url === "/api/programmatic/audio") {
			counts.audioRequests++;
			await audio.handle(request, response);
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
			const input = (await body(request)) as ProgrammaticFrameRequest,
				engine = input.source.build?.engine;
			if (engine !== "hyperframes" && engine !== "remotion")
				throw Error("Unexpected HTML engine");
			counts.frames[engine]++;
			const png = await renderHtmlPng({
				executable,
				request: input,
				resourceStore: context,
				connectionFile: "",
				nativeVideoDecoder: decoder,
				signal: controller.signal,
			});
			response.writeHead(200, { "content-type": "image/png" }).end(png);
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
		throw Error("Missing private fixture address");
	console.log(
		JSON.stringify({
			endpoint: `http://127.0.0.1:${address.port}`,
			archived: prepared.archived,
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
	await audio.dispose();
	server.closeAllConnections();
	await new Promise<void>((done) => server.close(() => done()));
	await writeFile(join(root, "counts.json"), JSON.stringify(counts, null, 2));
}
