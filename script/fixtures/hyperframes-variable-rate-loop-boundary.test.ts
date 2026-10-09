import assert from "node:assert/strict";
import { test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { nativeAudioWav } from "./native-audio-fixture";
import { variableRateSample } from "./hyperframes-variable-rate-cases";
import { digest } from "./hyperframes-variable-rate-io";
import {
	canonicalSourceTile,
	materializeSourceLoop,
	prepareLoopReference,
} from "./hyperframes-variable-rate-loop-media";
import {
	loadVariableRateNative,
	type RateLane,
} from "./hyperframes-variable-rate-native";
import { verifyRatePreparation } from "./hyperframes-variable-rate-production-case";

function absolute(name: string) {
	const value = process.env[name];
	assert.ok(value && isAbsolute(value));
	return value;
}

test("loop materialization EOF near half-sample and six-decimal native duration boundaries", async () => {
	const directory = await mkdtemp(
		join(tmpdir(), "rocut-hf-rate-loop-boundary-"),
	);
	const report: Record<string, unknown> = {
		status: "running",
		directory,
		cases: [],
		boundary:
			"Restricted source-span EOF rounding experiment using an independently oversized source loop and unchanged native preparation; no fractional trim/period admission is enabled.",
	};
	console.log(JSON.stringify({ event: "started", directory }));
	const controller = new AbortController(),
		timeout = setTimeout(
			() => controller.abort(Error("Loop EOF boundary deadline")),
			55000,
		);
	try {
		const wasmDirectory = absolute("ROCUT_TEST_WASM_DIRECTORY");
		report.wasm = {
			directory: wasmDirectory,
			sha256: digest(
				await readFile(join(wasmDirectory, "opencut_wasm_bg.wasm")),
			),
		};
		const decoder = {
			ffmpeg: absolute("ROCUT_TEST_FFMPEG"),
			ffprobe: absolute("ROCUT_TEST_FFPROBE"),
		};
		const native = await loadVariableRateNative({
			...decoder,
			toolchain: absolute("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN"),
			archive: absolute("ROCUT_TEST_HYPERFRAMES_ARCHIVE"),
		});
		report.provenance = native.provenance;
		const path = join(directory, "source.wav");
		const body = nativeAudioWav({
			seconds: 0.35,
			sampleRate: 48000,
			channels: 2,
			sample: variableRateSample(48000),
		});
		await writeFile(path, body, { flag: "wx" });
		const tile = await canonicalSourceTile(decoder.ffmpeg, path, 0.1, 0.25, 2);
		// 1e6/48000 = 125/6: six consecutive whole-sample residues exercise the
		// relative native decimal-time grid immediately BELOW half a source sample.
		const spans = [...Array(6)].map((_, residue) => 96000 + residue + 0.4999);
		spans.push(96003.5001);
		for (const [index, span] of spans.entries()) {
			const rate: RateLane = {
				target: "rate",
				points: [{ t: 0, v: span / (1.6 * 48000) }],
			};
			const name = `eof-${index}`;
			const virtual = await materializeSourceLoop(
				directory,
				`${name}-independent-source`,
				tile,
				Math.ceil(span) + 480,
			);
			const reference = await prepareLoopReference(
				native,
				directory,
				name,
				virtual,
				1.6,
				rate,
			);
			const prepared = await verifyRatePreparation({
				oracle: native,
				media: {
					name,
					kind: "wav",
					path,
					body,
					mimeType: "audio/wav",
					hasAudio: true,
				},
				reference,
				test: {
					id: name,
					channels: 2,
					sampleRate: 48000,
					duration: 1.6,
					mediaStart: 0.1,
					rate,
				},
				rate,
				sampleRate: 48000,
				decoder,
				signal: controller.signal,
				loopSourceDuration: 0.35,
			});
			const result = {
				span,
				actualIntegratedSpan: native.speed.sourceTimeAt(rate, 1.6) * 48000,
				sourceFrames:
					prepared.plan.decodedSources[0].ratePreparation!.sourceLoop!
						.sourceFrames,
				...prepared.summary,
			};
			(report.cases as unknown[]).push(result);
			console.log(JSON.stringify({ event: "boundary-passed", ...result }));
		}
		report.status = "passed";
	} catch (error) {
		report.status = "failed";
		report.error = error instanceof Error ? error.stack : String(error);
		throw error;
	} finally {
		clearTimeout(timeout);
		await writeFile(
			join(directory, "verification.json"),
			JSON.stringify(report, null, 2) + "\n",
			{ flag: "wx" },
		);
		console.log(
			JSON.stringify({
				event: "finished",
				status: report.status,
				report: join(directory, "verification.json"),
			}),
		);
	}
}, 60000);
