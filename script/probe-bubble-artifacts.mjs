import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bubbleContained, bubbleHash } from "./probe-bubble-evidence.mjs";

export async function bubbleSaveJson(directory, filename, value) {
	assert(/^[a-z][a-z0-9-]*\.json$/.test(filename));
	const path = join(directory, filename);
	bubbleContained(directory, path);
	const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
	await writeFile(path, bytes, { flag: "wx" });
	return { filename, bytes: bytes.length, sha256: bubbleHash(bytes) };
}
export async function bubbleDeadline(promise, milliseconds, label) {
	let timer;
	try {
		return await Promise.race([promise, new Promise((_, reject) => {
			timer = setTimeout(() => reject(Error(`${label} timed out`)), milliseconds);
		})]);
	} finally { clearTimeout(timer); }
}
const sourceBuffers = ["authoredRgba", "rgba"];
const frameBuffers = ["nativeRgba", "canvasRgba", "expectedRgba"];
const negativeBuffers = ["mutantRgba", "referenceRgba"];

export function validateBubbleRaw(raw, plan, complete = true) {
	assert.equal(raw?.version, 1);
	assert.equal(raw.kind, "bubble-raster-native-and-presentation-separate");
	assert.equal(typeof raw.diagnostic, "boolean");
	assert(Array.isArray(raw.sources) && Array.isArray(raw.frames) && Array.isArray(raw.negatives));
	assert(raw.frames.length <= plan.length, "Unexpected Bubble frame count");
	const caseIds = new Map(plan.map((sample) => [sample.id, sample]));
	assert.equal(caseIds.size, plan.length, "Duplicate Bubble planned case IDs");
	const sources = new Map();
	for (const source of raw.sources) {
		assert(typeof source.id === "string" && !sources.has(source.id), "Duplicate/missing Bubble source");
		assert(Number.isInteger(source.width) && source.width > 0 && source.width <= 8192);
		assert(Number.isInteger(source.height) && source.height > 0 && source.height <= 8192);
		assert(source.width * source.height <= 8388608);
		sources.set(source.id, source);
	}
	assert(sources.size <= plan.length, "Too many Bubble sources");
	const ids = new Set();
	for (const frame of raw.frames) {
		const sample = caseIds.get(frame.id), source = sources.get(frame.sourceId);
		assert(sample && !ids.has(frame.id), "Unexpected/duplicate Bubble frame ID");
		assert(source && source.width === sample.width && source.height === sample.height, "Bubble source dimensions changed");
		assert.deepEqual(frame.sample, sample, `Bubble case changed: ${frame.id}`);
		assert(["fixture-disabled-bypass", "resolver-empty-pass", "applyEffectPasses", "applyEffectPassesReadback"].includes(frame.renderPath));
		if (frame.renderPath === "fixture-disabled-bypass") assert.equal(sample.enabled, false);
		if (frame.renderPath === "resolver-empty-pass") assert.deepEqual(frame.resolved?.passes, []);
		const pipeline = frame.renderPath.startsWith("applyEffectPasses");
		assert.equal(frame.nativeCaptured, raw.diagnostic && pipeline);
		if (pipeline) assert.equal(frame.renderPath, raw.diagnostic ? "applyEffectPassesReadback" : "applyEffectPasses");
		ids.add(frame.id);
	}
	const negativeIds = new Set();
	for (const negative of raw.negatives) {
		assert(typeof negative.id === "string" && !negativeIds.has(negative.id));
		assert(caseIds.has(negative.caseId) && sources.has(negative.sourceId));
		negativeIds.add(negative.id);
	}
	if (raw.pendingFrame) {
		assert(caseIds.has(raw.pendingFrame.id) && !ids.has(raw.pendingFrame.id));
		assert(sources.has(raw.pendingFrame.sourceId));
		assert.deepEqual(raw.pendingFrame.sample, caseIds.get(raw.pendingFrame.id));
	}
	if (complete) {
		assert.deepEqual([...ids], plan.map((sample) => sample.id), "Incomplete/out-of-order Bubble capture");
		assert(!raw.pendingFrame, "Incomplete Bubble render attempt");
	}
	return raw;
}

export async function captureBubble(page, directory, report, plan) {
	if (!page || page.isClosed()) return;
	const read = (key) => bubbleDeadline(page.evaluate((key) => Reflect.get(globalThis, key) ?? null, key), 15000, `Capture ${key}`);
	try {
		report.checks = await read("__bubbleResult");
		const progress = await read("__bubbleProgress");
		if (report.checks) await bubbleSaveJson(directory, "browser-result.json", report.checks);
		if (progress) await bubbleSaveJson(directory, "browser-progress.json", progress);
	} catch (error) { report.captureErrors.push(`results: ${String(error)}`); }
	try {
		// Metadata first, followed by one bounded frame at a time. Partial failures
		// still retain every completed input/reference/native/presentation buffer.
		const raw = await bubbleDeadline(page.evaluate(() => {
			const raw = Reflect.get(globalThis, "__bubbleRaw");
			if (!raw) return null;
			const omit = (item, keys) => Object.fromEntries(Object.entries(item).filter(([key]) => !keys.includes(key)));
			return { ...raw,
				sources: raw.sources.map((item) => omit(item, ["authoredRgba", "rgba"])),
				frames: raw.frames.map((item) => omit(item, ["nativeRgba", "canvasRgba", "expectedRgba"])),
				negatives: raw.negatives.map((item) => omit(item, ["mutantRgba", "referenceRgba"])),
				pendingFrame: raw.pendingFrame ? omit(raw.pendingFrame, ["expectedRgba"]) : null,
			};
		}), 15000, "Capture Bubble RAW metadata");
		if (!raw) return;
		validateBubbleRaw(raw, plan, false);
		const retained = { ...raw, sources: [], frames: [], negatives: [] };
		if (raw.pendingFrame) {
			const encoded = await bubbleDeadline(page.evaluate(() => Reflect.get(globalThis, "__bubbleRaw").pendingFrame.expectedRgba), 15000, "Capture pending Bubble expected frame");
			assert(typeof encoded === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded));
			const bytes = Buffer.from(encoded, "base64"), source = raw.sources.find((source) => source.id === raw.pendingFrame.sourceId);
			assert.equal(bytes.length, source.width * source.height * 4);
			const filename = "pending-frame-expected.rgba";
			await writeFile(join(directory, filename), bytes, { flag: "wx" });
			retained.pendingFrame = { ...raw.pendingFrame, expected: { filename, bytes: bytes.length, sha256: bubbleHash(bytes) } };
		}
		for (const [kind, keys] of [["sources", sourceBuffers], ["frames", frameBuffers], ["negatives", negativeBuffers]]) {
			for (const [index, metadata] of raw[kind].entries()) {
				const buffers = await bubbleDeadline(page.evaluate(({ kind, index, keys }) => {
					const item = Reflect.get(globalThis, "__bubbleRaw")[kind][index];
					return Object.fromEntries(keys.map((key) => [key, item[key] ?? null]));
				}, { kind, index, keys }), 30000, `Capture Bubble ${kind} ${index}`);
				const source = kind === "sources" ? metadata : raw.sources.find((source) => source.id === metadata.sourceId);
				const size = source.width * source.height * 4, files = {};
				for (const key of keys) {
					const value = buffers[key];
					if (key === "nativeRgba" && !metadata.nativeCaptured) {
						assert.equal(value, null, "Bypass/default mislabeled as native pixels");
						files[key] = null;
						continue;
					}
					assert(typeof value === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(value), `Missing/invalid ${kind} ${key}`);
					const bytes = Buffer.from(value, "base64");
					assert.equal(bytes.length, size, `Invalid ${kind} ${key} length`);
					assert.equal(bytes.toString("base64"), value, "Noncanonical RGBA encoding");
					const filename = `${kind}-${index}-${key}.rgba`;
					await writeFile(join(directory, filename), bytes, { flag: "wx" });
					files[key] = { filename, bytes: bytes.length, sha256: bubbleHash(bytes) };
				}
				retained[kind].push({ ...metadata, files });
			}
		}
		report.raw = retained;
		await bubbleSaveJson(directory, "raw-frames.json", retained);
		validateBubbleRaw(raw, plan);
		report.rawComplete = true;
	} catch (error) { report.captureErrors.push(`raw: ${String(error)}`); }
}

export function compareBubblePackages(ordinary, diagnostic) {
	const failures = [], pairs = [];
	const check = (condition, message) => { if (!condition) failures.push(message); };
	check(ordinary?.diagnostic === false && diagnostic?.diagnostic === true, "Package mode mismatch");
	check(ordinary?.rawComplete === true && diagnostic?.rawComplete === true, "Both complete captures required");
	const left = ordinary?.raw, right = diagnostic?.raw;
	check(Boolean(left && right), "Missing paired RAW captures");
	if (left && right) {
		check(left.sources.length === right.sources.length && left.frames.length === right.frames.length, "Paired matrix length mismatch");
		for (const input of left.sources) {
			const match = right.sources.find((item) => item.id === input.id);
			check(match?.files.rgba.sha256 === input.files.rgba.sha256, `Canonical source changed across packages: ${input.id}`);
			check(match?.files.authoredRgba.sha256 === input.files.authoredRgba.sha256, `Authored source changed across packages: ${input.id}`);
		}
		for (const frame of left.frames) {
			const match = right.frames.find((item) => item.id === frame.id);
			const sameCanvas = match?.files.canvasRgba.sha256 === frame.files.canvasRgba.sha256;
			const sameExpected = match?.files.expectedRgba.sha256 === frame.files.expectedRgba.sha256;
			check(sameCanvas, `Default/diagnostic Canvas bytes differ: ${frame.id}`);
			check(sameExpected, `Independent expected bytes differ: ${frame.id}`);
			pairs.push({ id: frame.id, sameCanvas, sameExpected, diagnosticNativeCaptured: match?.nativeCaptured === true });
		}
	}
	return { ok: !failures.length, failures, pairs,
		scope: "Default-vs-diagnostic Canvas byte equivalence only. Native oracle acceptance is a separate diagnostic measurement; Canvas metrics never replace its gates." };
}
