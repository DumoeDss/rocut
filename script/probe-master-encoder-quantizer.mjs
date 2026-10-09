import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser-probe-toolchain.mjs";
import { sha256 } from "./fixtures/master-encoder-analysis.mjs";
import { runMasterEncoderCase } from "./fixtures/master-encoder-browser.mjs";
import {
	QUANTIZER_SPECIFICATIONS,
	createQuantizerCases,
	assertSameFrameContent,
	quantizerContrasts,
} from "./fixtures/master-encoder-quantizer-cases.mjs";
import {
	loadQuantizerSource,
	persistQuantizerCase,
} from "./fixtures/master-encoder-quantizer-io.mjs";

const inputs = process.env.ROCUT_MASTER_ENCODER_INPUTS,
	ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (
	process.argv.length !== 2 ||
	![inputs, ffmpeg, ffprobe].every((path) => path && isAbsolute(path))
)
	throw Error(
		"Use absolute locked encoder-input, FFmpeg and FFprobe paths; no arguments",
	);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tracked = [
	"script/probe-master-encoder-quantizer.mjs",
	"script/fixtures/master-encoder-quantizer-cases.mjs",
	"script/fixtures/master-encoder-quantizer-io.mjs",
	"script/fixtures/master-encoder-browser.mjs",
	"script/fixtures/master-encoder-analysis.mjs",
	"script/fixtures/master-effects-browser-oracle.ts",
	"script/browser-probe-toolchain.mjs",
];
const identities = () =>
	Promise.all(
		tracked.map(async (path) => ({
			path,
			sha256: sha256(await readFile(join(root, path))),
		})),
	);
const sourceBefore = await identities();
assert.equal(
	sourceBefore.find((entry) =>
		entry.path.endsWith("master-effects-browser-oracle.ts"),
	).sha256,
	"5386ad30b1acad77d2fddff495ea12bc5559d9ee53d8dd71b0d72c8961543055",
);
const source = await loadQuantizerSource(inputs, ffprobe);
const cases = createQuantizerCases(source.config, source.frames);
for (const testCase of cases)
	assertSameFrameContent(testCase.frames, source.frames);
const artifacts = await mkdtemp(
	join(tmpdir(), "rocut-master-encoder-quantizer-"),
);
console.log(
	JSON.stringify({ artifacts, cases: cases.map((testCase) => testCase.name) }),
);
const provenance = {
	inputIdentity: source.identity,
	trackedSources: sourceBefore,
	baselineConfig: source.config,
	quantizerSpecifications: QUANTIZER_SPECIFICATIONS,
	unchangedDecodedInteriorMaeLimitExclusive: 3,
	scope:
		"Native WebCodecs-only causal diagnostic; same captured six BGRA inputs, original times/keyframes and independent oracle. No Mediabunny callback mutation, production policy change or lossless RGB claim.",
};
await writeFile(
	join(artifacts, "source-identity.json"),
	JSON.stringify(provenance, null, 2),
	{ flag: "wx" },
);
await writeFile(
	join(artifacts, "original-metadata.json"),
	JSON.stringify(source.originalMetadata, null, 2),
	{ flag: "wx" },
);
const server = createServer((request, response) => {
	response.writeHead(200, {
		"content-type": "text/html",
		"cache-control": "no-store",
	});
	response.end(
		"<!doctype html><meta charset=utf-8><title>Private quantizer diagnostic</title>",
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
	for (const testCase of cases) {
		const directory = join(artifacts, testCase.name);
		await mkdir(directory);
		let evidence;
		try {
			evidence = await page.evaluate(runMasterEncoderCase, {
				config: testCase.config,
				frames: testCase.frames,
				recordEncodeOptions: true,
				captureErrors: true,
			});
		} catch (error) {
			evidence = {
				supported: false,
				error: String(error?.stack ?? error),
				requestedConfig: testCase.config,
				scope:
					"Capability/setup failed before structured native capture was available",
			};
		}
		const result = await persistQuantizerCase({
			evidence,
			testCase,
			source,
			directory,
			ffmpeg,
			ffprobe,
		});
		results.push(result);
		console.log(
			JSON.stringify({
				name: result.name,
				supported: result.supported,
				error: result.error,
				originalPacketsReproduced: result.originalPacketsReproduced,
				ffmpegMae: result.observations?.map(
					(row) => row.ffmpegToOracle.interiorRgbMae,
				),
				chromiumMae: result.observations?.map(
					(row) => row.chromiumToOracle.interiorRgbMae,
				),
			}),
		);
		if (["baseline", "profile0-variable-control"].includes(testCase.name)) {
			assert.equal(
				result.originalPacketsReproduced,
				true,
				"Original/native P0 control did not reproduce baseline packets; stop experiment",
			);
			assert.equal(
				result.originalFfmpegDecodedReproduced,
				true,
				"Original/native P0 control did not reproduce baseline decoded pixels; stop experiment",
			);
		}
	}
	assert.deepEqual(
		await identities(),
		sourceBefore,
		"Quantizer diagnostic sources changed during run",
	);
	const contrasts = quantizerContrasts(results);
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(
			{
				diagnosticCompleted: true,
				productionAcceptanceClaimed: false,
				browser: await browser.version(),
				...provenance,
				results,
				contrasts,
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	console.log(JSON.stringify({ diagnosticCompleted: true, contrasts }));
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
