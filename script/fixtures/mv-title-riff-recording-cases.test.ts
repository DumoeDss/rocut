import { expect, test } from "bun:test";
import { titleRiffRecordingCases } from "./mv-title-riff-recording-cases";
import { titleRiffTestFrame } from "./mv-title-riff-reference-cases";
import { titleRiffNativeSample } from "./mv-title-riff-native-source";

test("additional recording cases retain all branch and strict-boundary controls", () => {
	const groups = titleRiffRecordingCases();
	expect(groups.flatMap((g) => g.samples)).toHaveLength(24);
	expect(groups[0]?.sizes).toEqual({});
	const labels = groups[0]!.samples.map((s) => s.name);
	for (const label of [
		"zero-monuments",
		"one-monument",
		"before-silhouette",
		"silhouette-disabled",
		"alpha-zero-entry",
		"visible-two-monuments",
		"disappearing",
		"disappeared",
	])
		expect(labels).toContain(label);
	const limit = 32 * 1024 * 1024;
	const bytes = (height: number) => 4 * 1920 * 1080 * 4 + 2 * 184 * height * 4;
	expect(bytes(255)).toBeLessThan(limit);
	expect(bytes(256)).toBe(limit);
	expect(bytes(257)).toBeGreaterThan(limit);
	for (const height of [255, 256, 257]) {
		const group = groups.find((g) => g.name === `boundary-184x${height}`)!;
		expect(group.sizes["character.png"]).toEqual([184, height]);
		expect(group.samples.map((s) => s.name)).toEqual([
			"alpha-zero-entry",
			"visible",
		]);
	}
});

test("every matrix case maps to an admitted frame and the repeated large-mask sample is identical", () => {
	const groups = titleRiffRecordingCases();
	for (const group of groups) {
		for (const sample of group.samples) {
			const frame = titleRiffTestFrame(sample.variant);
			const index = Math.round((sample.time - frame.shotStart) * 60);
			expect(index).toBeGreaterThanOrEqual(0);
			expect(index).toBeLessThan(frame.duration * 60);
			expect(titleRiffNativeSample(frame, index).time).toBeCloseTo(
				frame.shotStart + index / 60,
				10,
			);
		}
	}
	const samples = groups.find((g) => g.name === "large-mask")!.samples;
	expect(samples.at(-1)?.time).toBe(samples[0]?.time);
	expect(samples.at(-1)?.variant).toBe(samples[0]?.variant);
});
