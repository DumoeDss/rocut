import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import {
	installMasterEncoderTrace,
	saveMasterEncoderTrace,
} from "./master-encoder-trace.mjs";
import {
	WIDTH,
	HEIGHT,
	FPS,
	FIRST_FRAME,
	FRAME_COUNT,
	interior,
	temporalColor,
	decodedFrameMatrix,
} from "./fixtures/master-effects-browser-oracle.ts";

const wasm = process.env.ROCUT_TEST_WASM_DIRECTORY,
	ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
const referenceVideo = process.env.ROCUT_MASTER_GPU_REFERENCE_VIDEO;
const videoChroma = process.env.ROCUT_MASTER_VIDEO_CHROMA;
const encoderTraceBaseline = process.env.ROCUT_MASTER_ENCODER_TRACE_BASELINE;
if (
	encoderTraceBaseline &&
	(!isAbsolute(encoderTraceBaseline) || referenceVideo)
)
	throw Error(
		"Encoder trace needs an absolute unobserved baseline and a real new export",
	);
if (videoChroma !== undefined && videoChroma !== "444")
	throw Error(
		"Only the explicit supplemental 444 mode is supported; omit for unchanged default",
	);
if (referenceVideo && !isAbsolute(referenceVideo))
	throw Error(
		"GPU-only diagnostic requires an absolute existing reference video",
	);
if (
	process.argv.length !== 2 ||
	![wasm, ffmpeg, ffprobe].every((p) => p && isAbsolute(p))
)
	throw Error(
		"Use absolute private WASM, FFmpeg and FFprobe environment paths and no arguments",
	);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = await mkdtemp(join(tmpdir(), "rocut-master-effects-")),
	output = join(artifacts, "web");
console.log(JSON.stringify({ artifacts, wasm }));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = async (base, names) =>
	Promise.all(
		names.map(async (name) => {
			const bytes = await readFile(join(base, name));
			return { name, bytes: bytes.length, sha256: digest(bytes) };
		}),
	);
const inputs = [
	"script/probe-master-effects.mjs",
	"script/master-encoder-trace.mjs",
	"script/fixtures/master-effects-browser.ts",
	"script/fixtures/master-effects-browser-scene.ts",
	"script/fixtures/master-effects-browser-oracle.ts",
	"script/fixtures/master-effects-browser.html",
	"script/native-audio-export-build.mjs",
	"script/browser-probe-toolchain.mjs",
	"packages/editor-classic/src/services/renderer/scene-builder.ts",
	"packages/editor-classic/src/services/renderer/canvas-renderer.ts",
	"packages/editor-classic/src/services/renderer/scene-exporter.ts",
	"packages/editor-classic/src/services/renderer/export-video-bitrate.ts",
	"packages/editor-classic/src/services/renderer/export-video-options.ts",
	"packages/editor-classic/src/services/renderer/export-video-chroma.ts",
	"packages/editor-classic/src/services/renderer/resolve.ts",
	"packages/editor-classic/src/services/renderer/resolve-visual-state.ts",
	"packages/editor-classic/src/services/renderer/compositor/frame-descriptor.ts",
	"packages/editor-classic/src/services/renderer/compositor/wasm-compositor.ts",
	"packages/editor-classic/src/effects/definitions/index.ts",
	"packages/editor-classic/src/effects/definitions/color-adjustment.ts",
	"packages/editor-classic/src/effects/definitions/stylized.ts",
];
const wasmInputs = ["opencut_wasm.js", "opencut_wasm_bg.wasm"];
const sourceBefore = await identity(root, inputs),
	wasmBefore = await identity(wasm, wasmInputs);
const wasmSha256 = wasmBefore.find((file) =>
	file.name.endsWith(".wasm"),
).sha256;
if (process.env.ROCUT_TEST_EXPECTED_WASM_SHA256)
	assert.equal(
		wasmSha256,
		process.env.ROCUT_TEST_EXPECTED_WASM_SHA256.toLowerCase(),
		"Unexpected private WASM identity",
	);
await writeFile(
	join(artifacts, "source-before-build.json"),
	JSON.stringify({ sourceBefore, wasmBefore }, null, 2),
	{ flag: "wx" },
);
await buildNativeAudioExportProbe(root, wasm, output, "master-effects-browser");
assert.deepEqual(
	await identity(root, inputs),
	sourceBefore,
	"Tracked inputs changed during browser bundle build",
);
assert.deepEqual(
	await identity(wasm, wasmInputs),
	wasmBefore,
	"Private WASM changed during browser bundle build",
);
async function bundleNames(base, prefix = "") {
	const names = [];
	for (const entry of await readdir(join(base, prefix), {
		withFileTypes: true,
	})) {
		const name = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) names.push(...(await bundleNames(base, name)));
		else if (entry.isFile()) names.push(name);
		else throw Error(`Unexpected non-regular bundle entry: ${name}`);
	}
	return names.sort();
}
const bundles = await identity(output, await bundleNames(output));
const bundledWasm = bundles.filter((file) => file.name.endsWith(".wasm"));
assert.equal(bundledWasm.length, 1, "Expected one actual bundled WASM");
assert.equal(
	bundledWasm[0].sha256,
	wasmSha256,
	"Browser bundle does not contain the declared private WASM",
);
const provenance = {
	wasmDirectory: wasm,
	wasmSha256,
	wasmInputs: wasmBefore,
	trackedInputs: sourceBefore,
	trackedInputsStableDuringBuild: true,
	bundles,
	coverage:
		"Named probe/core input hashes plus every served bundle byte; not a claim of a whole-worktree snapshot",
	gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		windowsHide: true,
		encoding: "utf8",
	}).trim(),
};
await writeFile(
	join(artifacts, "source-identity.json"),
	JSON.stringify(provenance, null, 2),
	{ flag: "wx" },
);
const server = await createServer({
	root: output,
	configFile: false,
	logLevel: "error",
	cacheDir: join(artifacts, "vite-cache"),
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { host: "127.0.0.1", port: 0, hmr: false },
});
let browser;
try {
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	browser = await chromium.launch({
		headless: true,
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage(),
		errors = [];
	if (encoderTraceBaseline) await page.addInitScript(installMasterEncoderTrace);
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		return /^https?:$/.test(url.protocol) && url.origin !== origin
			? route.abort()
			: route.continue();
	});
	await page.goto(
		`${origin}/script/fixtures/master-effects-browser.html?${new URLSearchParams(
			{
				...(referenceVideo ? { gpuOnly: "1" } : {}),
				...(videoChroma ? { chroma: videoChroma } : {}),
			},
		)}`,
		{
			waitUntil: "commit",
		},
	);
	await page.waitForFunction(() => globalThis.__masterEffects, undefined, {
		timeout: 180000,
	});
	const { bytes, gpuFrames, ...result } = await page.evaluate(
		() => globalThis.__masterEffects,
	);
	const encoderTrace = encoderTraceBaseline
		? await page.evaluate(() => globalThis.__masterEncoderTrace())
		: undefined;
	if (encoderTrace)
		await writeFile(
			join(artifacts, "encoder-inputs-raw.json"),
			JSON.stringify(encoderTrace, null, 2),
			{ flag: "wx" },
		);
	await writeFile(
		join(artifacts, "browser-evidence.json"),
		JSON.stringify(
			{ ...result, errors, browser: await browser.version(), wasm, wasmSha256 },
			null,
			2,
		),
		{ flag: "wx" },
	);
	assert.ok(
		result.passed && !errors.length,
		JSON.stringify({ result, errors }),
	);
	assert.deepEqual(result.exportSettings, {
		width: WIDTH,
		height: HEIGHT,
		fps: { numerator: FPS, denominator: 1 },
		format: "webm",
		quality: "very_high",
		shouldIncludeAudio: false,
		...(videoChroma ? { videoChroma } : {}),
	});
	assert.deepEqual(result.exportRange, {
		startTime: FIRST_FRAME * 4000,
		endTime: (FIRST_FRAME + FRAME_COUNT) * 4000,
		duration: FRAME_COUNT * 4000,
	});
	await browser.close();
	browser = undefined;
	assert.equal(gpuFrames.length, FRAME_COUNT);
	const gpuAccuracy = [],
		gpuByFrame = new Map();
	for (const entry of gpuFrames) {
		assert.ok(
			entry.sceneFrame >= FIRST_FRAME &&
				entry.sceneFrame < FIRST_FRAME + FRAME_COUNT,
		);
		assert.ok(
			!gpuByFrame.has(entry.sceneFrame),
			"Duplicate GPU reference frame",
		);
		const rgba = Buffer.from(entry.rgba);
		assert.equal(rgba.length, WIDTH * HEIGHT * 4);
		gpuByFrame.set(entry.sceneFrame, rgba);
		await writeFile(join(artifacts, `gpu-${entry.sceneFrame}.rgba`), rgba, {
			flag: "wx",
		});
		let difference = 0,
			maxError = 0,
			differingChannels = 0;
		for (let y = 0; y < HEIGHT; y++)
			for (let x = 0; x < WIDTH; x++) {
				const expected = [...temporalColor(x, y, entry.sceneFrame), 255];
				for (let c = 0; c < 4; c++) {
					const delta = Math.abs(rgba[(y * WIDTH + x) * 4 + c] - expected[c]);
					difference += delta;
					maxError = Math.max(maxError, delta);
					if (delta) differingChannels++;
				}
			}
		gpuAccuracy.push({
			sceneFrame: entry.sceneFrame,
			sha256: digest(rgba),
			meanAbsoluteRgbaError: difference / rgba.length,
			maxError,
			differingChannels,
			tolerance: 2,
		});
	}
	await writeFile(
		join(artifacts, "gpu-accuracy.json"),
		JSON.stringify(gpuAccuracy, null, 2),
		{ flag: "wx" },
	);
	assert.ok(
		gpuAccuracy.every((frame) => frame.maxError <= 2),
		"Whole-frame GPU pixels differ from independent oracle",
	);
	const video = referenceVideo ?? join(artifacts, "master-effects.webm");
	const encodedBytes = referenceVideo
		? await readFile(referenceVideo)
		: Buffer.from(bytes);
	if (referenceVideo) assert.equal(result.exportSkipped, true);
	else await writeFile(video, encodedBytes, { flag: "wx" });
	const options = {
		windowsHide: true,
		timeout: 30000,
		maxBuffer: 4 * 1024 * 1024,
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
				video,
			],
			options,
		),
	);
	const stream = metadata.streams.find((s) => s.codec_type === "video");
	assert.equal(stream.width, WIDTH);
	assert.equal(stream.height, HEIGHT);
	assert.equal(Number(stream.nb_read_frames), FRAME_COUNT);
	assert.equal(stream.r_frame_rate, `${FPS}/1`);
	assert.ok(
		Math.abs(Number(metadata.format.duration) - FRAME_COUNT / FPS) <= 0.002,
	);
	const decoded = execFileSync(
		ffmpeg,
		[
			"-v",
			"error",
			"-i",
			video,
			"-map",
			"0:v:0",
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"pipe:1",
		],
		options,
	);
	await writeFile(
		join(artifacts, "encoded-metadata.json"),
		JSON.stringify(metadata, null, 2),
		{ flag: "wx" },
	);
	assert.equal(decoded.length, WIDTH * HEIGHT * 3 * FRAME_COUNT);
	await writeFile(join(artifacts, "decoded.rgb"), decoded, { flag: "wx" });
	const encoderInputs = encoderTrace
		? await saveMasterEncoderTrace({
				trace: encoderTrace,
				artifacts,
				gpuByFrame,
				decoded,
				baseline: encoderTraceBaseline,
				exportSettings: result.exportSettings,
				wasmSha256,
			})
		: undefined;
	const frameMatrix = decodedFrameMatrix(
		decoded,
		[...gpuByFrame].map(([sceneFrame, rgba]) => ({ sceneFrame, rgba })),
	);
	await writeFile(
		join(artifacts, "frame-error-matrix.json"),
		JSON.stringify(
			{
				projection:
					"Rec.601 luma/chroma projections of RGB deltas; not raw coded planes",
				rows: frameMatrix,
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	const observations = [];
	for (let index = 0; index < FRAME_COUNT; index++) {
		let difference = 0,
			count = 0,
			wrongClockDifference = 0,
			gpuDifference = 0;
		const gpu = gpuByFrame.get(FIRST_FRAME + index);
		for (let y = 0; y < HEIGHT; y++)
			for (let x = 0; x < WIDTH; x++)
				if (interior(x, y)) {
					const expected = temporalColor(x, y, FIRST_FRAME + index),
						wrongClock = temporalColor(x, y, FIRST_FRAME + index, index);
					for (let c = 0; c < 3; c++) {
						const value = decoded[((index * HEIGHT + y) * WIDTH + x) * 3 + c];
						difference += Math.abs(value - expected[c]);
						gpuDifference += Math.abs(value - gpu[(y * WIDTH + x) * 4 + c]);
						wrongClockDifference += Math.abs(value - wrongClock[c]);
						count++;
					}
				}
		const mae = difference / count,
			rangeLocalClockMae = wrongClockDifference / count;
		// Same <3 decoded-interior gate as the existing mv-finishing verifier.
		observations.push({
			encodedFrame: index,
			sceneFrame: FIRST_FRAME + index,
			mae,
			gpuToDecodeMae: gpuDifference / count,
			rangeLocalClockMae,
			qualityPassed: mae < 3,
			wrongClockRejected: rangeLocalClockMae > 8,
		});
	}
	const report = {
		...result,
		runKind: referenceVideo
			? "gpu-only-diagnostic"
			: videoChroma === "444"
				? "explicit-444-supplement"
				: "unchanged-default",
		passed:
			observations.every(
				(row) => row.qualityPassed && row.wrongClockRejected,
			) &&
			(!encoderInputs ||
				(encoderInputs.allActualInputsExact &&
					encoderInputs.decodedOutputUnchanged)),
		wasm,
		wasmSha256,
		sourceIdentitySha256: digest(
			await readFile(join(artifacts, "source-identity.json")),
		),
		artifacts,
		exportedBytes: encodedBytes.length,
		exportedSha256: digest(encodedBytes),
		...(referenceVideo
			? { reusedVideo: referenceVideo, diagnosticOnly: true }
			: {}),
		gpuAccuracy,
		...(encoderInputs ? { encoderInputs } : {}),
		decodedRgbSha256: digest(decoded),
		frameErrorMatrixSha256: digest(
			await readFile(join(artifacts, "frame-error-matrix.json")),
		),
		decoded: {
			frames: FRAME_COUNT,
			codec: stream.codec_name,
			pixelFormat: stream.pix_fmt,
			colorSpace: stream.color_space,
			colorRange: stream.color_range,
			duration: Number(metadata.format.duration),
			observations,
		},
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	console.log(JSON.stringify(report));
	assert.ok(
		report.passed,
		"Decoded master effect video failed original quality or clock gates; see retained verification.json",
	);
} catch (error) {
	await writeFile(
		join(artifacts, "failure.json"),
		JSON.stringify(
			{ passed: false, error: String(error?.stack ?? error), wasm, wasmSha256 },
			null,
			2,
		),
		{ flag: "wx" },
	);
	throw error;
} finally {
	await browser?.close();
	await server.close();
}
