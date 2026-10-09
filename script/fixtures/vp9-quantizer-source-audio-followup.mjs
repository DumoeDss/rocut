import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { sha256 } from "./master-encoder-analysis.mjs";
import { loadFrozenSource } from "./vp9-quantizer-source-cases.mjs";
import {
	analyseCompanionAudio,
	pcmFloat32,
} from "./vp9-quantizer-source-audio.mjs";

const directory = process.env.ROCUT_VP9_ADAPTER_ARTIFACTS;
const inputs = process.env.ROCUT_MASTER_ENCODER_INPUTS;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG;
if (
	process.argv.length !== 2 ||
	![directory, inputs, ffmpeg].every((path) => path && isAbsolute(path))
)
	throw Error(
		"Use absolute adapter-artifact/frozen-input/FFmpeg paths; no arguments",
	);
const original = await readFile(join(directory, "verification.json"));
const verification = JSON.parse(original.toString("utf8"));
assert.equal(verification.adapterAcceptancePassed, true);
await loadFrozenSource(inputs);
const identities = () =>
	Promise.all(
		verification.results.map(async (result) => ({
			name: result.name,
			sha256: sha256(
				await readFile(join(directory, result.name, "encoded.webm")),
			),
		})),
	);
const before = await identities();
assert.deepEqual(
	before,
	verification.results.map((result) => ({
		name: result.name,
		sha256: result.containerSha256,
	})),
);
const decoderHashBefore = sha256(await readFile(ffmpeg));
assert.equal(
	decoderHashBefore,
	verification.decoderBinaries.find((entry) => entry.path === ffmpeg).sha256,
);
const sourcePaths = [
	"vp9-quantizer-source-audio-followup.mjs",
	"vp9-quantizer-source-audio.mjs",
	"vp9-quantizer-source-audio.test.mjs",
	"vp9-quantizer-source-cases.mjs",
	"master-encoder-analysis.mjs",
	"master-effects-browser-oracle.ts",
];
const sourceIdentity = () =>
	Promise.all(
		sourcePaths.map(async (path) => ({
			path,
			sha256: sha256(await readFile(new URL(path, import.meta.url))),
		})),
	);
const sourceBefore = await sourceIdentity();
const results = [];
for (const result of verification.results) {
	const video = join(directory, result.name, "encoded.webm");
	const pcm = execFileSync(
		ffmpeg,
		["-v", "error", "-i", video, "-map", "0:a:0", "-f", "f32le", "pipe:1"],
		{ windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
	);
	assert.equal(sha256(pcm), result.audioDecodedSha256);
	const analysis = {
		name: result.name,
		pcmSha256: sha256(pcm),
		...analyseCompanionAudio(pcmFloat32(pcm)),
	};
	await writeFile(join(directory, result.name, "audio-followup.f32le"), pcm, {
		flag: "wx",
	});
	await writeFile(
		join(directory, result.name, "audio-followup.json"),
		JSON.stringify(analysis, null, 2),
		{ flag: "wx" },
	);
	results.push(analysis);
	console.log(
		JSON.stringify({
			name: analysis.name,
			passed: analysis.passed,
			unshiftedCorrelation: analysis.unshiftedCorrelation,
			bestLagSamples: analysis.bestLagSamples,
			decodedSamples: analysis.decodedSamples,
			tailPaddingSamples: analysis.tailPaddingSamples,
			onsetDifferenceSamples: analysis.onsetDifferenceSamples,
			offsetDifferenceSamples: analysis.offsetDifferenceSamples,
			tailRms: analysis.tailRms,
		}),
	);
}
const after = await identities();
assert.deepEqual(after, before);
assert.deepEqual(await sourceIdentity(), sourceBefore);
assert.equal(sha256(await readFile(ffmpeg)), decoderHashBefore);
assert.equal(
	sha256(await readFile(join(directory, "verification.json"))),
	sha256(original),
);
await loadFrozenSource(inputs);
const passed = results.every((result) => result.passed);
await writeFile(
	join(directory, "audio-followup-verification.json"),
	JSON.stringify(
		{
			audioFollowupPassed: passed,
			originalVerificationSha256: sha256(original),
			videoIdentityBefore: before,
			videoIdentityAfter: after,
			sources: sourceBefore,
			ffmpeg: { path: ffmpeg, sha256: decoderHashBefore },
			unchangedVideoInputs: verification.inputIdentity,
			results,
		},
		null,
		2,
	),
	{ flag: "wx" },
);
assert.equal(
	passed,
	true,
	"Independent unshifted companion audio timing/content gate failed; artifacts retain the full unmodified decoded tails",
);
console.log(
	JSON.stringify({
		audioFollowupPassed: true,
		unchangedVideoArtifacts: true,
		directory,
	}),
);
