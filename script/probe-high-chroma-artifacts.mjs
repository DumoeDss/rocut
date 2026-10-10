import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeFrame, saveDropletsJson } from "./probe-droplets-artifacts.mjs";
import { sha256 } from "./probe-droplets-evidence.mjs";
import { validateHighChromaMedia } from "./probe-high-chroma-contract.mjs";

export async function saveHighChromaMedia(directory, value) {
	const spec = validateHighChromaMedia(value);
	const stride = value.width * value.height * 4;
	const expected = decodeFrame(value.expected, stride * value.frames);
	const baseline = decodeFrame(value.baseline, stride);
	assert.equal(
		sha256(expected),
		spec.expectedSha256,
		"Independent reference changed",
	);
	assert.equal(
		sha256(baseline),
		spec.baselineSha256,
		"Independent baseline changed",
	);
	assert(
		typeof value.video === "string" && value.video.length < 128 * 1024 * 1024,
	);
	const video = Buffer.from(value.video, "base64");
	assert(
		video.length && video.toString("base64") === value.video,
		"Malformed WebM payload",
	);
	const files = {};
	const payloads = [
		["video", "production.webm", video],
		["expected", "expected.rgba", expected],
		["baseline", "baseline.rgba", baseline],
	];
	if (spec.localTicks) {
		const source = decodeFrame(value.captureEvidence?.source, stride);
		assert.equal(
			sha256(source),
			spec.baselineSha256,
			"Original opaque source changed",
		);
		const captures = decodeFrame(
			value.captureEvidence?.frames,
			stride * value.frames,
		);
		for (let i = 0; i < captures.length; i++)
			assert(
				Math.abs(captures[i] - expected[i]) <= (i % 4 === 3 ? 1 : 2),
				"Production reference capture differs from oracle",
			);
		payloads.push(
			["source", "source.rgba", source],
			["capture", "reference-capture.rgba", captures],
		);
	}
	for (const [key, name, bytes] of payloads) {
		await writeFile(join(directory, name), bytes, { flag: "wx" });
		files[key] = { filename: name, bytes: bytes.length, sha256: sha256(bytes) };
	}
	const metadata = {
		...Object.fromEntries(
			Object.entries(value).filter(
				([key]) =>
					!["video", "expected", "baseline", "captureEvidence"].includes(key),
			),
		),
		kind: "production-explicit-chroma-vp9",
		independentDecodeVerified: false,
		files,
	};
	await saveDropletsJson(directory, "media.json", metadata);
	return metadata;
}
