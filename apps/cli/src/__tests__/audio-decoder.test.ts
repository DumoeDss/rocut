import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { decodeNativeAudioSegment, type NativeAudioDecodeRequest } from "../programmatic/audio-decoder";
import { renderNativeAudioObservations } from "../programmatic/native-audio-render";
import { runNativeMediaProcess } from "../programmatic/native-media-process";
import { nativeAudioWav, nativeSineWav, pcmFrequency } from "../../../../script/fixtures/native-audio-fixture";

const ffmpeg = process.env.ROCUT_TEST_FFMPEG, ffprobe = process.env.ROCUT_TEST_FFPROBE;
const signal = () => AbortSignal.timeout(15000);
const decoder = { ffmpeg: ffmpeg!, ffprobe: ffprobe! };
const request: NativeAudioDecodeRequest = { mimeType: "audio/wav", audioStreamIndex: 0,
	sampleRate: 48000, sourceSample: 4800, frames: 9600, playbackRate: 1, toneFrequency: 1 };
const decode = (body: Buffer, options = {}, abort = signal()) => decodeNativeAudioSegment({ decoder, body,
	request: { ...request, ...options }, signal: abort });

test.skipIf(!ffmpeg || !ffprobe)("PCM decode preserves stereo samples, trims exactly, pads EOF and recovers after rejection/cancellation", async () => {
	const before = new Set((await readdir(tmpdir())).filter(n => n.startsWith("rocut-native-audio-")));
	const wave = nativeAudioWav({ seconds: 1, sample: (i, c) => i / 48000 * (c ? -0.5 : 1) });
	const result = await decode(wave);
	expect(result.hasAudio).toBe(true); expect(result.pcm.length).toBe(9600 * 8);
	for (const i of [0, 1, 1500, 5000, 9599]) for (const c of [0, 1])
		expect(result.pcm.readFloatLE(i * 8 + c * 4)).toBeCloseTo((4800 + i) / 48000 * (c ? -0.5 : 1), 6);
	const tail = await decode(wave, { sourceSample: 47000, frames: 2000 });
	expect(tail.pcm.readFloatLE(999 * 8)).toBeCloseTo(47999 / 48000, 6);
	expect(tail.pcm.subarray(1000 * 8).every(byte => byte === 0)).toBe(true);
	expect((await decode(wave, { sourceSample: 96000 })).pcm.every(byte => byte === 0)).toBe(true);
	for (const body of [Buffer.from([1, 2, 3]), Buffer.from("#EXTM3U\nfile:///private.wav")])
		await expect(decode(body)).rejects.toThrow("decoder failed");
	await expect(decode(wave, { frames: 20_000_000 })).rejects.toThrow("excessive");
	await expect(decode(wave, { audioStreamIndex: 1 })).rejects.toThrow("does not exist");
	const abort = new AbortController(), pending = decode(wave, {}, abort.signal);
	setTimeout(() => abort.abort(), 1); await expect(pending).rejects.toThrow();
	expect((await decode(wave)).pcm.equals(result.pcm)).toBe(true);
	expect((await readdir(tmpdir())).filter(n => n.startsWith("rocut-native-audio-") && !before.has(n))).toEqual([]);
}, 30000);

test.skipIf(!ffmpeg || !ffprobe)("playback speed preserves pitch while toneFrequency changes pitch independently", async () => {
	const wave = nativeSineWav(440);
	for (const playbackRate of [0.25, 1, 2, 4]) {
		const { pcm } = await decode(wave, { playbackRate });
		expect(Math.abs(pcmFrequency(pcm, 48000) - 440)).toBeLessThan(7);
		expect(pcm.length).toBe(9600 * 8);
	}
	const shifted = await decode(wave, { playbackRate: 2, toneFrequency: 1.5 });
	expect(Math.abs(pcmFrequency(shifted.pcm, 48000) - 660)).toBeLessThan(7);
}, 30000);

test.skipIf(!ffmpeg || !ffprobe)("real MP3/Ogg/FLAC and MP4 stream selection decode, with video-relative delayed audio preserved", async () => {
	const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, "rocut-audio-codecs-"));
	const run = (args: string[]) => runNativeMediaProcess({ executable: ffmpeg!, media: "audio", args: ["-v", "error", "-nostdin", ...args], signal: signal(), maxBytes: 1024 });
	try {
		const one = join(root, "one.wav"), two = join(root, "two.wav");
		await writeFile(one, nativeSineWav(440)); await writeFile(two, nativeSineWav(880));
		for (const [ext, codec, mimeType] of [["mp3", "libmp3lame", "audio/mpeg"], ["ogg", "libvorbis", "audio/ogg"], ["flac", "flac", "audio/flac"]]) {
			const path = join(root, `source.${ext}`); await run(["-i", one, "-c:a", codec, path]);
			const { pcm } = await decode(await readFile(path), { mimeType, sampleRate: 44100 });
			expect(Math.abs(pcmFrequency(pcm, 44100) - 440)).toBeLessThan(7);
		}
		const multi = join(root, "multi.mp4");
		await run(["-f", "lavfi", "-i", "color=black:s=16x16:r=30:d=2", "-i", one, "-i", two,
			"-map", "0:v:0", "-map", "1:a:0", "-map", "2:a:0", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", multi]);
		const body = await readFile(multi);
		for (const [audioStreamIndex, frequency] of [[0, 440], [1, 880]]) {
			const result = await decode(body, { mimeType: "video/mp4", audioStreamIndex });
			expect(Math.abs(pcmFrequency(result.pcm, 48000) - frequency)).toBeLessThan(7);
		}
		await expect(decode(body, { mimeType: "video/mp4", audioStreamIndex: 2 })).rejects.toThrow("does not exist");
		const delayed = join(root, "delayed.mp4");
		await run(["-f", "lavfi", "-i", "color=black:s=16x16:r=30:d=2", "-itsoffset", "0.25", "-i", one,
			"-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-threads", "1", "-c:a", "alac", delayed]);
		const late = await decode(await readFile(delayed), { mimeType: "video/mp4", sourceSample: 0, frames: 24000 });
		let onset = 0; while (onset < 24000 && Math.abs(late.pcm.readFloatLE(onset * 8)) < 0.01) onset++;
		expect(Math.abs(onset - 12000)).toBeLessThanOrEqual(2);
		const silent = join(root, "silent.mp4"); await run(["-i", multi, "-map", "0:v:0", "-c", "copy", silent]);
		expect(await decode(await readFile(silent), { mimeType: "video/mp4" })).toEqual({ pcm: Buffer.alloc(0), hasAudio: false });
	} finally {
		if (dirname(root) !== parent || !basename(root).startsWith("rocut-audio-codecs-")) throw Error("Unsafe codec fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

test.skipIf(!ffmpeg || !ffprobe)("observation schedule, real decoder and Rust mixing produce exact frame gain and stereo overlap", async () => {
	const body = nativeAudioWav({ sample: (i, c) => i / 96000 * (c ? -0.5 : 1) }), mimeType = "audio/wav";
	const id = createHash("sha256").update(mimeType).update("\0").update(body).digest("hex");
	const asset = (time: number, volume: number, name = "main") => ({ id: name, resourceId: id, type: "audio" as const,
		sourceTime: time, playbackRate: 1, toneFrequency: 1, audioStreamIndex: 0, volume });
	const mixed = await renderNativeAudioObservations({ decoder, signal: signal(), sampleRate: 48000,
		frameRate: { numerator: 30, denominator: 1 }, firstFrame: 0,
		sources: [{ id, body, mimeType, src: `data:${mimeType};base64,${body.toString("base64")}` }],
		frames: [{ frameIndex: 0, assets: [asset(0.1, 0.25)] },
			{ frameIndex: 1, assets: [asset(0.1 + 1 / 30, 0.5), asset(0.2, 1, "overlay")] },
			{ frameIndex: 2, assets: [] }],
	});
	expect(mixed).toMatchObject({ frames: 4800, channels: 2, sampleRate: 48000, hasAudio: true });
	for (const i of [0, 500, 1599, 1600, 1700, 3199, 3200, 4799]) for (const c of [0, 1]) {
		const expected = i >= 3200 ? 0 : i < 1600 ? (4800 + i) / 96000 * 0.25
			: (4800 + i) / 96000 * 0.5 + (9600 + i - 1600) / 96000;
		expect(mixed.pcm.readFloatLE(i * 8 + c * 4)).toBeCloseTo(expected * (c ? -0.5 : 1), 6);
	}
}, 15000);
