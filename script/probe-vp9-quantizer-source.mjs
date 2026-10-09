import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "./browser-probe-toolchain.mjs";
import { sha256 } from "./fixtures/master-encoder-analysis.mjs";
import {
	packetHashesFromProbe,
	probeQuantizerVideo,
} from "./fixtures/master-encoder-quantizer-io.mjs";
import {
	AUDIO,
	adapterCases,
	audioSamples,
	loadFrozenSource,
} from "./fixtures/vp9-quantizer-source-cases.mjs";
import { persistAdapterCase } from "./fixtures/vp9-quantizer-source-io.mjs";
import { applyRustPlans } from "./fixtures/vp9-quantizer-source-rust-plan.mjs";
import {
	sourceIdentities,
	bundledSourceIdentities,
	binaryIdentity,
} from "./fixtures/vp9-quantizer-source-identities.mjs";

const inputs = process.env.ROCUT_MASTER_ENCODER_INPUTS;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG;
const ffprobe = process.env.ROCUT_TEST_FFPROBE;
const policyResolver = process.env.ROCUT_VP9_POLICY_RESOLVER;
if (policyResolver !== undefined && !isAbsolute(policyResolver))
	throw Error("Use an absolute private Rust policy resolver path");
if (
	process.argv.length !== 2 ||
	![inputs, ffmpeg, ffprobe].every((path) => path && isAbsolute(path))
)
	throw Error(
		"Use absolute frozen encoder-input/FFmpeg/FFprobe paths; no arguments",
	);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const identities = () => sourceIdentities({ root, policyResolver });
const sourceBefore = await identities();
assert.equal(
	sourceBefore.find((entry) =>
		entry.path.endsWith("master-effects-browser-oracle.ts"),
	).sha256,
	"5386ad30b1acad77d2fddff495ea12bc5559d9ee53d8dd71b0d72c8961543055",
);
const source = await loadFrozenSource(inputs);
const selectedCases = adapterCases(source.config, source.frames);
const cases = policyResolver
	? applyRustPlans({ cases: selectedCases, executable: policyResolver })
	: selectedCases;
const originalPacketHashes = packetHashesFromProbe(
	probeQuantizerVideo(ffprobe, join(inputs, "master-effects.webm")),
);
const samples = audioSamples();
const artifacts = await mkdtemp(join(tmpdir(), "rocut-vp9-quantizer-source-"));
const bundle = await build({
	entryPoints: [join(root, "script/fixtures/vp9-quantizer-source-browser.mjs")],
	absWorkingDir: root,
	bundle: true,
	write: false,
	metafile: true,
	format: "iife",
	globalName: "Vp9SourceProbe",
	platform: "browser",
	target: "chrome120",
});
const bundledIdentities = () =>
	bundledSourceIdentities({ root, metafile: bundle.metafile });
const bundledBefore = await bundledIdentities();
const toolsBefore = await Promise.all(
	[
		ffmpeg,
		ffprobe,
		chromium.executablePath(),
		...(policyResolver ? [policyResolver] : []),
	].map(binaryIdentity),
);
const provenance = {
	trackedSources: sourceBefore,
	bundledSources: bundledBefore,
	bundleSha256: sha256(Buffer.from(bundle.outputFiles[0].text)),
	decoderBinaries: toolsBefore,
	inputIdentity: source.identity,
	audio: { ...AUDIO, inputFloat32Sha256: sha256(Buffer.from(samples.buffer)) },
	unchangedDecodedInteriorMaeLimitExclusive: 3,
	baselineConfig: source.config,
	rustPolicyPlans: cases
		.filter((testCase) => testCase.rustPolicy)
		.map((testCase) => ({ name: testCase.name, ...testCase.rustPolicy })),
	scope:
		"Actual explicit VP9 adapter -> public Mediabunny Output/EncodedVideoPacketSource with fixed companion audio -> finalized WebM -> independent FFmpeg and Chromium decode. This probe does not exercise production SceneExporter; no production, RGB lossless or whole-song acceptance claim.",
};
await writeFile(
	join(artifacts, "source-identity.json"),
	JSON.stringify(provenance, null, 2),
	{ flag: "wx" },
);
console.log(
	JSON.stringify({ artifacts, cases: cases.map((testCase) => testCase.name) }),
);
const server = createServer((_request, response) => {
	response.writeHead(200, {
		"content-type": "text/html",
		"cache-control": "no-store",
	});
	response.end(
		"<!doctype html><meta charset=utf-8><title>Private VP9 adapter acceptance</title>",
	);
});
let browser;
const results = [];
try {
	await new Promise((yes, no) => {
		server.once("error", no);
		server.listen(0, "127.0.0.1", yes);
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
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	const audio = { ...AUDIO, samples: [...samples] };
	for (const testCase of cases) {
		const directory = join(artifacts, testCase.name);
		await mkdir(directory);
		const evidence = await page.evaluate(
			(args) => globalThis.Vp9SourceProbe.runAdapterCase(args),
			{ testCase, audio },
		);
		const result = await persistAdapterCase({
			evidence,
			testCase,
			source,
			originalPacketHashes,
			directory,
			ffmpeg,
			ffprobe,
		});
		results.push(result);
		console.log(
			JSON.stringify({
				name: result.name,
				ffmpegPassed: result.ffmpegPassed,
				chromiumPassed: result.chromiumPassed,
				ffmpegMae: result.observations.map(
					(row) => row.ffmpegToOracle.interiorRgbMae,
				),
				chromiumMae: result.observations.map(
					(row) => row.chromiumToOracle.interiorRgbMae,
				),
			}),
		);
	}
	const original = results.find((entry) => entry.name === "profile1-q0");
	const repeat = results.find((entry) => entry.name === "profile1-q0-repeat");
	assert.deepEqual(repeat.packetHashes, original.packetHashes);
	assert.equal(repeat.ffmpegRgbSha256, original.ffmpegRgbSha256);
	assert.equal(repeat.chromiumRgbSha256, original.chromiumRgbSha256);
	const negative = results.find((entry) => entry.name === "profile1-q63");
	assert.ok(
		results.every(
			(entry) => entry.audioDecodedSha256 === results[0].audioDecodedSha256,
		),
		"Video quantizer must not change the fixed companion audio output",
	);
	assert.notDeepEqual(negative.packetHashes, original.packetHashes);
	assert.notEqual(negative.ffmpegRgbSha256, original.ffmpegRgbSha256);
	const cancelled = await page.evaluate(
		(args) => globalThis.Vp9SourceProbe.runAdapterCase(args),
		{ testCase: cases[2], audio, cancel: true },
	);
	assert.equal(cancelled.closeError.name, "ExportCancelledError");
	assert.equal(cancelled.lifecycle.at(-1), "output.cancel");
	assert.equal(cancelled.lifecycle.includes("output.finalize"), false);
	assert.equal(cancelled.bufferPublished, false);
	await writeFile(
		join(artifacts, "cancellation.json"),
		JSON.stringify(cancelled, null, 2),
		{ flag: "wx" },
	);
	assert.deepEqual(
		await identities(),
		sourceBefore,
		"Tracked adapter/probe/dependency source changed during run",
	);
	await loadFrozenSource(inputs);
	assert.deepEqual(await bundledIdentities(), bundledBefore);
	assert.deepEqual(
		await Promise.all(
			[
				ffmpeg,
				ffprobe,
				chromium.executablePath(),
				...(policyResolver ? [policyResolver] : []),
			].map(binaryIdentity),
		),
		toolsBefore,
	);
	const verification = {
		adapterAcceptancePassed: true,
		productionIntegrated: false,
		productionAcceptanceClaimed: false,
		browser: await browser.version(),
		...provenance,
		results,
		cancellation: cancelled,
		repeatMatched: true,
		quantizerNegativeControlDetected: true,
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(verification, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			adapterAcceptancePassed: true,
			productionIntegrated: false,
			artifacts,
		}),
	);
} catch (error) {
	await writeFile(
		join(artifacts, "failure.json"),
		JSON.stringify(
			{
				adapterAcceptancePassed: false,
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
	await new Promise((done) => server.close(done));
}
