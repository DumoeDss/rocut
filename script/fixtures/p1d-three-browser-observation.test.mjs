import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { p1dRawSamples, preserveP1dCapture, withP1dCleanup } from "./p1d-three-browser-observation.mjs";
import { checkP1dPixels } from "./p1d-three-browser-oracle.mjs";

const png = Buffer.from("synthetic capture bytes; tests inject a decoder, not a browser");
const image = { width: 64, height: 64, pixels: Buffer.alloc(16384) };
const context = () => ({ id: "legal-feature", kind: "http", frame: { index: 45, time: .75 }, passed: false });
async function fixture(operation) {
	const directory = await mkdtemp(join(tmpdir(), "p1d-observation-cpu-"));
	try { return await operation(directory, (name, bytes) => writeFile(join(directory, name), bytes, { flag: "wx" })); }
	finally { assert.equal(await realpath(directory), directory); await rm(directory, { recursive: true }); }
}
test("PNG and raw samples exist before the failing independent oracle; evidence remains failed", () => fixture(async (directory, write) => {
	const attempt = context(), evidence = { passed: false, attempts: [attempt] };
	const colorMismatch = { ...image, pixels: Buffer.from(image.pixels) };
	colorMismatch.pixels.set([230, 110, 90, 255], (32 * 64 + 32) * 4);
	colorMismatch.pixels.set([230, 110, 90, 255], (32 * 64 + 50) * 4);
	// Deliberately wrong synthetic color; neither expected values nor bytes come from a screenshot.
	colorMismatch.pixels.set([0, 0, 255, 255], (16 * 64 + 16) * 4);
	let originalError, cleaned = false;
	await assert.rejects(withP1dCleanup(async () => {
		await preserveP1dCapture({ png, name: "failed", write, decode: () => colorMismatch, attempt, validate: async decoded => {
			assert.deepEqual(await readFile(join(directory, "failed.png")), png);
			const raw = JSON.parse(await readFile(join(directory, "failed.samples.json"), "utf8"));
			assert.deepEqual(raw.samples, p1dRawSamples(colorMismatch).samples);
			try { checkP1dPixels(decoded, .75, { svg: true, lit: true }); } catch (error) { originalError = error; throw error; }
		} }); evidence.passed = true;
	}, () => { cleaned = true; }, () => {}), error => error === originalError);
	assert.equal(cleaned, true); assert.equal(evidence.passed, false); assert.equal(attempt.passed, false);
	assert.equal(attempt.stage, "assertions"); assert.match(attempt.error, /Known independent green SVG interior/);
}));
test("successful capture persists exact bytes and raw observation before validation", () => fixture(async (directory, write) => {
	const attempt = context(), observed = { result: { value: [{ position: [.375, 0, 0] }] } };
	const result = await preserveP1dCapture({ png, name: "success", write, decode: () => image, attempt,
		observe: async () => { assert.deepEqual(await readFile(join(directory, "success.png")), png); return observed; },
		validate: async (decoded, value) => {
			assert.equal(decoded, image); assert.equal(value, observed);
			assert.deepEqual(JSON.parse(await readFile(join(directory, "success.observation.json"), "utf8")).observed, observed);
			return "checked";
		} });
	assert.equal(result, "checked"); assert.equal(attempt.passed, true); assert.equal(attempt.stage, "complete");
}));
for (const stage of ["pose-assertions", "pixel-assertions", "parity-assertions"]) {
	test(`${stage} failure retains direct PNG, raw samples and pose observation`, () => fixture(async (directory, write) => {
		const attempt = context(), original = Error(stage), observed = { result: { value: [{ position: [0, 0, 0] }] } };
		await assert.rejects(preserveP1dCapture({ png, name: "direct", write, decode: () => image, attempt, observe: () => observed,
			validate: () => { attempt.stage = stage; throw original; } }), error => error === original);
		assert.deepEqual(await readFile(join(directory, "direct.png")), png);
		assert.equal(JSON.parse(await readFile(join(directory, "direct.samples.json"), "utf8")).samples.length, 5);
		assert.deepEqual(JSON.parse(await readFile(join(directory, "direct.observation.json"), "utf8")).observed, observed);
		assert.equal(attempt.stage, stage); assert.equal(attempt.passed, false);
	}));
}
test("decode failure still preserves raw PNG and reports its stage", () => fixture(async (directory, write) => {
	const attempt = context(), original = Error("decode failed");
	await assert.rejects(preserveP1dCapture({ png, name: "decode", write, decode: () => { throw original; }, attempt,
		validate: () => assert.fail("must not validate") }), error => error === original);
	assert.deepEqual(await readFile(join(directory, "decode.png")), png);
	assert.equal(attempt.stage, "png-decode"); assert.equal(attempt.passed, false);
}));
test("wx never overwrites prior failure bytes or promotes an EEXIST capture", () => fixture(async (directory, write) => {
	const old = Buffer.from("prior immutable failure"), attempt = context();
	await write("old.png", old);
	await assert.rejects(preserveP1dCapture({ png, name: "old", write, decode: () => assert.fail("must not decode"), attempt,
		validate: () => assert.fail("must not validate") }), { code: "EEXIST" });
	assert.deepEqual(await readFile(join(directory, "old.png")), old);
	assert.equal(attempt.stage, "png-save"); assert.equal(attempt.passed, false); assert.equal(attempt.png, undefined);
}));
test("sample storage failure cannot publish success and cleanup runs without masking it", async () => {
	const attempt = context(), original = Error("storage failed"), cleanupErrors = [];
	let cleaned = false, writes = 0;
	await assert.rejects(withP1dCleanup(() => preserveP1dCapture({ png, name: "storage", attempt, decode: () => image,
		write: () => { if (++writes === 2) throw original; }, validate: () => assert.fail("must not validate") }),
		() => { cleaned = true; throw Error("cleanup failed"); }, error => cleanupErrors.push(error)), error => error === original);
	assert.equal(attempt.passed, false); assert.equal(attempt.stage, "raw-samples-save"); assert.equal(cleaned, true);
	assert.equal(cleanupErrors.length, 1); assert.match(cleanupErrors[0], /cleanup failed/);
});
test("cleanup failure after otherwise successful operation still fails", async () => {
	const cleanupErrors = [], original = Error("close failed");
	await assert.rejects(withP1dCleanup(() => "done", () => { throw original; }, error => cleanupErrors.push(error)), error => error === original);
	assert.equal(cleanupErrors.length, 1);
});
