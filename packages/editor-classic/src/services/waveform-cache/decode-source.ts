import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import type { SourceWaveformSummary } from "../../media/waveform-summary";
import {
	MAX_WAVEFORM_BLOCK_BYTES,
	MAX_WAVEFORM_ENCODED_BYTES,
	waveformUnsupported,
} from "./decode-budget";

export interface WaveformDecodeSourceArgs {
	sourceKey: string;
	file: Blob;
	signal: AbortSignal;
}

/** Platform codec adapter: consumes and closes bounded decoded blocks, never a whole-track AudioBuffer. */
export async function decodeWaveformSource({
	sourceKey,
	file,
	signal,
}: WaveformDecodeSourceArgs): Promise<SourceWaveformSummary> {
	if (file.size > MAX_WAVEFORM_ENCODED_BYTES)
		throw waveformUnsupported(
			"Waveform source exceeds the 64 MiB input budget. Retry with a smaller source.",
		);
	const input = new Input({
		source: new BlobSource(file),
		formats: ALL_FORMATS,
	});
	const abort = () => input.dispose();
	signal.addEventListener("abort", abort, { once: true });
	try {
		signal.throwIfAborted();
		const track = await input.getPrimaryAudioTrack();
		if (!track || !(await track.canDecode()))
			throw waveformUnsupported(
				"Audio waveform codec is unsupported on this Host.",
			);
		// MediaBunny duration is the final packet END timestamp, not elapsed duration.
		// Web Audio's old decoded buffer was zero-origin; preserve that source-time contract.
		const firstTimestamp = await track.getFirstTimestamp();
		const sourceOrigin = Math.max(0, firstTimestamp);
		const duration = (await track.computeDuration()) - sourceOrigin;
		const sampleRate = track.sampleRate;
		const channels = track.numberOfChannels;
		if (
			!Number.isFinite(firstTimestamp) ||
			!Number.isFinite(duration) ||
			duration < 0 ||
			!Number.isFinite(sampleRate) ||
			sampleRate <= 0 ||
			!Number.isInteger(channels) ||
			channels < 1 ||
			channels > 32
		)
			throw waveformUnsupported(
				"Waveform source metadata is unavailable or exceeds decoder limits.",
			);
		let totalSamples = Math.max(1, Math.ceil(duration * sampleRate));
		if (!Number.isSafeInteger(totalSamples))
			throw waveformUnsupported(
				"Waveform source duration exceeds decoder limits.",
			);
		let bucketSize = Math.max(128, Math.ceil(totalSamples / 262144));
		let amplitudes = new Float32Array(Math.ceil(totalSamples / bucketSize));
		let decodedSamples = 0;
		let decodedEnd = 0;
		for await (const sample of new AudioSampleSink(track).samples(
			sourceOrigin,
		)) {
			try {
				signal.throwIfAborted();
				if (
					sample.sampleRate !== sampleRate ||
					sample.numberOfChannels !== channels ||
					sample.numberOfFrames * channels * 4 > MAX_WAVEFORM_BLOCK_BYTES
				)
					throw waveformUnsupported(
						"Waveform decoded block exceeds the memory budget or changes format.",
					);
				const start = Math.round(
					(sample.timestamp - sourceOrigin) * sampleRate,
				);
				if (
					!Number.isSafeInteger(start) ||
					start < -sample.numberOfFrames ||
					!Number.isSafeInteger(start + sample.numberOfFrames)
				)
					throw waveformUnsupported(
						"Waveform decoded samples exceed source metadata bounds.",
					);
				// Some containers omit the last packet's duration. The actual decoded
				// block is authoritative; grow a bounded peak layer rather than truncate audio.
				decodedEnd = Math.max(decodedEnd, start + sample.numberOfFrames);
				totalSamples = Math.max(totalSamples, decodedEnd);
				let nextBucketSize = bucketSize;
				while (Math.ceil(totalSamples / nextBucketSize) > 262144)
					nextBucketSize *= 2;
				if (
					nextBucketSize !== bucketSize ||
					Math.ceil(totalSamples / bucketSize) > amplitudes.length
				) {
					const next = new Float32Array(
						Math.min(
							262144,
							Math.max(
								Math.ceil(totalSamples / nextBucketSize),
								nextBucketSize === bucketSize ? amplitudes.length * 2 : 0,
							),
						),
					);
					for (let i = 0; i < amplitudes.length; i++) {
						const index = Math.floor((i * bucketSize) / nextBucketSize);
						next[index] = Math.max(next[index], amplitudes[i]);
					}
					amplitudes = next;
					bucketSize = nextBucketSize;
				}
				const plane = new Float32Array(sample.numberOfFrames);
				for (let channel = 0; channel < channels; channel++) {
					sample.copyTo(plane, { format: "f32-planar", planeIndex: channel });
					for (
						let i = Math.max(0, -start);
						i < plane.length && start + i < totalSamples;
						i++
					) {
						const value = Math.abs(plane[i]);
						if (!Number.isFinite(value))
							throw new Error("Waveform decoder returned non-finite PCM.");
						const index = Math.floor((start + i) / bucketSize);
						amplitudes[index] = Math.max(amplitudes[index], value);
					}
				}
				decodedSamples += sample.numberOfFrames;
			} finally {
				sample.close();
			}
		}
		if (!decodedSamples)
			throw new Error("Waveform decoder returned no audio samples.");
		totalSamples = decodedEnd;
		return {
			sourceKey,
			sampleRate,
			totalSamples,
			bucketSize,
			amplitudes: amplitudes.slice(0, Math.ceil(totalSamples / bucketSize)),
		};
	} finally {
		signal.removeEventListener("abort", abort);
		input.dispose();
	}
}
