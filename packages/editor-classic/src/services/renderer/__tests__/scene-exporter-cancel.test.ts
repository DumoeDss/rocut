/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- isolated native encoder and renderer doubles exercise cancellation ownership without a GPU. */
import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { WasmCompositor } from "../compositor/wasm-compositor";
import type { VideoCache } from "../../video-cache/service";
import type { RootNode } from "../nodes/root-node";

if (process.env.ROCUT_EXPORT_CANCEL_ISOLATED !== "1") {
	test("export cancellation integration runs with isolated native mocks", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: { ...process.env, ROCUT_EXPORT_CANCEL_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (result.exitCode !== 0) throw Error(result.stderr.toString());
	});
} else {
	let blocked = true,
		lockHeld = false,
		added = 0,
		cancelledOutputs = 0,
		finalizedOutputs = 0;
	let audioBlocked = false;
	let softwareSupported = true,
		capabilityError = false;
	const encoderOptions: unknown[] = [];
	class FakeOutput {
		target = { buffer: new ArrayBuffer(4) };
		addVideoTrack() {}
		addAudioTrack() {}
		async start() {}
		async cancel() {
			cancelledOutputs++;
		}
		async finalize() {
			finalizedOutputs++;
		}
	}
	mock.module("mediabunny", () => ({
		canEncodeVideo: async () => {
			if (capabilityError) throw Error("capability unavailable");
			return softwareSupported;
		},
		Output: FakeOutput,
		Mp4OutputFormat: class {},
		WebMOutputFormat: class {},
		BufferTarget: class {},
		CanvasSource: class {
			// eslint-disable-next-line opencut/prefer-object-params -- matches the third-party CanvasSource constructor used by production.
			constructor(_canvas: unknown, options: unknown) {
				encoderOptions.push(options);
			}
			add() {
				added++;
				return blocked ? new Promise<void>(() => {}) : Promise.resolve();
			}
			close() {}
		},
		AudioBufferSource: class {
			add() {
				added++;
				return audioBlocked ? new Promise<void>(() => {}) : Promise.resolve();
			}
			close() {}
		},
		QUALITY_LOW: 1,
		QUALITY_MEDIUM: 2,
		QUALITY_HIGH: 3,
		QUALITY_VERY_HIGH: 4,
	}));
	mock.module("opencut-wasm", () => ({
		mediaTimeToSeconds: ({ time }: { time: number }) => time / 120000,
	}));
	mock.module("../../../wasm", () => ({ TICKS_PER_SECOND: 120000 }));
	mock.module("../../../fps/utils", () => ({ frameRateToFloat: () => 30 }));
	mock.module("../canvas-renderer", () => ({
		CanvasRenderer: class {
			fps = { numerator: 30, denominator: 1 };
			async getOutputCanvas() {
				return { width: 1920, height: 1080 };
			}
			async renderAndCapture({ capture }: { capture: () => Promise<void> }) {
				if (lockHeld) throw Error("previous export retained the render lock");
				lockHeld = true;
				try {
					await capture();
				} finally {
					lockHeld = false;
				}
			}
		},
	}));
	const { SceneExporter } = await import("../scene-exporter");
	function exporter(audio = false) {
		return new SceneExporter({
			width: 1920,
			height: 1080,
			fps: { numerator: 30, denominator: 1 },
			format: "mp4",
			quality: "high",
			compositor: {} as WasmCompositor,
			videoCache: {} as VideoCache,
			shouldIncludeAudio: audio,
			audioBuffer: audio
				? ({ sampleRate: 48000, numberOfChannels: 1 } as AudioBuffer)
				: undefined,
		});
	}
	const options = {
		rootNode: {} as RootNode,
		range: { startTime: 0, endTime: 8000, duration: 8000 },
	};
	test("cancel breaks video backpressure, releases the compositor, and permits a fresh export", async () => {
		const first = exporter();
		let events = 0;
		first.on("cancelled", () => events++);
		const run = first.export(options);
		while (added === 0) await Promise.resolve();
		expect(lockHeld).toBe(true);
		const cancellation = first.cancel();
		expect(
			await Promise.race([cancellation, Bun.sleep(100).then(() => "timeout")]),
		).toBeNull();
		expect(await run).toBeNull();
		expect(lockHeld).toBe(false);
		expect(events).toBe(1);
		expect(cancelledOutputs).toBe(1);
		blocked = false;
		expect(await exporter().export(options)).toBeInstanceOf(ArrayBuffer);
		expect(encoderOptions.at(-1)).toEqual({
			codec: "avc",
			bitrate: 3,
			hardwareAcceleration: "prefer-software",
		});
		expect(finalizedOutputs).toBe(1);
	});
	test("cancel also breaks a stalled audio add", async () => {
		audioBlocked = true;
		added = 0;
		const next = exporter(true);
		const run = next.export(options);
		while (added === 0) await Promise.resolve();
		expect(
			await Promise.race([next.cancel(), Bun.sleep(100).then(() => "timeout")]),
		).toBeNull();
		expect(await run).toBeNull();
		expect(cancelledOutputs).toBe(2);
	});
	test("unsupported or failed optional software probes preserve prior codec and quality", async () => {
		const { resolveExportVideoOptions } =
			await import("../export-video-options");
		const params = {
			codec: "avc" as const,
			bitrate: 8_000_000,
			width: 1920,
			height: 1080,
		};
		softwareSupported = false;
		expect(await resolveExportVideoOptions(params)).toEqual({
			codec: "avc",
			bitrate: 8_000_000,
		});
		capabilityError = true;
		expect(await resolveExportVideoOptions(params)).toEqual({
			codec: "avc",
			bitrate: 8_000_000,
		});
	});
}
