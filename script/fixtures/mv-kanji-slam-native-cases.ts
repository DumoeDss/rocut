import type { KanjiSlamFrame } from "./mv-kanji-slam-reference-contract";
import { kanjiSlamTestFrame } from "./mv-kanji-slam-reference-cases";

/** Exact60fps indices, including original30fps anticipation and first/exhausted hits. */
export const KANJI_NATIVE_SAMPLES = [
	131, 0, 2, 25, 26, 28, 29, 30, 31, 33, 48, 60, 96, 120, 180, 237, 239, 131, 2,
	48,
] as const;

/** Explicit legal authored branches beyond the three original preset defaults. */
export function kanjiSlamExplicitCases(): {
	label: string;
	input: KanjiSlamFrame;
	indices: readonly number[];
}[] {
	const base = kanjiSlamTestFrame("default", 4),
		hand = kanjiSlamTestFrame("hand", 4),
		night = kanjiSlamTestFrame("night", 4);
	return [
		{
			label: "day-row-no-bg",
			input: {
				...base,
				shotId: "day-row-no-bg",
				args: {
					...base.args,
					bg: null,
					sky: "day",
					skyGrad: [
						[0, "#31455E"],
						[0.45, "#CE956A"],
						[1, "#FFE5B9"],
					],
					wind: {
						axis: "row",
						from: 0.25,
						dir: 1,
						amp: 19,
						freq: 2.2,
						speed: 3.2,
						q: 24,
					},
					noFlash: true,
					color: "#439BAA",
					rim: "#F2D46B",
					lines: "light",
				},
			},
			indices: [31, 96, 31],
		},
		{
			label: "fire-night-high-rim",
			input: {
				...night,
				shotId: "fire-night-high-rim",
				args: { ...night.args, fire: true, rimA: 1, haloA: 1, voiceDir: 0.5 },
			},
			indices: [31, 120, 31],
		},
		{
			label: "hand-no-fire",
			input: {
				...hand,
				shotId: "hand-no-fire",
				args: { ...hand.args, fire: false },
			},
			indices: [48, 120, 48],
		},
		{
			label: "day-plate-zero-wind",
			input: {
				...base,
				shotId: "day-plate-zero-wind",
				args: {
					...base.args,
					sky: "day",
					wind: { ...base.args.wind, amp: 0 },
					noFlash: true,
				},
			},
			indices: [2, 131, 2],
		},
		{
			label: "generic-kana-layout",
			input: {
				...base,
				shotId: "generic-kana-layout",
				args: { ...base.args, glyphs: ["は夜光", "救って"], voiceDir: null },
			},
			indices: [0, 48, 120, 48],
		},
	];
}

/** Integer-tick neighbors avoid falsely representing1µs on a120kHz grid. */
export const KANJI_NATIVE_BOUNDARIES = [
	{ label: "lower-outside", beatIndex: 8, tick: 474599, count: 8 },
	{ label: "lower-at", beatIndex: 8, tick: 474600, count: 8 },
	{ label: "lower-inside", beatIndex: 8, tick: 474601, count: 8 },
	{ label: "snap-at", beatIndex: 8, tick: 485400, count: 8 },
	{ label: "snap-outside", beatIndex: 8, tick: 485401, count: 9 },
	{ label: "tail-inside", beatIndex: 16, tick: 954599, count: 9 },
	{ label: "tail-at", beatIndex: 16, tick: 954600, count: 8 },
	{ label: "tail-outside", beatIndex: 16, tick: 954601, count: 8 },
] as const;
