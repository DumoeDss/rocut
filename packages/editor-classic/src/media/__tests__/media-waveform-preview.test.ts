import { expect, test } from "bun:test";
import { WaveformCache } from "../../services/waveform-cache/service";
import {
	requestMediaWaveform,
	type MediaWaveformState,
} from "../media-waveform-request";
import type { SourceWaveformSummary } from "../waveform-summary";

const asset = (id = "audio") => ({
	id,
	file: new File(["audio"], `${id}.wav`),
});
const silentSummary = (): SourceWaveformSummary => ({
	sourceKey: "media:audio",
	sampleRate: 48000,
	totalSamples: 128,
	bucketSize: 128,
	amplitudes: new Float32Array([0]),
});
const settle = () => new Promise<void>((done) => setTimeout(done, 0));

test("a decoding failure remains an error and never becomes a ready silent waveform", async () => {
	const changes: MediaWaveformState[] = [];
	let calls = 0;
	requestMediaWaveform({
		asset: asset(),
		cache: {
			getSourceSummary: async () => {
				calls++;
				throw Error("corrupt media");
			},
		},
		onChange: (state) => changes.push(state),
	});
	await settle();
	expect(changes.map((state) => state.status)).toEqual(["loading", "error"]);
	expect(changes.at(-1)).toEqual({ status: "error", error: "corrupt media" });
	await settle();
	expect(calls).toBe(1);
});

test("a successful all-zero summary is a ready silent waveform with 48 valid buckets", async () => {
	const changes: MediaWaveformState[] = [];
	requestMediaWaveform({
		asset: asset(),
		cache: { getSourceSummary: async () => silentSummary() },
		onChange: (state) => changes.push(state),
	});
	await settle();
	expect(changes.at(-1)).toEqual({
		status: "ready",
		values: Array(48).fill(0),
	});
});

test("offline and unsupported sources are explicit and do not masquerade as silence", async () => {
	let calls = 0;
	const changes: MediaWaveformState[] = [];
	const cache = {
		getSourceSummary: async () => {
			calls++;
			throw Error("Audio waveform decoding is unavailable on this Host.");
		},
	};
	requestMediaWaveform({
		asset: { id: "missing", file: new File([], "missing.wav") },
		cache,
		onChange: (state) => changes.push(state),
	});
	expect(changes).toEqual([{ status: "offline" }]);
	expect(calls).toBe(0);
	requestMediaWaveform({
		asset: asset(),
		cache,
		onChange: (state) => changes.push(state),
	});
	await settle();
	expect(changes.at(-1)?.status).toBe("unsupported");
	requestMediaWaveform({
		asset: asset(),
		cache: {
			getSourceSummary: async () => {
				throw new DOMException("codec unavailable", "NotSupportedError");
			},
		},
		onChange: (state) => changes.push(state),
	});
	await settle();
	expect(changes.at(-1)?.status).toBe("unsupported");
});

test("source replacement and unmount ignore late results without clearing shared cache work", async () => {
	let finishOld!: (summary: SourceWaveformSummary) => void;
	const old = new Promise<SourceWaveformSummary>((done) => {
		finishOld = done;
	});
	const changes: MediaWaveformState[] = [];
	const stop = requestMediaWaveform({
		asset: asset("old"),
		cache: { getSourceSummary: () => old },
		onChange: (state) => changes.push(state),
	});
	stop();
	requestMediaWaveform({
		asset: asset("new"),
		cache: { getSourceSummary: async () => silentSummary() },
		onChange: (state) => changes.push(state),
	});
	await settle();
	const before = [...changes];
	finishOld({ ...silentSummary(), amplitudes: new Float32Array([1]) });
	await settle();
	expect(changes).toEqual(before);
	expect(changes.at(-1)).toEqual({
		status: "ready",
		values: Array(48).fill(0),
	});
});

function silentBuffer(): AudioBuffer {
	const data = new Float32Array(128);
	return {
		duration: 128 / 48000,
		length: 128,
		numberOfChannels: 1,
		sampleRate: 48000,
		getChannelData: () => data,
		copyFromChannel: () => {},
		copyToChannel: () => {},
	};
}

test("an explicit retry recovers through the shared cache and later cards reuse the successful decode", async () => {
	let decodes = 0,
		closes = 0;
	const resources = {
		createAudioContext: () => ({
			context: {
				decodeAudioData: async () => {
					if (++decodes === 1) throw Error("temporary failure");
					return silentBuffer();
				},
			},
			close: async () => {
				closes++;
			},
		}),
	};
	const cache = new WaveformCache({
		resources,
		options: {
			contentCache: false,
			decodeSource: async ({ sourceKey }) => {
				const handle = resources.createAudioContext();
				try {
					const buffer = await handle.context.decodeAudioData();
					return {
						sourceKey,
						sampleRate: buffer.sampleRate,
						totalSamples: buffer.length,
						bucketSize: 128,
						amplitudes: new Float32Array([0]),
					};
				} finally {
					await handle.close();
				}
			},
		},
	});
	const source = asset();
	const changes: MediaWaveformState[] = [];
	const request = () =>
		requestMediaWaveform({
			asset: source,
			cache,
			onChange: (state) => changes.push(state),
		});
	try {
		request();
		await settle();
		expect(changes.at(-1)?.status).toBe("error");
		expect(decodes).toBe(1);
		request();
		await settle();
		expect(changes.at(-1)).toEqual({
			status: "ready",
			values: Array(48).fill(0),
		});
		expect(decodes).toBe(2);
		request();
		request();
		await settle();
		expect(decodes).toBe(2);
		expect(closes).toBe(2);
	} finally {
		await cache.dispose();
	}
});
