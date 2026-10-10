import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function createCaptureServer({
	root,
	pkg,
	runnerPath,
	kind = "canvas",
}) {
	if (!["canvas", "flame-wrap"].includes(kind))
		throw Error("Unsupported capture fixture");
	const paths = {
		"/wasm-glue.mjs": join(resolve(pkg), "opencut_wasm_bg.js"),
		"/wasm.wasm": join(resolve(pkg), "opencut_wasm_bg.wasm"),
		"/probe.mjs": join(root, `script/fixtures/${kind}-capture-probe.mjs`),
		"/canvas-capture-support.mjs": join(
			root,
			"script/fixtures/canvas-capture-support.mjs",
		),
		"/runner-source.mjs": runnerPath,
	};
	const frozen = new Map();
	for (const [route, path] of Object.entries(paths)) {
		const bytes = await readFile(path);
		frozen.set(route, { bytes, path, sha256: sha(bytes) });
	}
	frozen.set("/server-source.mjs", {
		path: new URL("./canvas-capture-server.mjs", import.meta.url),
	});
	const serverEntry = frozen.get("/server-source.mjs");
	serverEntry.bytes = await readFile(serverEntry.path);
	serverEntry.sha256 = sha(serverEntry.bytes);
	const server = createServer((request, response) => {
		const route = new URL(request.url, "http://localhost").pathname;
		if (route === "/") {
			response.setHeader("Content-Type", "text/html");
			response.end('<script type="module" src="/probe.mjs"></script>');
			return;
		}
		const entry = frozen.get(route);
		if (!entry) {
			response.writeHead(404);
			response.end();
			return;
		}
		response.setHeader(
			"Content-Type",
			route.endsWith(".wasm") ? "application/wasm" : "text/javascript",
		);
		response.setHeader("Cache-Control", "no-store");
		response.end(entry.bytes);
	});
	return { frozen, server };
}
