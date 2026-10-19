import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.EDITOR_WAVEFORM_STREAM_TEST !== "1") {
	test("streamed decoder origin and decoded block bounds run in isolation", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, EDITOR_WAVEFORM_STREAM_TEST: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	let closed = 0,
		disposed = 0,
		oversized = false;
	mock.module("mediabunny", () => ({
		ALL_FORMATS: [],
		BlobSource: class {},
		Input: class {
			getPrimaryAudioTrack = async () => ({
				canDecode: async () => true,
				sampleRate: 48000,
				numberOfChannels: 1,
				getFirstTimestamp: async () => 2,
				computeDuration: async () => 2.192,
			});
			dispose() {
				disposed++;
			}
		},
		AudioSampleSink: class {
			async *samples() {
				for (const timestamp of [2, 2.1])
					yield {
						timestamp,
						sampleRate: 48000,
						numberOfChannels: 1,
						numberOfFrames: oversized ? 5000000 : 4800,
						copyTo: (data: Float32Array) => data.fill(0.5),
						close: () => {
							closed++;
						},
					};
			}
		},
	}));
	const { decodeWaveformSource } = await import("../decode-source");
	test("normalizes a positive stream origin and keeps decoded tail omitted by container metadata", async () => {
		const summary = await decodeWaveformSource({
			sourceKey: "offset",
			file: new Blob(["source"]),
			signal: new AbortController().signal,
		});
		expect(summary.totalSamples).toBe(9600);
		expect(summary.amplitudes.length).toBe(75);
		expect(summary.amplitudes[0]).toBe(0.5);
		expect(summary.amplitudes[74]).toBe(0.5);
		expect(closed).toBe(2);
		expect(disposed).toBe(1);
	});
	test("oversized decoded blocks reject explicitly and close sample/input without a silent summary", async () => {
		oversized = true;
		await expect(
			decodeWaveformSource({
				sourceKey: "budget",
				file: new Blob(["source"]),
				signal: new AbortController().signal,
			}),
		).rejects.toMatchObject({ name: "NotSupportedError" });
		expect(closed).toBe(3);
		expect(disposed).toBe(2);
	});
}
