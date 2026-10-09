import type { ProgrammaticSource } from "@opencut/editor-contracts";
export const recipeSource: ProgrammaticSource = {
	version: 1,
	runtime: "canvas-worker",
	code: "",
	width: 64,
	height: 32,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 90,
	seed: 7,
	resources: [
		{
			id: "retained.png",
			kind: "image",
			mimeType: "image/png",
			byteLength: 100,
			sha256: "a".repeat(64),
			attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
		},
	],
	recipe: {
		version: 1,
		root: "root",
		songStartSeconds: 0,
		outputRoles: ["background"],
		nodes: [
			{
				id: "root",
				scene: { kind: "solid", role: "background", color: [0.2, 0.3, 0.4, 1] },
			},
		],
	},
};
export const changedRecipe = { ...recipeSource.recipe!, songStartSeconds: 1 };
