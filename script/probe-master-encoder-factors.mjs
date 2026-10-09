import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser-probe-toolchain.mjs";
import { runMasterEncoderCase } from "./fixtures/master-encoder-browser.mjs";
import {
	WIDTH,
	HEIGHT,
	FPS,
	FIRST_FRAME,
	FRAME_COUNT,
	FACTORS,
	CHROMA_BITRATE_FACTORS,
	CHROMA_BITRATE_FULL_FACTORS,
	VP9_CODEC_SPECIFICATION,
	controlledComparisons,
	sha256,
	sourceRgba,
	oracleRgba,
	rgbaToRgb,
	packetsToIvf,
	compareDecoderFrames,
} from "./fixtures/master-encoder-analysis.mjs";

const inputs = process.env.ROCUT_MASTER_ENCODER_INPUTS;
const matrix = process.env.ROCUT_MASTER_ENCODER_MATRIX ?? "single-factors";
assert.ok(
	["single-factors", "chroma-bitrate", "chroma-bitrate-full"].includes(matrix),
	"Unknown private encoder matrix",
);
const factors =
	matrix === "chroma-bitrate-full"
		? CHROMA_BITRATE_FULL_FACTORS
		: matrix === "chroma-bitrate"
			? CHROMA_BITRATE_FACTORS
			: FACTORS;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (
	process.argv.length !== 2 ||
	![inputs, ffmpeg, ffprobe].every((path) => path && isAbsolute(path))
)
	throw Error(
		"Provide absolute master encoder input, FFmpeg and FFprobe paths; no arguments",
	);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
	"script/probe-master-encoder-factors.mjs",
	"script/fixtures/master-encoder-browser.mjs",
	"script/fixtures/master-encoder-analysis.mjs",
	"script/fixtures/master-effects-browser-oracle.ts",
	"script/browser-probe-toolchain.mjs",
];
const identities = () =>
	Promise.all(
		sources.map(async (path) => ({
			path,
			sha256: sha256(await readFile(join(root, path))),
		})),
	);
const sourceBefore = await identities();
const rawBytes = await readFile(join(inputs, "encoder-inputs-raw.json"));
assert.equal(
	sha256(rawBytes),
	"3767c360b44c6bb69b8508291a53e9c01021f47737158440c0cf9aa66de3ff8a",
	"Only the locked tu2Trq actual native inputs are admitted",
);
assert.equal(
	sourceBefore.find((entry) =>
		entry.path.endsWith("master-effects-browser-oracle.ts"),
	).sha256,
	"5386ad30b1acad77d2fddff495ea12bc5559d9ee53d8dd71b0d72c8961543055",
	"Independent oracle changed",
);
const trace = JSON.parse(rawBytes.toString("utf8"));
const inputEvidence = JSON.parse(
	await readFile(join(inputs, "encoder-inputs.json"), "utf8"),
);
const previous = JSON.parse(
	await readFile(join(inputs, "verification.json"), "utf8"),
);
assert.equal(inputEvidence.allActualInputsExact, true);
assert.equal(inputEvidence.decodedOutputUnchanged, true);
const frames = trace.records.filter((entry) => entry.kind === "encode");
const configurations = trace.records.filter(
	(entry) => entry.kind === "configure",
);
assert.equal(frames.length, FRAME_COUNT);
assert.equal(configurations.length, 1);
const baselineConfig = configurations[0].config;
assert.equal(baselineConfig.bitrate, 56000);
assert.ok(
	!("latencyMode" in baselineConfig) && !("bitrateMode" in baselineConfig),
);
for (const [index, frame] of frames.entries()) {
	assert.equal(frame.timestamp, Math.trunc((index / FPS) * 1e6));
	assert.deepEqual(sourceRgba(frame), oracleRgba(FIRST_FRAME + index));
}
const originalVideo = join(inputs, "master-effects.webm");
assert.equal(
	sha256(await readFile(originalVideo)),
	"2389638c47f03e1b3ded4e3a391e79d8d1d3b574b53fa18918bb916f5b671ca6",
);
const originalDecoded = await readFile(join(inputs, "decoded.rgb"));
assert.equal(sha256(originalDecoded), previous.decodedRgbSha256);
const artifacts = await mkdtemp(
	join(tmpdir(), "rocut-master-encoder-factors-"),
);
console.log(
	JSON.stringify({
		artifacts,
		inputs,
		matrix,
		factors: factors.map((factor) => factor.name),
	}),
);
const commandOptions = {
	windowsHide: true,
	timeout: 30000,
	maxBuffer: 8 * 1024 * 1024,
};
const probe = (video) =>
	JSON.parse(
		execFileSync(
			ffprobe,
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-count_frames",
				"-show_streams",
				"-show_packets",
				"-show_data_hash",
				"sha256",
				"-of",
				"json",
				video,
			],
			commandOptions,
		),
	);
const originalMetadata = probe(originalVideo);
assert.equal(originalMetadata.packets.length, FRAME_COUNT);
const originalPacketHashes = originalMetadata.packets.map((packet) =>
	packet.data_hash.replace(/^SHA256:/, "").toLowerCase(),
);
await writeFile(
	join(artifacts, "original-metadata.json"),
	JSON.stringify(originalMetadata, null, 2),
	{ flag: "wx" },
);
const provenance = {
	matrix,
	codecSpecification: VP9_CODEC_SPECIFICATION,
	inputs,
	rawInputsSha256: sha256(rawBytes),
	originalVideoSha256: previous.exportedSha256,
	originalDecodedSha256: sha256(originalDecoded),
	originalPacketHashes,
	baselineConfig,
	inputFrames: frames.map(({ bytes, ...metadata }) => ({
		...metadata,
		rawSha256: sha256(Buffer.from(bytes)),
	})),
	trackedSources: sourceBefore,
	originalWasmSha256: previous.wasmSha256,
	ffmpeg,
	ffprobe,
	scope:
		"Standalone diagnostic replay of six locked native encoder input frames. No production policy, material, timeline or acceptance threshold changes. Factor passes are not release-policy acceptance.",
	unchangedDecodedInteriorMaeLimitExclusive: 3,
};
await writeFile(
	join(artifacts, "source-identity.json"),
	JSON.stringify(provenance, null, 2),
	{ flag: "wx" },
);
const server = createServer((request, response) => {
	response.writeHead(200, {
		"content-type": "text/html",
		"cache-control": "no-store",
	});
	response.end(
		"<!doctype html><meta charset=utf-8><title>Private encoder replay</title>",
	);
});
let browser;
const results = [];
try {
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const origin = `http://127.0.0.1:${server.address().port}`;
	browser = await chromium.launch({
		headless: true,
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage();
	await page.route("**/*", (route) =>
		new URL(route.request().url()).origin === origin
			? route.continue()
			: route.abort(),
	);
	await page.goto(origin);
	for (const factor of factors) {
		const directory = join(artifacts, factor.name);
		await mkdir(directory);
		const config = { ...baselineConfig, ...factor.patch };
		const evidence = await page.evaluate(runMasterEncoderCase, {
			config,
			frames,
		});
		if (!evidence.supported) {
			await writeFile(
				join(directory, "unsupported.json"),
				JSON.stringify(evidence, null, 2),
				{ flag: "wx" },
			);
			assert.notEqual(
				factor.name,
				"baseline",
				"Original actual configure is unsupported",
			);
			results.push({ factor, supported: false });
			continue;
		}
		assert.deepEqual(evidence.actualConfigure, config);
		assert.equal(evidence.packets.length, FRAME_COUNT);
		const packetHashes = evidence.packets.map((packet) =>
			sha256(Buffer.from(packet.bytes)),
		);
		const video = join(directory, "encoded.ivf");
		const ivf = packetsToIvf(evidence.packets);
		await writeFile(video, ivf, { flag: "wx" });
		const metadata = probe(video);
		assert.equal(metadata.streams[0].width, WIDTH);
		assert.equal(metadata.streams[0].height, HEIGHT);
		assert.equal(Number(metadata.streams[0].nb_read_frames), FRAME_COUNT);
		assert.equal(metadata.streams[0].r_frame_rate, `${FPS}/1`);
		assert.equal(
			metadata.streams[0].pix_fmt,
			factor.expectedPixelFormat ?? "yuv420p",
			"Encoder did not honor the requested chroma profile",
		);
		assert.deepEqual(
			metadata.packets.map((packet) =>
				packet.data_hash.replace(/^SHA256:/, "").toLowerCase(),
			),
			packetHashes,
			"IVF must preserve every native packet byte",
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
			commandOptions,
		);
		const chromiumRgb = Buffer.concat(
			evidence.decoded.map((frame) => rgbaToRgb(frame.rgba)),
		);
		const observations = compareDecoderFrames(decoded, evidence.decoded);
		const report = {
			factor,
			actualConfigure: evidence.actualConfigure,
			support: evidence.support,
			decoderConfig: evidence.decoderConfig,
			decodeReadback: evidence.decodeReadback,
			packetHashes,
			ivfSha256: sha256(ivf),
			encodedPayloadBytes: evidence.packets.reduce(
				(sum, packet) => sum + packet.bytes.length,
				0,
			),
			ffmpegRgbSha256: sha256(decoded),
			chromiumRgbSha256: sha256(chromiumRgb),
			originalPacketsReproduced: packetHashes.every(
				(hash, index) => hash === originalPacketHashes[index],
			),
			originalFfmpegDecodedReproduced: decoded.equals(originalDecoded),
			ffmpegColorMetadata: {
				pixelFormat: metadata.streams[0].pix_fmt,
				colorSpace: metadata.streams[0].color_space,
				colorRange: metadata.streams[0].color_range,
			},
			chromiumDecodedFrames: evidence.decoded.map(
				({ rgba, ...frame }) => frame,
			),
			ffmpegAllFramesUnderOriginalGate: observations.every(
				(row) => row.ffmpegPassed,
			),
			chromiumAllFramesUnderOriginalGate: observations.every(
				(row) => row.chromiumPassed,
			),
			observations,
		};
		await Promise.all([
			writeFile(join(directory, "ffmpeg.rgb"), decoded, { flag: "wx" }),
			writeFile(join(directory, "chromium.rgb"), chromiumRgb, { flag: "wx" }),
			writeFile(
				join(directory, "ffprobe.json"),
				JSON.stringify(metadata, null, 2),
				{ flag: "wx" },
			),
			writeFile(
				join(directory, "verification.json"),
				JSON.stringify(report, null, 2),
				{ flag: "wx" },
			),
		]);
		results.push(report);
		console.log(
			JSON.stringify({
				factor: factor.name,
				originalPacketsReproduced: report.originalPacketsReproduced,
				originalFfmpegDecodedReproduced: report.originalFfmpegDecodedReproduced,
				ffmpegMae: observations.map((row) => row.ffmpegToOracle.interiorRgbMae),
				chromiumMae: observations.map(
					(row) => row.chromiumToOracle.interiorRgbMae,
				),
			}),
		);
		if (
			factor.name === "baseline" ||
			(matrix === "chroma-bitrate-full" &&
				["level-only-control", "profile0-base-budget"].includes(factor.name))
		) {
			assert.equal(
				report.originalPacketsReproduced,
				true,
				"Replay did not reproduce original native encoded packet payloads; stop causal matrix",
			);
			assert.equal(
				report.originalFfmpegDecodedReproduced,
				true,
				"Replay decode did not reproduce original failure; stop causal matrix",
			);
		}
	}
	assert.deepEqual(
		await identities(),
		sourceBefore,
		"Diagnostic source changed while running",
	);
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(
			{
				diagnosticCompleted: true,
				browser: await browser.version(),
				...provenance,
				results,
				...(matrix !== "single-factors"
					? { controlledComparisons: controlledComparisons(results) }
					: {}),
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
} catch (error) {
	await writeFile(
		join(artifacts, "failure.json"),
		JSON.stringify(
			{
				diagnosticCompleted: false,
				error: String(error?.stack ?? error),
				results,
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	throw error;
} finally {
	await browser?.close();
	await new Promise((resolve) => server.close(resolve));
}
