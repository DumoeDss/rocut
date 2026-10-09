import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { nativeAudioWav } from "./native-audio-fixture";
import { fractionalLoopClock } from "./hyperframes-fractional-phase-clock";
import {
	fractionalDifference,
	graphRatePcm,
	nativeFractionalPlacement,
	prepareFractionalNative,
} from "./hyperframes-fractional-phase-media";
import { digest } from "./hyperframes-variable-rate-io";
import { loopFfmpeg } from "./hyperframes-variable-rate-loop-media";
import {
	loadVariableRateNative,
	type RateLane,
} from "./hyperframes-variable-rate-native";

const native = test.skipIf(!process.env.ROCUT_TEST_FRACTIONAL_PHASE);
function absolute(name: string) {
	const path = process.env[name];
	assert.ok(
		path && isAbsolute(path),
		`${name} requires an existing absolute path`,
	);
	return path;
}

native(
	"fractional exporter preparation preserves unrounded inputs and full history",
	async () => {
		const options = {
			toolchain: absolute("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN"),
			archive: absolute("ROCUT_TEST_HYPERFRAMES_ARCHIVE"),
			ffmpeg: absolute("ROCUT_TEST_FFMPEG"),
			ffprobe: absolute("ROCUT_TEST_FFPROBE"),
		};
		const oracle = await loadVariableRateNative(options);
		const directory = await mkdtemp(
			join(tmpdir(), "rocut-hf-fractional-phase-"),
		);
		const lane: RateLane = oracle.automation.normalizeAutomation({
			version: 1,
			lanes: [
				{
					target: "rate",
					points: [
						{ t: 0, v: 0.7, curve: 0.4 },
						{ t: 0.81, v: 1.8 },
					],
				},
			],
		}).lanes[0];
		const results = [];
		for (const sourceRate of [48000, 44100]) {
			const source = join(directory, `source-${sourceRate}.wav`);
			await writeFile(
				source,
				nativeAudioWav({
					sampleRate: sourceRate,
					seconds: 2,
					channels: 2,
					sample: (frame, channel) =>
						0.22 * Math.sin(frame * (channel ? 1.173 : 0.781)) +
						0.13 * Math.sin(frame * frame * 0.000041) +
						(frame % 97 === 0 ? 0.12 : 0),
				}),
				{ flag: "wx" },
			);
			for (const [name, duration, trim] of [
				["trim-only-aligned-duration", 0.73, 0.125 + 0.75 / sourceRate],
				// FFmpeg's time parser quantizes to microseconds before the source
				// sample grid. An upfront sample round does not commute with that.
				["trim-half-boundary", 0.73, 0.1 + 0.5001 / sourceRate],
				[
					"fractional-both",
					0.73 + 0.25 / sourceRate,
					0.125 + 0.75 / sourceRate,
				],
				["slice-left", 0.5 - 0.25 / 48000, 0.1 + 0.25 / sourceRate],
				["slice-right", 0.5 + 0.25 / 48000, 0.1 + 0.25 / sourceRate],
			] as const) {
				const id = `${sourceRate}-${name}`;
				const exact = await prepareFractionalNative(
					oracle,
					directory,
					id,
					source,
					trim,
					duration,
					lane,
				);
				const exactCall = oracle.io.calls.at(-1)!;
				expect(exactCall.args[exactCall.args.indexOf("-ss") + 1]).toBe(
					String(trim),
				);
				expect(exactCall.args[exactCall.args.indexOf("-t") + 1]).toBe(
					String(oracle.speed.sourceTimeAt(lane, duration)),
				);
				const filter = oracle.native.buildRampFilterComplex(
					lane,
					duration,
					null,
				);
				expect(filter).toContain(`asplit=${Math.ceil(duration / 0.25)}`);
				const negatives = [];
				for (const grid of [48000, 44100]) {
					const roundedTrim = Math.round(trim * grid) / grid;
					const roundedDuration = Math.round(duration * grid) / grid;
					for (const [kind, candidateTrim, candidateDuration] of [
						["trim-only", roundedTrim, duration],
						["duration-only", trim, roundedDuration],
						["both", roundedTrim, roundedDuration],
					] as const) {
						const wrong = await prepareFractionalNative(
							oracle,
							directory,
							`${id}-rounded-${grid}-${kind}`,
							source,
							candidateTrim,
							candidateDuration,
							lane,
						);
						negatives.push({
							grid,
							kind,
							candidateTrim,
							candidateDuration,
							difference: fractionalDifference(exact.pcm, wrong.pcm),
						});
					}
				}
				const cropStart = 0.2,
					cropDuration = 0.11;
				const restart = await prepareFractionalNative(
					oracle,
					directory,
					`${id}-restart`,
					source,
					trim + oracle.speed.sourceTimeAt(lane, cropStart),
					cropDuration,
					oracle.speed.shiftRateLane(lane, cropStart),
				);
				const crop = exact.pcm.subarray(
					Math.round(cropStart * 48000) * 8,
					Math.round((cropStart + cropDuration) * 48000) * 8,
				);
				const restartDifference = fractionalDifference(crop, restart.pcm);
				expect(restartDifference.maximum).toBeGreaterThan(0.001);
				const graphGeometry = [];
				for (const sampleRate of [48000, 44100]) {
					const pcm = await graphRatePcm(
						options.ffmpeg,
						exact.path,
						sampleRate,
					);
					graphGeometry.push({
						sampleRate,
						actualFrames: pcm.length / 8,
						coverageCeil: Math.ceil(duration * sampleRate),
						sha256: digest(pcm),
					});
				}
				results.push({
					id,
					sourceRate,
					trim,
					duration,
					nativeFrames: exact.frames,
					sha256: digest(exact.pcm),
					filter,
					negatives,
					cropStart,
					cropDuration,
					restartDifference,
					graphGeometry,
				});
			}
		}
		await writeFile(
			join(directory, "observations.json"),
			JSON.stringify(
				{
					provenance: oracle.provenance,
					results,
					nativeCalls: oracle.io.calls,
				},
				null,
				2,
			) + "\n",
			{ flag: "wx" },
		);
		for (const grid of [48000, 44100])
			for (const kind of ["trim-only", "duration-only", "both"])
				expect(
					results.some((result) =>
						result.negatives.some(
							(negative) =>
								negative.grid === grid &&
								negative.kind === kind &&
								negative.difference.maximum > 0.001,
						),
					),
					`${grid} ${kind} must distinguish a rounded substitute`,
				).toBe(true);
		const clock = await fractionalLoopClock(options.toolchain);
		const report = {
			status: "passed",
			provenance: oracle.provenance,
			results,
			clock,
			boundary:
				"Unchanged pinned native exporter preparation and IO-only native loop clock. No production gates changed; no browser/FX/MediaElement PCM, source-loop fractional implementation or public mixer acceptance.",
			nativeCalls: oracle.io.calls,
		};
		const path = join(directory, "verification.json");
		await writeFile(path, JSON.stringify(report, null, 2) + "\n", {
			flag: "wx",
		});
		console.log(
			JSON.stringify({
				report: path,
				results: results.map(
					({
						id,
						nativeFrames,
						negatives,
						restartDifference,
						graphGeometry,
					}) => ({
						id,
						nativeFrames,
						negatives,
						restartDifference,
						graphGeometry,
					}),
				),
			}),
		);
	},
	60000,
);

native(
	"real exporter PCM placement differs from fractional sample and preview policies",
	async () => {
		const toolchain = absolute("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN");
		const placement = await nativeFractionalPlacement(
			toolchain,
			absolute("ROCUT_TEST_HYPERFRAMES_ENGINE"),
		);
		const directory = await mkdtemp(
			join(tmpdir(), "rocut-hf-fractional-placement-"),
		);
		const results = [];
		for (const sampleRate of [48000, 44100]) {
			const source = join(directory, `source-${sampleRate}.wav`);
			await writeFile(
				source,
				nativeAudioWav({
					sampleRate,
					channels: 2,
					seconds: 0.02,
					sample: () => 0.25,
				}),
				{ flag: "wx" },
			);
			for (const start of [0.0001, 0.00049, 0.00051, 0.00149, 0.00151]) {
				const filter = placement.build(start, 0.01, 0.03);
				const { stdout } = await loopFfmpeg(absolute("ROCUT_TEST_FFMPEG"), [
					"-i",
					source,
					"-filter_complex",
					filter,
					"-map",
					"[a0]",
					"-ar",
					String(sampleRate),
					"-ac",
					"2",
					"-c:a",
					"pcm_f32le",
					"-f",
					"f32le",
					"pipe:1",
				]);
				let firstAudible = -1;
				for (let frame = 0; frame < stdout.length / 8; frame++)
					if (stdout.readFloatLE(frame * 8) !== 0) {
						firstAudible = frame;
						break;
					}
				expect(firstAudible).toBe(
					Math.trunc((Math.round(start * 1000) * sampleRate) / 1000),
				);
				expect(firstAudible).not.toBe(Math.ceil(start * sampleRate));
				results.push({
					sampleRate,
					start,
					firstAudible,
					sampleCeil: Math.ceil(start * sampleRate),
					filter,
					frames: stdout.length / 8,
					sha256: digest(stdout),
				});
			}
		}
		const report = {
			status: "passed",
			sourceSha256: placement.sourceSha256,
			mixerSha256: placement.mixerSha256,
			results,
			boundary:
				"Actual FFmpeg PCM from original pinned input-filter builder; this is exporter placement, not Rocut placement or browser preview.",
		};
		const path = join(directory, "verification.json");
		await writeFile(path, JSON.stringify(report, null, 2) + "\n", {
			flag: "wx",
		});
		console.log(JSON.stringify({ report: path, results }));
	},
	30000,
);
