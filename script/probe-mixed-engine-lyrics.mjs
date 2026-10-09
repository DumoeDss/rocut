import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { verifyMixedEngineLyrics } from "./fixtures/mixed-engine-lyrics-verify.mjs";

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
	throw Error("Provide private toolchain/WASM and native FFmpeg paths");
const artifact = await mkdtemp(join(tmpdir(), "rocut-mixed-engine-lyrics-"));
console.log(JSON.stringify({ artifact, state: "starting-private-probe" }));
const host = spawn(
	"bun",
	[
		"--preload",
		"./script/fixtures/isolated-web-wasm-preload.mjs",
		"script/fixtures/mixed-engine-lyrics-host.ts",
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
			() => reject(Error("Mixed-engine fixture startup timeout")),
			150000,
		);
		const fail = (error) => {
			clearTimeout(timer);
			reject(error);
		};
		host.once("error", fail);
		host.once("exit", (code) =>
			fail(Error(`Mixed-engine fixture exited ${code}`)),
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
		"mixed-engine-lyrics-browser",
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
	});
	const page = await browser.newPage(),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text().slice(0, 2000));
	});
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/mixed-engine-lyrics-browser.html`,
		{ waitUntil: "commit", timeout: 90000 },
	);
	await page.waitForFunction(() => globalThis.__mixedEngineLyrics, undefined, {
		timeout: 240000,
	});
	const result = await page.evaluate(() => globalThis.__mixedEngineLyrics);
	await writeFile(
		join(artifact, "browser-result.json"),
		JSON.stringify({ result, errors }, null, 2),
	);
	if (result.error || errors.length)
		throw Error(JSON.stringify({ result, errors }));
	assert.deepEqual(result.layerOrderTopToBottom, [
		"foreground",
		"lyrics",
		"remotion",
		"hyperframes",
	]);
	assert.equal(result.reloadedPixelsExact, true);
	const counts = await (await fetch(`${endpoint}/api/counts`)).json();
	assert.deepEqual(counts.frames, { hyperframes: 14, remotion: 14 });
	assert.equal(counts.saves, 1);
	assert.equal(counts.reloads, 1);
	assert.equal(counts.fontLoads, 2);
	assert.ok(counts.resources >= 2);
	for (const video of result.videos)
		await writeFile(
			join(
				artifact,
				(video.foreground ? "with-foreground" : "without-foreground") + ".webm",
			),
			Buffer.from(video.bytes),
		);
	await writeFile(
		join(artifact, "native-preview.png"),
		Buffer.from(result.previewPng),
	);
	const verified = verifyMixedEngineLyrics({ artifact, ffmpeg, ffprobe });
	const summary = {
		passed: true,
		artifact,
		counts,
		...verified,
		archived: result.archived,
		reloadedPixelsExact: true,
		fontLoads: result.fontLoads,
		fontState: result.fontState,
		sequence: result.sequence,
		scope:
			"relocated/rebuilt HyperFrames + Remotion archives -> real project codec/FileProjectStore reopen -> native JIZURA/Rust factory + real font -> mvRecipe foreground role -> buildScene/SceneExporter -> independent FFmpeg occlusion/pixel/time checks; private WASM/Chromium; not installed/Electron",
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
