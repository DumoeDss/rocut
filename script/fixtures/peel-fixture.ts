import type {
	MvRecipe,
	MvTransition,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { texturedSource } from "./mv-transition-fixture";

export const peelStyle = (
	direction: "left" | "right" | "up" | "down" = "left",
): Extract<MvTransition, { kind: "peel" }> => ({
	kind: "peel",
	direction,
	curl: 0.17,
	segments: 32,
	shading: 0.6,
	perspective: 0.5,
});
export function peelSource(
	resources: ResolvedProgrammaticResource[],
	style: MvTransition = peelStyle(),
): ProgrammaticSource {
	const base = texturedSource(style, resources);
	return {
		...base,
		width: 192,
		height: 108,
		durationFrames: 60,
		frameRate: { numerator: 30, denominator: 1 },
		recipe: {
			...base.recipe!,
			songStartSeconds: 0,
			nodes: base.recipe!.nodes.map((node) => {
				if (node.scene.kind === "transition")
					return {
						...node,
						scene: {
							...node.scene,
							span: { startFrame: 6, durationFrames: 30 },
						},
					};
				if (node.scene.kind !== "illust") return node;
				return {
					...node,
					scene: {
						...node.scene,
						motion: { startFrame: 0, durationFrames: 60 },
						sprites: node.scene.sprites!.map((s) => ({
							...s,
							from: { ...s.from, height: 2 },
							to: { ...s.to, height: 2 },
						})),
					},
				};
			}),
		},
	};
}
export function peelWithStyle(
	source: ProgrammaticSource,
	style: MvTransition,
): ProgrammaticSource {
	return {
		...source,
		recipe: {
			...source.recipe!,
			nodes: source.recipe!.nodes.map((n) =>
				n.scene.kind === "transition"
					? { ...n, scene: { ...n.scene, style } }
					: n,
			),
		},
	};
}
export function peelWithNodes(
	source: ProgrammaticSource,
	nodes: MvRecipe["nodes"],
): ProgrammaticSource {
	return { ...source, recipe: { ...source.recipe!, nodes } };
}
