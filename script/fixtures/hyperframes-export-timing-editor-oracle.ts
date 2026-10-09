import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeExportTiming } from "./hyperframes-export-timing-native";
import { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import {
	fractionalDifference,
	graphRatePcm,
	prepareFractionalNative,
} from "./hyperframes-fractional-phase-media";
import { loadVariableRateNative } from "./hyperframes-variable-rate-native";
import { digest } from "./hyperframes-variable-rate-io";
import { loopFfmpeg } from "./hyperframes-variable-rate-loop-media";
import { fixtureGain } from "./hyperframes-graph-chain-fixture";
import {
	durationEditorFx,
	durationEditorRate,
} from "./hyperframes-fractional-duration-editor-spec.mjs";
import {
	exportTimingEditorSpec as spec,
	exportTimingEditorTimelineSample,
	type ExportTimingEditorCase,
} from "./hyperframes-export-timing-editor-spec.mjs";

/** Expected PCM never depends on Rocut's timing/planning/mixing or collected PCM. */
export async function exportTimingEditorOracle({
	directory,
	toolchain,
	archive,
	engine,
	source,
	decoder,
	controller,
	test,
}: {
	directory: string;
	toolchain: string;
	archive: string;
	engine: string;
	source: string;
	decoder: { ffmpeg: string; ffprobe: string };
	controller: AbortController;
	test: ExportTimingEditorCase;
}) {
	const native = await loadVariableRateNative({
		toolchain,
		archive,
		...decoder,
	});
	const rate = native.automation.normalizeAutomation({
		version: 1,
		lanes: [durationEditorRate],
	}).lanes[0];
	const prepared = await prepareFractionalNative(
		native,
		directory,
		"original-native",
		source,
		spec.mediaStart,
		spec.duration,
		rate,
	);
	const dry = await graphRatePcm(
		decoder.ffmpeg,
		prepared.path,
		spec.sampleRate,
	);
	assert.equal(prepared.frames, 24001);
	assert.equal(dry.length / 8, 22051);
	const fx = await createFxAutomationOracle(toolchain, controller);
	let gained: Buffer, tailSeconds: number, nativeFxFrames: number;
	try {
		const effect = await fx.render(
			{
				sampleRate: spec.sampleRate,
				chain: { version: 1, nodes: durationEditorFx },
			},
			dry,
		);
		assert.ok(
			effect.pcm.length > dry.length,
			"Original FX must produce a tail",
		);
		gained = fixtureGain(effect.pcm, () => spec.trackGain);
		tailSeconds = effect.tailSeconds;
		nativeFxFrames = effect.frames;
	} finally {
		await fx.close();
	}
	const pcmFile = join(directory, "original-post-fx-gain.f32le");
	await writeFile(pcmFile, gained, { flag: "wx" });
	const timing = await nativeExportTiming(toolchain, engine);
	const total = spec.sourceFrames / spec.fps;
	const filter = timing.build(
		{ start: test.start, end: test.start + spec.duration, tailSeconds },
		total,
	);
	const runFilter = async (value: string) =>
		(
			await loopFfmpeg(decoder.ffmpeg, [
				"-f",
				"f32le",
				"-ar",
				String(spec.sampleRate),
				"-ac",
				"2",
				"-i",
				pcmFile,
				"-filter_complex",
				value,
				"-map",
				"[a0]",
				"-c:a",
				"pcm_f32le",
				"-f",
				"f32le",
				"pipe:1",
			])
		).stdout;
	const exporter = await runFilter(filter);
	const wrongPlacement = await runFilter(
		filter.replace(
			/adelay=\d+\|\d+/,
			`adelay=${Math.round(test.start * spec.sampleRate)}S|${Math.round(test.start * spec.sampleRate)}S`,
		),
	);
	assert.notEqual(filter.replace(/adelay=\d+\|\d+/, "PLACEMENT"), filter);
	const withoutTerminalTrim = filter.replace(/^\[0:a\]atrim=[^,]+,/, "[0:a]");
	assert.notEqual(withoutTerminalTrim, filter);
	const untrimmed = await runFilter(withoutTerminalTrim);
	const trimDifference = fractionalDifference(exporter, untrimmed);
	assert.ok(
		trimDifference.maximum > 1e-5,
		"Selected fixture must distinguish omitted final trim",
	);
	// Historical graph semantics: integer sample placement with complete post-FX PCM.
	const legacy = Buffer.alloc(spec.sourceFrames * 1764 * 8);
	const delay = Math.round(test.start * spec.sampleRate);
	if (!test.timing)
		assert.ok(Math.abs(delay - test.start * spec.sampleRate) < 1e-8);
	for (let i = 0; i < gained.length / 8 && i + delay < legacy.length / 8; i++)
		for (let c = 0; c < 2; c++)
			legacy.writeFloatLE(
				gained.readFloatLE(i * 8 + c * 4),
				(i + delay) * 8 + c * 4,
			);
	const correct = test.timing ? exporter : legacy;
	const incorrect = test.timing ? wrongPlacement : exporter;
	const placementDifference = fractionalDifference(correct, incorrect);
	assert.ok(
		placementDifference.maximum > 0.001,
		"Placement negative must remain discriminative",
	);
	const timeline = Buffer.alloc(spec.exportFrames * 1764 * 8);
	const view = new DataView(correct.buffer, correct.byteOffset, correct.length);
	for (let i = 0; i < timeline.length / 8; i++)
		for (let c = 0; c < 2; c++)
			timeline.writeFloatLE(
				exportTimingEditorTimelineSample(view, i, c),
				i * 8 + c * 4,
			);
	const summary = {
		test,
		spec,
		nativeProvenance: native.provenance,
		fxProvenance: fx.provenance,
		mixerSha256: timing.mixerSha256,
		declarationsSha256: timing.declarationsSha256,
		filter,
		withoutTerminalTrim,
		sourceSha256: digest(await readFile(source)),
		originalNativeFrames: prepared.frames,
		graphDryFrames: dry.length / 8,
		nativeFxFrames,
		tailSeconds,
		placementDifference,
		trimDifference,
		nativeCalls: native.io.calls,
		canonicalFrames: correct.length / 8,
		timelineFrames: timeline.length / 8,
		correctSha256: digest(correct),
		incorrectSha256: digest(incorrect),
		untrimmedSha256: digest(untrimmed),
		timelineSha256: digest(timeline),
		boundary: test.timing
			? "Original prepare/FX -> post-FX gain -> original final filter -> actual FFmpeg; no production expected PCM or timing"
			: "Original prepare/FX -> post-FX gain -> independent historical sample placement; default mode has no terminal trim",
	};
	await writeFile(
		join(directory, "oracle.json"),
		JSON.stringify(summary, null, 2),
		{ flag: "wx" },
	);
	for (const [name, pcm] of [
		["expected-source", correct],
		["incorrect-placement-source", incorrect],
		["incorrect-untrimmed-source", untrimmed],
		["expected-timeline", timeline],
	] as const)
		await writeFile(join(directory, `${name}.f32le`), pcm, { flag: "wx" });
	return { correct, incorrect, untrimmed, timeline, summary };
}
