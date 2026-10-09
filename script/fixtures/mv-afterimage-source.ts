import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import type { MvAfterimage } from "../../packages/editor-contracts/src/mv-afterimage";

/** Explicit, synthetic AB lockup in the original 1920x1080 layout. */
export function afterimageSettings(): MvAfterimage {
	const h = 218 * 1.86,
		w = h / 2;
	return {
		cutout: {
			image: "character",
			rect: [
				(960 - w * 0.46) / 1920,
				(500 + 218 * 1.02 - h) / 1080,
				w / 1920,
				h / 1080,
			],
		},
		titleFont: "title",
		glyphs: [
			{ text: "A", center: [490 / 1920, 500 / 1080], fontSize: 400 / 1080 },
			{ text: "B", center: [1430 / 1920, 500 / 1080], fontSize: 400 / 1080 },
		],
		circle: { center: [0.5, 500 / 1080], radius: 218 / 1080 },
		subtitle: {
			font: "subtitle",
			text: "afterglow",
			position: [967 / 1920, 874 / 1080],
			fontSize: 28 / 1080,
			tracking: 14 / 1080,
			opacity: 0.8,
		},
		credit: {
			font: "credit",
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
	};
}

export function afterimageSource(
	resources: readonly ProgrammaticResource[],
): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 1920,
		height: 1080,
		frameRate: { numerator: 60, denominator: 1 },
		durationFrames: 180,
		seed: 0,
		resources,
		recipe: {
			version: 1,
			root: "after",
			songStartSeconds: 12.25,
			outputRoles: ["graphics"],
			post: [],
			nodes: [
				{
					id: "after",
					scene: {
						kind: "afterimage",
						role: "graphics",
						settings: afterimageSettings(),
						span: { startFrame: 0, durationFrames: 180 },
					},
				},
			],
		},
	};
}
