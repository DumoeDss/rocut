import type {
	MvEmberDraw,
	MvEmberPathStep,
	MvEmberPlan,
} from "@opencut/editor-contracts";

export const circles = [
	[1.25, -3.5, 0.7],
	[-0, 0, 0],
	[1000000000000000, 0.125, 0.25],
	[20.125, 30.5, 4.75],
] as const;
export function circleCommand(
	rows: readonly (readonly [number, number, number])[] = circles,
) {
	return {
		kind: "circleBatch",
		circles: rows,
		transform: [0.5, 0, 0, 0.75, 2, 3],
		operations: [
			{ kind: "translate", offset: [10, 20] },
			{ kind: "rotate", radians: 0.23 },
			{ kind: "scale", factors: [1.1, 0.7] },
		],
		clip: {
			transform: [1, 0, 0, 1, 100, 200],
			operations: [{ kind: "rotate", radians: -0.13 }],
			path: [
				{
					kind: "arc",
					center: [0, 0],
					radius: 40,
					start: 0,
					end: 6.283185307179586,
				},
				{
					kind: "arc",
					center: [0, 0],
					radius: 5,
					start: 0,
					end: 6.283185307179586,
					anticlockwise: true,
				},
			],
		},
		paints: [
			{
				kind: "fill",
				composite: "source-over",
				opacity: 0.75,
				style: {
					kind: "linear",
					from: [0, 0],
					to: [32, 64],
					stops: [
						{ offset: 0, color: [1, 0.2, 0.3, 0.5] },
						{ offset: 1, color: [0.1, 0.3, 1, 0.7] },
					],
				},
			},
			{
				kind: "stroke",
				composite: "lighter",
				opacity: 0.25,
				width: 2.3,
				cap: "round",
				join: "round",
				style: { kind: "solid", color: [1, 1, 1, 0.8] },
			},
			{
				kind: "fill",
				composite: "multiply",
				opacity: 0.4,
				style: {
					kind: "radial",
					from: [0, 0, 3],
					to: [2, 4, 40],
					stops: [
						{ offset: 0, color: [0.3, 0.5, 1, 0.8] },
						{ offset: 1, color: [0.6, 0, 0, 0.2] },
					],
				},
			},
		],
	} as const satisfies MvEmberDraw;
}

/** Independent verbose transport retained as the equivalence oracle. */
export function expandedCircleCommand(
	rows: readonly (readonly [number, number, number])[] = circles,
) {
	const { circles: _circles, ...command } = circleCommand(rows);
	const path: MvEmberPathStep[] = [];
	for (const [x, y, radius] of rows) {
		path.push({ kind: "moveTo", point: [x + radius, y] });
		path.push({
			kind: "arc",
			center: [x, y],
			radius,
			start: 0,
			end: 6.283185307179586,
			anticlockwise: false,
		});
	}
	return { ...command, kind: "path", path } as const satisfies MvEmberDraw;
}

export function circlePlan(command: MvEmberDraw): MvEmberPlan {
	return {
		commands: [
			command,
			{ kind: "surface", id: "circles", size: [128, 128], commands: [command] },
			{
				kind: "blit",
				surface: "circles",
				transform: [1, 0, 0, 1, 0, 0],
				sourceRect: [0, 0, 128, 128],
				destinationRect: [0, 0, 128, 128],
				composite: "source-over",
				opacity: 0.5,
			},
			{ kind: "releaseSurface", surface: "circles" },
		],
	};
}
