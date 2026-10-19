import { beforeEach, expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.EDITOR_PREVIEW_DECODER_TEST !== "1") {
	test("preview decoding handles short sources and releases samples", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, EDITOR_PREVIEW_DECODER_TEST: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0)
			throw new Error(result.stdout.toString() + result.stderr.toString());
	});
} else {
	const sampled: number[] = [];
	let closed = 0;
	let disposed = 0;
	let supported = true;
	let firstTimestamp = 0;
	let videoEnd = 0.1;
	beforeEach(() => {
		sampled.length = 0;
		closed = 0;
		disposed = 0;
		supported = true;
		firstTimestamp = 0;
		videoEnd = 0.1;
	});
	mock.module("mediabunny", () => ({
		ALL_FORMATS: [],
		BlobSource: class {},
		Input: class {
			async getPrimaryVideoTrack() {
				return {
					displayWidth: 320,
					displayHeight: 180,
					canDecode: async () => supported,
					getFirstTimestamp: async () => firstTimestamp,
					computeDuration: async () => videoEnd,
				};
			}
			async computeDuration() {
				return 12; // A longer audio track must not set the video boundary.
			}
			dispose() {
				disposed++;
			}
		},
		VideoSampleSink: class {
			async getSample(time: number) {
				sampled.push(time);
				if (time < firstTimestamp || time >= videoEnd) return null;
				return {
					draw: () => {},
					close: () => {
						closed++;
					},
				};
			}
		},
	}));
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {
			createElement: () => ({
				getContext: () => ({}),
				toDataURL: () => "data:image/jpeg;base64,frame",
			}),
		},
	});
	test("clamps zero posters to a positive video start and uses the video end", async () => {
		firstTimestamp = 0.05;
		for (const time of [0, 12]) {
			const result = await decodePreviewFrame({
				file: new File(["video"], "offset.mp4"),
				time,
				signal: new AbortController().signal,
			});
			expect(result.status).toBe("ready");
		}
		expect(sampled.slice(-2)).toEqual([0.05, 0.099]);
		firstTimestamp = 0;
	});
	const { decodePreviewFrame } = await import("../preview-resource");
	test("normalizes negative and nonfinite requests without presenting negative preroll", async () => {
		firstTimestamp = -0.05;
		for (const time of [-1, NaN, Infinity, -Infinity]) {
			expect(
				await decodePreviewFrame({
					file: new File(["video"], "preroll.mp4"),
					time,
					signal: new AbortController().signal,
				}),
			).toEqual({ status: "ready", url: "data:image/jpeg;base64,frame" });
		}
		expect(sampled).toEqual([0, 0, 0, 0]);
		expect(closed).toBe(4);
		expect(disposed).toBe(4);
	});
	test("keeps a sub-millisecond positive track inside its video range", async () => {
		firstTimestamp = 0.05;
		videoEnd = 0.0505;
		expect(
			(
				await decodePreviewFrame({
					file: new File(["video"], "tiny.mp4"),
					time: 1,
					signal: new AbortController().signal,
				})
			).status,
		).toBe("ready");
		expect(sampled).toEqual([0.05]);
	});
	test("rejects empty, negative-only, reversed and nonfinite video ranges before sampling", async () => {
		for (const [first, end] of [
			[0, 0],
			[-0.1, -0.01],
			[0.1, 0.05],
			[NaN, 0.1],
			[Infinity, 0.1],
			[-Infinity, 0.1],
			[0, NaN],
			[0, Infinity],
		]) {
			firstTimestamp = first;
			videoEnd = end;
			expect(
				await decodePreviewFrame({
					file: new File(["video"], "empty.mp4"),
					time: 0,
					signal: new AbortController().signal,
				}),
			).toEqual({ status: "failed", error: "No visible video time range" });
		}
		expect(sampled).toEqual([]);
		expect(closed).toBe(0);
		expect(disposed).toBe(8);
	});
	test("clamps poster requests inside a sub-second source and closes frame/input", async () => {
		const file = new File(["video"], "short.mp4");
		const result = await decodePreviewFrame({
			file,
			time: 1,
			signal: new AbortController().signal,
		});
		expect(result.status).toBe("ready");
		expect(sampled).toEqual([0.099]);
		expect(closed).toBe(1);
		expect(disposed).toBe(1);
	});
	test("distinguishes offline and unsupported without claiming a decoder failure", async () => {
		expect(
			(
				await decodePreviewFrame({
					file: new File([], "missing.mp4"),
					time: 0,
					signal: new AbortController().signal,
				})
			).status,
		).toBe("offline");
		supported = false;
		expect(
			(
				await decodePreviewFrame({
					file: new File(["video"], "unsupported.mp4"),
					time: 0,
					signal: new AbortController().signal,
				})
			).status,
		).toBe("unsupported");
		expect(closed).toBe(0);
		expect(disposed).toBe(1);
	});
}
