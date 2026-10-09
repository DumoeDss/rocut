import { strict as assert } from "node:assert";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { verifyPresetVideo } from "./remotion-presets-verification.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [scaffold, toolchain, styles, assets] = process.argv.slice(2);
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (
	![scaffold, toolchain, styles, assets, isolated, ffmpeg, ffprobe].every(
		(value) => value && isAbsolute(value),
	)
)
	throw Error(
		"Provide absolute scaffold/toolchain/style-toolchain/asset-directory arguments and WASM/FFmpeg/FFprobe environment paths",
	);
const temporary = await mkdtemp(join(tmpdir(), "rocut-remotion-presets-"));
console.log(JSON.stringify({ artifacts: temporary }));
const host = spawn(
	"bun",
	[
		"--preload",
		"./script/fixtures/isolated-web-wasm-preload.mjs",
		"script/fixtures/remotion-presets-host.ts",
		scaffold,
		toolchain,
		styles,
		assets,
		temporary,
	],
	{
		cwd: root,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary },
	},
);
const exited = new Promise((resolve) => host.once("close", resolve));
let browser,
	server,
	ready = false,
	passed = false;
try {
	const endpoint = await new Promise((resolve, reject) => {
		let output = "";
		const timer = setTimeout(
			() => reject(Error("Preset native validation startup timeout")),
			process.env.ROCUT_TEST_PRESET_RANGE === "full" ? 3600000 : 900000,
		);
		const fail = (error) => {
			clearTimeout(timer);
			reject(error);
		};
		host.once("error", fail);
		host.once("exit", (code) => fail(Error(`Preset fixture exited ${code}`)));
		host.stderr.on("data", (data) => process.stderr.write(data));
		host.stdout.on("data", (data) => {
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
				} catch {
					// The fixture also writes non-JSON progress messages to stdout.
				}
			}
		});
	});
	ready = true;
	// All native browser captures have finished before the export browser starts.
	const output = join(temporary, "web");
	await buildNativeAudioExportProbe(
		root,
		isolated,
		output,
		"remotion-presets-browser",
	);
	server = await createServer({
		root: output,
		configFile: false,
		logLevel: "error",
		cacheDir: join(temporary, "vite-cache"),
		optimizeDeps: { noDiscovery: true, include: [] },
		server: {
			host: "127.0.0.1",
			hmr: false,
			port: 0,
			proxy: { "/api": { target: endpoint } },
		},
	});
	await server.listen();
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage(),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/remotion-presets-browser.html`,
		{ waitUntil: "commit" },
	);
	await page.waitForFunction(() => globalThis.__remotionPresets, undefined, {
		timeout: process.env.ROCUT_TEST_PRESET_RANGE === "full" ? 900000 : 180000,
	});
	const result = await page.evaluate(() => globalThis.__remotionPresets);
	if (result.error || errors.length)
		throw Error(JSON.stringify({ result, errors }));
	await browser.close();
	browser = undefined;
	const native = JSON.parse(
		await readFile(join(temporary, "native-results.json"), "utf8"),
	);
	const matrix = [];
	for (const video of result.videos) {
		const entry = native.results.find((item) => item.id === video.id);
		const file = join(temporary, video.id, "rocut.webm");
		await writeFile(file, Buffer.from(video.bytes));
		const options = {
			windowsHide: true,
			timeout: 30000,
			maxBuffer: 64 * 1024 * 1024,
		};
		const metadata = JSON.parse(
			execFileSync(
				ffprobe,
				[
					"-v",
					"error",
					"-count_frames",
					"-show_streams",
					"-show_format",
					"-of",
					"json",
					file,
				],
				options,
			),
		);
		const stream = metadata.streams.find((item) => item.codec_type === "video");
		assert.equal(Number(stream.nb_read_frames), entry.frameCount);
		assert.equal(stream.width, entry.source.width);
		assert.equal(stream.height, entry.source.height);
		const [encodedNumerator, encodedDenominator] = stream.r_frame_rate
			.split("/")
			.map(Number);
		assert.ok(
			encodedNumerator > 0 && encodedDenominator > 0,
			"Missing encoded frame rate",
		);
		assert.equal(
			encodedNumerator * entry.source.frameRate.denominator,
			encodedDenominator * entry.source.frameRate.numerator,
			"Encoded frame rate differs from composition",
		);
		const encodedDurationSeconds = Number(metadata.format.duration);
		const expectedDurationSeconds =
			(entry.frameCount * entry.source.frameRate.denominator) /
			entry.source.frameRate.numerator;
		assert.ok(
			Math.abs(encodedDurationSeconds - expectedDurationSeconds) <= 0.002,
			"Encoded duration differs from the requested frame range",
		);
		const decoded = await verifyPresetVideo({
			ffmpeg,
			file,
			framesDirectory: join(temporary, video.id, "frames"),
			width: entry.source.width,
			height: entry.source.height,
			firstFrame: entry.firstFrame,
			frameCount: entry.frameCount,
		});
		matrix.push({
			id: video.id,
			compile: true,
			randomFrames: entry.randomFrames,
			repeatPixelsExact: entry.repeatPixelsExact,
			rebuiltPixelsExact: entry.rebuiltPixelsExact,
			archiveRebuilt: true,
			rangeMode: entry.rangeMode,
			sourceDurationFrames: entry.source.durationFrames,
			exportedFrames: entry.frameCount,
			frameRate: entry.source.frameRate,
			encodedDurationSeconds,
			width: stream.width,
			height: stream.height,
			...decoded,
			exportedBytes: video.bytes.length,
		});
	}
	await writeFile(
		join(temporary, "verification.json"),
		JSON.stringify({ matrix, errors: native.errors }, null, 2),
	);
	console.log(
		JSON.stringify(
			{
				matrix,
				errors: native.errors,
				scope:
					"Original presets -> native Remotion/Rocut PNG -> ProgrammaticNode/buildScene -> SceneExporter -> independent video decode; standalone, not installed Electron",
			},
			null,
			2,
		),
	);
	assert.equal(
		matrix.length,
		process.env.ROCUT_TEST_PRESETS?.split(",").length ?? 6,
		"Not all requested original presets passed",
	);
	assert.equal(
		native.errors.length,
		0,
		"Native raster consistency is unresolved; export success does not waive this gate",
	);
	passed = true;
} catch (error) {
	console.error(error?.stack ?? String(error));
	process.exitCode = 1;
	await writeFile(
		join(temporary, "failure.json"),
		JSON.stringify(
			{ passed: false, error: String(error?.stack ?? error) },
			null,
			2,
		),
	);
} finally {
	await browser?.close();
	await server?.close();
	if (host.exitCode === null && !host.killed) {
		if (ready) host.stdin.end("stop\n");
		else host.kill();
	}
	await exited;
	if (passed && process.env.ROCUT_PRESETS_KEEP_DIAGNOSTIC !== "1") {
		await removeProbeDirectory(temporary);
	}
}

async function removeProbeDirectory(directory) {
	if (
		dirname(directory) !== resolve(tmpdir()) ||
		!basename(directory).startsWith("rocut-remotion-presets-")
	)
		throw Error("Unsafe preset probe cleanup");
	await rm(directory, { recursive: true, force: true });
}
