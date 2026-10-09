import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const digest = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");

/** Fixture IO only. Native code still supplies every filter, rate and sample
 * conversion. No authored project code, browser or network is involved. */
export function variableRateIo(ffmpeg: string, ffprobe: string) {
	const calls: { args: string[]; success: boolean; stderr: string }[] = [];
	return {
		calls,
		async runFfmpeg(
			args: string[],
			options: { signal?: AbortSignal; timeout: number },
		) {
			const started = performance.now();
			try {
				const { stderr } = await execute(ffmpeg, args, {
					windowsHide: true,
					signal: options.signal,
					timeout: options.timeout,
					maxBuffer: 4 * 1024 * 1024,
					encoding: "utf8",
				});
				calls.push({
					args: [...args],
					success: true,
					stderr: stderr.slice(-2000),
				});
				return {
					success: true,
					exitCode: 0,
					stderr,
					durationMs: performance.now() - started,
					terminationReason: "exit",
				};
			} catch (error) {
				const failure = error as Error & {
					code?: number | string;
					stderr?: string;
					killed?: boolean;
				};
				const stderr = failure.stderr ?? failure.message;
				calls.push({
					args: [...args],
					success: false,
					stderr: stderr.slice(-2000),
				});
				return {
					success: false,
					exitCode: typeof failure.code === "number" ? failure.code : null,
					stderr,
					durationMs: performance.now() - started,
					terminationReason: options.signal?.aborted
						? "abort"
						: failure.killed
							? "deadline"
							: "exit",
					error: failure,
				};
			}
		},
		async extractAudioMetadata(path: string) {
			const { stdout } = await execute(
				ffprobe,
				[
					"-v",
					"error",
					"-select_streams",
					"a:0",
					"-show_entries",
					"stream=channels",
					"-of",
					"json",
					path,
				],
				{
					windowsHide: true,
					timeout: 15000,
					maxBuffer: 1024 * 1024,
					encoding: "utf8",
				},
			);
			const value = JSON.parse(stdout);
			if (!Number.isInteger(value.streams?.[0]?.channels))
				throw Error("Missing real FFprobe channel count");
			return { channels: value.streams[0].channels as number };
		},
		async decode(path: string) {
			const { stdout } = await execute(
				ffmpeg,
				[
					"-v",
					"error",
					"-i",
					path,
					"-map",
					"0:a:0",
					"-c:a",
					"pcm_f32le",
					"-f",
					"f32le",
					"pipe:1",
				],
				{
					windowsHide: true,
					timeout: 15000,
					maxBuffer: 16 * 1024 * 1024,
					encoding: "buffer",
				},
			);
			return stdout;
		},
	};
}

export async function readNativePreparedWav(path: string) {
	const bytes = await readFile(path);
	if (
		bytes.toString("ascii", 0, 4) !== "RIFF" ||
		bytes.toString("ascii", 8, 12) !== "WAVE"
	)
		throw Error("Expected native RIFF output");
	let format:
		| { kind: number; channels: number; sampleRate: number; bits: number }
		| undefined;
	let samples: Buffer | undefined;
	for (let at = 12; at + 8 <= bytes.length; ) {
		const id = bytes.toString("ascii", at, at + 4),
			count = bytes.readUInt32LE(at + 4),
			body = at + 8;
		if (body + count > bytes.length) throw Error("Truncated native WAV chunk");
		if (id === "fmt ")
			format = {
				kind: bytes.readUInt16LE(body),
				channels: bytes.readUInt16LE(body + 2),
				sampleRate: bytes.readUInt32LE(body + 4),
				bits: bytes.readUInt16LE(body + 14),
			};
		if (id === "data") samples = bytes.subarray(body, body + count);
		at = body + count + (count & 1);
	}
	if (
		!format ||
		!samples ||
		format.kind !== 1 ||
		format.channels !== 2 ||
		format.sampleRate !== 48000 ||
		format.bits !== 16 ||
		samples.length % 4
	)
		throw Error("Native exporter preparation format changed");
	const pcm = Buffer.alloc(samples.length * 2);
	for (let at = 0; at < samples.length; at += 2)
		pcm.writeFloatLE(samples.readInt16LE(at) / 32768, at * 2);
	return { format, frames: samples.length / 4, pcm, wavSha256: digest(bytes) };
}

export function pcmDifference(a: Buffer, b: Buffer) {
	if (a.length !== b.length) throw Error("PCM comparison geometry differs");
	let maximum = 0,
		squares = 0;
	for (let at = 0; at < a.length; at += 4) {
		const difference = a.readFloatLE(at) - b.readFloatLE(at);
		if (!Number.isFinite(difference)) throw Error("Nonfinite native PCM");
		maximum = Math.max(maximum, Math.abs(difference));
		squares += difference * difference;
	}
	return { maximum, rms: Math.sqrt(squares / (a.length / 4)) };
}
