import { expect, test } from "bun:test";
import { hyperframesNativePreparationOutputArgs } from "../programmatic/hyperframes-native-prepare-args";
import type { HyperframesRatePreparation } from "../programmatic/hyperframes-rate-prepare";

function recipe(scalar: boolean, rateOne = false): HyperframesRatePreparation {
	return {
		profile: "hyperframes-0.8.139-exporter-prepare-s16-48k-v1",
		preparationKind: scalar ? "scalar" : "ramp", outputDurationRequired: !rateOne,
		mediaStartSeconds: "0.10000520833333335", sourceDurationSeconds: "0.5000052083333333",
		durationSeconds: "0.5000052083333333", nativeSampleRate: 48000,
		nativeMaxFrames: 24002, nativeMaxBytes: 96008, graphMaxFrames: 22053,
		observedPcm: true, stereoFilter: rateOne ? "" : "atempo=1.5",
		monoFilter: "pan=stereo|FL=FL+FC|FR=FR+FC" + (rateOne ? "" : ",atempo=1.5"),
		resampleFilter: "aresample=44100", slices: scalar ? 0 : 3, clockCells: scalar ? 0 : 50,
	};
}

test("scalar native output retains mono-before-tempo and nonunit output duration", () => {
	const r = recipe(true);
	expect(hyperframesNativePreparationOutputArgs(r, 1, "ignored")).toEqual([
		"-af", r.monoFilter, "-t", r.durationSeconds,
	]);
	expect(hyperframesNativePreparationOutputArgs(r, 2, "ignored")).toEqual([
		"-ac", "2", "-af", r.stereoFilter, "-t", r.durationSeconds,
	]);
});

test("scalar rate one preserves native lack of terminal duration and empty stereo filter", () => {
	const r = recipe(true, true);
	expect(hyperframesNativePreparationOutputArgs(r, 2, "ignored")).toEqual(["-ac", "2"]);
	expect(hyperframesNativePreparationOutputArgs(r, 1, "ignored")).toEqual(["-af", r.monoFilter]);
});

test("ramp retains its independent graph and refuses a scalar-only omission", () => {
	const r = recipe(false);
	expect(hyperframesNativePreparationOutputArgs(r, 2, "native.filter")).toEqual([
		"-filter_complex_script", "native.filter", "-map", "[out]", "-ac", "2", "-t", r.durationSeconds,
	]);
	expect(() => hyperframesNativePreparationOutputArgs({ ...r, outputDurationRequired: false }, 2, "x")).toThrow();
});
