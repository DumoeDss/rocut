import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cloudsSha256 } from "./probe-clouds-evidence.mjs";
import { cloudsDeadline, saveCloudsJson } from "./probe-clouds-artifacts.mjs";
import { validateCloudsMedia } from "./probe-clouds-contract.mjs";

function decode(value, length) {
	assert(
		typeof value === "string" && value.length < 128 * 1024 * 1024,
		"Invalid Clouds base64 size",
	);
	const bytes = Buffer.from(value, "base64");
	assert(
		bytes.length > 0 && bytes.toString("base64") === value,
		"Invalid Clouds canonical base64",
	);
	if (length !== undefined)
		assert.equal(bytes.length, length, "Wrong Clouds pixel byte length");
	return bytes;
}
export async function saveCloudsPipeline(directory, value) {
	validateCloudsMedia(value);
	const stride = value.width * value.height * 4;
	const expected = decode(value.expected, stride * value.frames),
		baseline = decode(value.baseline, stride),
		video = decode(value.video);
	for (const pixels of [expected, baseline])
		for (let offset = 3; offset < pixels.length; offset += 4)
			assert.equal(
				pixels[offset],
				255,
				"Clouds references are not already composited over opaque black",
			);
	const files = {};
	for (const [kind, filename, bytes] of [
		["video", "production.webm", video],
		["expected", "expected.rgba", expected],
		["baseline", "baseline.rgba", baseline],
	]) {
		await writeFile(join(directory, filename), bytes, { flag: "wx" });
		files[kind] = {
			filename,
			bytes: bytes.length,
			sha256: cloudsSha256(bytes),
		};
	}
	const declaration = Object.fromEntries(
		Object.entries(value).filter(
			([key]) => !["video", "expected", "baseline"].includes(key),
		),
	);
	const metadata = {
		...declaration,
		kind: "production-vp9-webm",
		independentDecodeVerified: false,
		files,
	};
	return {
		...metadata,
		manifest: await saveCloudsJson(directory, "media.json", metadata),
	};
}
export async function captureCloudsPipeline(page, directory, report) {
	if (!page || page.isClosed()) return;
	const read = (key) =>
		cloudsDeadline(
			page.evaluate((name) => Reflect.get(globalThis, name) ?? null, key),
			5000,
			`Capture ${key}`,
		);
	try {
		report.checks = await read("__cloudsPipeline");
		if (report.checks)
			report.resultArtifact = await saveCloudsJson(
				directory,
				"browser-result.json",
				report.checks,
			);
	} catch (error) {
		report.captureErrors.push(`pipeline result: ${String(error)}`);
	}
	// Media is published before browser decoding; preserve it even if the checks failed.
	try {
		const media = await read("__cloudsPipelineMedia");
		if (media)
			report.pipelineMedia = await saveCloudsPipeline(directory, media);
	} catch (error) {
		report.captureErrors.push(`pipeline media: ${String(error)}`);
	}
	try {
		const diagnostics = await read("__cloudsPipelineDiagnostics");
		if (diagnostics)
			report.diagnosticsArtifact = await saveCloudsJson(
				directory,
				"diagnostics.json",
				diagnostics,
			);
	} catch (error) {
		report.captureErrors.push(`pipeline diagnostics: ${String(error)}`);
	}
}
