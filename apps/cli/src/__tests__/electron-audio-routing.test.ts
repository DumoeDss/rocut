import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { createProgrammaticAudioService } from "../programmatic/audio-service";
import { performProgrammaticAudio } from "../programmatic/audio-operation";
import type { ProgrammaticResourceStore } from "../programmatic/resources";

const resource = (
	id: string,
	kind = "source",
	mimeType = "application/octet-stream",
) => ({
	id,
	kind,
	mimeType,
	byteLength: 1,
	sha256: "a".repeat(64),
	attachmentKey: `${kind === "document" ? "programmatic" : "programmatic-source"}-sha256-${"a".repeat(64)}`,
});
const source = (
	engine: "remotion" | "hyperframes",
	graph = false,
): ProgrammaticSource =>
	({
		version: 1,
		runtime: "html-document",
		code: "",
		documentId: "build.html",
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 8,
		seed: 1,
		resources: [resource("build.html", "document", "text/html")],
		audio: {
			version: 1,
			mode: "native",
			...(graph ? { profile: "hyperframes-graph-v1" } : {}),
		},
		build: {
			version: 1,
			engine,
			engineVersion: engine === "remotion" ? "4.0.440" : "0.8.139",
			entryFile: engine === "remotion" ? "index.tsx" : "index.html",
			...(engine === "remotion" ? { compositionId: "Audio" } : {}),
			inputs: [resource(engine === "remotion" ? "index.tsx" : "index.html")],
			toolchainLock: resource("_rocut/toolchain-lock.json"),
		},
	}) as ProgrammaticSource;
const input = (engine: "remotion" | "hyperframes", graph = false) => ({
	source: source(engine, graph),
	firstFrame: 0,
	frameCount: 1,
	sampleRate: 48000,
	...(graph
		? {
				expectedIdentity: {
					version: 1,
					profile: "hyperframes-graph-v1",
					id: "a".repeat(64),
				},
			}
		: {}),
});

test("Electron discovery follows the fixed connection file grants and never probes health or falls back to configured Chrome", async () => {
	const root = await mkdtemp("C:/tmps/rocut-audio-routing-");
	const connectionFile = join(root, "connection.json");
	const connection = (base: boolean, session = false) =>
		writeFile(
			connectionFile,
			JSON.stringify({
				version: 1,
				backend: "elftia-electron",
				endpoint: "http://127.0.0.1:1/v1/frame",
				token: "b".repeat(64),
				capabilities: {
					...(base
						? {
								nativeAudioAnalysis: {
									version: 1,
									protocol: "html-frames-native-audio-v1",
								},
							}
						: {}),
					...(session
						? {
								nativeAudioSession: {
									version: 1,
									protocol: "html-frames-native-audio-session-v1",
								},
							}
						: {}),
				},
			}),
			"utf8",
		);
	let resourceReads = 0;
	const resourceStore = {
		projectId: "routing",
		store: {
			async loadAttachment() {
				resourceReads++;
				throw Error("ROUTING_RESOURCE_IO");
			},
		},
	} as unknown as ProgrammaticResourceStore;
	const config = {
		resourceStore,
		projectDir: root,
		toolchainDirectory: root,
		connectionFile,
		executable: process.execPath,
		decoder: { ffmpeg: process.execPath, ffprobe: process.execPath },
	};
	const service = createProgrammaticAudioService(config);
	const server = createServer((request, response) => {
		if (request.url === "/capability") {
			response.end(JSON.stringify(service.capability));
			return;
		}
		void service.handle(
			request,
			response,
			request.url?.slice(1) as "render" | "identity" | "produced",
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const send = (action: string, body: unknown = {}) =>
		fetch(`${url}/${action}`, { method: "POST", body: JSON.stringify(body) });
	try {
		await connection(false, true);
		expect(service.capability.configured).toBe(false);
		expect((await send("render", input("remotion"))).status).toBe(503);
		await connection(true);
		expect(await (await fetch(`${url}/capability`)).json()).toMatchObject({
			configured: true,
			availability: "configured-not-health-probed",
			backend: "elftia-electron-native-decoder",
			hyperframesGraph: { configured: false },
			remotionProduced: { configured: false },
		});
		for (const action of ["identity", "produced"])
			expect((await send(action)).status).toBe(503);
		expect((await send("render", input("hyperframes", true))).status).toBe(503);
		expect(resourceReads).toBe(0);
		const basic = await send("render", input("remotion"));
		expect(basic.status).toBe(422);
		expect(await basic.text()).toContain("ROUTING_RESOURCE_IO");
		expect(resourceReads).toBe(1);
		await connection(true, true);
		expect(service.capability).toMatchObject({
			configured: true,
			hyperframesGraph: {
				configured: true,
				availability: "configured-not-health-probed",
			},
			remotionProduced: {
				configured: true,
				availability: "configured-not-health-probed",
			},
			electronSession: { configured: true, profiles: ["source", "dsp"] },
		});
		const producedWrongEngine = await send("produced", {
			...input("hyperframes"),
			expectedIdentity: undefined,
		});
		expect(producedWrongEngine.status).toBe(422);
		expect(await producedWrongEngine.text()).toContain("compiled Remotion");
		expect(
			(
				await send("render", {
					...input("remotion"),
					graphBackend: "standalone",
				})
			).status,
		).toBe(422);
		expect((await send("invalid", input("remotion"))).status).toBe(400);
		expect(resourceReads).toBe(1);
		const produced = await send("produced", input("remotion"));
		expect(produced.status).toBe(422);
		expect(await produced.text()).toContain("ROUTING_RESOURCE_IO");
		expect(resourceReads).toBe(2);
		const identity = await send("identity", {
			source: source("hyperframes", true),
			sampleRate: 48000,
		});
		expect(identity.status).toBe(422);
		expect(await identity.text()).not.toContain("session grant");
		await connection(true);
		expect(service.capability.hyperframesGraph.configured).toBe(false);
		expect((await send("produced", input("remotion"))).status).toBe(503);
		expect(resourceReads).toBe(2);
		await rm(connectionFile);
		expect(service.capability.configured).toBe(false);
		expect((await send("render", input("remotion"))).status).toBe(503);
	} finally {
		await service.dispose();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		if (dirname(resolve(root)) !== resolve("C:/tmps"))
			throw Error("Unsafe fixture cleanup");
		await rm(root, { recursive: true });
	}
});

test("action, project destination, graph backend and engine boundaries reject before resource IO while standalone configuration stays available", async () => {
	const root = await mkdtemp("C:/tmps/rocut-audio-operation-routing-");
	const connectionFile = join(root, "connection.json");
	let reads = 0;
	const resourceStore = {
		projectId: "routing",
		store: {
			async loadAttachment() {
				reads++;
				throw Error("Unexpected resource IO");
			},
		},
	} as unknown as ProgrammaticResourceStore;
	const options = {
		resourceStore,
		executable: process.execPath,
		decoder: { ffmpeg: process.execPath, ffprobe: process.execPath },
		connectionFile,
		graphConfigured: true,
		toolchainDirectory: root,
		sessionNonce: "routing",
		signal: AbortSignal.timeout(5000),
	};
	try {
		await writeFile(
			connectionFile,
			JSON.stringify({
				version: 1,
				backend: "elftia-electron",
				endpoint: "http://127.0.0.1:1/v1/frame",
				token: "b".repeat(64),
				capabilities: {
					nativeAudioAnalysis: {
						version: 1,
						protocol: "html-frames-native-audio-v1",
					},
				},
			}),
			"utf8",
		);
		await expect(
			performProgrammaticAudio({
				...options,
				action: "render",
				input: input("hyperframes", true),
			}),
		).rejects.toThrow("session grant");
		await expect(
			performProgrammaticAudio({
				...options,
				action: "produced",
				input: input("remotion"),
			}),
		).rejects.toThrow("session grant");
		await expect(
			performProgrammaticAudio({
				...options,
				action: "identity",
				input: { source: source("hyperframes", true), sampleRate: 48000 },
			}),
		).rejects.toThrow("session grant");
		const standalone = { ...options, connectionFile: "" };
		await expect(
			performProgrammaticAudio({
				...standalone,
				graphConfigured: false,
				action: "render",
				input: input("hyperframes", true),
			}),
		).rejects.toThrow("configured pinned engine toolchain");
		await expect(
			performProgrammaticAudio({
				...standalone,
				action: "identity",
				input: { source: source("remotion"), sampleRate: 48000 },
			}),
		).rejects.toThrow("only available");
		await expect(
			performProgrammaticAudio({
				...standalone,
				action: "render",
				input: {
					...input("remotion"),
					source: { ...source("remotion"), build: { engine: "other" } },
				},
			}),
		).rejects.toThrow("compiled Remotion or HyperFrames");
		expect(reads).toBe(0);
		const service = createProgrammaticAudioService({
			...standalone,
			projectDir: "relative/project",
		});
		expect(service.capability).toMatchObject({
			configured: true,
			backend: "standalone-chromium-native-decoder",
			hyperframesGraph: { configured: true },
			remotionProduced: { configured: false },
		});
		const server = createServer((request, response) => {
			void service.handle(request, response, "produced");
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		try {
			const response = await fetch(
				`http://127.0.0.1:${(server.address() as { port: number }).port}`,
				{ method: "POST", body: JSON.stringify(input("remotion")) },
			);
			expect(response.status).toBe(503);
			expect(await response.text()).toContain("Host-owned project destination");
			expect(reads).toBe(0);
		} finally {
			await service.dispose();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	} finally {
		if (dirname(resolve(root)) !== resolve("C:/tmps"))
			throw Error("Unsafe fixture cleanup");
		await rm(root, { recursive: true });
	}
});
