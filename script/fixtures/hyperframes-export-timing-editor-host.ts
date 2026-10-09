import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProgrammaticFrameRequest } from "@opencut/editor-contracts";
import { createProgrammaticAudioService } from "../../apps/cli/src/programmatic/audio-service";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import { exportTimingEditorProject } from "./hyperframes-export-timing-editor-project";
import { exportTimingEditorOracle } from "./hyperframes-export-timing-editor-oracle";

import { exportTimingEditorCase } from "./hyperframes-export-timing-editor-spec.mjs";

const [toolchain, artifact, caseId] = process.argv.slice(2);
const test = exportTimingEditorCase(caseId);
const engine = process.env.ROCUT_TEST_HYPERFRAMES_ENGINE_DIRECTORY;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
const archive = process.env.ROCUT_TEST_HYPERFRAMES_ARCHIVE;
if (
	![toolchain, artifact, ffmpeg, ffprobe, archive, engine].every(
		(value) => value && isAbsolute(value),
	)
)
	throw Error(
		"Provide absolute toolchain/artifact and ROCUT_TEST_FFMPEG, ROCUT_TEST_FFPROBE, ROCUT_TEST_HYPERFRAMES_ARCHIVE and ROCUT_TEST_HYPERFRAMES_ENGINE_DIRECTORY paths",
	);
const root = join(resolve(artifact), "host");
await mkdir(root);
const require = createRequire(
	new URL("../../apps/vite-example/package.json", import.meta.url),
);
const { chromium } = await import(
	pathToFileURL(require.resolve("@playwright/test")).href
);
const executable = chromium.executablePath() as string;
const decoder = { ffmpeg: ffmpeg!, ffprobe: ffprobe! };
const controller = new AbortController();
const timer = setTimeout(
	() => controller.abort(Error("Explicit timing editor Host deadline")),
	240000,
);
let service: ReturnType<typeof createProgrammaticAudioService> | undefined;
let server: ReturnType<typeof createServer> | undefined;
try {
	console.log(
		JSON.stringify({ stage: "compile-archive-rebuild-and-collect", root }),
	);
	const project = await exportTimingEditorProject({
		root,
		toolchain,
		executable,
		signal: controller.signal,
		test,
	});
	console.log(JSON.stringify({ stage: "independent-original-native-oracle" }));
	const oracle = await exportTimingEditorOracle({
		directory: root,
		toolchain,
		archive: archive!,
		engine: engine!,
		test,
		source: project.original,
		decoder,
		controller,
	});
	service = createProgrammaticAudioService({
		resourceStore: project.context,
		executable,
		connectionFile: "",
		decoder,
		toolchainDirectory: toolchain,
	});
	assert.equal(service.capability.hyperframesGraph.configured, true);
	const counts = { identityRequests: 0, audioRequests: 0, pictureRequests: 0 };
	const expected = new Map([
		["/api/oracle/source", oracle.correct],
		["/api/oracle/placement", oracle.incorrect],
		["/api/oracle/untrimmed", oracle.untrimmed],
		["/api/oracle/timeline", oracle.timeline],
	]);
	server = createServer(async (request, response) => {
		if (request.url === "/api/case") {
			response
				.writeHead(200, { "content-type": "application/json" })
				.end(JSON.stringify(test));
			return;
		}
		if (request.url === "/api/source") {
			response
				.writeHead(200, { "content-type": "application/json" })
				.end(JSON.stringify(project.source));
			return;
		}
		if (request.url === "/api/counts") {
			response
				.writeHead(200, { "content-type": "application/json" })
				.end(JSON.stringify(counts));
			return;
		}
		const pcm = expected.get(request.url ?? "");
		if (pcm) {
			response
				.writeHead(200, { "content-type": "application/octet-stream" })
				.end(pcm);
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
			const abort = new AbortController(),
				close = () => abort.abort();
			response.once("close", close);
			try {
				const chunks: Buffer[] = [];
				let size = 0;
				for await (const chunk of request) {
					size += chunk.length;
					if (size > 2_000_000) throw Error("Fixture frame request too large");
					chunks.push(Buffer.from(chunk));
				}
				const frame = JSON.parse(
					Buffer.concat(chunks).toString("utf8"),
				) as ProgrammaticFrameRequest;
				const png = await renderHtmlPng({
					executable,
					request: frame,
					resourceStore: project.context,
					nativeVideoDecoder: decoder,
					connectionFile: "",
					signal: AbortSignal.any([controller.signal, abort.signal]),
				});
				response.writeHead(200, { "content-type": "image/png" }).end(png);
			} catch (error) {
				if (!response.destroyed)
					response
						.writeHead(422, { "content-type": "application/json" })
						.end(JSON.stringify({ error: String(error) }));
			} finally {
				response.removeListener("close", close);
			}
			return;
		}
		response.writeHead(404).end();
	});
	await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	console.log(
		JSON.stringify({
			endpoint: `http://127.0.0.1:${address.port}`,
			root,
			archivedAndRebuilt: true,
			originalNativeFrames: oracle.summary.originalNativeFrames,
			graphDryFrames: oracle.summary.graphDryFrames,
		}),
	);
	await new Promise<void>((done) => {
		process.stdin.once("data", () => done());
		process.stdin.once("end", done);
		process.stdin.resume();
	});
	process.stdin.pause();
	await writeFile(join(root, "counts.json"), JSON.stringify(counts, null, 2), {
		flag: "wx",
	});
} finally {
	clearTimeout(timer);
	controller.abort();
	await service?.dispose();
	if (server) {
		server.closeAllConnections();
		await new Promise<void>((done) => server!.close(() => done()));
	}
	// Retain the full authored, archived, oracle and failure evidence.
}
