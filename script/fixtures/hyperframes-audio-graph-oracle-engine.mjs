/** Optional read-only oracle over an already extracted engine package. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { near, sha256 } from "./hyperframes-audio-graph-oracle-support.mjs";

export async function engineCases(engineRoot, native, check) {
	const read = async (path) => {
		const bytes = await readFile(join(engineRoot, path));
		return {
			text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			sha256: sha256(bytes),
		};
	};
	const pkg = JSON.parse((await read("package.json")).text);
	assert.equal(pkg.name, "@hyperframes/engine");
	assert.equal(pkg.version, "0.8.139");
	const mixer = await read("dist/services/audioMixer.js");
	const envelope = await read("dist/services/audioVolumeEnvelope.js");
	const extract = (text, name) => {
		const marker = `export function ${name}(`;
		const start = text.indexOf(marker);
		assert.ok(start >= 0, `Missing upstream function ${name}`);
		assert.equal(text.indexOf(marker, start + 1), -1);
		// Pinned emitted JS closes these outer functions at column zero.
		const end = text.indexOf("\n}", start);
		assert.ok(end > start);
		return text.slice(start + "export ".length, end + 2);
	};
	const density = mixer.text.match(
		/^const CURVED_SEGMENT_SAMPLES_PER_SEC = 30;$/m,
	)?.[0];
	assert.ok(density, "Engine export sampling pin changed");
	const source = [
		density,
		extract(mixer.text, "volumeLaneKeyframes"),
		extract(envelope.text, "createEnvelopeWalker"),
	].join("\n");
	const context = createContext({
		VOLUME_TARGET: native.automation.VOLUME_TARGET,
		sampleAutomationLane: native.automation.sampleAutomationLane,
		normaliseEnvelope: native.envelope.normaliseEnvelope,
	});
	// Evaluate unchanged function bodies only, not engine's browser/FFmpeg imports.
	runInContext(source, context, { timeout: 1000 });
	const evaluate = (lane) => {
		context.automation = { version: 1, lanes: [lane] };
		runInContext(
			"globalThis.keyframes = volumeLaneKeyframes(automation, 0, 1); globalThis.walker = createEnvelopeWalker(keyframes, 0, 1)",
			context,
			{ timeout: 1000 },
		);
		return {
			keyframes: Array.from(context.keyframes, (point) => ({ ...point })),
			at(time) {
				context.time = time;
				return runInContext("walker(time)", context, { timeout: 1000 });
			},
		};
	};
	check(
		"engine-export-via-only-differs-from-preview",
		"native-engine-control-math",
		() => {
			const lane = {
				target: "volume",
				points: [
					{ t: 0, v: 0, viaX: 0.5, viaY: 0.001 },
					{ t: 1, v: 1 },
				],
			};
			const actual = evaluate(lane);
			assert.deepEqual(actual.keyframes, [
				{ time: 0, volume: 0 },
				{ time: 1, volume: 1 },
			]);
			near(actual.at(0.25), 0.25);
			const previewRaw = native.automation.sampleAutomationLane(lane, 0.25);
			assert.ok(previewRaw < 0);
			return {
				exportKeyframeCount: 2,
				exportGainAtQuarter: 0.25,
				previewUnclampedLaneAtQuarter: previewRaw,
				meaning:
					"Pinned export checks curve, not viaX/viaY, when deciding whether to sample a bent segment",
			};
		},
	);
	check(
		"engine-export-30hz-sampling-and-keyframe-clamp",
		"native-engine-control-math",
		() => {
			const lane = {
				target: "volume",
				points: [
					{ t: 0, v: 0, curve: 0.5 },
					{ t: 1, v: 1 },
				],
			};
			const curved = evaluate(lane);
			assert.equal(curved.keyframes.length, 31);
			const interpolated = curved.at(0.51);
			const analytic = native.automation.sampleAutomationLane(lane, 0.51);
			near(interpolated, 0.26033333333333336);
			assert.ok(Math.abs(interpolated - analytic) > 0.0002);
			const viaWithCurve = {
				target: "volume",
				points: [
					{ t: 0, v: 0, curve: 0.5, viaX: 0.5, viaY: 0.001 },
					{ t: 1, v: 1 },
				],
			};
			const clamped = evaluate(viaWithCurve);
			assert.equal(clamped.keyframes.length, 31);
			assert.ok(
				Math.min(...clamped.keyframes.map((point) => point.volume)) < 0,
			);
			const normalized = native.envelope.normaliseEnvelope(
				clamped.keyframes,
				0,
				1,
			);
			assert.equal(Math.min(...normalized.map((point) => point.volume)), 0);
			assert.equal(clamped.at(0.25), 0);
			return {
				exportCurvedKeyframes: 31,
				exportGainAtPoint51: interpolated,
				analyticLaneAtPoint51: analytic,
				negativeKeyframeClampedTo: 0,
				boundary:
					"Actual engine pure functions only; no WAV scaling, browser FX or complete export executed",
			};
		},
	);
	return {
		name: pkg.name,
		version: pkg.version,
		sourceSha256: {
			"dist/services/audioMixer.js": mixer.sha256,
			"dist/services/audioVolumeEnvelope.js": envelope.sha256,
			selectedFunctionBodies: sha256(source),
		},
	};
}
