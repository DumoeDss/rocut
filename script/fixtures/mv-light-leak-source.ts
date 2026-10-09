import type { MvEffect } from "../../packages/editor-contracts/src/mv-recipe-post";
import type { ProgrammaticSource } from "@opencut/editor-contracts";

export const leakEffect = (
	alpha: "preserve" | "expand" = "expand",
): MvEffect => ({ kind: "lightLeak", amount: 0.8, alpha });
export function lightLeakSource(effect = leakEffect()): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 160,
		height: 96,
		frameRate: { numerator: 30000, denominator: 1001 },
		durationFrames: 300,
		seed: 3,
		recipe: {
			version: 1,
			root: "base",
			songStartSeconds: 12.25,
			outputRoles: ["foreground"],
			nodes: [
				{
					id: "base",
					scene: {
						kind: "solid",
						role: "foreground",
						color: [0.2, 0.3, 0.4, 0.5],
					},
				},
			],
			post: [{ stage: "composite", effects: [effect] }],
		},
	};
}
