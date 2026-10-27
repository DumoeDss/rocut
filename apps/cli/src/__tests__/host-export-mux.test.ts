import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { muxNativeExport } from "../host-export-mux";
import type { NativeExportRecord } from "../host-export-native";
import { runNativeMediaProcess } from "../programmatic/native-media-process";

const enabled =
	!!process.env.ROCUT_NATIVE_FFMPEG_PATH &&
	!!process.env.ROCUT_NATIVE_FFPROBE_PATH;const cases = (["mp4", "webm"] as const).flatMap((format) =>
	[30, 31].map((segmentFrames) => ({ format, segmentFrames })),
);
for (const { format, segmentFrames } of cases)
	test.skipIf(!enabled)(
		`real ${format} native mux preserves ${segmentFrames}-frame segments and continuous decoded audio across a seam`,
		async () => {
			const segmentSamples = segmentFrames * 1600;
			const totalFrames = segmentFrames * 2;
			const totalSamples = segmentSamples * 2;
			const temporary = await mkdtemp(
				path.join(os.tmpdir(), "rocut-mux-test-"),
			);
			const signal = new AbortController().signal;
			const run = (
				executable: string,
				args: string[],
				maxBytes = 1024 * 1024,
			) =>
				runNativeMediaProcess({
					executable,
					args,
					maxBytes,
					signal,
					media: "video",
					timeoutMs: 60000,
				});
			const ffmpeg = process.env.ROCUT_NATIVE_FFMPEG_PATH!,
				ffprobe = process.env.ROCUT_NATIVE_FFPROBE_PATH!;
			try {
				const sources = new Map<
					string,
					{ record: NativeExportRecord; bytes: Buffer }
				>();
				const segments = [];
				for (let i = 0; i < 2; i++) {
					const file = path.join(temporary, `${i}.${format}`),
						raw = path.join(temporary, `${i}.rgb`);
					const pixels = Buffer.alloc(segmentFrames * 64 * 64 * 3);
					for (let frame = 0; frame < segmentFrames; frame++)
						pixels.fill(
							20 + 3 * (i * segmentFrames + frame),
							frame * 64 * 64 * 3,
							(frame + 1) * 64 * 64 * 3,
						);
					await writeFile(raw, pixels);
					await run(ffmpeg, [
						"-v",
						"error",
						"-nostdin",
						"-f",
						"rawvideo",
						"-pix_fmt",
						"rgb24",
						"-s",
						"64x64",
						"-r",
						"30",
						"-i",
						raw,
						"-f",
						"lavfi",
						"-i",
						`aevalsrc=0.25*sin(2*PI*437.5*(t+${i * segmentFrames / 30})):s=44100:d=${segmentFrames / 30}`,
						"-ac",
						"2",
						"-c:v",
						format === "mp4" ? "libopenh264" : "libvpx-vp9",
						"-pix_fmt",
						"yuv420p",
						"-c:a",
						format === "mp4" ? "aac" : "libopus",
						"-n",
						file,
					]);
					const bytes = await readFile(file),
						sha256 = createHash("sha256").update(bytes).digest("hex"),
						jobId = String(i + 1).padStart(36, "0");
					const record = {
						phase: "completed",
						jobId,
						output: { sha256, bytes: bytes.length },
						request: {
							options: {
								format,
								includeAudio: true,
								range: { startTime: i * segmentFrames * 4000, endTime: (i + 1) * segmentFrames * 4000 },
							},
						},
					} as NativeExportRecord;
					sources.set(jobId, { record, bytes });
					segments.push({
						nativeJobId: jobId,
						outputSha256: sha256,
						scopeDigest: "a".repeat(64),
						startFrame: i * segmentFrames,
						frameCount: segmentFrames,
						sampleCount: segmentSamples,
					});
				}
				const output = await muxNativeExport({
					options: {
						format,
						quality: "high",
						includeAudio: true,
						range: { startTime: 0, endTime: totalFrames * 4000 },
						mux: {
							version: 1,
							frameRate: { numerator: 30, denominator: 1 },
							sampleRate: 48000,
							segments,
						},
					},
					signal,
					read: async (id) => sources.get(id)!,
				});
				const final = path.join(temporary, `final.${format}`);
				await writeFile(final, output);
				const info = JSON.parse(
					(
						await run(ffprobe, [
							"-v",
							"error",
							"-count_frames",
							"-show_entries",
							"stream=codec_type,nb_read_frames,duration_ts,time_base",
							"-of",
							"json",
							final,
						])
					).toString("utf8"),
				);
				expect(
					info.streams.find((s: any) => s.codec_type === "video")
						.nb_read_frames,
				).toBe(String(totalFrames));
				const audio = info.streams.find((s: any) => s.codec_type === "audio");
				if (format === "mp4") {
					expect(audio.time_base).toBe("1/48000");
					expect(audio.duration_ts).toBe(totalSamples);
				}
				const rgb = await run(
					ffmpeg,
					[
						"-v",
						"error",
						"-nostdin",
						"-i",
						final,
						"-map",
						"0:v:0",
						"-pix_fmt",
						"rgb24",
						"-f",
						"rawvideo",
						"pipe:1",
					],
					64 * 64 * 3 * (totalFrames + 1),
				);
				for (let frame = 0; frame < totalFrames; frame++) {
					const at = frame * 64 * 64 * 3;
					expect(Math.abs(rgb[at] - (20 + 3 * frame))).toBeLessThan(3);
				}
				const pcm = await run(
					ffmpeg,
					[
						"-v",
						"error",
						"-nostdin",
						"-i",
						final,
						"-map",
						"0:a:0",
						"-ac",
						"2",
						"-ar",
						"48000",
						"-f",
						"f32le",
						"pipe:1",
					],
					(totalSamples + 8192) * 8,
				);
				let seamError = 0;
				for (let sample = segmentSamples - 480; sample < segmentSamples + 480; sample++) {
					const expected =
						0.25 *
						Math.SQRT1_2 *
						Math.sin((2 * Math.PI * 437.5 * sample) / 48000);
					seamError += (pcm.readFloatLE(sample * 8) - expected) ** 2;
				}
				expect(Math.sqrt(seamError / 960)).toBeLessThan(0.025);
			} finally {
				await rm(temporary, { recursive: true, force: true });
			}
		},
		120000,
	);

	test.skipIf(!enabled)(
		"real mp4 native mux synthesizes exact silence for video-only segments",
		async () => {
			const temporary = await mkdtemp(path.join(os.tmpdir(), "rocut-mux-silent-"));
			const signal = new AbortController().signal;
			try {
				const ffmpeg = process.env.ROCUT_NATIVE_FFMPEG_PATH!,
					ffprobe = process.env.ROCUT_NATIVE_FFPROBE_PATH!;
				const run = (executable: string, args: string[], maxBytes = 1024 * 1024) =>
					runNativeMediaProcess({
						executable,
						args,
						maxBytes,
						signal,
						media: "video",
						timeoutMs: 60000,
					});
				const segmentFrames = 31,
					segmentSamples = segmentFrames * 1600,
					totalFrames = segmentFrames * 2,
					totalSamples = segmentSamples * 2;
				const sources = new Map<string, { record: NativeExportRecord; bytes: Buffer }>();
				const segments = [];
				for (let i = 0; i < 2; i++) {
					const file = path.join(temporary, `${i}.mp4`),
						raw = path.join(temporary, `${i}.rgb`);
					const pixels = Buffer.alloc(segmentFrames * 64 * 64 * 3);
					pixels.fill(30 + 60 * i);
					await writeFile(raw, pixels);
					// Silent timelines render video-only segments: no audio input here.
					await run(ffmpeg, [
						"-v", "error", "-nostdin",
						"-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "64x64", "-r", "30",
						"-i", raw,
						"-c:v", "libopenh264", "-pix_fmt", "yuv420p", "-n",
						file,
					]);
					const bytes = await readFile(file),
						sha256 = createHash("sha256").update(bytes).digest("hex"),
						jobId = String(i + 1).padStart(36, "0");
					sources.set(jobId, {
						record: {
							phase: "completed",
							jobId,
							output: { sha256, bytes: bytes.length },
							request: {
								options: {
									format: "mp4",
									includeAudio: true,
									range: {
										startTime: i * segmentFrames * 4000,
										endTime: (i + 1) * segmentFrames * 4000,
									},
								},
							},
						} as NativeExportRecord,
						bytes,
					});
					segments.push({
						nativeJobId: jobId,
						outputSha256: sha256,
						scopeDigest: "a".repeat(64),
						startFrame: i * segmentFrames,
						frameCount: segmentFrames,
						sampleCount: segmentSamples,
					});
				}
				const output = await muxNativeExport({
					options: {
						format: "mp4",
						quality: "high",
						includeAudio: true,
						range: { startTime: 0, endTime: totalFrames * 4000 },
						mux: {
							version: 1,
							frameRate: { numerator: 30, denominator: 1 },
							sampleRate: 48000,
							segments,
						},
					},
					signal,
					read: async (id) => sources.get(id)!,
				});
				const final = path.join(temporary, "final.mp4");
				await writeFile(final, output);
				const info = JSON.parse(
					(
						await run(ffprobe, [
							"-v", "error", "-count_frames",
							"-show_entries", "stream=codec_type,nb_read_frames,duration_ts,time_base",
							"-of", "json",
							final,
						])
					).toString("utf8"),
				);
				expect(
					info.streams.find((s: any) => s.codec_type === "video").nb_read_frames,
				).toBe(String(totalFrames));
				const audio = info.streams.find((s: any) => s.codec_type === "audio");
				expect(audio).toBeDefined();
				expect(audio.time_base).toBe("1/48000");
				expect(audio.duration_ts).toBe(totalSamples);
			} finally {
				await rm(temporary, { recursive: true, force: true });
			}
		},
		120000,
	);
