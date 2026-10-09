import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { variableRateCases } from "./hyperframes-variable-rate-cases";
import {
	digest,
	pcmDifference,
	readNativePreparedWav,
} from "./hyperframes-variable-rate-io";
import {
	loopFfmpeg,
	prepareLoopReference,
} from "./hyperframes-variable-rate-loop-media";
import { loadVariableRateNative } from "./hyperframes-variable-rate-native";

/** Diagnostic only: isolate canonical source materialization from the ramp.
 * Reads retained media from the failed oracle; never changes production gates. */
export async function inspectLoopSourceStage(options: {
	directory: string;
	toolchain: string;
	archive: string;
	ffmpeg: string;
	ffprobe: string;
}) {
	const test = variableRateCases.find(
		(value) => value.id === "falling-log-mono",
	);
	assert.ok(test && typeof test.rate === "object");
	const oracle = await loadVariableRateNative(options);
	const rate = oracle.automation.normalizeAutomation({
		version: 1,
		lanes: [test.rate],
	}).lanes[0];
	const filter = await readFile(
		join(options.directory, `${test.id}.filter`),
		"utf8",
	);
	const first = filter.split(";")[0];
	assert.ok(first.startsWith("[0:a]") && first.endsWith("[loop]"));
	const path = join(options.directory, `${test.id}-staged-source.wav`);
	await loopFfmpeg(options.ffmpeg, [
		"-ss",
		"0.1",
		"-t",
		"0.25",
		"-i",
		join(options.directory, `${test.id}-source.wav`),
		"-filter_complex",
		first,
		"-map",
		"[loop]",
		"-acodec",
		"pcm_f32le",
		"-ar",
		"48000",
		"-ac",
		"2",
		"-y",
		path,
	]);
	const staged = await prepareLoopReference(
		oracle,
		options.directory,
		`${test.id}-staged`,
		path,
		1.6,
		rate,
	);
	const reference = await readNativePreparedWav(
		join(options.directory, `${test.id}-reference-prepared.wav`),
	);
	const expected = Buffer.alloc(staged.pcm.length);
	reference.pcm.copy(expected);
	const difference = pcmDifference(expected, staged.pcm);
	const report = {
		status: difference.maximum === 0 ? "passed" : "failed",
		difference,
		frames: staged.frames,
		expectedSha256: digest(expected),
		actualSha256: digest(staged.pcm),
		sourceSha256: digest(await readFile(path)),
		boundary:
			"Two-stage experiment on retained mono fixture: source canonicalization+loop Float32 WAV, then unchanged native preparation. Not production support.",
		provenance: oracle.provenance,
		calls: oracle.io.calls,
	};
	const reportPath = join(options.directory, "verification-source-stage.json");
	await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
		flag: "wx",
	});
	console.log(
		JSON.stringify({ status: report.status, report: reportPath, difference }),
	);
	assert.equal(difference.maximum, 0);
}

if (import.meta.main) {
	const required = (name: string) => {
		const value = process.env[name];
		assert.ok(value && isAbsolute(value));
		return value;
	};
	await inspectLoopSourceStage({
		directory: required("ROCUT_TEST_LOOP_EVIDENCE"),
		toolchain: required("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN"),
		archive: required("ROCUT_TEST_HYPERFRAMES_ARCHIVE"),
		ffmpeg: required("ROCUT_TEST_FFMPEG"),
		ffprobe: required("ROCUT_TEST_FFPROBE"),
	});
}
