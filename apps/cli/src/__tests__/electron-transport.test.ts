import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { captureElectronPng } from "../programmatic/electron-transport";

test("Electron transport re-reads rotated backend credentials, rejects remote/redirect/invalid PNG, and propagates cancellation", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-electron-transport-"));
	const connectionFile = path.join(root, "connection.json");
	const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64");
	let token = "a".repeat(64), mode = "png", calls = 0;
	const server = createServer((req, res) => {
		calls++;
		if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
		req.resume();
		if (mode === "hang") return;
		if (mode === "redirect") { res.writeHead(302, { location: "http://example.invalid" }).end(); return; }
		if (mode === "invalid") { res.writeHead(200, { "content-type": "image/png" }).end("not png"); return; }
		res.writeHead(200, { "content-type": "image/png" }).end(png);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	const publish = (endpoint = `http://127.0.0.1:${port}/v1/frame`) => writeFile(connectionFile,
		JSON.stringify({ version: 1, backend: "elftia-electron", endpoint, token }), "utf8");
	const render = (signal = new AbortController().signal) => captureElectronPng({
		connectionFile, signal, width: 64, height: 64, expression: "Promise.resolve(true)",
	});
	try {
		await publish();
		expect(await render()).toEqual(png);
		token = "b".repeat(64);
		await publish();
		expect(await render()).toEqual(png);
		const before = calls;
		for (const endpoint of ["https://example.invalid/v1/frame", `http://localhost:${port}/v1/frame`,
			`http://127.0.0.1:${port}/other`, `http://secret@127.0.0.1:${port}/v1/frame`]) {
			await publish(endpoint);
			await expect(render()).rejects.toThrow("Electron capture unavailable");
		}
		expect(calls).toBe(before);
		await publish();
		mode = "redirect";
		await expect(render()).rejects.toThrow("connection failed");
		mode = "invalid";
		await expect(render()).rejects.toThrow("invalid PNG");
		mode = "hang";
		const abort = new AbortController();
		const pending = render(abort.signal);
		setTimeout(() => abort.abort(), 100);
		await expect(pending).rejects.toThrow("cancelled");
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("rocut-electron-transport-"))
			throw Error("Unsafe transport test cleanup");
		await rm(root, { recursive: true, force: true });
	}
});
