/**
 * s05-second-host — a static stand-in for the `opencut://app` scheme (task
 * 5.2). `check-asset-manifest.mjs` verifies every manifest entry against a
 * served base over HTTP; Node cannot fetch Electron's custom scheme, so the
 * electron dist gets this trivial read-only file server rooted at `dist/` for
 * the duration of the checker run. The scheme serving itself is proven live
 * by the boot proof in the same group; this stand-in exists only so the
 * checker's served-bytes/MIME/SHA-256 leg can run against the same tree.
 *
 * Usage: node serve-dist.mjs <port>   (serves until killed; logs its PID)
 */
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(join(here, "..", "dist"));

const MIME = {
	".avif": "image/avif",
	".css": "text/css",
	".htm": "text/html",
	".html": "text/html",
	".ico": "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".js": "text/javascript",
	".json": "application/json",
	".mjs": "text/javascript",
	".png": "image/png",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

const port = Number(process.argv[2] ?? 4199);
const server = createServer((request, response) => {
	let url;
	try {
		url = new URL(request.url ?? "/", "http://127.0.0.1");
	} catch {
		response.writeHead(400).end("bad url");
		return;
	}
	const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
	const target = join(root, relative === "" ? "index.html" : relative);
	if (target !== root && !target.startsWith(root + sep)) {
		response.writeHead(403).end("forbidden");
		return;
	}
	let stat;
	try {
		stat = statSync(target);
	} catch {
		response.writeHead(404).end("not found");
		return;
	}
	if (!stat.isFile()) {
		response.writeHead(404).end("not found");
		return;
	}
	response.writeHead(200, {
		"Content-Type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
	}).end(readFileSync(target));
});
server.listen(port, "127.0.0.1", () => {
	console.log(`SERVE_DIST_READY pid=${process.pid} port=${port} root=${root}`);
});
