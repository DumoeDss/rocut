import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { verifyGraphEditorExport } from "./fixtures/hyperframes-graph-editor-verify.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (
	!process.argv[2] ||
	!isolated ||
	!isAbsolute(isolated) ||
	!ffmpeg ||
	!ffprobe
)
	throw Error(
		"Provide isolated toolchain, ROCUT_TEST_WASM_DIRECTORY, ROCUT_TEST_FFMPEG and ROCUT_TEST_FFPROBE",
	);
const artifact = await mkdtemp(join(tmpdir(), "rocut-hf-graph-editor-"));
console.log(JSON.stringify({ artifact, state: "starting-private-probe" }));
const host = spawn(
	"bun",
	[
		"--preload",
		"./script/fixtures/isolated-web-wasm-preload.mjs",
		"script/fixtures/hyperframes-graph-editor-host.ts",
		process.argv[2],
		artifact,
	],
	{
		cwd: root,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, TEMP: artifact, TMP: artifact, TMPDIR: artifact },
	},
);
const exited = new Promise((resolve) => host.once("close", resolve));
let browser,
	server,
	hostReady = false;
try {
	const endpoint = await new Promise((resolve, reject) => {
		let output = "";
		const timer = setTimeout(
			() => reject(Error("Graph editor fixture startup timeout")),
			90000,
		);
		const fail = (error) => {
			clearTimeout(timer);
			reject(error);
		};
		host.once("error", fail);
		host.once("exit", (code) =>
			fail(Error(`Graph editor fixture exited ${code}`)),
		);
		host.stderr.on("data", (data) => {
			appendFileSync(join(artifact, "host.stderr.log"), data);
			process.stderr.write(data);
		});
		host.stdout.on("data", (data) => {
			appendFileSync(join(artifact, "host.stdout.log"), data);
			process.stdout.write(data);
			output += String(data);
			let end;
			while ((end = output.indexOf("\n")) >= 0) {
				const line = output.slice(0, end);
				output = output.slice(end + 1);
				try {
					const value = JSON.parse(line);
					if (value.endpoint) {
						clearTimeout(timer);
						resolve(value.endpoint);
					}
				} catch {}
			}
		});
	});
	hostReady = true;
	const output = join(artifact, "web");
	await buildNativeAudioExportProbe(
		root,
		isolated,
		output,
		"hyperframes-graph-editor-browser",
	);
	server = await createServer({
		root: output,
		configFile: false,
		cacheDir: join(artifact, "vite-cache"),
		logLevel: "error",
		optimizeDeps: { noDiscovery: true, include: [] },
		server: {
			host: "127.0.0.1",
			hmr: false,
			port: 0,
			proxy: { "/api": { target: endpoint } },
		},
	});
	await server.listen();
	browser = await chromium.launch({
		headless: true,
		executablePath: chromium.executablePath(),
		args: ["--autoplay-policy=no-user-gesture-required"],
	});
	const page = await browser.newPage(),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text().slice(0, 2000));
	});
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/hyperframes-graph-editor-browser.html`,
		{ waitUntil: "commit", timeout: 90000 },
	);
	await page.waitForFunction(
		() => globalThis.__hyperframesGraphEditor,
		undefined,
		{ timeout: 180000 },
	);
	const result = await page.evaluate(() => globalThis.__hyperframesGraphEditor);
	await writeFile(
		join(artifact, "browser-result.json"),
		JSON.stringify({ result, errors }, null, 2),
	);
	if (result.error || errors.length)
		throw Error(JSON.stringify({ result, errors }));
	assert.deepEqual(result.requests, { audio: 1, identity: 5 });
	const counts = await (await fetch(`${endpoint}/api/counts`)).json();
	assert.deepEqual(counts, {
		audioRequests: 1,
		identityRequests: 5,
		pictureRequests: 6,
	});
	const file = join(artifact, "hyperframes-graph-editor.webm");
	const mixedPcm = Buffer.from(result.pcm);
	await writeFile(file, Buffer.from(result.bytes));
	await writeFile(join(artifact, "mixed.f32le"), mixedPcm);
	await writeFile(
		join(artifact, "native-graph.f32le"),
		Buffer.from(result.rawPcm),
	);
	const verified = verifyGraphEditorExport({
		file,
		ffmpeg,
		ffprobe,
		artifact,
		mixedPcm,
	});
	const summary = {
		passed: true,
		artifact,
		exportedBytes: result.bytes.length,
		videoFrames: 9,
		audio: "stereo Opus 48000",
		nativeMaxError: result.nativeMaxError,
		mixedMaxError: result.mixedMaxError,
		partialMaxError: result.partialMaxError,
		wrongOrderMax: result.wrongOrderMax,
		counts,
		...verified,
		scope:
			"explicit graph archive -> real Chromium/HTTP identity+PCM -> runtime/cache/collector/timeline mix -> buildScene/SceneExporter -> independent FFmpeg AV decode; private WASM; not installed/Electron",
	};
	await writeFile(
		join(artifact, "verification.json"),
		JSON.stringify(summary, null, 2),
	);
	console.log(JSON.stringify(summary, null, 2));
} catch (error) {
	await writeFile(join(artifact, "failure.txt"), error?.stack ?? String(error));
	console.error(error?.stack ?? String(error));
	process.exitCode = 1;
} finally {
	await browser?.close();
	await server?.close();
	if (host.exitCode === null && !host.killed) {
		if (hostReady) host.stdin.end("stop\n");
		else host.kill();
	}
	await exited;
	console.log(JSON.stringify({ artifact, state: "retained-evidence" }));
}
