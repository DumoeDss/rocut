import type {
	KanjiSlamArgs,
	KanjiSlamFrame,
	KanjiSlamSong,
} from "./mv-kanji-slam-reference-contract";

/** Authored configuration only: drawing, clocks and easing are never ported. */
export function kanjiSlamTestFrame(
	variant: KanjiSlamArgs["variant"],
	time: number,
): KanjiSlamFrame {
	const common = {
		fire: variant === "hand",
		char: "character.png",
		bg: "sky.png",
		fam: "minchoHeavy" as const,
		weight: 900 as const,
		noFlash: false,
	};
	const configs: Record<KanjiSlamArgs["variant"], KanjiSlamArgs> = {
		default: {
			...common,
			variant,
			glyphs: ["救", "って", "救", "って"],
			charX: 1330,
			charY: 1100,
			charH: 1000,
			face: [0.745, 0.235],
			color: "#C8373A",
			sky: "sunset",
			rim: "#FFB36B",
			rimOff: [7, 2],
			rimA: 0.75,
			haloA: 0.55,
			voiceDir: -0.62,
			wind: {
				axis: "col",
				from: 0.6,
				dir: -1,
				amp: 20,
				freq: 1.4,
				speed: 6.2,
				q: 12,
			},
			slots: [
				{ x: 560, y: 545, s: 1.3, r: -0.035 },
				{ x: 640, y: 520, s: 1.42, r: 0.05 },
				{ x: 470, y: 600, s: 1.58, r: 0.065 },
				{ x: 600, y: 505, s: 1.5, r: -0.07 },
			],
			frames: [
				{ z: 1, dx: 0, dy: 0 },
				{ z: 1.14, dx: 40, dy: 20 },
				{ z: 0.95, dx: -20, dy: 0 },
				{ z: 1.24, dx: 70, dy: 40 },
			],
			lines: "ink",
		},
		night: {
			...common,
			variant,
			glyphs: ["夜"],
			charX: 1340,
			charY: 1110,
			charH: 1150,
			face: [0.33, 0.25],
			color: "#D23A36",
			sky: "night",
			rim: "#FF6A4D",
			rimOff: [8, 3],
			rimA: 0.9,
			haloA: 0.7,
			voiceDir: null,
			wind: {
				axis: "col",
				from: 0.56,
				dir: 1,
				amp: 18,
				freq: 1.3,
				speed: 5.4,
				q: 12,
			},
			slots: [
				{ x: 620, y: 540, s: 1.36, r: 0.03 },
				{ x: 580, y: 560, s: 1.5, r: -0.04 },
				{ x: 680, y: 520, s: 1.62, r: 0.055 },
				{ x: 600, y: 540, s: 1.45, r: -0.03 },
			],
			frames: [
				{ z: 1, dx: 0, dy: 0 },
				{ z: 1.16, dx: 30, dy: 20 },
				{ z: 1.34, dx: 50, dy: 50 },
				{ z: 1.1, dx: 0, dy: 0 },
			],
			lines: "light",
		},
		hand: {
			...common,
			variant,
			glyphs: ["救", "って", "救", "って"],
			charX: 1360,
			charY: 1430,
			charH: 1700,
			face: [0.5, 0.26],
			color: "#C8373A",
			sky: "sunset",
			rim: "#FFC07A",
			rimOff: [7, 4],
			rimA: 0.7,
			haloA: 0.5,
			voiceDir: null,
			wind: {
				axis: "col",
				from: 0.63,
				dir: 1,
				amp: 26,
				freq: 1.2,
				speed: 6.5,
				q: 12,
			},
			slots: [
				{ x: 640, y: 560, s: 1.36, r: -0.04 },
				{ x: 580, y: 540, s: 1.5, r: 0.045 },
				{ x: 700, y: 600, s: 1.6, r: -0.06 },
				{ x: 600, y: 520, s: 1.55, r: 0.06 },
			],
			frames: [
				{ z: 1, dx: 0, dy: 0 },
				{ z: 1.05, dx: -10, dy: -50 },
				{ z: 1.1, dx: -20, dy: -100 },
				{ z: 1.16, dx: -30, dy: -160 },
			],
			lines: "ink",
		},
	};
	return {
		shotId: `kanji-${variant}`,
		time,
		shotStart: 4,
		duration: 4,
		args: configs[variant],
	};
}

export function kanjiSlamTestSong(): KanjiSlamSong {
	return {
		beats: [
			0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 3.955, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 7.955,
			8.5, 9,
		],
		bpm: 120,
		downbeatIndex0: 2,
	};
}

export const KANJI_SAMPLES = [
	{ label: "late-first", time: 6.18, counter: "05 / 08" },
	{ label: "start-snap", time: 4, counter: "01 / 08" },
	{ label: "initial-flash", time: 4 + 1 / 30, counter: "01 / 08" },
	{
		label: "before-anticipation",
		time: 4.5 - 2 / 30 - 1e-6,
		counter: "01 / 08",
	},
	{ label: "anticipation-two-frames", time: 4.5 - 2 / 30, counter: "01 / 08" },
	{ label: "anticipation-one-frame", time: 4.5 - 1 / 30, counter: "01 / 08" },
	{ label: "beat-minus-45ms", time: 4.455, counter: "01 / 08" },
	{ label: "beat-minus-epsilon", time: 4.5 - 2e-6, counter: "01 / 08" },
	{ label: "beat-at", time: 4.5, counter: "02 / 08" },
	{ label: "beat-plus-epsilon", time: 4.5 + 2e-6, counter: "02 / 08" },
	{ label: "beat-plus-45ms", time: 4.545, counter: "02 / 08" },
	{ label: "small-kana-first", time: 4.8, counter: "02 / 08" },
	{ label: "third-hit", time: 5, counter: "03 / 08" },
	{ label: "small-kana-alternate", time: 5.6, counter: "04 / 08" },
	{ label: "exhausted-rekick", time: 6, counter: "05 / 08" },
	{ label: "shot-tail", time: 7.96, counter: "08 / 08" },
] as const;
