import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";

export function meshHostSources(
	image: ProgrammaticResource,
): ProgrammaticSource[] {
	const scene = (kind: "grid" | "hexFloat") => ({
		kind,
		role: "subject" as const,
		easing: "linear" as const,
		span: { startFrame: 0, durationFrames: 59 },
		settings: {
			image: image.id,
			rect: [0, 0, 1, 1] as const,
			fit: "contain" as const,
			lift: 0.2,
			tilt: kind === "grid" ? 24 : 0.4,
			gap: 0.12,
			cycles: 1,
			perspective: 0.5,
			shading: 0.4,
			opacity: 0.75,
			...(kind === "grid"
				? { columns: 8, rows: 6, center: [0.5, 0.5] as const, wavelength: 0.5 }
				: { size: 0.12 }),
		},
	});
	const base = {
		version: 1 as const,
		runtime: "canvas-worker" as const,
		code: "",
		width: 368,
		height: 320,
		durationFrames: 60,
		seed: 37,
		frameRate: { numerator: 30, denominator: 1 },
		resources: [image],
	};
	const recipe = {
		version: 1 as const,
		root: "shot",
		songStartSeconds: 0,
		outputRoles: ["subject"] as const,
	};
	return ["grid", "hexFloat"]
		.map(
			(kind) =>
				({
					...base,
					recipe: {
						...recipe,
						nodes: [{ id: "shot", scene: scene(kind as "grid" | "hexFloat") }],
					},
				}) as ProgrammaticSource,
		)
		.concat({
			...base,
			recipe: {
				...recipe,
				nodes: [
					{
						id: "a",
						scene: {
							kind: "solid",
							role: "subject",
							color: [1, 0.2, 0.1, 0.6],
						},
					},
					{
						id: "b",
						scene: {
							kind: "solid",
							role: "subject",
							color: [0.1, 0.4, 1, 0.8],
						},
					},
					{
						id: "shot",
						scene: {
							kind: "transition",
							from: "a",
							to: "b",
							easing: "linear",
							span: { startFrame: 0, durationFrames: 59 },
							style: {
								kind: "bend",
								direction: "left",
								hinge: 0.5,
								angle: Math.PI,
								perspective: 0.5,
								shading: 0.4,
							},
						},
					},
				],
			},
		});
}

export function mutateMeshSource(
	source: ProgrammaticSource,
	mutate: (value: any) => void,
) {
	const value = structuredClone(source);
	mutate(value);
	return value;
}

export function expandedMesh(source: ProgrammaticSource) {
	return mutateMeshSource(source, (v) => {
		v.recipe.root = "double";
		v.recipe.nodes.push({
			id: "double",
			scene: {
				kind: "transition",
				from: "shot",
				to: "shot",
				span: { startFrame: 0, durationFrames: 59 },
				easing: "linear",
				style: { kind: "xfade" },
			},
		});
	});
}
