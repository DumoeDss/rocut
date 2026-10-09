import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createFxAutomationOracle } from "./hyperframes-fx-automation-fixture";
import {
	fractionalDifference,
	graphRatePcm,
	prepareFractionalNative,
} from "./hyperframes-fractional-phase-media";
import { loadVariableRateNative } from "./hyperframes-variable-rate-native";
import { digest } from "./hyperframes-variable-rate-io";
import {
	durationEditorFx,
	durationEditorRate,
	durationEditorSpec as spec,
	durationEditorTimelineSample,
} from "./hyperframes-fractional-duration-editor-spec.mjs";

/** Only original pinned native preparation and original native FX produce the
 * expected source. No production planning, gain, PCM, graph or mixer is used. */
export async function durationEditorOracle({
	directory,
	toolchain,
	archive,
	source,
	decoder,
	controller,
}: {
	directory: string;
	toolchain: string;
	archive: string;
	source: string;
	decoder: { ffmpeg: string; ffprobe: string };
	controller: AbortController;
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
	const rounded = await prepareFractionalNative(
		native,
		directory,
		"incorrect-rounded-native",
		source,
		spec.mediaStart,
		Math.round(spec.duration * 48000) / 48000,
		rate,
	);
	const roundingDifference = fractionalDifference(prepared.pcm, rounded.pcm);
	assert.ok(
		roundingDifference.maximum > 0.001,
		"Rounding duration must remain detectable in the original native preparation",
	);
	assert.equal(
		prepared.frames,
		24001,
		"Original 44.1k source preparation changed its fractional native length",
	);
	const dry = await graphRatePcm(decoder.ffmpeg, prepared.path, 44100);
	const roundedDry = await graphRatePcm(decoder.ffmpeg, rounded.path, 44100);
	assert.equal(
		dry.length / 8,
		22051,
		"Graph resampling must keep actual original-native length",
	);
	const fx = await createFxAutomationOracle(toolchain, controller);
	let correct: Buffer, incorrect: Buffer, tailFrames: number;
	try {
		const request = {
			sampleRate: 44100,
			chain: { version: 1 as const, nodes: durationEditorFx },
		};
		const effect = await fx.render(request, dry);
		const wrong = await fx.render(request, roundedDry);
		assert.ok(
			effect.pcm.length > dry.length,
			"Original delay must emit a real tail",
		);
		tailFrames = effect.frames - dry.length / 8;
		const place = (pcm: Buffer) => {
			const output = Buffer.alloc(31752 * 8);
			for (
				let frame = 0;
				frame < pcm.length / 8 && frame + 3528 < 31752;
				frame++
			)
				for (let channel = 0; channel < 2; channel++)
					output.writeFloatLE(
						Math.fround(pcm.readFloatLE(frame * 8 + channel * 4) * 0.75),
						(frame + 3528) * 8 + channel * 4,
					);
			return output;
		};
		correct = place(effect.pcm);
		incorrect = place(wrong.pcm);
		await writeFile(join(directory, "native-fx.f32le"), effect.pcm, {
			flag: "wx",
		});
	} finally {
		await fx.close();
	}
	const postFxRoundingDifference = fractionalDifference(correct, incorrect);
	assert.ok(
		postFxRoundingDifference.maximum > 0.001,
		"Nonlinear FX must not hide the rounding negative",
	);
	const timeline = Buffer.alloc(37044 * 8);
	const view = new DataView(correct.buffer, correct.byteOffset, correct.length);
	for (let i = 0; i < 37044; i++)
		for (let channel = 0; channel < 2; channel++)
			timeline.writeFloatLE(
				durationEditorTimelineSample(view, i, channel),
				i * 8 + channel * 4,
			);
	const summary = {
		spec,
		nativeProvenance: native.provenance,
		fxProvenance: fx.provenance,
		sourceSha256: digest(await readFile(source)),
		originalNativeFrames: prepared.frames,
		graphDryFrames: dry.length / 8,
		fxTailFrames: tailFrames,
		roundingDifference,
		postFxRoundingDifference,
		nativeCalls: native.io.calls,
		canonicalFrames: 31752,
		timelineFrames: 37044,
		correctSha256: digest(correct),
		incorrectSha256: digest(incorrect),
		timelineSha256: digest(timeline),
		boundary:
			"Independent original native preparation and FX; fixture-only aligned placement/post-FX constant gain and editor mixing. No production PCM contributes expected data.",
	};
	await writeFile(
		join(directory, "oracle.json"),
		JSON.stringify(summary, null, 2),
		{ flag: "wx" },
	);
	for (const [name, body] of [
		["expected-source", correct],
		["incorrect-rounded-source", incorrect],
		["expected-timeline", timeline],
	] as const)
		await writeFile(join(directory, `${name}.f32le`), body, { flag: "wx" });
	return { correct, incorrect, timeline, summary };
}
