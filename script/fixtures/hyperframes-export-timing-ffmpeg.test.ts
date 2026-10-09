import assert from "node:assert/strict";
import { test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { nativeExportTiming } from "./hyperframes-export-timing-native";
import { loopFfmpeg } from "./hyperframes-variable-rate-loop-media";

const native = test.skipIf(process.env.ROCUT_TEST_EXPORT_TIMING !== "1");
const digest = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
function path(name: string) {
	const value = process.env[name];
	assert.ok(
		value && isAbsolute(value),
		`${name} requires an absolute local path`,
	);
	return value;
}

native(
	"original final track filter measures actual FFmpeg delay/trim including the float32 counterexample",
	async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "rocut-hf-export-timing-native-"),
		);
		const report: Record<string, unknown> = {
			status: "running",
			directory,
			cases: [],
		};
		console.log(JSON.stringify({ event: "started", directory }));
		try {
			const ffmpeg = path("ROCUT_TEST_FFMPEG");
			const oracle = await nativeExportTiming(
				path("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN"),
				path("ROCUT_TEST_HYPERFRAMES_ENGINE_DIRECTORY"),
			);
			report.mixerSha256 = oracle.mixerSha256;
			report.declarationsSha256 = oracle.declarationsSha256;
			report.ffmpegSha256 = digest(await readFile(ffmpeg));
			const version = await loopFfmpeg(ffmpeg, ["-version"]);
			report.ffmpegVersion = version.stdout.toString("utf8").split(/\r?\n/)[0];
			for (const sampleRate of [44100, 48000]) {
				const inputFrames = sampleRate / 10 + 1;
				const pcm = Buffer.alloc(inputFrames * 8);
				for (let frame = 0; frame < inputFrames; frame++) {
					pcm.writeFloatLE(0.25, frame * 8);
					pcm.writeFloatLE(-0.125, frame * 8 + 4);
				}
				const inputFile = join(directory, `input-${sampleRate}.f32le`);
				await writeFile(inputFile, pcm, { flag: "wx" });
				for (const start of [
					0,
					0.00049,
					0.0004999999999999999,
					0.0005,
					0.00051,
					1 / sampleRate,
					0.015,
					3.05,
				]) {
					const duration = 0.1 + 0.25 / 48000;
					const total = start > 3 ? 3.2 : 0.2;
					const filter = oracle.build({ start, end: start + duration }, total);
					const { stdout, stderr } = await loopFfmpeg(ffmpeg, [
						"-f",
						"f32le",
						"-ar",
						String(sampleRate),
						"-ac",
						"2",
						"-i",
						inputFile,
						"-filter_complex",
						filter,
						"-map",
						"[a0]",
						"-c:a",
						"pcm_f32le",
						"-f",
						"f32le",
						"pipe:1",
					]);
					assert.equal(stderr.length, 0);
					assert.equal(stdout.length, Math.round(total * sampleRate) * 8);
					let first = -1,
						last = -1;
					for (let frame = 0; frame < stdout.length / 8; frame++) {
						const left = stdout.readFloatLE(frame * 8),
							right = stdout.readFloatLE(frame * 8 + 4);
						if (left !== 0 || right !== 0) {
							assert.equal(left, 0.25);
							assert.equal(right, -0.125);
							if (first < 0) first = frame;
							last = frame;
						}
					}
					const delayMs = Number(/adelay=(\d+)\|/.exec(filter)![1]);
					const float32Prediction = Math.trunc(
						Math.fround(Math.fround(Math.fround(delayMs) * sampleRate) / 1000),
					);
					const exactRationalPrediction = Math.trunc(
						(delayMs * sampleRate) / 1000,
					);
					assert.equal(
						first,
						float32Prediction,
						"Measured binary must confirm, not merely assume, FFmpeg float32 placement",
					);
					assert.equal(
						last - first + 1,
						sampleRate / 10,
						"Original nominal trim removes the extra measured-duration sample",
					);
					if (sampleRate === 44100 && start === 3.05)
						assert.notEqual(first, exactRationalPrediction);
					(report.cases as unknown[]).push({
						sampleRate,
						start,
						inputFrames,
						duration,
						filter,
						first,
						last,
						retainedFrames: last - first + 1,
						float32Prediction,
						exactRationalPrediction,
						pcmSha256: digest(stdout),
					});
				}
				// Native six-decimal formatter, not a direct sample-domain round.
				const trimFilter = oracle.build({ start: 0, end: 0.00003125 }, 0.1);
				const result = await loopFfmpeg(ffmpeg, [
					"-f",
					"f32le",
					"-ar",
					String(sampleRate),
					"-ac",
					"2",
					"-i",
					inputFile,
					"-filter_complex",
					trimFilter,
					"-map",
					"[a0]",
					"-c:a",
					"pcm_f32le",
					"-f",
					"f32le",
					"pipe:1",
				]);
				assert.equal(result.stdout.readFloatLE(0), 0.25);
				assert.equal(result.stdout.readFloatLE(8), 0);
				(report.cases as unknown[]).push({
					sampleRate,
					case: "format6-before-rescale",
					filter: trimFilter,
					retainedFrames: 1,
					pcmSha256: digest(result.stdout),
				});
			}
			report.status = "passed";
		} catch (error) {
			report.status = "failed";
			report.error = error instanceof Error ? error.message : String(error);
			throw error;
		} finally {
			await writeFile(
				join(directory, "verification.json"),
				JSON.stringify(report, null, 2),
				{ flag: "wx" },
			);
			console.log(
				JSON.stringify({ event: "finished", directory, status: report.status }),
			);
		}
	},
	60000,
);
