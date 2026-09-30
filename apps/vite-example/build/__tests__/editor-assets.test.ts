import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import { createServer } from "vite";
import { editorAssets } from "../editor-assets";

const viteRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const repoRoot = join(viteRoot, "..", "..");
const publicRoot = join(repoRoot, "apps", "web", "public");
const fontPath = "motion-text/fonts/noto-sans-jp-variable.ttf";
const expectedFont = {
	bytes: 9_589_900,
	sha256: "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f",
};

test("Vite dev serves allowlisted runtime fonts instead of the SPA fallback", async () => {
	const server = await createServer({
		root: viteRoot,
		configFile: false,
		logLevel: "error",
		plugins: [editorAssets({ publicRoot, repoRoot })],
		publicDir: false,
		server: { host: "127.0.0.1", port: 0, strictPort: false },
	});
	try {
		await server.listen();
		const address = server.httpServer?.address();
		if (!address || typeof address === "string") {
			throw new Error("Vite did not expose a local port");
		}

		const url = `http://127.0.0.1:${address.port}/${fontPath}?probe=1`;
		const response = await fetch(url);
		const bytes = new Uint8Array(await response.arrayBuffer());
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("font/ttf");
		expect(response.headers.get("content-length")).toBe(
			String(expectedFont.bytes),
		);
		expect(bytes.byteLength).toBe(expectedFont.bytes);
		expect([...bytes.slice(0, 4)]).toEqual([0, 1, 0, 0]);
		expect(createHash("sha256").update(bytes).digest("hex")).toBe(
			expectedFont.sha256,
		);

		const head = await fetch(url, { method: "HEAD" });
		expect(head.status).toBe(200);
		expect(head.headers.get("content-type")).toBe("font/ttf");
		expect(head.headers.get("content-length")).toBe(
			String(expectedFont.bytes),
		);
		expect((await head.arrayBuffer()).byteLength).toBe(0);
	} finally {
		await server.close();
	}
}, 15_000);
