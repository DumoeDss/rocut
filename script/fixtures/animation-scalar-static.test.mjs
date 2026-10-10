import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { bits, wireJson, key, channel, sampleItem, sampleReference, constantDifference } from "./animation-scalar-reference.mjs";
import { sampleCases, errorCases } from "./animation-scalar-cases.mjs";
import { inspectCases, smoothKeys } from "./animation-scalar-inspect-cases.mjs";
import { parseArguments, within } from "./animation-scalar-io.mjs";

test("f64 wire encoding preserves signed zero and finite extreme values", () => {
	const values = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, 2 ** -1022, .10000000000000002, Number.MAX_VALUE, -Number.MAX_VALUE];
	assert.deepEqual(JSON.parse(wireJson(values)).map(bits), values.map(bits));
	assert.equal(bits(-0), "8000000000000000");
	assert.equal(bits(Number.MIN_VALUE), "0000000000000001");
	assert.throws(() => wireJson(Infinity));
	assert.throws(() => wireJson(NaN));
});

test("reference covers endpoints, signed local times, step and directional extrapolation", () => {
	const keys = [key(0, 0), key(10, 1)];
	const item = sampleItem("linear", keys, [], { channel: channel(keys, "linear", "linear") });
	assert.deepEqual([-1.25, 0, 2.5, 7.5, 10, 12.5].map(time => sampleReference(item, time)), [-.125, 0, .25, .75, 1, 1.25]);
	const step = sampleItem("step", [key(0, .25, "step"), key(10, .75)], []);
	assert.equal(sampleReference(step, 9.999), .25);
	assert.equal(sampleReference(step, 10), .75);
	assert.equal(sampleReference(step, -Number.MAX_VALUE), .25);
	assert.equal(bits(sampleReference(sampleItem("zero", [key(3, -0)]), -1.25)), bits(-0));
});

test("large safe key ticks preserve representable integer locations without frame quantization", () => {
	const start = Number.MAX_SAFE_INTEGER - 20;
	const item = sampleItem("large", [key(start, 0), key(start + 20, 1)], []);
	assert.equal(sampleReference(item, start + 5), .25);
	assert.equal(sampleReference(item, start + 15), .75);
	assert.equal(sampleReference(item, Number.MAX_SAFE_INTEGER), 1);
});

test("Bezier uses twenty iterations, clamps handle dt, and v1 constant behavior is explicit", () => {
	const item = sampleItem("smooth", smoothKeys(), []);
	const center = sampleReference(item, 60000);
	assert(center < .5 && center > .499999);
	const keys = [key(0, .2, "bezier", { rightHandle: { dt: 50, dv: .7 } }),
		key(20, .8, "linear", { leftHandle: { dt: -50, dv: -.4 } })];
	const clipped = structuredClone(keys); clipped[0].rightHandle.dt = 20; clipped[1].leftHandle.dt = -20;
	for (const time of [.25, 1.5, 9.25, 19.75]) assert.equal(
		bits(sampleReference(sampleItem("raw", keys), time)), bits(sampleReference(sampleItem("clipped", clipped), time)));
	const difference = constantDifference();
	assert(difference.legacyError || difference.canonicalBits !== difference.legacyBits);
	assert.equal(difference.canonicalBits, bits(difference.item.channel.keys[0].value));
});

test("nonfinite arithmetic is not clamped or silently replaced by fallback", () => {
	const item = sampleItem("overflow", [key(0, -Number.MAX_VALUE), key(10, Number.MAX_VALUE)], []);
	assert.equal(sampleReference(item, 0), -Number.MAX_VALUE);
	assert.throws(() => sampleReference(item, 5), error => error.code === "non-finite-arithmetic" && error.keyIndex === 0);
	assert.equal(sampleReference(item, 10), Number.MAX_VALUE);
});

test("sample corpus independent expected values are finite and includes exact count limits", () => {
	const specs = sampleCases(); let total = 0;
	for (const spec of specs) {
		const input = JSON.parse(spec.input);
		for (const item of input.items) for (const time of item.times) {
			assert(Number.isFinite(sampleReference(item, time))); total++;
		}
	}
	assert(total > 65536);
	const limits = JSON.parse(specs.find(spec => spec.name === "exact-item-and-request-sample-limits").input);
	assert.equal(limits.items.reduce((sum, item) => sum + item.times.length, 0), 65536);
	assert.equal(limits.items[0].times.length, 4096);
});

test("invalid wire fixtures retain decimal tokens, parser limits, and per-item isolation", () => {
	const errors = errorCases();
	assert(errors.some(spec => spec.input.includes('"time":10.00000000000000001')));
	assert(errors.some(spec => spec.input.includes('"version":1.0')));
	assert.equal(Buffer.byteLength(errors.find(spec => spec.name === "input-limit").input), 8 * 1024 * 1024 + 1);
	assert.equal(errors.find(spec => spec.name === "item-atomic-overflow-and-isolation").expected.items[0].sampleIndex, 1);
});

test("inspection corpus covers three states and cumulative rather than declared node budgets", () => {
	const specs = inspectCases();
	assert.deepEqual(specs.find(spec => spec.name === "inspect-three-states").expected.items.map(item => item.status), ["safe", "violation", "unresolved"]);
	const budget = specs.find(spec => spec.name === "inspect-request-actual-budget");
	assert.equal(budget.expected.visitedNodes, 8);
	assert.deepEqual(budget.expected.items.map(item => item.visitedNodes), [0, 8, 0]);
	assert.equal(specs.find(spec => spec.name === "inspect-near-boundary-unresolved").expected.items[0].visitedNodes, 4096);
	const all = [...sampleCases(), ...errorCases(), ...specs];
	assert.equal(new Set(all.map(spec => spec.name)).size, all.length);
});

test("runner paths are explicit and reject conflicting package entry selection", () => {
	const args = ["--pkg", "C:/tmps/private/pkg", "--out", "C:/tmps", "--source-root", "C:/tmps/private/source"];
	const parsed = parseArguments(args);
	assert(parsed.jsPath.endsWith("opencut_wasm_bg.js"));
	assert.throws(() => parseArguments([...args, "--wasm-js", "C:/tmps/private/entry.js"]));
	assert.throws(() => parseArguments(args.slice(0, 4)));
	assert.throws(() => parseArguments([...args, "--mock", "C:/tmps/mock"]));
	assert(within("C:/tmps", "C:/tmps/private/pkg"));
	assert(!within("C:/tmps", "C:/outside/pkg"));
});

test("static fixture source is valid UTF-8, and importing the runner does not instantiate WASM", async () => {
	const directory = dirname(fileURLToPath(import.meta.url));
	for (const name of ["reference", "cases", "inspect-cases", "checks", "io", "roundtrip", "static.test"]) {
		const bytes = await readFile(join(directory, `animation-scalar-${name}.mjs`));
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		assert(!text.includes("\ufffd")); assert(!bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])));
	}
	const runner = await import("./animation-scalar-roundtrip.mjs");
	assert.equal(typeof runner.runRoundtrip, "function");
});
