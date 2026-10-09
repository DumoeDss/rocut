/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Web Audio has no constructible buffer in Bun; this focused fixture implements the fields the mixer reads. */
import { describe, expect, test } from "bun:test";

import { mixAudioChannels, type CollectedAudioElement } from "../audio";

function buffer({ samples, sampleRate = 10 }: { samples: readonly number[]; sampleRate?: number }): AudioBuffer {
	const data = Float32Array.from(samples);
	return {
		numberOfChannels: 1,
		length: data.length,
		sampleRate,
		duration: data.length / sampleRate,
		getChannelData: () => data,
	} as unknown as AudioBuffer;
}

function outputBuffer({ length, sampleRate = 10 }: { length: number; sampleRate?: number }): AudioBuffer {
	const channels = [new Float32Array(length), new Float32Array(length)];
	return {
		numberOfChannels: 2,
		length,
		sampleRate,
		duration: length / sampleRate,
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
		buffer: buffer({ samples: [] }),
		startTime,
		duration,
		trimStart: 0,
		trimEnd: 0,
		volume: 1,
		muted: false,
	};
}

function mixRange({
	source,
	clip,
	trimStart = 0,
	sampleRate,
	startTime = 0,
	length,
}: {
	source: AudioBuffer;
	clip: CollectedAudioElement;
	trimStart?: number;
	sampleRate: number;
	startTime?: number;
	length: number;
}): AudioBuffer {
	const output = outputBuffer({ length, sampleRate });
	mixAudioChannels({
		element: clip,
		buffer: source,
		trimStart,
		outputBuffer: output,
		outputLength: length,
		sampleRate,
		outputStartTime: startTime,
	});
	return output;
}

function expectFullSlice({
	partial,
	full,
	startSample,
}: {
	partial: AudioBuffer;
	full: AudioBuffer;
	startSample: number;
}) {
	for (let channel = 0; channel < 2; channel++) {
		expect(partial.getChannelData(channel)).toEqual(
			full.getChannelData(channel).subarray(startSample, startSample + partial.length),
		);
	}
}

describe("range audio mixing", () => {
	test("an output range begins at the matching source sample, not clip zero", () => {
		const source = buffer({ samples: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
		const output = outputBuffer({ length: 5 });
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
		const source = buffer({ samples: [1, 2, 3, 4] });
		const output = outputBuffer({ length: 8 });
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
		const output = outputBuffer({ length: 5 });
		mixAudioChannels({
			element: element({ startTime: 0, duration: 0.5 }),
			buffer: buffer({ samples: [1, 2, 3, 4, 5] }),
			trimStart: 0,
			outputBuffer: output,
			outputLength: 5,
			sampleRate: 10,
			outputStartTime: 1,
		});

		expect([...output.getChannelData(0)]).toEqual([0, 0, 0, 0, 0]);
	});

	test("44.1 kHz partial export retains the first sample of a clip entering at 0.20 seconds", () => {
		const source = buffer({ samples: Array.from({ length: 8820 }, () => 1), sampleRate: 44100 });
		const clip = element({ startTime: 0.2, duration: 0.12 });
		const options = { source, clip, trimStart: 0.04, sampleRate: 44100 };
		const full = mixRange({ ...options, length: 15876 });
		const partial = mixRange({ ...options, startTime: 0.12, length: 7056 });

		// 0.20s and 0.12s are exactly sample 8820 and 5292 on this clock.
		expect(full.getChannelData(0)[8820]).toBe(1);
		expect(partial.getChannelData(0)[3527]).toBe(0);
		expect(partial.getChannelData(0)[3528]).toBe(1);
		expectFullSlice({ partial, full, startSample: 5292 });
	});

	test("44.1 kHz partial export does not extend a half-open clip end by one sample", () => {
		const source = buffer({ samples: Array.from({ length: 8820 }, () => 1), sampleRate: 44100 });
		const clip = element({ startTime: 0.08, duration: 0.08 });
		const options = { source, clip, sampleRate: 44100 };
		const full = mixRange({ ...options, length: 8820 });
		const partial = mixRange({ ...options, startTime: 0.12, length: 3528 });

		expect(full.getChannelData(0)[7055]).toBe(1);
		expect(full.getChannelData(0)[7056]).toBe(0);
		expect(partial.getChannelData(0)[1763]).toBe(1);
		expect(partial.getChannelData(0)[1764]).toBe(0);
		expectFullSlice({ partial, full, startSample: 5292 });
	});

	test("tick-aligned fractional starts and trims preserve the absolute sample interpolation phase", () => {
		const source = buffer({ samples: Array.from({ length: 4410 }, (_, index) => index % 8), sampleRate: 44100 });
		const clip = element({ startTime: 24001 / 120000, duration: 4801 / 120000 });
		const options = { source, clip, trimStart: 2 / 120000, sampleRate: 44100 };
		const full = mixRange({ ...options, length: 12000 });
		const partial = mixRange({ ...options, startTime: 14401 / 120000, length: 6000 });

		// Project ticks put the clip at sample 8820.3675 and trim at 0.735.
		// Its first included sample therefore reads ramp position 1.3675.
		// Partial origin is floor(14401 * 44100 / 120000) = 5292, not a
		// newly phased output clock beginning 0.3675 samples after that grid.
		expect(full.getChannelData(0)[8820]).toBe(0);
		expect(full.getChannelData(0)[8821]).toBe(Math.fround(1.3675));
		expect(partial.getChannelData(0)[3528]).toBe(0);
		expect(partial.getChannelData(0)[3529]).toBe(Math.fround(1.3675));
		expectFullSlice({ partial, full, startSample: 5292 });
	});

	for (const [inputRate, outputRate, origin, first] of [
		[48000, 44100, 5292, 8820],
		[44100, 48000, 5760, 9600],
		[32000, 48000, 5760, 9600],
	] as const) {
		test(`${inputRate} Hz sources keep the same sample clock in a ${outputRate} Hz partial mix`, () => {
			const source = buffer({ samples: Array.from({ length: 12000 }, (_, index) => 1 + index % 64), sampleRate: inputRate });
			const clip = element({ startTime: 0.2, duration: 0.12 });
			const options = { source, clip, trimStart: 0.013125, sampleRate: outputRate };
			const full = mixRange({ ...options, length: 16000 });
			const partial = mixRange({ ...options, startTime: 0.12, length: 9000 });

			expect(full.getChannelData(0).findIndex(sample => sample !== 0)).toBe(first);
			expect(partial.getChannelData(0).findIndex(sample => sample !== 0)).toBe(first - origin);
			expectFullSlice({ partial, full, startSample: origin });
		});
	}
});
