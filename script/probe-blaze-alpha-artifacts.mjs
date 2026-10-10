import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { alphaContained, alphaHash } from "./probe-blaze-alpha-evidence.mjs";

const ordinary = [
	"A0-authored",
	"A1-put-get",
	"A2-copy-get",
	"A3-copy-again-get",
	"B0-identity-returned",
	"B1-identity-copy",
	"C0-black-authored",
	"C1-black-put-get",
	...[-32, -36, -40].flatMap((value) => [
		`C-${value}-analytic`,
		`C-${value}-returned`,
		`C-${value}-copy`,
	]),
];
const native = [
	"B0-identity-native-texture",
	...[-32, -36, -40].map((value) => `C-${value}-native-texture`),
];
export function validateAlphaStages(raw, complete = true) {
	assert.equal(raw?.version, 2);
	assert.equal(raw.kind, "independent-alpha-calibration-not-Blaze-acceptance");
	assert.equal(typeof raw.nativeReadback, "boolean");
	assert(
		raw.emptyStackRejection &&
			typeof raw.emptyStackRejection.attempted === "boolean" &&
			typeof raw.emptyStackRejection.rejected === "boolean" &&
			typeof raw.emptyStackRejection.matched === "boolean" &&
			typeof raw.emptyStackRejection.error === "string",
	);
	assert(Array.isArray(raw.stages));
	const planned = raw.nativeReadback ? [...ordinary, ...native] : ordinary;
	const ids = new Set();
	for (const stage of raw.stages) {
		assert(
			planned.includes(stage.id) && !ids.has(stage.id),
			"Unexpected/duplicate calibration stage",
		);
		assert.equal(stage.width, stage.id.startsWith("C") ? 16 : 256);
		assert.equal(stage.height, 16);
		assert(typeof stage.role === "string");
		if (stage.referenceId !== undefined)
			assert(
				ids.has(stage.referenceId),
				"Calibration reference not captured before actual",
			);
		const references = {
			"A1-put-get": "A0-authored",
			"A2-copy-get": "A1-put-get",
			"A3-copy-again-get": "A2-copy-get",
			"B0-identity-native-texture": "A1-put-get",
			"B0-identity-returned": raw.nativeReadback
				? "B0-identity-native-texture"
				: "A1-put-get",
			"B1-identity-copy": "B0-identity-returned",
			"C1-black-put-get": "C0-black-authored",
		};
		for (const contrast of [-32, -36, -40])
			Object.assign(references, {
				[`C-${contrast}-native-texture`]: `C-${contrast}-analytic`,
				[`C-${contrast}-returned`]: raw.nativeReadback
					? `C-${contrast}-native-texture`
					: `C-${contrast}-analytic`,
				[`C-${contrast}-copy`]: `C-${contrast}-returned`,
			});
		assert.equal(
			stage.referenceId,
			references[stage.id],
			"Calibration stage reference changed",
		);
		ids.add(stage.id);
	}
	if (complete) {
		assert.equal(ids.size, planned.length, "Incomplete calibration RAW stages");
		assert.deepEqual(
			raw.emptyStackRejection,
			{
				attempted: true,
				rejected: true,
				matched: true,
				error: "At least one effect pass is required",
			},
			"Empty-stack refusal was not independently checked",
		);
	}
}
export async function saveAlphaJson(directory, filename, value) {
	assert(/^[a-z][a-z0-9-]*\.json$/.test(filename));
	const path = join(directory, filename);
	alphaContained(directory, path);
	const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
	await writeFile(path, bytes, { flag: "wx" });
	return { filename, bytes: bytes.length, sha256: alphaHash(bytes) };
}
export async function alphaDeadline(promise, ms, label) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(Error(`${label} timed out`)), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
export async function captureAlpha(page, directory, report) {
	if (!page || page.isClosed()) return;
	const get = (key) =>
		alphaDeadline(
			page.evaluate((name) => Reflect.get(globalThis, name) ?? null, key),
			10000,
			`capture ${key}`,
		);
	try {
		report.checks = await get("__alphaResult");
		const progress = await get("__alphaProgress");
		if (report.checks)
			report.resultArtifact = await saveAlphaJson(
				directory,
				"browser-result.json",
				report.checks,
			);
		if (progress)
			await saveAlphaJson(directory, "browser-progress.json", progress);
		const raw = await get("__alphaRaw");
		if (!raw) return;
		validateAlphaStages(raw, false);
		const stages = [];
		for (const [index, { rgba, ...stage }] of raw.stages.entries()) {
			assert(typeof rgba === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(rgba));
			const bytes = Buffer.from(rgba, "base64"),
				filename = `stage-${index}.rgba`;
			assert.equal(bytes.length, stage.width * stage.height * 4);
			await writeFile(join(directory, filename), bytes, { flag: "wx" });
			stages.push({
				...stage,
				file: { filename, bytes: bytes.length, sha256: alphaHash(bytes) },
			});
		}
		report.raw = { ...raw, stages };
		await saveAlphaJson(directory, "raw-stages.json", report.raw);
		validateAlphaStages(raw);
		report.rawComplete = true;
	} catch (error) {
		report.captureErrors.push(String(error));
	}
}
