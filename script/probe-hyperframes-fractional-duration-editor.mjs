import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { verifyDurationEditorExport } from "./fixtures/hyperframes-fractional-duration-editor-verify.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY,
	toolchain = process.argv[2];
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (
	![
		toolchain,
		isolated,
		ffmpeg,
		ffprobe,
		process.env.ROCUT_TEST_HYPERFRAMES_ARCHIVE,
	].every((value) => value && isAbsolute(value))
)
	throw Error(
		"Provide absolute toolchain and ROCUT_TEST_WASM_DIRECTORY, ROCUT_TEST_FFMPEG, ROCUT_TEST_FFPROBE, ROCUT_TEST_HYPERFRAMES_ARCHIVE paths",
	);
const artifact = await mkdtemp(
	join(tmpdir(), "rocut-hf-fractional-duration-editor-"),
);
console.log(JSON.stringify({ artifact, state: "starting-private-probe" }));
const host = spawn(
	"bun",
	[
		"--preload",
		"./script/fixtures/isolated-web-wasm-preload.mjs",
		"script/fixtures/hyperframes-fractional-duration-editor-host.ts",
		toolchain,
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
	const endpoint = await new Promise((done, reject) => {
		let output = "";
		const timer = setTimeout(
			() => reject(Error("Fractional duration editor fixture startup timeout")),
			120000,
		);
		const fail = (error) => {
			clearTimeout(timer);
			reject(error);
		};
		host.once("error", fail);
		host.once("exit", (code) =>
			fail(Error(`Fractional duration fixture exited ${code}`)),
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
						done(value.endpoint);
					}
				} catch {
					/* Progress messages need not be JSON. */
				}
			}
		});
	});
	hostReady = true;
	const output = join(artifact, "web");
	await buildNativeAudioExportProbe(
		root,
		isolated,
		output,
		"hyperframes-fractional-duration-editor-browser",
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
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/hyperframes-fractional-duration-editor-browser.html`,
		{ waitUntil: "commit", timeout: 90000 },
	);
	await page
		.waitForFunction(
			() => globalThis.__hyperframesFractionalDurationEditor,
			undefined,
			{ timeout: 180000 },
		)
		.catch((error) => {
			throw Error(JSON.stringify({ error: String(error), errors }));
		});
	const result = await page.evaluate(
		() => globalThis.__hyperframesFractionalDurationEditor,
	);
	await writeFile(
		join(artifact, "browser-result.json"),
		JSON.stringify({ result, errors }, null, 2),
		{ flag: "wx" },
	);
	if (result.error || errors.length)
		throw Error(
			JSON.stringify({
				error: result.error,
				errors,
				requests: result.requests,
			}),
		);
	assert.deepEqual(result.requests, { audio: 1, identity: 4 });
	const counts = await (await fetch(`${endpoint}/api/counts`)).json();
	assert.deepEqual(counts, {
		identityRequests: 4,
		audioRequests: 1,
		pictureRequests: 16,
	});
	const file = join(artifact, "hyperframes-fractional-duration-editor.webm"),
		mixedPcm = Buffer.from(result.pcm);
	await writeFile(file, Buffer.from(result.bytes), { flag: "wx" });
	for (const [name, body] of [
		["mixed", mixedPcm],
		["native-graph", Buffer.from(result.rawPcm)],
		["partial", Buffer.from(result.partialPcm)],
	])
		await writeFile(join(artifact, `${name}.f32le`), body, { flag: "wx" });
	const decoded = verifyDurationEditorExport({
		file,
		ffmpeg,
		ffprobe,
		artifact,
		mixedPcm,
	});
	const hash = async (path) =>
		createHash("sha256")
			.update(await readFile(path))
			.digest("hex");
	const summary = {
		passed: true,
		artifact,
		wasmSha256: await hash(join(isolated, "opencut_wasm_bg.wasm")),
		videoSha256: await hash(file),
		exportedBytes: result.bytes.length,
		nativeMaximum: result.nativeMaximum,
		nativeRms: result.nativeRms,
		mixedMaximum: result.mixedMaximum,
		mixedRms: result.mixedRms,
		cropMaximum: result.cropMaximum,
		repeatCropMaximum: result.repeatCropMaximum,
		incorrectRoundedMaximum: result.incorrectRoundedMaximum,
		counts,
		oracle: JSON.parse(
			await readFile(join(artifact, "host/oracle.json"), "utf8"),
		),
		decoded,
		scope:
			"Real authored fractional nonloop rate+trim HTML -> compile/archive/rebuild -> real browser gain history -> Host identity+graph PCM -> editor mix/crop -> SceneExporter -> independent FFmpeg AV decode; private WASM, not installed Electron or full-MV acceptance",
	};
	await writeFile(
		join(artifact, "verification.json"),
		JSON.stringify(summary, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify(
			{
				passed: true,
				artifact,
				exportedBytes: summary.exportedBytes,
				nativeMaximum: summary.nativeMaximum,
				mixedMaximum: summary.mixedMaximum,
				cropMaximum: summary.cropMaximum,
				incorrectRoundedMaximum: summary.incorrectRoundedMaximum,
				counts,
				decodedChannels: decoded.channels,
			},
			null,
			2,
		),
	);
} catch (error) {
	await writeFile(
		join(artifact, "failure.txt"),
		error?.stack ?? String(error),
		{ flag: "wx" },
	);
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
