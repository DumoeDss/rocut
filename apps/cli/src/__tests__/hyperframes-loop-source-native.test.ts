import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { HYPERFRAMES_LOOP_SOURCE_BOOTSTRAP } from "../programmatic/hyperframes-loop-source-bootstrap";
import { hyperframesFloatWav } from "../programmatic/hyperframes-loop-source-wav";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
test.skipIf(!toolchain)("fractional source scheduler embeds the unchanged original oR", () => {
	const original = readFileSync(join(toolchain!, "node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js"), "utf8");
	const native = original.slice(original.indexOf("function oR(e,t)"), original.indexOf("function Ra(e,t,n)"));
	expect(HYPERFRAMES_LOOP_SOURCE_BOOTSTRAP.includes(native)).toBe(true);
});

function realm(lateDecode = false) {
	const starts: number[][] = [], stops: number[] = [];
	let finishDecode: (buffer: unknown) => void = () => {};
	const source = { sampleRate: 48000, length: 24000, numberOfChannels: 2 };
	const output = { length: 8, numberOfChannels: 2, getChannelData: () => new Float32Array(8) };
	class Context {
		destination = {};
		decodeAudioData() { return lateDecode ? new Promise(resolve => { finishDecode = resolve; }) : Promise.resolve(source); }
		createBufferSource() { return { buffer: null, playbackRate: { value: 0 },
			connect() {}, disconnect() {}, start(...args: number[]) { starts.push(args); }, stop() { stops.push(1); } }; }
		startRendering() { return Promise.resolve(output); }
	}
	const window: Record<string, unknown> = { OfflineAudioContext: Context };
	runInNewContext(HYPERFRAMES_LOOP_SOURCE_BOOTSTRAP, { window, Uint8Array, Float32Array, DataView, Number, Error,
		atob: (value: string) => Buffer.from(value, "base64").toString("binary"),
		btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
	});
	const io = window.rocutNativeLoopSourceIO as {
		configure(value: unknown, length: number): void; put(offset: number, value: string): void;
		render(): Promise<unknown>; dispose(): void; read(offset: number, count: number): string;
	};
	io.configure({ profile: "hyperframes-0.8.139-native-buffer-loop-clock-v1", sampleRate: 48000,
		outputFrames: 8, maxSourceFrames: 24098, segments: [
			{ elapsedSeconds: 0, mediaStartSeconds: 0.10000520833333335, durationSeconds: 0.00001041875 },
			{ elapsedSeconds: -0.00001041875, mediaStartSeconds: 0.10000520833333335, durationSeconds: 0.00001041875 },
			{ elapsedSeconds: -0.0000208375, mediaStartSeconds: 0.10000520833333335, durationSeconds: 0.000005 },
		] }, 1);
	io.put(0, "AQ==");
	return { io, starts, stops, finish() { finishDecode(source); } };
}

test("native source receives fractional offsets, wrap start and final duration unchanged", async () => {
	const r = realm(); await r.io.render();
	expect(r.starts).toEqual([
		[0, 0.10000520833333335, 0.00001041875],
		[0.00001041875, 0.10000520833333335, 0.00001041875],
		[0.0000208375, 0.10000520833333335, 0.000005],
	]);
	expect(Buffer.from(r.io.read(0, 64), "base64").length).toBe(64);
	r.io.dispose(); expect(r.stops.length).toBe(3);
});

test("late native decode cannot schedule or publish after disposal", async () => {
	const r = realm(true), rendering = r.io.render();
	r.io.dispose(); r.finish();
	await expect(rendering).rejects.toThrow("disposed");
	expect(r.starts.length).toBe(0);
	expect(() => r.io.read(0, 8)).toThrow();
});

test("native Float32 WAV container preserves bytes and rejects padding or nonfinite PCM", () => {
	const pcm = Buffer.alloc(16); pcm.writeFloatLE(0.123, 0); pcm.writeFloatLE(-0.456, 4);
	const wav = hyperframesFloatWav(pcm, 2, 60);
	expect(wav.subarray(44).equals(pcm)).toBe(true);
	expect(wav.readUInt16LE(20)).toBe(3); expect(wav.readUInt32LE(24)).toBe(48000);
	expect(() => hyperframesFloatWav(pcm, 3, 100)).toThrow();
	pcm.writeFloatLE(NaN, 0); expect(() => hyperframesFloatWav(pcm, 2, 60)).toThrow();
});
