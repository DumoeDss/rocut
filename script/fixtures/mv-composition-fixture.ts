import type {
	MvPanel,
	MvScene,
	MvTimePoint,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
export const identityMap: readonly MvTimePoint[] = [
	{ atFrame: 0, sourceFrame: 0 },
	{ atFrame: 23, sourceFrame: 23 },
];
export function panel(
	input: string,
	polygon: MvPanel["polygon"],
	startFrame = 0,
): MvPanel {
	return {
		input,
		polygon,
		opening: {
			span: { startFrame, durationFrames: 2 },
			angle: 0,
			easing: "linear",
		},
		camera: {
			motion: { startFrame: 0, durationFrames: 24 },
			from: { x: 0, y: 0, zoom: 1 },
			to: { x: 0, y: 0, zoom: 1 },
			easing: "linear",
		},
	};
}
export function panelScene(): MvScene {
	return {
		kind: "panels",
		panels: [
			panel("a", [
				[0, 0],
				[0.45, 0],
				[0.45, 1],
				[0, 1],
			]),
			panel(
				"b",
				[
					[0.55, 0],
					[1, 0],
					[1, 1],
					[0.55, 1],
				],
				2,
			),
		],
		collapse: {
			span: { startFrame: 8, durationFrames: 8 },
			hero: 0,
			easing: "linear",
		},
	};
}
export function compositionSource(
	scene: MvScene,
	resources: ResolvedProgrammaticResource[] = [],
): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 64,
		height: 64,
		frameRate: { numerator: 24, denominator: 1 },
		durationFrames: 24,
		seed: 7,
		resources: resources.map((r) => r.resource),
		recipe: {
			version: 1,
			root: "root",
			songStartSeconds: 12.25,
			outputRoles: ["foreground"],
			nodes: [
				{
					id: "a",
					scene: { kind: "solid", role: "foreground", color: [1, 0, 0, 1] },
				},
				{
					id: "b",
					scene: { kind: "solid", role: "foreground", color: [0, 0, 1, 1] },
				},
				{ id: "root", scene },
			],
		},
	};
}
export function texturedComposition(
	scene: MvScene,
	resources: ResolvedProgrammaticResource[],
): ProgrammaticSource {
	const s = compositionSource(scene, resources);
	return {
		...s,
		recipe: {
			...s.recipe!,
			nodes: [
				...resources.map((r, i) => ({
					id: i ? "b" : "a",
					scene: {
						kind: "illust" as const,
						motion: { startFrame: 0, durationFrames: 24 },
						easing: "linear" as const,
						sprites: [
							{
								image: r.resource.id,
								role: "foreground" as const,
								from: {
									x: i ? 0.8 : 0.2,
									y: 0.5,
									height: 0.5,
									rotation: 0,
									opacity: 1,
								},
								to: {
									x: i ? 0.2 : 0.8,
									y: 0.5,
									height: 0.5,
									rotation: 0,
									opacity: 1,
								},
								anchor: [0.5, 0.5] as const,
								drawingFps: 12,
								sway: { amplitude: 0.02, frequency: 0.7, phase: 0.2 },
							},
						],
					},
				})),
				s.recipe!.nodes[2],
			],
		},
	};
}
