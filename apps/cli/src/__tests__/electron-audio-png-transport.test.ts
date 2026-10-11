import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { captureElectronPng } from "../programmatic/electron-transport";

test("Electron audio PNG requires its named grant without changing legacy capture", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-audio-png-"));
	const connectionFile = path.join(root, "connection.json");
	const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64");
	const bodies: Record<string, unknown>[] = [];
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
		response.writeHead(200, { "content-type": "image/png" }).end(png);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	const publish = (capabilities?: unknown) => writeFile(connectionFile, JSON.stringify({
		version: 1, backend: "elftia-electron", token: "a".repeat(64),
		endpoint: `http://127.0.0.1:${port}/v1/frame`, capabilities,
	}));
	const capture = (nativeAudio?: true) => captureElectronPng({
		connectionFile, width: 64, height: 64, expression: "Promise.resolve(true)",
		signal: new AbortController().signal, ...(nativeAudio ? { nativeAudio } : {}),
	});
	try {
		await publish();
		expect(await capture()).toEqual(png);
		expect(bodies[0]).not.toHaveProperty("nativeAudio");
		await expect(capture(true)).rejects.toThrow("Electron capture unavailable");
		expect(bodies).toHaveLength(1);
		for (const nativeAudioAnalysis of [
			{ version: 2, protocol: "html-frames-native-audio-v1" },
			{ version: 1, protocol: "html-frames-native-video-v1" },
		]) {
			await publish({ nativeAudioAnalysis });
			await expect(capture(true)).rejects.toThrow("Electron capture unavailable");
		}
		expect(bodies).toHaveLength(1);
		await publish({ nativeAudioAnalysis: { version: 1, protocol: "html-frames-native-audio-v1" } });
		expect(await capture(true)).toEqual(png);
		expect(bodies[1]).toMatchObject({ version: 1, nativeAudio: true });
		// Re-read every request: an old grant cannot survive revocation/rotation.
		await publish();
		await expect(capture(true)).rejects.toThrow("Electron capture unavailable");
		expect(bodies).toHaveLength(2);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("rocut-audio-png-"))
			throw Error("Unsafe audio PNG test cleanup");
		await rm(root, { recursive: true, force: true });
	}
});
