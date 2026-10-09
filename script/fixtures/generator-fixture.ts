import type {
	MvGeneratorScene,
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";

export const glyphScene = (
	font = "rain.ttf",
): Extract<MvGeneratorScene, { kind: "glyphRain" }> => ({
	kind: "glyphRain",
	role: "foreground",
	settings: {
		font,
		glyphs: "01ABC+-",
		columns: 16,
		rows: 10,
		trail: 6,
		speed: 5,
		drawingFps: 12,
		color: [0.1, 1, 0.45, 0.65],
		headColor: [0.8, 1, 0.95, 1],
		opacity: 0.85,
	},
});
export const particleScene = (
	image = "logo.png",
): Extract<MvGeneratorScene, { kind: "particleReveal" }> => ({
	kind: "particleReveal",
	role: "foreground",
	span: { startFrame: 0, durationFrames: 24 },
	easing: "linear",
	settings: {
		image,
		columns: 16,
		rows: 12,
		rect: [0, 0, 1, 1],
		fit: "contain",
		scatter: 0.8,
		stagger: 0.35,
		spin: 1,
		startScale: 0.1,
		opacity: 1,
		direction: "in",
	},
});
export function generatorSource(
	scene: MvGeneratorScene,
	resources: readonly ProgrammaticResource[],
): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 192,
		height: 108,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 19,
		resources,
		recipe: {
			version: 1,
			root: "generator",
			songStartSeconds: 0,
			outputRoles: ["foreground"],
			nodes: [{ id: "generator", scene }],
		},
	};
}
