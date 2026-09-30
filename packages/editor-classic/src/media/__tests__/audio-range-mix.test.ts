/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Web Audio has no constructible buffer in Bun; this focused fixture implements the fields the mixer reads. */
import { describe, expect, test } from "bun:test";

import { mixAudioChannels, type CollectedAudioElement } from "../audio";

function buffer(samples: readonly number[]): AudioBuffer {
	const data = Float32Array.from(samples);
	return {
		numberOfChannels: 1,
		length: data.length,
		sampleRate: 10,
		duration: data.length / 10,
		getChannelData: () => data,
	} as unknown as AudioBuffer;
}

function outputBuffer(length: number): AudioBuffer {
	const channels = [new Float32Array(length), new Float32Array(length)];
	return {
		numberOfChannels: 2,
		length,
		sampleRate: 10,
		duration: length / 10,
		getChannelData: (channel: number) => channels[channel]!,
	} as unknown as AudioBuffer;
}

function element({
	startTime,
	duration,
}: {
	startTime: number;
	duration: number;
}): CollectedAudioElement {
	return {
		timelineElement: { type: "audio" } as never,
		buffer: buffer([]),
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
		volume: 1,
		muted: false,
	};
}

describe("range audio mixing", () => {
	test("an output range begins at the matching source sample, not clip zero", () => {
		const source = buffer([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		const output = outputBuffer(5);
		mixAudioChannels({
			element: element({ startTime: 0.5, duration: 1 }),
			buffer: source,
			trimStart: 0,
			outputBuffer: output,
			outputLength: 5,
			sampleRate: 10,
			outputStartTime: 1,
		});

		expect([...output.getChannelData(0)]).toEqual([5, 6, 7, 8, 9]);
		expect([...output.getChannelData(1)]).toEqual([5, 6, 7, 8, 9]);
	});

	test("clips entering after range start keep their relative silence", () => {
		const source = buffer([1, 2, 3, 4]);
		const output = outputBuffer(8);
		mixAudioChannels({
			element: element({ startTime: 1.4, duration: 0.4 }),
			buffer: source,
			trimStart: 0,
			outputBuffer: output,
			outputLength: 8,
			sampleRate: 10,
			outputStartTime: 1,
		});

		expect([...output.getChannelData(0)]).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
	});

	test("clips outside the requested range do not contribute", () => {
		const output = outputBuffer(5);
		mixAudioChannels({
			element: element({ startTime: 0, duration: 0.5 }),
			buffer: buffer([1, 2, 3, 4, 5]),
			trimStart: 0,
			outputBuffer: output,
			outputLength: 5,
			sampleRate: 10,
			outputStartTime: 1,
		});

		expect([...output.getChannelData(0)]).toEqual([0, 0, 0, 0, 0]);
	});
});
