import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	chromium,
	createServer,
	wasm,
	topLevelAwait,
} from "./browser-probe-toolchain.mjs";
import { decodeSweepScroll } from "./fixtures/sweep-scroll-decode.mjs";

const [executablePath, ffmpegDirectory] = process.argv.slice(2);
assert(
	process.argv.length === 4 &&
		[executablePath, ffmpegDirectory].every((p) => p && isAbsolute(p)),
	"Expected absolute private Chromium and FFmpeg-directory paths",
);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const parent = join(root, ".artifacts/sweep-scroll");
await mkdir(parent, { recursive: true });
const artifacts = await mkdtemp(join(parent, "run-"));
const privateTemp = join(artifacts, "temp");
await mkdir(privateTemp);
Object.assign(process.env, {
	TEMP: privateTemp,
	TMP: privateTemp,
	TMPDIR: privateTemp,
});
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(join(root, "fixture-source.json")),
	manifest = JSON.parse(manifestBytes);
for (const file of manifest.files)
	assert.equal(
		digest(await readFile(join(root, file.path))),
		file.sha256,
		`Stale fixture manifest: ${file.path}`,
	);
await writeFile(join(artifacts, "source-manifest.json"), manifestBytes, {
	flag: "wx",
});
const evidence = {
	ok: false,
	errors: [],
	externalRequests: [],
	backend: "private Chromium WebGPU/SwiftShader, no Host/Electron",
	sourceCommit: manifest.sourceCommit,
	sourceWorktreeClean: false,
	sourceManifestSha256: digest(manifestBytes),
	wasmSha256: digest(
		await readFile(join(root, "rust/wasm/pkg/opencut_wasm_bg.wasm")),
	),
};
const entry = "/script/fixtures/sweep-scroll.ts";
const server = await createServer({
	root,
	configFile: false,
	cacheDir: join(artifacts, "vite-cache"),
	logLevel: "error",
	plugins: [
		wasm(),
		topLevelAwait(),
		{
			name: "private-sweep-scroll-entry",
			configureServer(server) {
				server.middlewares.use((request, response, next) => {
					if (request.url !== "/sweep-scroll") return next();
					response.setHeader("content-type", "text/html; charset=utf-8");
					response.end(
						`<!doctype html><meta charset="utf-8"><title>Rocut sweep and scroll</title><script type="module">import { runSweepScrollProbe } from '${entry}';runSweepScrollProbe().then(result=>globalThis.__sweepScrollResult=result).catch(error=>globalThis.__sweepScrollResult={ok:false,error:String(error),stack:error.stack});</script>`,
					);
				});
			},
		},
	],
	optimizeDeps: { entries: [entry.slice(1)] },
	resolve: {
		alias: {
			"opencut-wasm": join(root, "rust/wasm/pkg/opencut_wasm.js"),
			mediabunny: join(root, "packages/editor-classic/node_modules/mediabunny"),
		},
	},
	server: { host: "127.0.0.1", port: 0, hmr: false },
});
let context;
try {
	await server.listen();
	context = await chromium.launchPersistentContext(
		join(artifacts, "browser-profile"),
		{
			headless: true,
			executablePath,
			env: {
				...process.env,
				TEMP: privateTemp,
				TMP: privateTemp,
				TMPDIR: privateTemp,
			},
			args: [
				"--no-proxy-server",
				"--enable-unsafe-webgpu",
				"--enable-unsafe-swiftshader",
				"--use-angle=swiftshader",
				"--use-gl=angle",
			],
		},
	);
	evidence.browser = context.browser()?.version();
	const page = await context.newPage();
	page.on("pageerror", (error) => evidence.errors.push(error.message));
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1") {
			evidence.externalRequests.push(url.origin);
			await route.abort();
		} else await route.continue();
	});
	const address = server.httpServer.address();
	console.log(JSON.stringify({ phase: "sweep-scroll-browser", artifacts }));
	await page.goto(`http://127.0.0.1:${address.port}/sweep-scroll`, {
		waitUntil: "commit",
	});
	await page.waitForFunction(() => globalThis.__sweepScrollResult, undefined, {
		timeout: 180000,
	});
	const result = await page.evaluate(() => globalThis.__sweepScrollResult);
	Object.assign(evidence, result);
	const variants = await page.evaluate(
		() => globalThis.__sweepScrollMedia ?? [],
	);
	for (const variant of variants) {
		assert(
			["ascii-sweep", "particle-scroll", "overlay"].includes(variant.name),
		);
		const directory = join(artifacts, variant.name);
		await mkdir(directory);
		for (const [name, bytes] of [
			["generators.webm", Buffer.from(variant.video, "base64")],
			["expected.rgba", Buffer.from(variant.expected, "base64")],
			["contact-sheet.png", Buffer.from(variant.sheet.split(",")[1], "base64")],
		])
			await writeFile(join(directory, name), bytes, { flag: "wx" });
	}
	assert(
		result.ok &&
			evidence.errors.length === 0 &&
			evidence.externalRequests.length === 0,
		"Sweep/scroll browser assertions failed; artifacts retained",
	);
	assert.equal(variants.length, 3);
	evidence.decoded = decodeSweepScroll(artifacts, ffmpegDirectory);
	evidence.ok = true;
} catch (error) {
	evidence.ok = false;
	evidence.failure = String(error.stack ?? error);
	process.exitCode = 1;
} finally {
	await context?.close();
	await server.close();
	await writeFile(
		join(artifacts, "evidence.json"),
		JSON.stringify(evidence, null, 2) + "\n",
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({ ok: evidence.ok, failure: evidence.failure, artifacts }),
	);
}
