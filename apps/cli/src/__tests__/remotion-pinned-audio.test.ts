import { expect, test } from "bun:test";
import { transformSync } from "esbuild";
import {
	PINNED_AUDIO_INPUT,
	PINNED_AUDIO_RETURNED,
	pinnedAudioAuthor,
	pinnedAudioWave,
} from "./remotion-pinned-audio-source";
import {
	pinnedAudioExpected,
	pinnedAudioExpectedRms,
	pinnedAudioMixedRms,
	pinnedAudioPcmFrameRms,
} from "./remotion-pinned-audio-oracle";
import type { PinnedAudioMode } from "./remotion-pinned-audio-source";

function authoredMetadata({
	mode,
	analysisOnly = false,
}: {
	mode: PinnedAudioMode;
	analysisOnly?: boolean;
}) {
	let root: (() => { props: Record<string, unknown> }) | undefined;
	const React = {
		createElement: (...[_type, props]: [unknown, Record<string, unknown>]) => ({
			props,
		}),
	};
	const remotion = {
		registerRoot: (value: typeof root) => {
			root = value;
		},
	};
	const code = transformSync(pinnedAudioAuthor(mode), {
		loader: "tsx",
		format: "cjs",
		target: "esnext",
	}).code;
	new Function("require", "window", code)(
		(name: string) =>
			name === "react"
				? React
				: name === "remotion"
					? remotion
					: { default: "data:audio/wav;base64,AQID" },
		{ rocutRemotionAudio: { analysisOnly } },
	);
	if (!root) throw Error("Native registration fixture missing");
	const calculate = root().props.calculateMetadata;
	if (typeof calculate !== "function")
		throw Error("Native metadata author callback missing");
	return async (input: { props: unknown }) => {
		const value: unknown = await calculate(input);
		const isMetadata = (
			value: unknown,
		): value is {
			width: number;
			height: number;
			durationInFrames: number;
			props: { resolvedGain: number };
		} => {
			if (
				typeof value !== "object" ||
				value === null ||
				!("width" in value) ||
				typeof value.width !== "number" ||
				!("height" in value) ||
				typeof value.height !== "number" ||
				!("durationInFrames" in value) ||
				typeof value.durationInFrames !== "number" ||
				!("props" in value) ||
				typeof value.props !== "object" ||
				value.props === null ||
				!("resolvedGain" in value.props) ||
				typeof value.props.resolvedGain !== "number"
			)
				throw Error("Native metadata author returned malformed metadata");
			return true;
		};
		if (!isMetadata(value))
			throw Error("Native metadata author returned malformed metadata");
		return value;
	};
}

test("audio-only drift controls leave discovery stable and target actual returned metadata", async () => {
	for (const mode of ["stable", "props-drift", "geometry-drift"] as const) {
		expect(
			await authoredMetadata({ mode: mode })({ props: PINNED_AUDIO_INPUT }),
		).toEqual({
			width: 80,
			height: 48,
			durationInFrames: 36,
			props: PINNED_AUDIO_RETURNED,
		});
		const actual = await authoredMetadata({ mode: mode, analysisOnly: true })({
			props: PINNED_AUDIO_INPUT,
		});
		expect(actual.width).toBe(mode === "geometry-drift" ? 81 : 80);
		expect(actual.props.resolvedGain).toBe(mode === "props-drift" ? 0.65 : 0.4);
	}
});

test("mixed PCM energy oracle distinguishes silence and wrong/default gain", () => {
	const pcm = Buffer.alloc(1600 * 8);
	expect(pinnedAudioPcmFrameRms({ pcm: pcm, frameOffset: 0 })).toBe(0);
	const wave = pinnedAudioWave();
	for (let sample = 0; sample < 1600; sample++)
		for (let channel = 0; channel < 2; channel++)
			pcm.writeFloatLE(
				wave.readFloatLE(44 + (sample * 2 + channel) * 4) * 0.4,
				(sample * 2 + channel) * 4,
			);
	const rms = pinnedAudioPcmFrameRms({ pcm: pcm, frameOffset: 0 });
	expect(Math.abs(rms - pinnedAudioMixedRms(5))).toBeLessThan(1e-8);
	expect(Math.abs(rms - Math.sqrt(0.05) * 0.15)).toBeGreaterThan(0.05);
	expect(pinnedAudioMixedRms(4)).toBe(0);
	expect(pinnedAudioMixedRms(13)).toBe(0);
});

test("pinned audio author uses supplied inputProps rather than defaults or receipt returnedProps", async () => {
	let root: (() => { props: Record<string, unknown> }) | undefined;
	const React = {
		createElement: (...[_type, props]: [unknown, Record<string, unknown>]) => ({
			props,
		}),
	};
	const remotion = {
		registerRoot: (value: typeof root) => {
			root = value;
		},
	};
	const code = transformSync(pinnedAudioAuthor("stable"), {
		loader: "tsx",
		format: "cjs",
		target: "esnext",
	}).code;
	new Function("require", "window", code)(
		(name: string) =>
			name === "react"
				? React
				: name === "remotion"
					? remotion
					: { default: "data:audio/wav;base64,AQID" },
		{},
	);
	if (!root) throw Error("Native registration fixture missing");
	const composition = root().props;
	const calculate = composition.calculateMetadata;
	if (typeof calculate !== "function")
		throw Error("Native metadata author callback missing");
	expect(await calculate({ props: PINNED_AUDIO_INPUT })).toEqual({
		width: 80,
		height: 48,
		durationInFrames: 36,
		props: PINNED_AUDIO_RETURNED,
	});
	expect(await calculate({ props: composition.defaultProps })).not.toEqual({
		width: 80,
		height: 48,
		durationInFrames: 36,
		props: PINNED_AUDIO_RETURNED,
	});
	await expect(calculate({ props: PINNED_AUDIO_RETURNED })).rejects.toThrow(
		"substituted into inputProps",
	);
});

test("independent seek oracle has exact activity edges and non-silent expected source PCM", () => {
	expect(pinnedAudioExpected(4)).toEqual([]);
	expect(pinnedAudioExpected(13)).toEqual([]);
	expect(pinnedAudioExpected(5)).toEqual([
		{
			sourceTime: 0.3,
			playbackRate: 2,
			volume: 0.4,
			toneFrequency: 1,
			audioStreamIndex: 0,
		},
	]);
	expect(pinnedAudioExpected(12)[0].sourceTime).toBe(23 / 30);
	const wav = pinnedAudioWave();
	expect(wav.readUInt16LE(20)).toBe(3);
	expect(wav.readUInt32LE(24)).toBe(48000);
	for (const frame of [5, 6, 8, 12])
		expect(pinnedAudioExpectedRms({ wav: wav, frame: frame })).toBeGreaterThan(
			0.08,
		);
	expect(pinnedAudioExpectedRms({ wav: wav, frame: 4 })).toBe(0);
});
