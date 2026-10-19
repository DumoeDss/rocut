import { expect, test } from "bun:test";
import {
	sampleSourceWaveformSummary,
	withWaveformLevels,
	type SourceWaveformSummary,
} from "../../../media/waveform-summary";
import {
	MAX_WAVEFORM_ENCODED_BYTES,
	MAX_WAVEFORM_WAITING,
	WaveformDecodeQueue,
} from "../decode-budget";
import { WaveformCache } from "../service";
import { validWaveformSummary } from "../summary-storage";

const resources = {
	createAudioContext: () => ({ context: null, close: async () => {} }),
};
const summary = (sourceKey: string): SourceWaveformSummary => ({
	sourceKey,
	sampleRate: 48000,
	totalSamples: 4096,
	bucketSize: 128,
	amplitudes: Float32Array.from({ length: 32 }, (_, i) => i / 32),
});
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("global admission keeps two active jobs, bounds waiting jobs and cancels queued work", async () => {
	const queue = new WaveformDecodeQueue();
	const controller = new AbortController();
	let active = 0,
		peak = 0;
	const release: (() => void)[] = [];
	const work = () =>
		new Promise<void>((resolve) => {
			active++;
			peak = Math.max(peak, active);
			release.push(() => {
				active--;
				resolve();
			});
		});
	const running = [
		queue.run({ signal: controller.signal, work }),
		queue.run({ signal: controller.signal, work }),
	];
	const waiting = Array.from({ length: MAX_WAVEFORM_WAITING }, () =>
		queue.run({ signal: controller.signal, work }).catch((error) => error),
	);
	await expect(
		queue.run({ signal: controller.signal, work }),
	).rejects.toMatchObject({ name: "NotSupportedError" });
	expect(active).toBe(2);
	controller.abort();
	await Promise.all(waiting);
	for (const done of release) done();
	await Promise.all(running);
	expect(peak).toBe(2);
	await queue.run({
		signal: new AbortController().signal,
		work: async () => {},
	});
});

test("same-content File replacements and source keys reuse one SHA-bound decode, changed bytes do not", async () => {
	let decodes = 0;
	const cache = new WaveformCache({
		resources,
		options: {
			decodeSource: async ({ sourceKey }) => {
				decodes++;
				await settle();
				return summary(sourceKey);
			},
		},
	});
	try {
		const [a, b] = await Promise.all([
			cache.getSourceSummary({
				sourceKey: "card",
				sourceFile: new File(["equal bounded-summary fixture"], "a.wav"),
			}),
			cache.getSourceSummary({
				sourceKey: "timeline",
				sourceFile: new File(["equal bounded-summary fixture"], "b.wav"),
			}),
		]);
		expect(decodes).toBe(1);
		expect(a.sourceKey).toBe("card");
		expect(b.sourceKey).toBe("timeline");
		await cache.getSourceSummary({
			sourceKey: "replacement",
			sourceFile: new File(["different bounded-summary fixture"], "a.wav"),
		});
		expect(decodes).toBe(2);
	} finally {
		await cache.dispose();
	}
});

test("encoded budget rejects before decoding, failures leave an explicit retry path", async () => {
	let decodes = 0;
	let fail = true;
	const cache = new WaveformCache({
		resources,
		options: {
			contentCache: false,
			decodeSource: async ({ sourceKey }) => {
				decodes++;
				if (fail) throw Error("decoder failed");
				return summary(sourceKey);
			},
		},
	});
	try {
		const oversized = new File(
			[new Uint8Array(MAX_WAVEFORM_ENCODED_BYTES + 1)],
			"huge.wav",
		);
		await expect(
			cache.getSourceSummary({ sourceKey: "large", sourceFile: oversized }),
		).rejects.toMatchObject({ name: "NotSupportedError" });
		expect(decodes).toBe(0);
		const file = new File(["retry"], "retry.wav");
		await expect(
			cache.getSourceSummary({ sourceKey: "retry", sourceFile: file }),
		).rejects.toThrow("decoder failed");
		fail = false;
		expect(
			(await cache.getSourceSummary({ sourceKey: "retry", sourceFile: file }))
				.amplitudes[31],
		).toBeGreaterThan(0);
		expect(decodes).toBe(2);
	} finally {
		await cache.dispose();
	}
});

test("peak pyramid preserves exact source interval selection, not a stretched card thumbnail", () => {
	const base = {
		...summary("source"),
		totalSamples: 128 * 4096,
		amplitudes: Float32Array.from({ length: 4096 }, (_, i) =>
			i === 1043 ? 0.95 : i === 3500 ? 0.75 : 0.1,
		),
	};
	const layered = withWaveformLevels(base);
	expect(layered.levels!.length).toBeGreaterThan(1);
	const buckets = [
		{ bucketStart: 1000 * 128, bucketEnd: 1100 * 128 },
		{ bucketStart: 2000 * 128, bucketEnd: 2100 * 128 },
		{ bucketStart: 3400 * 128, bucketEnd: 3600 * 128 },
	];
	const expected = sampleSourceWaveformSummary({ summary: base, buckets });
	expect(sampleSourceWaveformSummary({ summary: layered, buckets })).toEqual(
		expected,
	);
	expect(expected[1]).toBeCloseTo(0.1);
	expect(expected[0]).toBeCloseTo(0.95);
});

test("persistent summary validation rejects corrupt shapes and nonfinite PCM instead of returning silence", () => {
	const valid = summary("valid");
	expect(validWaveformSummary(valid)).toBe(true);
	for (const corrupt of [
		null,
		{},
		{ ...valid, sampleRate: NaN },
		{ ...valid, totalSamples: -1 },
		{ ...valid, bucketSize: 0 },
		{ ...valid, amplitudes: new Float32Array([NaN]) },
		{ ...valid, amplitudes: new Float32Array(1) },
	])
		expect(validWaveformSummary(corrupt)).toBe(false);
});

test("ready object summaries are bounded across card identities", async () => {
	let decodes = 0;
	const cache = new WaveformCache({
		resources,
		options: {
			contentCache: false,
			decodeSource: async ({ sourceKey }) => {
				decodes++;
				return summary(sourceKey);
			},
		},
	});
	const first = new File(["first"], "first.wav");
	try {
		await cache.getSourceSummary({ sourceKey: "first", sourceFile: first });
		for (let i = 0; i < 65; i++)
			await cache.getSourceSummary({
				sourceKey: `card-${i}`,
				sourceFile: new File([String(i)], `${i}.wav`),
			});
		await cache.getSourceSummary({ sourceKey: "first", sourceFile: first });
		expect(decodes).toBe(67);
	} finally {
		await cache.dispose();
	}
});
