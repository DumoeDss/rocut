import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "./browser-probe-toolchain.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolchain =
	process.argv[2] ?? process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
if (!toolchain || !isAbsolute(toolchain))
	throw Error(
		"Provide the absolute private HyperFrames 0.8.139 toolchain directory",
	);
const core = join(toolchain, "node_modules/@hyperframes/core"),
	dist = resolve(core, "dist");
const strictText = async (file) =>
	new TextDecoder("utf-8", { fatal: true }).decode(await readFile(file));
const manifest = JSON.parse(await strictText(join(core, "package.json")));
assert.equal(manifest.name, "@hyperframes/core");
assert.equal(manifest.version, "0.8.139");
const native = await import(
	pathToFileURL(join(dist, "generated/audio-fx-runtime-inline.js")).href
);
const runtime = native.getAudioFxRuntimeScript();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sourceSha256 = { inlineRuntime: sha256(runtime) };
for (const name of [
	"audioFx.js",
	"audioAutomation.js",
	"audio/audioFxGraph.js",
	"audio/audioFxWorklets.js",
	"audio/audioFxAutomation.js",
	"audio/audioFxTail.js",
])
	sourceSha256[name] = sha256(await readFile(join(dist, name)));
const fixtures = new Map();
const parsers = join(toolchain, "node_modules/@hyperframes/parsers");
const parsersManifest = JSON.parse(
	await strictText(join(parsers, "package.json")),
);
assert.equal(parsersManifest.name, "@hyperframes/parsers");
assert.equal(parsersManifest.version, "0.8.139");
assert.equal(
	parsersManifest.exports["./media-duration"].import,
	"./dist/mediaDuration.js",
);
const mediaDuration = await strictText(join(parsers, "dist/mediaDuration.js"));
fixtures.set("/native-media-duration.js", mediaDuration);
sourceSha256["@hyperframes/parsers/dist/mediaDuration.js"] =
	sha256(mediaDuration);
for (const suffix of [
	"main.html",
	"main.mjs",
	"support.mjs",
	"order.mjs",
	"curves.mjs",
	"state.mjs",
]) {
	const name = `hyperframes-audio-graph-browser-${suffix}`;
	fixtures.set(
		`/fixtures/${name}`,
		await strictText(join(root, "script/fixtures", name)),
	);
}
const artifacts = await mkdtemp(
	join(tmpdir(), "rocut-hf-audio-graph-browser-"),
);
const server = createServer(async (request, response) => {
	try {
		if (request.method !== "GET") {
			response.writeHead(405).end();
			return;
		}
		const path = new URL(request.url, "http://127.0.0.1").pathname;
		let text,
			mime = "text/javascript; charset=utf-8";
		if (path === "/native-runtime.js") text = runtime;
		else if (fixtures.has(path)) {
			text = fixtures.get(path);
			if (path.endsWith(".html")) mime = "text/html; charset=utf-8";
		} else if (path.startsWith("/upstream/")) {
			const relative = path.slice("/upstream/".length);
			if (!/^[a-zA-Z0-9_/-]+\.js$/.test(relative)) {
				response.writeHead(404).end();
				return;
			}
			const target = resolve(dist, relative);
			if (!target.startsWith(dist + sep))
				throw Error("Outside pinned upstream static root");
			text = await strictText(target);
		} else {
			response.writeHead(404).end();
			return;
		}
		response
			.writeHead(200, { "content-type": mime, "cache-control": "no-store" })
			.end(text);
	} catch (error) {
		response.writeHead(500).end(String(error));
	}
});
let browser;
try {
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	browser = await chromium.launch({
		headless: true,
		executablePath: chromium.executablePath(),
		args: ["--autoplay-policy=no-user-gesture-required"],
	});
	const page = await browser.newPage(),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("requestfailed", (request) =>
		errors.push(`${request.url()}: ${request.failure()?.errorText}`),
	);
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
		else if (message.text().startsWith("Native graph oracle:"))
			console.log(message.text());
	});
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1")
			await route.abort();
		else await route.continue();
	});
	await page.goto(
		`http://127.0.0.1:${server.address().port}/fixtures/hyperframes-audio-graph-browser-main.html`,
		{ waitUntil: "load" },
	);
	if (errors.length)
		throw Error(JSON.stringify({ phase: "module-load", errors, artifacts }));
	await page
		.waitForFunction(() => globalThis.__hyperframesGraphOracle, undefined, {
			timeout: 90000,
		})
		.catch((error) => {
			throw Error(JSON.stringify({ error: String(error), errors, artifacts }));
		});
	const { artifacts: pcm = [], ...result } = await page.evaluate(
		() => globalThis.__hyperframesGraphOracle,
	);
	const retained = [];
	for (const { base64, ...metadata } of pcm) {
		assert.match(metadata.name, /^[a-z0-9-]+\.f32$/);
		const bytes = Buffer.from(base64, "base64");
		assert.equal(bytes.length, metadata.frames * metadata.channels * 4);
		assert.equal(sha256(bytes), metadata.sha256);
		await writeFile(join(artifacts, metadata.name), bytes);
		retained.push(metadata);
	}
	const report = {
		...result,
		errors,
		browser: await browser.version(),
		upstream: { name: manifest.name, version: manifest.version, sourceSha256 },
		pcm: retained,
		artifacts,
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(JSON.stringify(report, null, 2));
	assert.equal(
		result.passed,
		true,
		"Native browser graph oracle failed; see retained verification.json",
	);
	assert.deepEqual(errors, []);
} finally {
	await browser?.close();
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
}
