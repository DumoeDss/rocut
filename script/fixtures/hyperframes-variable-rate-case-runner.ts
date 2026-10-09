import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeAudioWav } from "./native-audio-fixture";
import {
	variableRateSample,
	type VariableRateCase,
} from "./hyperframes-variable-rate-cases";
import {
	digest,
	pcmDifference,
	readNativePreparedWav,
} from "./hyperframes-variable-rate-io";
import type {
	loadVariableRateNative,
	RateSpec,
} from "./hyperframes-variable-rate-native";

type Oracle = Awaited<ReturnType<typeof loadVariableRateNative>>;
function diagnosticDifference(expected: Buffer, actual: Buffer) {
	const overlapBytes = Math.min(expected.length, actual.length);
	assert.ok(overlapBytes > 0, "Negative control must contain actual PCM");
	return {
		...pcmDifference(
			expected.subarray(0, overlapBytes),
			actual.subarray(0, overlapBytes),
		),
		expectedFrames: expected.length / 8,
		actualFrames: actual.length / 8,
		comparedFrames: overlapBytes / 8,
	};
}

export async function runVariableRateCase(
	oracle: Oracle,
	directory: string,
	test: VariableRateCase,
) {
	const sourcePath = join(directory, `${test.id}-source.wav`);
	const source = nativeAudioWav({
		seconds: 4,
		sampleRate: test.sampleRate,
		channels: test.channels,
		sample: variableRateSample(test.sampleRate),
	});
	await writeFile(sourcePath, source);
	const rate =
		typeof test.rate === "number"
			? test.rate
			: oracle.automation.normalizeAutomation({
					version: 1,
					lanes: [test.rate],
				}).lanes[0];
	assert.ok(
		rate,
		"Native automation normalization must preserve the rate lane",
	);
	const prepare = async (
		name: string,
		spec: RateSpec,
		mediaStart = test.mediaStart,
		duration = test.duration,
	) => {
		const output = join(directory, `${test.id}-${name}.wav`);
		const result = await oracle.native.prepareAudioTrack(
			sourcePath,
			output,
			mediaStart,
			duration,
			spec,
			new AbortController().signal,
			{ ffmpegProcessTimeout: 15000 },
		);
		assert.ok(result.success, result.error);
		return { path: output, ...(await readNativePreparedWav(output)) };
	};
	const first = await prepare("native", rate);
	const decoded = await oracle.io.decode(first.path);
	assert.equal(
		pcmDifference(first.pcm, decoded).maximum,
		0,
		"Independent FFmpeg decode vs RIFF s16 reader",
	);
	assert.equal(
		first.frames,
		Math.round(test.duration * 48000),
		"Native PCM frame count",
	);
	const repeated = await prepare("repeat", rate);
	assert.equal(
		pcmDifference(first.pcm, repeated.pcm).maximum,
		0,
		"Repeated native preparation",
	);
	const energy = pcmDifference(first.pcm, Buffer.alloc(first.pcm.length));
	assert.ok(
		energy.rms > 0.02 && energy.maximum < 1,
		"Finite, non-silent, unclipped oracle",
	);
	let channelDifference = 0;
	for (let frame = 0; frame < first.frames; frame++)
		channelDifference = Math.max(
			channelDifference,
			Math.abs(
				first.pcm.readFloatLE(frame * 8) - first.pcm.readFloatLE(frame * 8 + 4),
			),
		);
	if (test.channels === 1)
		assert.equal(channelDifference, 0, "Native mono-to-stereo duplication");
	else
		assert.ok(
			channelDifference > 0.05,
			"Distinct native stereo channels survive",
		);
	const pcmPath = join(directory, `${test.id}-expected.f32le`);
	await writeFile(pcmPath, first.pcm);
	const cropStartFrame = Math.round(first.frames * 0.41);
	const crop = first.pcm.subarray(cropStartFrame * 8);
	const cropPath = join(directory, `${test.id}-expected-tail.f32le`);
	await writeFile(cropPath, crop);
	const controls: Record<string, ReturnType<typeof diagnosticDifference>> = {};
	if (typeof rate === "object") {
		const averageRate =
			oracle.speed.sourceTimeAt(rate, test.duration) / test.duration;
		const wrongRate = await prepare("wrong-average-rate", averageRate);
		controls.wrongAverageRate = diagnosticDifference(first.pcm, wrongRate.pcm);
		const wrongTrim = await prepare("wrong-trim", rate, test.mediaStart + 0.04);
		controls.wrongTrim = diagnosticDifference(first.pcm, wrongTrim.pcm);
		const cropStart = cropStartFrame / 48000;
		const restarted = await prepare(
			"restarted-tail",
			oracle.speed.shiftRateLane(rate, cropStart),
			test.mediaStart + oracle.speed.sourceTimeAt(rate, cropStart),
			(first.frames - cropStartFrame) / 48000,
		);
		controls.restartedTail = diagnosticDifference(crop, restarted.pcm);
		for (const [name, difference] of Object.entries(controls))
			assert.ok(
				difference.rms > 0.001,
				`${name} must be observably different, not merely a formula snapshot`,
			);
	}
	return {
		id: test.id,
		input: { ...test, rate, sourcePath, sourceSha256: digest(source) },
		output: {
			wavPath: first.path,
			pcmPath,
			wavSha256: first.wavSha256,
			pcmSha256: digest(first.pcm),
			format: first.format,
			frames: first.frames,
			energy,
			channelDifference,
		},
		decodeMaximumError: 0,
		repeatedMaximumError: 0,
		controls,
		cropReference: {
			path: cropPath,
			startFrame: cropStartFrame,
			frames: crop.length / 8,
			sha256: digest(crop),
			status:
				"Stored oracle reference only; production crop behavior is not yet tested.",
		},
	};
}
