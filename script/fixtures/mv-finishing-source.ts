import type {
	MvEffect,
	MvRecipe,
	MvRole,
	ProgrammaticSource,
} from "@opencut/editor-contracts";

export type FinishingPost = NonNullable<MvRecipe["post"]>;
export type FinishingEffect = Extract<
	MvEffect,
	{ kind: "invert" | "flash" | "fade" | "letterbox" | "quantizationDither" }
>;
export const orderedFinishing: readonly FinishingEffect[] = [
	{ kind: "invert", amount: 0.25 },
	{ kind: "flash", amount: 0.5, color: [0.8, 0.8, 0.8] },
	{ kind: "fade", amount: 0.2 },
];
export function finishingSource({
	post = [],
	alpha = 1,
	outputRoles = ["foreground"],
}: {
	post?: FinishingPost;
	alpha?: number;
	outputRoles?: readonly MvRole[];
} = {}): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 100,
		height: 100,
		frameRate: { numerator: 24, denominator: 1 },
		durationFrames: 12,
		seed: 35,
		recipe: {
			version: 1,
			root: "solid",
			songStartSeconds: 17.25,
			outputRoles,
			post,
			nodes: [
				{
					id: "solid",
					scene: {
						kind: "solid",
						role: "foreground",
						color: [0.2, 0.2, 0.2, alpha],
					},
				},
			],
		},
	};
}
export function animatedFinishingSource(): ProgrammaticSource {
	return finishingSource({
		post: [
			{
				stage: "composite",
				effects: [{ kind: "invert", amount: 0 }],
				automation: [
					{
						effect: 0,
						keyframes: [
							{ frame: 2, value: 0, easing: "inQuad" },
							{ frame: 6, value: 1, easing: "linear" },
							{ frame: 8, value: 0.5, easing: "outQuad" },
							{ frame: 12, value: 0, easing: "linear" },
						],
					},
				],
			},
		],
	});
}
export function exportFinishingSource(): ProgrammaticSource {
	return finishingSource({
		post: [
			{
				stage: "composite",
				effects: [
					{ kind: "invert", amount: 0 },
					{ kind: "flash", amount: 0.2, color: [0.8, 0.8, 0.8] },
					{ kind: "fade", amount: 0.25 },
					{ kind: "letterbox", amount: 1, heightFraction: 0.1 },
					{ kind: "quantizationDither", amount: 0.75 },
				],
				automation: [
					{
						effect: 0,
						keyframes: [
							{ frame: 0, value: 0, easing: "linear" },
							{ frame: 4, value: 1, easing: "linear" },
							{ frame: 8, value: 0, easing: "linear" },
						],
					},
				],
			},
		],
	});
}
