import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { at, capture, check, digest } from "./mv-finishing-capture";
import { finishingSource, orderedFinishing } from "./mv-finishing-source";
import { panel } from "./mv-composition-fixture";

export async function verifyFinishingRoles(
	ordered: ProgrammaticSource,
	orderedPixels: Uint8ClampedArray,
) {
	const selected: ProgrammaticSource = {
		...ordered,
		recipe: { ...ordered.recipe!, outputRoles: ["background"] },
	};
	const excluded = await capture(selected);
	check(
		excluded.every((value) => value === 0),
		"Composite finishing fabricated coverage from an excluded foreground role",
	);
	const selectedForeground = await capture({
		...selected,
		recipe: { ...selected.recipe!, outputRoles: ["foreground"] },
	});
	check(
		(await digest(selectedForeground)) === (await digest(orderedPixels)),
		"Output selection changed the included role",
	);
	const rolePixels = await capture(
		finishingSource({
			post: [
				{ stage: "role", roles: ["foreground"], effects: orderedFinishing },
			],
		}),
	);
	check(
		(await digest(rolePixels)) === (await digest(orderedPixels)),
		"Single-role finishing differs from composite contract",
	);
	const divided: ProgrammaticSource = {
		...ordered,
		recipe: {
			...ordered.recipe!,
			root: "divide",
			nodes: [
				...ordered.recipe!.nodes,
				{
					id: "bright",
					scene: {
						kind: "solid",
						role: "background",
						color: [0.8, 0.8, 0.8, 1],
					},
				},
				{
					id: "divide",
					scene: {
						kind: "panels",
						panels: [
							panel("solid", [
								[0, 0],
								[0.5, 0],
								[0.5, 1],
								[0, 1],
							]),
							panel("bright", [
								[0.5, 0],
								[1, 0],
								[1, 1],
								[0.5, 1],
							]),
						].map((item) => ({
							...item,
							camera: {
								...item.camera,
								motion: { startFrame: 0, durationFrames: 12 },
							},
						})),
					},
				},
			],
		},
	};
	const foregroundOnly = await capture(divided, 4);
	check(
		Math.abs(at(foregroundOnly, 25)[0] - 117.3) < 1 &&
			at(foregroundOnly, 75)[3] === 0,
		"Composite post included bright background excluded by outputRoles",
	);
	const bothRoles = await capture(
		{
			...divided,
			recipe: { ...divided.recipe!, outputRoles: ["foreground", "background"] },
		},
		4,
	);
	// The right-hand .8 input independently becomes .65 -> .725 -> .58.
	check(
		Math.abs(at(bothRoles, 75)[0] - 147.9) < 1 && at(bothRoles, 75)[3] === 255,
		"Selected background did not enter composite finishing",
	);
	return { foregroundOnly: at(foregroundOnly, 75), both: at(bothRoles, 75) };
}
