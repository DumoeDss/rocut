import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { runVariableRateCase } from "./hyperframes-variable-rate-case-runner";
import { variableRateCases } from "./hyperframes-variable-rate-cases";
import { loadVariableRateNative } from "./hyperframes-variable-rate-native";

function requiredPath(name: string) {
	const value = process.env[name];
	assert.ok(
		value && isAbsolute(value),
		`${name} must be an explicit absolute existing path`,
	);
	return value;
}

const directory = await mkdtemp(join(tmpdir(), "rocut-hf-variable-rate-"));
const report: Record<string, unknown> = {
	status: "running",
	scope: "HyperFrames 0.8.139 native exporter preparation-stage PCM oracle",
	artifacts: directory,
	productionImplementationTested: false,
	boundary:
		"Original prepareAudioTrack function closure with real FFmpeg/FFprobe. Not the full processCompositionAudio public mixer or MediaElement preview.",
};
console.log(JSON.stringify({ event: "started", directory }));
let oracle: Awaited<ReturnType<typeof loadVariableRateNative>> | undefined;
try {
	const ffmpeg = requiredPath("ROCUT_TEST_FFMPEG");
	const ffprobe = requiredPath("ROCUT_TEST_FFPROBE");
	report.ffmpegVersion = execFileSync(ffmpeg, ["-version"], {
		windowsHide: true,
		encoding: "utf8",
		timeout: 15000,
	}).split(/\r?\n/)[0];
	report.ffprobeVersion = execFileSync(ffprobe, ["-version"], {
		windowsHide: true,
		encoding: "utf8",
		timeout: 15000,
	}).split(/\r?\n/)[0];
	oracle = await loadVariableRateNative({
		ffmpeg,
		ffprobe,
		toolchain: requiredPath("ROCUT_TEST_HYPERFRAMES_TOOLCHAIN"),
		archive: requiredPath("ROCUT_TEST_HYPERFRAMES_ENGINE_ARCHIVE"),
	});
	report.provenance = oracle.provenance;
	const results: Awaited<ReturnType<typeof runVariableRateCase>>[] = [];
	report.cases = results;
	for (const test of variableRateCases) {
		const result = await runVariableRateCase(oracle, directory, test);
		results.push(result);
		console.log(
			JSON.stringify({
				event: "case-passed",
				id: test.id,
				frames: result.output.frames,
				pcmSha256: result.output.pcmSha256,
			}),
		);
	}
	const longLane = {
		target: "rate" as const,
		points: [
			{ t: 0, v: 0.5 },
			{ t: 120, v: 2 },
		],
	};
	const longGraph = oracle.native.buildRampFilterComplex(longLane, 120, null);
	assert.ok(longGraph.startsWith("[0:a]asplit=240"));
	report.longDurationPlanningOnly = {
		duration: 120,
		slices: 240,
		pcmTested: false,
	};
	report.status = "passed";
	report.summary = {
		cases: results.length,
		nativePreparationCalls: oracle.io.calls.length,
		negativeControls: results.reduce(
			(count, result) => count + Object.keys(result.controls).length,
			0,
		),
	};
} catch (error) {
	report.status = "failed";
	report.error =
		error instanceof Error
			? { name: error.name, message: error.message, stack: error.stack }
			: String(error);
	process.exitCode = 1;
} finally {
	report.nativeCalls = oracle?.io.calls ?? [];
	await writeFile(
		join(directory, "verification.json"),
		JSON.stringify(report, null, 2) + "\n",
	);
	console.log(
		JSON.stringify({
			event: "finished",
			status: report.status,
			report: join(directory, "verification.json"),
			summary: report.summary,
			error: report.error,
		}),
	);
}
