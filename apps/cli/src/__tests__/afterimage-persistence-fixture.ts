import type {
	MvAfterimageScene,
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";

export function afterimageScene(): MvAfterimageScene {
	return {
		kind: "afterimage",
		role: "graphics",
		span: { startFrame: 0, durationFrames: 120 },
		settings: {
			cutout: { image: "cutout.png", rect: [0.4, 0.3, 0.225, 0.2] },
			titleFont: "title.ttf",
			glyphs: [
				{ text: "A", center: [490 / 1920, 500 / 1080], fontSize: 400 / 1080 },
				{ text: "B", center: [1430 / 1920, 500 / 1080], fontSize: 400 / 1080 },
			],
			circle: { center: [0.5, 500 / 1080], radius: 218 / 1080 },
			subtitle: {
				font: "subtitle.ttf",
				text: "afterglow",
				position: [967 / 1920, 874 / 1080],
				fontSize: 28 / 1080,
				tracking: 14 / 1080,
				opacity: 0.8,
			},
			credit: {
				font: "credit.ttf",
				text: "fixture",
				position: [963 / 1920, 984 / 1080],
				fontSize: 24 / 1080,
				tracking: 5 / 1080,
				opacity: 0.78,
				color: [169 / 255, 195 / 255, 204 / 255, 1],
			},
			color: [57 / 255, 198 / 255, 224 / 255, 1],
			fringeColor: [42 / 255, 98 / 255, 214 / 255, 1],
			background: [0, 0, 0, 1],
			grain: 0.05,
			timeScale: 1,
			motionScale: 1,
		},
	};
}

export function afterimageSource(
	scene: MvAfterimageScene,
	resources: readonly ProgrammaticResource[],
): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 192,
		height: 108,
		frameRate: { numerator: 30000, denominator: 1001 },
		durationFrames: 120,
		seed: 0,
		resources,
		recipe: {
			version: 1,
			root: "afterimage",
			songStartSeconds: 50.125,
			outputRoles: ["graphics"],
			nodes: [{ id: "afterimage", scene }],
		},
	};
}

export function revisedAfterimageScene(
	initialScene: MvAfterimageScene,
): MvAfterimageScene {
	return {
		...initialScene,
		span: { startFrame: 5, durationFrames: 95 },
		settings: {
			...initialScene.settings,
			cutout: { image: "cutout.png", rect: [0.35, 0.25, 0.3375, 0.3] },
			glyphs: [
				{ text: "X", center: [0.24, 0.39], fontSize: 0.35 },
				{ text: "Y", center: [0.73, 0.44], fontSize: 0.32 },
			],
			circle: { center: [0.51, 0.48], radius: 0.22 },
			subtitle: {
				...initialScene.settings.subtitle,
				text: "revised subtitle",
				fontSize: 0.03,
				tracking: -0.005,
				opacity: 0.7,
			},
			credit: {
				...initialScene.settings.credit,
				text: "revised fixture",
				position: [0.52, 0.88],
				opacity: 0.5,
				color: [0.8, 0.3, 0.4, 0.9],
			},
			color: [0.7, 0.1, 0.5, 0.8],
			fringeColor: [0.2, 0.8, 0.3, 0.65],
			background: [0.01, 0.02, 0.03, 0.9],
			grain: 0.13,
			timeScale: 1.25,
			motionScale: 0.6,
		},
	};
}
