import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { nativeAudioWav } from "./native-audio-fixture";
import type { VariableRateCase } from "./hyperframes-variable-rate-cases";
import { pcmDifference } from "./hyperframes-variable-rate-io";
import type { RateLane } from "./hyperframes-variable-rate-native";
import {
	rateProductionReference,
	type RateOracle,
	type RateProductionMedia,
} from "./hyperframes-variable-rate-production-media";

export function trimEnvironment(name: string) {
	const path = process.env[name];
	assert.ok(
		path && isAbsolute(path),
		`${name} requires an existing absolute path`,
	);
	return path;
}

export const fractionalTrimCases: VariableRateCase[] = [
	{
		id: "stereo-48000-half-before",
		sampleRate: 48000,
		channels: 2,
		fraction: 0.4999,
	},
	{
		id: "stereo-48000-half-after",
		sampleRate: 48000,
		channels: 2,
		fraction: 0.5001,
	},
	{
		id: "mono-44100-half-after",
		sampleRate: 44100,
		channels: 1,
		fraction: 0.5001,
	},
	{
		id: "mono-48000-three-quarter",
		sampleRate: 48000,
		channels: 1,
		fraction: 0.75,
	},
].map(({ fraction, ...test }) => ({
	...test,
	duration: 0.73,
	mediaStart: 0.1 + fraction / test.sampleRate,
	rate: {
		target: "rate",
		points: [
			{ t: 0, v: 0.7, curve: 0.4 },
			{ t: 0.81, v: 1.8 },
		],
	},
}));

export async function fractionalTrimMedia(
	directory: string,
	test: VariableRateCase,
): Promise<RateProductionMedia> {
	const path = join(directory, `${test.id}-source.wav`);
	const body = nativeAudioWav({
		sampleRate: test.sampleRate,
		channels: test.channels,
		seconds: 2,
		sample: (frame, channel) =>
			0.22 * Math.sin(frame * (channel ? 1.173 : 0.781)) +
			0.13 * Math.sin(frame * frame * 0.000041) +
			(frame % 97 === 0 ? 0.12 : 0),
	});
	await writeFile(path, body, { flag: "wx" });
	return {
		name: test.id,
		kind: "wav",
		path,
		body,
		mimeType: "audio/wav",
		hasAudio: true,
	};
}

/** Wrong trim is passed through the SAME original native function; no Rocut
 * implementation contributes expected PCM. Some fractional trims legitimately
 * quantize identically, so only the measured half-boundary must distinguish. */
export async function roundedTrimNegative(
	oracle: RateOracle,
	directory: string,
	media: RateProductionMedia,
	test: VariableRateCase,
	rate: RateLane,
	reference: NonNullable<Awaited<ReturnType<typeof rateProductionReference>>>,
) {
	const rounded = {
		...test,
		mediaStart: Math.round(test.mediaStart * test.sampleRate) / test.sampleRate,
	};
	const wrong = await rateProductionReference(
		oracle,
		directory,
		{ ...media, name: `${media.name}-wrong-rounded` },
		rounded,
		rate,
	);
	assert.ok(wrong);
	const bytes = Math.max(reference.pcm.length, wrong.pcm.length),
		actual = Buffer.alloc(bytes),
		incorrect = Buffer.alloc(bytes);
	reference.pcm.copy(actual);
	wrong.pcm.copy(incorrect);
	const difference = pcmDifference(actual, incorrect);
	if (test.id.includes("half-after"))
		assert.ok(
			difference.maximum > 0.001,
			"Premature trim rounding must be observably wrong",
		);
	return {
		originalTrim: test.mediaStart,
		roundedTrim: rounded.mediaStart,
		difference,
	};
}
