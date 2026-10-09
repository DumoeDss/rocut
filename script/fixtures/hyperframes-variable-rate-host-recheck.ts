import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import { fixtureAdd, fixtureGain } from "./hyperframes-graph-chain-fixture";
import { digest, readNativePreparedWav } from "./hyperframes-variable-rate-io";
import { rateReferenceAtGraphRate } from "./hyperframes-variable-rate-production-media";

/** Reconstruct the independent expectation from retained original-preparation
 * WAVs, then compare the SHA256 already recorded from actual Host output. This
 * supplements old threshold-only reports without repeating browser collection. */
const directories = process.argv.slice(2);
assert.ok(directories.length > 0 && directories.length <= 3);
for (const directory of directories)
	assert.ok(
		isAbsolute(directory) &&
			basename(directory).startsWith("rocut-hf-rate-host-"),
	);
const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG;
assert.ok(toolchain && isAbsolute(toolchain) && ffmpeg && isAbsolute(ffmpeg));
const controller = new AbortController();
const deadline = setTimeout(
	() => controller.abort(Error("Host hash verification deadline")),
	30000,
);
let oracle: Awaited<ReturnType<typeof createFxAutomationOracle>> | undefined;
try {
	oracle = await createFxAutomationOracle(toolchain, controller);
	for (const directory of directories) {
		const report = JSON.parse(
			await readFile(join(directory, "verification.json"), "utf8"),
		);
		assert.equal(report.status, "passed");
		assert.equal(report.cases.length, 1);
		const recorded = report.cases[0];
		assert.ok(recorded.kind === "wav" || recorded.kind === "mp4-audio");
		assert.equal(recorded.sampleRate, 44100);
		assert.deepEqual(
			oracle.provenance.sourceSha256,
			report.fxOracleProvenance.sourceSha256,
		);
		const path = join(directory, `rising-log-${recorded.kind}-native.wav`);
		const reference = { path, ...(await readNativePreparedWav(path)) };
		const dry = await rateReferenceAtGraphRate(ffmpeg, reference, 1.13, 44100);
		const effected = await oracle.render(
			{
				sampleRate: 44100,
				chain: {
					version: 1,
					nodes: [{ type: "saturate", params: { threshold: -20 } }],
				},
			},
			dry,
		);
		const expected = Buffer.alloc(58653 * 8);
		fixtureAdd(
			expected,
			fixtureGain(effected.pcm, () => 0.75),
			4410,
		);
		const expectedSha256 = digest(expected);
		assert.equal(
			expectedSha256,
			recorded.pcmSha256,
			"Independent recomputation equals recorded actual Host PCM SHA256",
		);
		assert.equal(recorded.cropExact, true);
		const result = {
			status: "passed",
			originalReport: join(directory, "verification.json"),
			kind: recorded.kind,
			sampleRate: 44100,
			frames: 58653,
			nativePreparedWavSha256: reference.wavSha256,
			expectedSha256,
			actualRecordedSha256: recorded.pcmSha256,
			maximumError: 0,
			rmsError: 0,
			evidence:
				"Independent expected PCM matches the SHA256 recorded from actual Host PCM; original exact-crop assertion propagates equality to the crop.",
			cropFirstSample: 16317,
			cropFrames: 4851,
			oracleProvenance: oracle.provenance,
		};
		await writeFile(
			join(directory, "verification-exact-hash.json"),
			JSON.stringify(result, null, 2) + "\n",
			{ flag: "wx" },
		);
		console.log(
			JSON.stringify({
				event: "host-hash-recheck-passed",
				directory,
				expectedSha256,
				maximumError: 0,
			}),
		);
	}
} finally {
	clearTimeout(deadline);
	await oracle?.close();
}
