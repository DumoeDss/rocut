import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { blazeContained, blazeSha256 } from "./probe-blaze-evidence.mjs";
import { validateBlazeRaw } from "./probe-blaze-contract.mjs";

export async function saveBlazeJson(directory, filename, value) {
	const path = join(directory, filename);
	blazeContained(directory, path);
	const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
	await writeFile(path, bytes, { flag: "wx" });
	return { filename, bytes: bytes.length, sha256: blazeSha256(bytes) };
}
export async function blazeDeadline(promise, milliseconds, label) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(Error(`${label} timed out`)),
					milliseconds,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
export async function captureBlaze(page, directory, report) {
	if (!page || page.isClosed()) return;
	const read = (key) =>
		blazeDeadline(
			page.evaluate((name) => Reflect.get(globalThis, name) ?? null, key),
			15000,
			`Capture ${key}`,
		);
	try {
		report.checks = await read("__blazeResult");
		const progress = await read("__blazeProgress");
		if (report.checks)
			report.resultArtifact = await saveBlazeJson(
				directory,
				"browser-result.json",
				report.checks,
			);
		if (progress)
			report.progressArtifact = await saveBlazeJson(
				directory,
				"browser-progress.json",
				progress,
			);
	} catch (error) {
		report.captureErrors.push(`results: ${String(error)}`);
	}
	try {
		// Transfer bounded per-frame buffers, not a single >100 MiB CDP result.
		const raw = await blazeDeadline(
			page.evaluate(() => {
				const value = Reflect.get(globalThis, "__blazeFrames");
				if (!value) return null;
				return {
					...value,
					sources: value.sources.map(({ rgba, ...metadata }) => metadata),
					frames: value.frames.map(
						({ rgba, expectedRgba, ...metadata }) => metadata,
					),
					negatives: value.negatives.map(
						({ mutantRgba, referenceRgba, ...metadata }) => metadata,
					),
				};
			}),
			15000,
			"Capture Blaze RAW metadata",
		);
		if (!raw) return;
		validateBlazeRaw(raw, false);
		const buffers = (kind, index) =>
			blazeDeadline(
				page.evaluate(
					({ kind, index }) => {
						const item = Reflect.get(globalThis, "__blazeFrames")[kind][index];
						return kind === "sources"
							? { rgba: item.rgba }
							: kind === "frames"
								? { rgba: item.rgba, expectedRgba: item.expectedRgba }
								: {
										mutantRgba: item.mutantRgba,
										referenceRgba: item.referenceRgba,
									};
					},
					{ kind, index },
				),
				15000,
				`Capture Blaze ${kind} ${index}`,
			);
		const decode = (value, stride) => {
			assert(
				typeof value === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(value),
				"Invalid raw RGBA encoding",
			);
			const bytes = Buffer.from(value, "base64");
			assert.equal(bytes.length, stride);
			return bytes;
		};
		const save = async (name, bytes) => {
			await writeFile(join(directory, name), bytes, { flag: "wx" });
			return {
				filename: name,
				bytes: bytes.length,
				sha256: blazeSha256(bytes),
			};
		};
		const sources = [],
			frames = [],
			negatives = [];
		for (const [index, input] of raw.sources.entries()) {
			const { rgba } = await buffers("sources", index);
			sources.push({
				...input,
				file: await save(
					`source-${index}.rgba`,
					decode(rgba, input.width * input.height * 4),
				),
			});
		}
		for (const [index, frame] of raw.frames.entries()) {
			const { rgba, expectedRgba } = await buffers("frames", index);
			const input = raw.sources.find((input) => input.id === frame.sourceId),
				stride = input.width * input.height * 4;
			frames.push({
				...frame,
				actual: await save(`frame-${index}-native.rgba`, decode(rgba, stride)),
				expected: await save(
					`frame-${index}-expected.rgba`,
					decode(expectedRgba, stride),
				),
			});
		}
		for (const [index, negative] of raw.negatives.entries()) {
			const { mutantRgba, referenceRgba } = await buffers("negatives", index);
			const input = raw.sources.find((input) => input.id === negative.sourceId),
				stride = input.width * input.height * 4;
			negatives.push({
				...negative,
				mutant: await save(
					`negative-${index}-mutant.rgba`,
					decode(mutantRgba, stride),
				),
				reference: await save(
					`negative-${index}-reference.rgba`,
					decode(referenceRgba, stride),
				),
			});
		}
		report.rawFrames = {
			version: raw.version,
			kind: "raw-native-raster-not-an-encoded-video",
			reference: raw.reference,
			thresholds: raw.thresholds,
			sources,
			frames,
			negatives,
		};
		await saveBlazeJson(directory, "raw-frames.json", report.rawFrames);
		validateBlazeRaw(raw);
		report.rawComplete = true;
	} catch (error) {
		report.captureErrors.push(`rawFrames: ${String(error)}`);
	}
}
