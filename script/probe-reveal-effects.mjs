import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProductionProbeWasm } from "./production-probe-wasm.mjs";
import { createHtmlProbeWasmPlugin, HTML_PRIVATE_WASM_ID } from "./html-probe-wasm-binding.mjs";
import {
	chromium,
	createServer,
	wasm,
	topLevelAwait,
} from "./browser-probe-toolchain.mjs";
import { decodeRevealEffects } from "./fixtures/reveal-effects-decode.mjs";

const [executablePath, ffmpegDirectory] = process.argv.slice(2);
assert(
	process.argv.length === 4 &&
		[executablePath, ffmpegDirectory].every((p) => p && isAbsolute(p)),
	"Expected absolute private Chromium and FFmpeg-directory paths",
);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmBinding = resolveProductionProbeWasm();
const parent = join(root, ".artifacts/reveal-effects");
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
		await readFile(join(wasmBinding.directory, "opencut_wasm_bg.wasm")),
	),
};
const entry = "/script/fixtures/reveal-effects.ts";
const server = await createServer({
	root,
	configFile: false,
	cacheDir: join(artifacts, "vite-cache"),
	logLevel: "error",
	plugins: [
		createHtmlProbeWasmPlugin(wasmBinding),
		wasm(),
		topLevelAwait(),
		{
			name: "private-reveal-entry",
			configureServer(server) {
				server.middlewares.use((request, response, next) => {
					if (request.url !== "/reveal-effects") return next();
					response.setHeader("content-type", "text/html; charset=utf-8");
					response.end(
						`<!doctype html><meta charset="utf-8"><title>Rocut reveal effects</title><script type="module">import { runRevealProbe } from '${entry}';runRevealProbe().then(result=>globalThis.__revealResult=result).catch(error=>globalThis.__revealResult={ok:false,error:String(error),stack:error.stack});</script>`,
					);
				});
			},
		},
	],
	optimizeDeps: { entries: [entry.slice(1)] },
	resolve: {
		alias: {
			"opencut-wasm": HTML_PRIVATE_WASM_ID,
			mediabunny: join(root, "packages/editor-classic/node_modules/mediabunny"),
		},
	},
	server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root, wasmBinding.directory] } },
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
	console.log(JSON.stringify({ phase: "reveal-browser", artifacts }));
	await page.goto(`http://127.0.0.1:${address.port}/reveal-effects`, {
		waitUntil: "commit",
	});
	await page.waitForFunction(() => globalThis.__revealResult, undefined, {
		timeout: 180000,
	});
	const result = await page.evaluate(() => globalThis.__revealResult);
	Object.assign(evidence, result);
	const variants = await page.evaluate(() => globalThis.__revealMedia ?? []);
	for (const variant of variants) {
		assert(["laser", "decrypt-reveal"].includes(variant.name));
		const directory = join(artifacts, variant.name);
		await mkdir(directory);
		for (const [name, bytes] of [
			["spatial.webm", Buffer.from(variant.video, "base64")],
			["expected.rgba", Buffer.from(variant.expected, "base64")],
			["contact-sheet.png", Buffer.from(variant.sheet.split(",")[1], "base64")],
		])
			await writeFile(join(directory, name), bytes, { flag: "wx" });
	}
	assert(
		result.ok &&
			evidence.errors.length === 0 &&
			evidence.externalRequests.length === 0,
		"Reveal browser assertions failed; artifacts retained",
	);
	assert.equal(variants.length, 2);
	evidence.decoded = decodeRevealEffects(artifacts, ffmpegDirectory);
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
