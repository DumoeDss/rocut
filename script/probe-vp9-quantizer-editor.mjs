import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
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
import { applyRustPlans } from "./fixtures/vp9-quantizer-source-rust-plan.mjs";
import { binaryIdentity } from "./fixtures/vp9-quantizer-source-identities.mjs";
import {
	editorIdentities,
	wasmIdentities,
	bundleIdentities,
	snapshotIdentity,
} from "./fixtures/vp9-quantizer-editor-identities.mjs";
import { persistEditorCase } from "./fixtures/vp9-quantizer-editor-io.mjs";
import { assertEditorCancellation } from "./fixtures/vp9-quantizer-editor-assertions.mjs";

const inputs = process.env.ROCUT_MASTER_ENCODER_INPUTS;
const wasm = process.env.ROCUT_TEST_WASM_DIRECTORY;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG;
const ffprobe = process.env.ROCUT_TEST_FFPROBE;
const policyResolver = process.env.ROCUT_VP9_POLICY_RESOLVER;
const browserExecutable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE;
const expectedWasm = process.env.ROCUT_TEST_EXPECTED_WASM_SHA256;
const policySource = process.env.ROCUT_VP9_POLICY_SOURCE;
const expectedSourceManifest =
	process.env.ROCUT_VP9_POLICY_SOURCE_MANIFEST_SHA256;
if (
	process.argv.length !== 2 ||
	![
		inputs,
		wasm,
		ffmpeg,
		ffprobe,
		policyResolver,
		policySource,
		browserExecutable,
	].every((path) => path && isAbsolute(path)) ||
	!/^[0-9a-f]{64}$/i.test(expectedWasm ?? "") ||
	!/^[0-9a-f]{64}$/i.test(expectedSourceManifest ?? "")
)
	throw Error(
		"Use absolute frozen inputs/private WASM/Rust policy resolver/FFmpeg/FFprobe paths and ROCUT_TEST_BROWSER_EXECUTABLE plus expected WASM SHA256; no arguments",
	);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const identities = () => editorIdentities({ root, policyResolver });
const wasmIdentity = () => wasmIdentities(wasm);
const sourceBefore = await identities(),
	wasmBefore = await wasmIdentity();
const rustSnapshot = await snapshotIdentity(
	policySource,
	expectedSourceManifest,
);
for (const entry of rustSnapshot.videoExportSources)
	assert.equal(
		sourceBefore.find((item) => item.path === entry.path)?.sha256,
		entry.sha256,
		"Live quantizer policy differs from the compiled private snapshot",
	);
assert.equal(wasmBefore[1].sha256, expectedWasm.toLowerCase());
assert.equal(
	sourceBefore.find((entry) =>
		entry.path.endsWith("master-effects-browser-oracle.ts"),
	).sha256,
	"5386ad30b1acad77d2fddff495ea12bc5559d9ee53d8dd71b0d72c8961543055",
);
const source = await loadFrozenSource(inputs);
const cases = applyRustPlans({
	cases: adapterCases(source.config, source.frames).filter((entry) =>
		["baseline", "profile1-q0", "profile1-q63", "profile1-q0-repeat"].includes(
			entry.name,
		),
	),
	executable: policyResolver,
});
const samples = audioSamples(),
	audio = { ...AUDIO, samples: [...samples] };
const originalPacketHashes = packetHashesFromProbe(
	probeQuantizerVideo(ffprobe, join(inputs, "master-effects.webm")),
);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-vp9-quantizer-editor-")),
	output = join(artifacts, "web");
console.log(
	JSON.stringify({ artifacts, wasm, cases: cases.map((entry) => entry.name) }),
);
const tools = [ffmpeg, ffprobe, browserExecutable, policyResolver];
const toolsBefore = await Promise.all(tools.map(binaryIdentity));
await buildNativeAudioExportProbe(
	root,
	wasm,
	output,
	"vp9-quantizer-editor-browser",
);
assert.deepEqual(await identities(), sourceBefore);
assert.deepEqual(await wasmIdentity(), wasmBefore);
const bundles = await bundleIdentities(output),
	bundledWasm = bundles.filter((entry) => entry.path.endsWith(".wasm"));
assert.equal(bundledWasm.length, 1);
assert.equal(bundledWasm[0].sha256, expectedWasm.toLowerCase());
const provenance = {
	browserLaunch: {
		executablePath: browserExecutable,
		executableSha256: toolsBefore.find(
			(entry) => entry.path === browserExecutable,
		).sha256,
		headless: true,
		executableSelection:
			"Required absolute ROCUT_TEST_BROWSER_EXECUTABLE passed as explicit executablePath; before/after hashes bind the same launched image",
	},
	rustSnapshot,
	trackedSources: sourceBefore,
	privateWasm: wasmBefore,
	servedBundles: bundles,
	binaries: toolsBefore,
	frozenInputs: source.identity,
	audio: { ...AUDIO, inputFloat32Sha256: sha256(Buffer.from(samples.buffer)) },
	rustPolicyPlans: cases
		.filter((entry) => entry.rustPolicy)
		.map((entry) => ({ name: entry.name, ...entry.rustPolicy })),
	unchangedDecodedInteriorMaeLimitExclusive: 3,
	scope:
		"Real buildScene/CanvasRenderer -> real Rust WASM resolver -> SceneExporter native or unchanged Canvas branch -> real ExportOutputLifetime/audio -> finalized WebM -> independent FFmpeg and Chromium decode. Original six frames and fixed unshifted companion audio; not whole-song or RGB-lossless acceptance.",
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
const results = [];
try {
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	browser = await chromium.launch({
		executablePath: browserExecutable,
		headless: true,
		args: ["--disable-gpu-rasterization"],
	});
	const run = async (testCase, cancel = false) => {
		const page = await browser.newPage(),
			errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.route("**/*", (route) => {
			const url = new URL(route.request().url());
			return /^https?:$/.test(url.protocol) && url.origin !== origin
				? route.abort()
				: route.continue();
		});
		try {
			await page.goto(
				`${origin}/script/fixtures/vp9-quantizer-editor-browser.html`,
				{ waitUntil: "commit" },
			);
			await page.waitForFunction(
				() => typeof globalThis.__vp9EditorRun === "function",
				undefined,
				{ timeout: 30000 },
			);
			const evidence = await page.evaluate(
				(args) => globalThis.__vp9EditorRun(args),
				{ testCase, audio, cancel },
			);
			assert.deepEqual(errors, []);
			return evidence;
		} finally {
			await page.close();
		}
	};
	for (const testCase of cases) {
		const directory = join(artifacts, testCase.name);
		await mkdir(directory);
		const evidence = await run(testCase);
		const result = await persistEditorCase({
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
	const original = results.find((entry) => entry.name === "profile1-q0"),
		repeat = results.find((entry) => entry.name === "profile1-q0-repeat"),
		negative = results.find((entry) => entry.name === "profile1-q63");
	assert.deepEqual(repeat.packetHashes, original.packetHashes);
	assert.equal(repeat.ffmpegRgbSha256, original.ffmpegRgbSha256);
	assert.equal(repeat.chromiumRgbSha256, original.chromiumRgbSha256);
	assert.notDeepEqual(negative.packetHashes, original.packetHashes);
	assert.notEqual(negative.ffmpegRgbSha256, original.ffmpegRgbSha256);
	assert.ok(
		results.every(
			(entry) => entry.audioDecodedSha256 === results[0].audioDecodedSha256,
		),
	);
	const cancellation = await run(
		cases.find((entry) => entry.name === "profile1-q0"),
		true,
	);
	await writeFile(
		join(artifacts, "cancellation.json"),
		JSON.stringify(cancellation, null, 2),
		{ flag: "wx" },
	);
	assertEditorCancellation(cancellation);
	assert.deepEqual(await identities(), sourceBefore);
	assert.deepEqual(await wasmIdentity(), wasmBefore);
	assert.deepEqual(
		await snapshotIdentity(policySource, expectedSourceManifest),
		rustSnapshot,
	);
	assert.deepEqual(await bundleIdentities(output), bundles);
	assert.deepEqual(await Promise.all(tools.map(binaryIdentity)), toolsBefore);
	await loadFrozenSource(inputs);
	const verification = {
		productionAcceptancePassed: true,
		browser: await browser.version(),
		...provenance,
		results,
		cancellation,
		repeatMatched: true,
		quantizerNegativeControlDetected: true,
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(verification, null, 2),
		{ flag: "wx" },
	);
	console.log(JSON.stringify({ productionAcceptancePassed: true, artifacts }));
} catch (error) {
	await writeFile(
		join(artifacts, "failure.json"),
		JSON.stringify(
			{
				productionAcceptancePassed: false,
				error: String(error?.stack ?? error),
				results,
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	console.error(
		`VP9 editor acceptance failed: ${String(error?.message ?? error).split("\n")[0]}; see ${join(artifacts, "failure.json")}`.slice(
			0,
			1200,
		),
	);
	process.exitCode = 1;
} finally {
	await browser?.close();
	await server.close();
}
