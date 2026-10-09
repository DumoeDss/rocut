import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { runExportTimingEditorCase } from "./fixtures/hyperframes-export-timing-editor-runner.mjs";
import { exportTimingEditorCases } from "./fixtures/hyperframes-export-timing-editor-spec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY,
	toolchain = process.argv[2];
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (
	![
		isolated,
		toolchain,
		ffmpeg,
		ffprobe,
		process.env.ROCUT_TEST_HYPERFRAMES_ARCHIVE,
		process.env.ROCUT_TEST_HYPERFRAMES_ENGINE_DIRECTORY,
	].every((v) => v && isAbsolute(v))
)
	throw Error(
		"Provide absolute toolchain, private WASM, FFmpeg/FFprobe and original HyperFrames archive/engine paths",
	);
const artifact = await mkdtemp(
	join(tmpdir(), "rocut-hf-export-timing-editor-"),
);
const hash = async (path) =>
	createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
const writeJson = (directory, name, value) =>
	writeFile(join(directory, name), JSON.stringify(value, null, 2), {
		flag: "wx",
	});
const fixturePaths = [
	"script/probe-hyperframes-export-timing-editor.mjs",
	...[
		"project.ts",
		"oracle.ts",
		"host.ts",
		"browser.ts",
		"browser.html",
		"spec.mjs",
		"spec.d.mts",
		"verify.mjs",
		"runner.mjs",
	].map((s) => "script/fixtures/hyperframes-export-timing-editor-" + s),
];
const fixtureInputs = await Promise.all(
	fixturePaths.map(async (path) => ({
		path,
		sha256: await hash(join(root, path)),
	})),
);
const wasmSha256 = await hash(join(isolated, "opencut_wasm_bg.wasm"));
const results = [];
let browser;
console.log(
	JSON.stringify({ artifact, state: "starting-private-editor-probe" }),
);
try {
	const output = join(artifact, "web");
	await buildNativeAudioExportProbe(
		root,
		isolated,
		output,
		"hyperframes-export-timing-editor-browser",
	);
	browser = await chromium.launch({
		headless: true,
		executablePath: chromium.executablePath(),
		args: ["--autoplay-policy=no-user-gesture-required"],
	});
	for (const test of exportTimingEditorCases) {
		const directory = join(artifact, test.id);
		await mkdir(directory);
		results.push(
			await runExportTimingEditorCase({
				test,
				directory,
				output,
				root,
				toolchain,
				ffmpeg,
				ffprobe,
				browser,
			}),
		);
	}
	const old = join(artifact, "aligned-default"),
		selected = join(artifact, "aligned-native");
	assert.equal(
		await hash(join(old, "host/author-archived/index.html")),
		await hash(join(selected, "host/author-archived/index.html")),
		"Old/new author input must be identical",
	);
	const [oldSource, newSource] = await Promise.all(
		[old, selected].map(async (d) =>
			JSON.parse(await readFile(join(d, "host/source.json"), "utf8")),
		),
	);
	assert.equal(oldSource.audio.timing, undefined);
	assert.equal(newSource.audio.timing, "native-exporter");
	assert.notEqual(
		oldSource.build.toolchainLock.sha256,
		newSource.build.toolchainLock.sha256,
		"Mode must partition compile provenance",
	);
	const [oldPcm, newPcm] = await Promise.all(
		[old, selected].map((d) => readFile(join(d, "native-graph.f32le"))),
	);
	assert.equal(oldPcm.length, newPcm.length);
	let modeDifference = 0;
	for (let i = 0; i < oldPcm.length; i += 4)
		modeDifference = Math.max(
			modeDifference,
			Math.abs(oldPcm.readFloatLE(i) - newPcm.readFloatLE(i)),
		);
	assert.ok(
		modeDifference > 0.001,
		"Aligned start did not exercise different timing behavior",
	);
	for (const input of fixtureInputs)
		assert.equal(
			await hash(join(root, input.path)),
			input.sha256,
			"Fixture changed during run",
		);
	assert.equal(
		await hash(join(isolated, "opencut_wasm_bg.wasm")),
		wasmSha256,
		"Private WASM changed during run",
	);
	const report = {
		passed: true,
		artifact,
		fixtureInputs,
		wasmSha256,
		privateWasmVerificationSha256: await hash(
			join(isolated, "verification.json"),
		),
		ffmpegSha256: await hash(ffmpeg),
		ffprobeSha256: await hash(ffprobe),
		sameAuthoredInput: true,
		modeDifference,
		cases: results,
		scope:
			"Fresh authored compile/archive/rebuild/actual collector/Host graph/editor mix/crop for both default and selected timing; selected cases also SceneExporter and independent AV decode. Private Chromium/WASM, not installed Electron or full MV.",
	};
	await writeJson(artifact, "verification.json", report);
	console.log(
		JSON.stringify({
			passed: true,
			artifact,
			modeDifference,
			cases: results.length,
		}),
	);
} catch (error) {
	await writeFile(
		join(artifact, "failure.txt"),
		error?.stack ?? String(error),
		{ flag: "wx" },
	);
	console.error(error?.stack ?? error);
	process.exitCode = 1;
} finally {
	await browser?.close();
	console.log(JSON.stringify({ artifact, state: "retained-evidence" }));
}
