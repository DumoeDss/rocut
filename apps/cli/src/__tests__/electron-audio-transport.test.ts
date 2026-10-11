import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { analyzeElectronAudio, pinElectronAudioConnection, ELECTRON_NATIVE_AUDIO_PROTOCOL } from "../programmatic/electron-audio-transport";
import { createProgrammaticAudioService } from "../programmatic/audio-service";
import type { ProgrammaticResourceStore } from "../programmatic/resources";

test("native audio uses its own loopback endpoint and bounded observation envelope", async () => {
	const directory = await mkdtemp("C:/tmps/rocut-electron-audio-");
	const connectionFile = join(directory, "connection.json");
	const token = "a".repeat(64);
	let seen: unknown;
	let path: string | undefined;
	let authorization: string | undefined;
	let reply = JSON.stringify({ version: 1, value: [{ volume: 0.5 }] });
	const server = createServer(async (request, response) => {
		path = request.url; authorization = request.headers.authorization;
		const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
		seen = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		response.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(reply);
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	const descriptor = { version: 1, backend: "elftia-electron", endpoint: `http://127.0.0.1:${port}/v1/frame`, token,
		capabilities: { nativeAudioAnalysis: { version: 1, protocol: ELECTRON_NATIVE_AUDIO_PROTOCOL } } };
	try {
		await writeFile(connectionFile, JSON.stringify(descriptor), "utf8");
		expect(pinElectronAudioConnection(connectionFile).endpoint).toBe(`http://127.0.0.1:${port}/v1/audio-analysis`);
		expect(await analyzeElectronAudio({ connectionFile, width: 32, height: 24, expression: "nativeObservation()", signal: new AbortController().signal })).toEqual([{ volume: 0.5 }]);
		expect(path).toBe("/v1/audio-analysis"); expect(authorization).toBe(`Bearer ${token}`);
		expect(seen).toEqual({ version: 1, width: 32, height: 24, expression: "nativeObservation()" });
		const analyze = () => analyzeElectronAudio({ connectionFile, width: 32, height: 24, expression: "[]", signal: new AbortController().signal });
		reply = '{"version":1}'; await expect(analyze()).rejects.toThrow("envelope");
		reply = "x".repeat(2 * 1024 * 1024 + 1); await expect(analyze()).rejects.toThrow("limit");
		const service = createProgrammaticAudioService({ connectionFile, executable: undefined,
			decoder: { ffmpeg: process.execPath, ffprobe: process.execPath }, projectDir: directory,
			toolchainDirectory: directory, resourceStore: { projectId: "unused", store: new Proxy({}, { get() { throw Error("Unexpected store access"); } }) } as ProgrammaticResourceStore });
		expect(service.capability).toMatchObject({ configured: true, backend: "elftia-electron-native-decoder",
			remotionProduced: { configured: false }, hyperframesGraph: { configured: false } });
		const gate = createServer((request, response) => { void service.handle(request, response, "produced"); });
		await new Promise<void>(resolve => gate.listen(0, "127.0.0.1", resolve));
		try {
			const response = await fetch(`http://127.0.0.1:${(gate.address() as { port: number }).port}`, { method: "POST", body: "{}" });
			expect(response.status).toBe(503);
			expect(await response.text()).toContain("session grant");
		} finally { await service.dispose(); await new Promise<void>(resolve => gate.close(() => resolve())); }
		expect(() => pinElectronAudioConnection(connectionFile, true)).toThrow("grant");
		await writeFile(connectionFile, JSON.stringify({ ...descriptor, capabilities: {} }), "utf8");
		expect(() => pinElectronAudioConnection(connectionFile)).toThrow("grant");
		await writeFile(connectionFile, Buffer.from([0xff]));
		expect(() => pinElectronAudioConnection(connectionFile)).toThrow("grant");
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
		await rm(directory, { recursive: true });
	}
});
