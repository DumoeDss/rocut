import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { blazeSha256 } from "./probe-blaze-evidence.mjs";
import { blazeDeadline, saveBlazeJson } from "./probe-blaze-artifacts.mjs";
import { validateBlazePipelineMedia } from "./probe-blaze-pipeline-contract.mjs";
import { blazePipelinePng } from "./probe-blaze-pipeline-png.mjs";

export function decodeBlazePipelineBytes(value, length) {
	assert(typeof value === "string" && value.length < 128 * 1024 * 1024);
	const bytes = Buffer.from(value, "base64");
	assert(
		bytes.length > 0 && bytes.toString("base64") === value,
		"Malformed Blaze base64",
	);
	if (length !== undefined) assert.equal(bytes.length, length);
	return bytes;
}
async function save(directory, filename, bytes) {
	await writeFile(join(directory, filename), bytes, { flag: "wx" });
	return { filename, bytes: bytes.length, sha256: blazeSha256(bytes) };
}
async function rgba(directory, name, bytes, width = 192, height = 128) {
	return {
		raw: await save(directory, `${name}.rgba`, bytes),
		png: await save(
			directory,
			`${name}.png`,
			blazePipelinePng(bytes, width, height),
		),
	};
}

export async function saveBlazePipelineMedia(directory, value) {
	validateBlazePipelineMedia(value);
	const stride = value.width * value.height * 4;
	const payloads = {
		video: decodeBlazePipelineBytes(value.video),
		expected: decodeBlazePipelineBytes(value.expected, stride * 6),
		baseline: decodeBlazePipelineBytes(value.baseline, stride),
		source: decodeBlazePipelineBytes(value.source, stride),
	};
	for (const data of [payloads.expected, payloads.baseline])
		for (let offset = 3; offset < data.length; offset += 4)
			assert.equal(
				data[offset],
				255,
				"Blaze reference is not composited over black",
			);
	const files = {};
	for (const [key, bytes] of Object.entries(payloads))
		files[key] = await save(
			directory,
			key === "video" ? "production.webm" : `${key}.rgba`,
			bytes,
		);
	const expectedPngs = [];
	for (let index = 0; index < 6; index++)
		expectedPngs.push(
			await save(
				directory,
				`expected-${index}.png`,
				blazePipelinePng(
					payloads.expected.subarray(index * stride, (index + 1) * stride),
					value.width,
					value.height,
				),
			),
		);
	const baselinePng = await save(
		directory,
		"baseline.png",
		blazePipelinePng(payloads.baseline, value.width, value.height),
	);
	const sourcePng = await save(
		directory,
		"source.png",
		blazePipelinePng(payloads.source, value.width, value.height),
	);
	const counterfactuals = {
		baseline: await save(
			directory,
			"predecode-counterfactual-baseline.rgba",
			Buffer.concat(Array.from({ length: 6 }, () => payloads.baseline)),
		),
		repeatedFirst: await save(
			directory,
			"predecode-counterfactual-first.rgba",
			Buffer.concat(
				Array.from({ length: 6 }, () => payloads.expected.subarray(0, stride)),
			),
		),
	};
	const declaration = Object.fromEntries(
		Object.entries(value).filter(
			([key]) => !["video", "expected", "baseline", "source"].includes(key),
		),
	);
	const metadata = {
		...declaration,
		kind: "blaze-production-vp9-webm",
		independentDecodeVerified: false,
		files,
		expectedPngs,
		baselinePng,
		sourcePng,
		counterfactuals,
	};
	return {
		...metadata,
		manifest: await saveBlazeJson(directory, "media.json", metadata),
	};
}

export async function captureBlazePipeline(page, directory, report) {
	if (!page || page.isClosed()) return;
	const read = (key) =>
		blazeDeadline(
			page.evaluate((name) => Reflect.get(globalThis, name) ?? null, key),
			15000,
			`Capture ${key}`,
		);
	for (const [key, filename] of [
		["__blazePipeline", "browser-result.json"],
		["__blazePipelineDiagnostics", "diagnostics.json"],
	])
		try {
			const value = await read(key);
			if (key === "__blazePipeline") report.checks = value;
			if (value) await saveBlazeJson(directory, filename, value);
		} catch (error) {
			report.captureErrors.push(`${key}: ${String(error)}`);
		}
	try {
		const captures = await read("__blazePipelineCaptures");
		if (captures) {
			assert(Array.isArray(captures) && captures.length <= 28);
			const saved = [];
			for (const [index, capture] of captures.entries()) {
				assert.equal(capture.width, 192);
				assert.equal(capture.height, 128);
				const { source, actual, expected, baseline, ...metadata } = capture;
				const files = {};
				for (const [kind, value] of Object.entries({
					source,
					actual,
					expected,
					baseline,
				}))
					files[kind] = await rgba(
						directory,
						`capture-${index}-${kind}`,
						decodeBlazePipelineBytes(value, 192 * 128 * 4),
					);
				saved.push({ ...metadata, files });
			}
			report.captureFrames = await saveBlazeJson(directory, "captures.json", {
				frames: saved,
			});
		}
	} catch (error) {
		report.captureErrors.push(`captures: ${String(error)}`);
	}
	try {
		const media = await read("__blazePipelineMedia");
		if (media)
			report.pipelineMedia = await saveBlazePipelineMedia(directory, media);
	} catch (error) {
		report.captureErrors.push(`media: ${String(error)}`);
	}
	try {
		const decoded = await read("__blazePipelineDecoded");
		if (decoded) {
			const { rgba: encoded, ...metadata } = decoded;
			const files = [];
			if (encoded) {
				assert(
					Number.isSafeInteger(decoded.frames) &&
						decoded.frames > 0 &&
						decoded.frames <= 6,
				);
				const bytes = decodeBlazePipelineBytes(
					encoded,
					decoded.frames * 192 * 128 * 4,
				);
				for (let index = 0; index < decoded.frames; index++)
					files.push(
						await rgba(
							directory,
							`browser-decoded-${index}`,
							bytes.subarray(
								index * 192 * 128 * 4,
								(index + 1) * 192 * 128 * 4,
							),
						),
					);
			}
			report.browserDecode = await saveBlazeJson(
				directory,
				"browser-decode.json",
				{ ...metadata, files },
			);
		}
	} catch (error) {
		report.captureErrors.push(`decoded: ${String(error)}`);
	}
}
