import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

const channels = {
	constantBoundaryBezier: {
		keys: [
			{ id: "k0", time: 0, value: 1, segmentToNext: "bezier", tangentMode: "flat", rightHandle: { dt: 40000, dv: 0 } },
			{ id: "k1", time: 120000, value: 1, segmentToNext: "linear", tangentMode: "flat", leftHandle: { dt: -40000, dv: 0 } },
		],
	},
	rampLinear: {
		keys: [
			{ id: "k0", time: 0, value: 0, segmentToNext: "linear", tangentMode: "flat" },
			{ id: "k1", time: 120000, value: 1, segmentToNext: "linear", tangentMode: "flat" },
		],
	},
	easedBezier: {
		keys: [
			{ id: "k0", time: 0, value: 0, segmentToNext: "bezier", tangentMode: "flat", rightHandle: { dt: 40000, dv: 0 } },
			{ id: "k1", time: 120000, value: 1, segmentToNext: "linear", tangentMode: "flat", leftHandle: { dt: -40000, dv: 0 } },
		],
	},
	holdStep: {
		keys: [
			{ id: "k0", time: 0, value: 0.25, segmentToNext: "step", tangentMode: "flat" },
			{ id: "k1", time: 120000, value: 0.75, segmentToNext: "linear", tangentMode: "flat" },
		],
	},
	extrapolatingEdges: {
		keys: [
			{ id: "k0", time: 20000, value: 0, segmentToNext: "linear", tangentMode: "flat" },
			{ id: "k1", time: 100000, value: 1, segmentToNext: "linear", tangentMode: "flat" },
		],
		extrapolation: { before: "linear", after: "linear" },
	},
};

const caseMatrix = Object.entries(channels).map(([id, channel], index) => ({
	id,
	channel,
	fallbackValue: 0.5 + index * 0.01,
	times: [0, 102500, 120000, 130000].concat(
		Array.from({ length: 12 }, (_, i) => 10000 + i * 9000),
	),
}));

const root = await mkdtemp(join(tmpdir(), "scalar-runtime-parity-"));
const harnessDir = join(root, "harness");
await mkdir(harnessDir, { recursive: true });

const harness = [
	'const EDITOR_SRC = ' + JSON.stringify(pathToFileURL(join(repoRoot, "packages/editor-classic/src/")).href) + ';',
	'const interpolation = await import(EDITOR_SRC + "animation/interpolation.ts");',
	'const getScalarChannelValueAtTime = interpolation.getScalarChannelValueAtTime;',
	'import { readFile, writeFile } from "node:fs/promises";',
	'const input = JSON.parse(await readFile(new URL("./input.json", import.meta.url), "utf8"));',
	'const out = input.items.map(({ channel, fallbackValue, times }) =>',
	'	times.map((time) => getScalarChannelValueAtTime({ channel, time, fallbackValue })),',
	");",
	'await writeFile(new URL("./output.json", import.meta.url), JSON.stringify(out));',
].join("\n");
await writeFile(join(harnessDir, "harness.mjs"), harness, "utf8");
await writeFile(join(harnessDir, "input.json"), JSON.stringify({ items: caseMatrix }), "utf8");
await writeFile(
	join(harnessDir, "package.json"),
	JSON.stringify(
		{
			name: "scalar-runtime-parity-harness",
			private: true,
			dependencies: {},
			imports: {
				"opencut-editor-src/": pathToFileURL(
					join(repoRoot, "packages/editor-classic/src/"),
				).href,
			},
		},
		null,
		"\t",
	),
	"utf8",
);

const bunRun = spawnSync("bun", ["harness.mjs"], { cwd: harnessDir, encoding: "utf8" });
if (bunRun.status !== 0) {
	console.error(bunRun.stdout, bunRun.stderr);
	throw new Error("TS harness failed");
}
const tsValues = JSON.parse(await readFile(join(harnessDir, "output.json"), "utf8"));

const wasm = await import(
	pathToFileURL(join(repoRoot, "node_modules/opencut-wasm/opencut_wasm.js")).href
);
const transportInput = JSON.stringify({
	version: 1,
	numericSemantics: "scalar-f64-v1",
	items: caseMatrix.map(({ id, channel, fallbackValue, times }) => ({
		id,
		channel: {
			keys: channel.keys.map(({ time, value, segmentToNext, leftHandle, rightHandle }) => {
				const key = { time, value, segmentToNext };
				if (leftHandle) key.leftHandle = leftHandle;
				if (rightHandle) key.rightHandle = rightHandle;
				return key;
			}),
			extrapolation: channel.extrapolation || { before: "hold", after: "hold" },
		},
		fallbackValue,
		times,
	})),
});
const wasmResponse = JSON.parse(wasm.sampleScalarAnimationBatchJson(transportInput));
if (wasmResponse.error) throw new Error(JSON.stringify(wasmResponse.error));
const wasmValues = wasmResponse.results.map((result) => {
	if (result.status !== "values") throw new Error(JSON.stringify(result));
	return result.values;
});

const cases = caseMatrix.map((item, index) => {
	const tsRow = tsValues[index];
	const wasmRow = wasmValues[index];
	const diffs = item.times.map((time, t) => ({
		time,
		ts: tsRow[t],
		wasm: wasmRow[t],
		delta: Math.abs(tsRow[t] - wasmRow[t]),
	}));
	const maxDelta = diffs.reduce((acc, d) => Math.max(acc, d.delta), 0);
	return {
		id: item.id,
		samples: item.times.length,
		maxDelta,
		overshootSampleCount: diffs.filter((d) => d.delta > 0).length,
		overshoot: diffs.filter((d) => d.delta > 0).slice(0, 5),
	};
});

const evidence = {
	ok: true,
	root,
	recordedAt: new Date().toISOString(),
	scope:
		"Differential runtime parity probe: production TS scalar evaluator vs installed opencut-wasm scalar-f64-v1 batch sampling; CPU only",
	harness: {
		file: join(harnessDir, "harness.mjs"),
		sha256: sha256(await readFile(join(harnessDir, "harness.mjs"))),
		inputSha256: sha256(await readFile(join(harnessDir, "input.json"))),
	},
	wasmInputSha256: sha256(Buffer.from(transportInput, "utf8")),
	cases,
	summary: {
		totalCases: cases.length,
		totalSamples: cases.reduce((acc, c) => acc + c.samples, 0),
		casesWithAnyDelta: cases.filter((c) => c.overshootSampleCount > 0).length,
	},
};
await writeFile(join(root, "evidence.json"), JSON.stringify(evidence, null, "  "));
console.log(JSON.stringify(evidence, null, "  "));
