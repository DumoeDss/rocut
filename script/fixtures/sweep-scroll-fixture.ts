import type { MvGeneratorScene } from "@opencut/editor-contracts";
export { generatorSource as sweepScrollSource } from "./generator-fixture";

export const sweepScene = (): Extract<
	MvGeneratorScene,
	{ kind: "asciiSweep" }
> => ({
	kind: "asciiSweep",
	role: "foreground",
	span: { startFrame: 0, durationFrames: 24 },
	easing: "linear",
	settings: {
		font: "sweep.ttf",
		textA: "ABCDEFGHIJKL\n0123456789+-",
		textB: "abcdefghijkl\n9876543210-+",
		glyphs: "#",
		rect: [0.0625, 0.1, 0.875, 0.8],
		fontSize: 20,
		bandWidth: 0.25,
		color: [0.9, 0.95, 1, 0.8],
		activeColor: [1, 0.45, 0.1, 1],
		opacity: 0.9,
		direction: "leftToRight",
	},
});
export const scrollScene = (): Extract<
	MvGeneratorScene,
	{ kind: "particleScroll" }
> => ({
	kind: "particleScroll",
	role: "foreground",
	span: { startFrame: 0, durationFrames: 24 },
	easing: "linear",
	settings: {
		image: "scroll.png",
		columns: 4,
		rows: 2,
		rect: [0, 0, 1, 1],
		fit: "stretch",
		band: 0.5,
		scatter: 0,
		spin: 0,
		opacity: 1,
		direction: "left-to-right",
	},
});
