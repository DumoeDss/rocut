/**
 * Independent native oracle for @hyperframes/core 0.8.139.
 *
 * Run from any directory:
 * node script/fixtures/hyperframes-audio-graph-oracle.mjs <private-toolchain>
 *
 * Only imports the existing pinned package plus Node builtins and these fixture
 * helpers. No Rocut production algorithms, browser, network, dependency install,
 * source writes or WASM. A self-owned Node child has a 20 s wall-clock deadline.
 * Output is deterministic JSON; assertion failures and timeouts exit nonzero.
 *
 * Evidence classes are deliberately distinct:
 * - native-control-math: actual upstream functions, not a PCM render;
 * - native-scheduling / native-graph-construction: recording API adapters only;
 * - native-worklet-pcm: actual upstream process() code over Float32 buffers;
 * - full browser OfflineAudioContext / exporter parity: NOT EXECUTED.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { engineCases } from "./hyperframes-audio-graph-oracle-engine.mjs";
import { fxCases } from "./hyperframes-audio-graph-oracle-fx.mjs";
import { mathCases } from "./hyperframes-audio-graph-oracle-math.mjs";
import { pcmCases } from "./hyperframes-audio-graph-oracle-pcm.mjs";
import { presetCases } from "./hyperframes-audio-graph-oracle-presets.mjs";
import { previewCases } from "./hyperframes-audio-graph-oracle-preview.mjs";
import { sha256 } from "./hyperframes-audio-graph-oracle-support.mjs";

const usage =
	"Usage: node hyperframes-audio-graph-oracle.mjs <existing-private-toolchain> [--engine-root=<already-extracted-engine-package>]";
const args = process.argv.slice(2);
const worker = args.includes("--worker");
const engineFlag = args.find((argument) =>
	argument.startsWith("--engine-root="),
);
const engineRoot = engineFlag?.slice("--engine-root=".length);
if (args.length === 1 && args[0] === "--help") {
	console.log(usage);
} else if (
	!args[0] ||
	args[0].startsWith("--") ||
	(engineFlag && !engineRoot) ||
	new Set(args).size !== args.length ||
	args
		.slice(1)
		.some((argument) => argument !== "--worker" && argument !== engineFlag)
) {
	console.error(usage);
	process.exitCode = 1;
} else if (!worker) {
	const child = spawnSync(
		process.execPath,
		[
			"--max-old-space-size=256",
			fileURLToPath(import.meta.url),
			resolve(args[0]),
			...(engineRoot ? [`--engine-root=${resolve(engineRoot)}`] : []),
			"--worker",
		],
		{
			timeout: 20000,
			maxBuffer: 1024 * 1024,
			encoding: "utf8",
			windowsHide: true,
		},
	);
	if (child.stdout) process.stdout.write(child.stdout);
	if (child.stderr) process.stderr.write(child.stderr);
	if (child.error)
		console.error(`Native oracle child failed: ${child.error.message}`);
	process.exitCode = child.status ?? 1;
} else {
	try {
		await run(resolve(args[0]), engineRoot ? resolve(engineRoot) : undefined);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}

async function run(toolchain, engineRoot) {
	const coreRoot = join(toolchain, "node_modules", "@hyperframes", "core");
	const strictText = async (path) => {
		const bytes = await readFile(path);
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	};
	const pkg = JSON.parse(await strictText(join(coreRoot, "package.json")));
	assert.equal(pkg.name, "@hyperframes/core");
	assert.equal(
		pkg.version,
		"0.8.139",
		"Do not silently update the native oracle pin",
	);
	const sources = {
		automation: "audioAutomation.js",
		fx: "audioFx.js",
		gain: "audioGain.js",
		fxAutomation: "audio/audioFxAutomation.js",
		graph: "audio/audioFxGraph.js",
		tail: "audio/audioFxTail.js",
		rate: "speedRamp.js",
		media: "runtime/media.js",
		envelope: "runtime/mediaVolumeEnvelope.js",
		runtime: "generated/runtime-inline.js",
		offline: "generated/audio-fx-runtime-inline.js",
	};
	const native = {};
	const sourceSha256 = {};
	for (const [name, path] of Object.entries(sources)) {
		const absolute = join(coreRoot, "dist", path);
		await strictText(absolute);
		sourceSha256[path] = sha256(await readFile(absolute));
		native[name] = await import(pathToFileURL(absolute).href);
	}
	const results = [];
	const check = (name, evidenceClass, test) => {
		try {
			results.push({ name, evidenceClass, status: "passed", evidence: test() });
		} catch (error) {
			throw new Error(`Native oracle case failed: ${name}`, { cause: error });
		}
	};
	const runtime = native.runtime.getHyperframeRuntimeScript();
	previewCases(native, runtime, check);
	mathCases(native, check);
	presetCases(native, check);
	fxCases(native, check);
	await pcmCases(native, check);
	const engine = engineRoot
		? await engineCases(engineRoot, native, check)
		: null;
	const offlineScript = native.offline.getAudioFxRuntimeScript();
	assert.ok(offlineScript.includes("OfflineAudioContext"));
	assert.ok(offlineScript.includes("__HF_AUDIO_FX"));
	console.log(
		JSON.stringify(
			{
				oracle: "hyperframes-audio-graph-native-node",
				version: 1,
				upstream: { name: pkg.name, version: pkg.version, sourceSha256 },
				engine: engine ?? {
					status: "not-executed",
					reason: "No --engine-root supplied",
				},
				deadlineMs: 20000,
				status: "passed-node-oracles-only",
				passed: results.length,
				results,
				notExecuted: [
					"Chromium OfflineAudioContext graph PCM, native AudioParam interpolation, biquad/IIR/convolution/waveshaper DSP",
					"Real browser bus routing, repeated compiled composition identities and native decoder behavior",
					"Variable-rate/pitch-preserving PCM and engine audioMixer.ts end-to-end exporter execution",
					"Rocut graph implementation parity and full-versus-partial browser graph PCM",
				],
				offlineEntry: {
					export: "getAudioFxRuntimeScript",
					sha256: sha256(offlineScript),
					status: "inspected-only-not-executed",
				},
			},
			null,
			2,
		),
	);
}
