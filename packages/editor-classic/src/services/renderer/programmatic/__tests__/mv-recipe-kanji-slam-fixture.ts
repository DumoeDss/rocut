import type { MvEmberPlan, MvRecipePlan } from "@opencut/editor-contracts";

const transform = [1, 0, 0, 1, 0, 0] as const;
const data: MvEmberPlan = {
	commands: [
		{
			kind: "surface",
			id: "noise",
			size: [2, 2],
			commands: [
				{
					kind: "alphaPixels",
					size: [2, 2],
					alpha: [0, 128, 255, 17],
					position: [0, 0],
				},
			],
		},
		{
			kind: "surface",
			id: "glyph",
			size: [16, 16],
			commands: [
				{
					kind: "textStroke",
					transform,
					font: "font",
					text: "救",
					fontSize: 1500,
					tracking: 0,
					position: [1, 2],
					align: "left",
					baseline: "alphabetic",
					style: { kind: "solid", color: [1, 0.5, 0, 1] },
					width: 60,
					cap: "butt",
					join: "round",
					blurPx: 15,
					rasterBounds: [0, 0, 8, 10],
					opacity: 1,
					composite: "source-over",
				},
				{
					kind: "rectBatch",
					transform,
					rects: [
						[1, 2, 3, 4],
						[2, 3, 4, 5],
					],
					paint: {
						kind: "fill",
						style: { kind: "solid", color: [0, 0, 0, 0.35] },
						composite: "destination-out",
						opacity: 1,
					},
				},
				{
					kind: "surfacePatternRect",
					surface: "noise",
					transform,
					rect: [0, 0, 16, 16],
					composite: "destination-in",
					opacity: 0.8,
					smoothing: true,
					smoothingQuality: "low",
				},
				{
					kind: "image",
					image: "image",
					transform,
					sourceRect: [0, 1, 3, 2],
					destinationRect: [1, 0, 3, 2],
					opacity: 1,
					composite: "source-over",
					smoothing: true,
					smoothingQuality: "low",
				},
			],
		},
		{ kind: "releaseSurface", surface: "noise" },
		{
			kind: "blit",
			surface: "glyph",
			transform,
			sourceRect: [0, 0, 16, 16],
			destinationRect: [0, 0, 4, 3],
			opacity: 1,
			composite: "source-over",
		},
		{ kind: "releaseSurface", surface: "glyph" },
	],
};

export const kanjiPlan = (
	kind: "kanjiSlam" | "ember" = "kanjiSlam",
): MvRecipePlan => ({
	version: 1,
	songSeconds: 4.8,
	outputRoles: ["background", "graphics"],
	post: [],
	root: {
		kind: "ref",
		sampledFrame: 288,
		input: { kind, role: "graphics", data },
	},
});
