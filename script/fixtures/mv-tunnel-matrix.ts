import type { TunnelOracleFrame } from "./mv-tunnel-oracle";

export const TUNNEL_FONTS = [
	{
		family: "Shippori Mincho B1",
		weight: 800,
		file: "shippori-mincho-b1-extrabold.ttf",
	},
	{ family: "DotGothic16", weight: 400, file: "dot-gothic-16-regular.ttf" },
	{ family: "Zen Old Mincho", weight: 900, file: "zen-old-mincho-black.ttf" },
	{ family: "Noto Serif JP", weight: 400, file: "noto-serif-jp-variable.ttf" },
	{ family: "Noto Serif JP", weight: 800, file: "noto-serif-jp-variable.ttf" },
	{ family: "Noto Serif JP", weight: 900, file: "noto-serif-jp-variable.ttf" },
] as const;
export const TUNNEL_LATIN = [
	"AT THE END OF THE DARKNESS",
	"IT IS NOT TOO LATE",
	"I STILL WANT TO SEE YOU",
	"ZANKŌ — AFTERGLOW",
	"HOLD ON TO THE LAST LIGHT",
] as const;
export const TUNNEL_DEFAULT_WORDS = [
	"暗闇の果てで",
	"まだ遅くない",
	"あなたに会いたい",
	"光",
	"残光",
] as const;
export interface TunnelMatrixCase {
	readonly label: string;
	readonly frame: TunnelOracleFrame;
	readonly indices: readonly number[];
	readonly fullForward: boolean;
}
export function tunnelMatrix(): TunnelMatrixCase[] {
	const base: TunnelOracleFrame = {
		time: 12.25,
		shotStart: 12.25,
		duration: 6,
		beats: Array.from({ length: 61 }, (_, i) => i * 0.5),
		bpm: 120,
		downbeatIndex0: 1,
		args: {},
	};
	const seek = [
		359, 0, 240, 17, 344, 160, 255, 1, 350, 15, 135, 90, 359, 17, 344, 0, 240,
		350,
	];
	const samples = [
		0, 1, 5, 10, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 239, 230,
		210, 150, 70, 20, 0, 239, 160,
	];
	return [
		{
			label: "defaults-all-layers-complete-forward-seek-repeat",
			frame: base,
			indices: [...Array.from({ length: 360 }, (_, i) => i), ...seek],
			fullForward: true,
		},
		{
			label: "absolute-plan-short-word-expansion-accelerating",
			frame: {
				...base,
				duration: 4,
				args: {
					words: ["光", "夜", "残光"],
					plan: [
						[11.0, "夜"],
						[13.0, "光"],
						[15.0, "残光"],
					],
					f: 1024,
					v0: 1.2,
					v1: 13,
					fadeIn: 0.35,
				},
			},
			indices: samples,
			fullForward: false,
		},
		{
			label: "constant-speed-no-fade-three-word-selection",
			frame: {
				...base,
				duration: 4,
				downbeatIndex0: 0,
				args: { words: ["A", "光", "残光"], f: 640, v0: 6, v1: 6, fadeIn: 0 },
			},
			indices: [...samples].reverse(),
			fullForward: false,
		},
	];
}
export const TUNNEL_PIXEL_NEGATIVES = [
	{ name: "background", index: 150 },
	{ name: "edge-fog", index: 30 },
	{ name: "core", index: 60 },
	{ name: "latin", index: 90 },
	{ name: "rings", index: 90 },
	{ name: "dial", index: 90 },
	{ name: "circle", index: 90 },
	{ name: "frame", index: 90 },
	{ name: "cross", index: 90 },
	{ name: "dust", index: 120 },
	{ name: "anamorphic", index: 180 },
	{ name: "dawn", index: 350 },
	{ name: "title", index: 350 },
	{ name: "subtitle", index: 350 },
	{ name: "vignette", index: 90 },
	{ name: "grain", index: 180 },
	{ name: "fade", index: 5 },
	{ name: "perspective", index: 120 },
	{ name: "real-advance", index: 120 },
	{ name: "repair-rays-quirk", index: 180 },
] as const;
export const TUNNEL_POST_NEGATIVES = [
	"no-bloom",
	"no-zoom-blur",
	"no-boil",
	"no-post-vignette",
	"wrong-settle",
	"wrong-center",
] as const;
