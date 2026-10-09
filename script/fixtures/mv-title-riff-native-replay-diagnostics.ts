import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { captureTitleRiff } from "./mv-title-riff-native-capture";
import { check, difference } from "./mv-afterimage-capture";
import { titleRiffDifferenceLocations } from "./mv-title-riff-native-difference";

/** Diagnostic only: these variants never replace the public-route acceptance. */
export async function traceTitleRiffScheduling(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	index: number,
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
) {
	const result: Record<string, unknown> = {};
	for (const commandBatchSize of [1, 4096] as const) {
		const replay = await captureTitleRiff(source, resources, index, {
			commandBatchSize,
		});
		result[`batch${commandBatchSize}`] = {
			vsPublic: difference(replay, actual),
			vsOriginal: difference(replay, expected),
			locations: titleRiffDifferenceLocations(replay, expected),
		};
	}
	for (const target of ["ring", "front"] as const) {
		let copies = 0;
		const replay = await captureTitleRiff(source, resources, index, {
			mutate(plan) {
				const front = plan.commands.find(
					(command) =>
						command.kind === "surface" && command.id === "title-front",
				);
				check(front?.kind === "surface", "Missing matrix diagnostic surface");
				for (const draw of front.commands) {
					if (
						target === "ring" &&
						!(
							draw.kind === "path" &&
							draw.paints.some(
								(paint) => paint.kind === "stroke" && paint.width === 6,
							)
						)
					)
						continue;
					if (!("operations" in draw) || !draw.operations?.length) continue;
					for (const space of [draw, draw.clip]) {
						if (!space?.operations?.length) continue;
						const operations = space.operations;
						check(
							operations.length >= 3 &&
								operations[0]?.kind === "translate" &&
								operations[1]?.kind === "scale" &&
								operations[2]?.kind === "translate",
							"Expected camera prefix for matrix diagnostic",
						);
						Reflect.set(space, "operations", [
							...operations.slice(0, 3),
							{ kind: "copyTransform" },
							...operations.slice(3),
						]);
						copies++;
					}
				}
			},
		});
		check(copies > 0, "No matrix-copy diagnostic commands");
		result[`copyCamera-${target}`] = {
			copies,
			vsPublic: difference(replay, actual),
			vsOriginal: difference(replay, expected),
			locations: titleRiffDifferenceLocations(replay, expected),
		};
	}
	return result;
}

export async function traceTitleRiffRingBoundaries(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	index: number,
	beforeRingPixels?: Uint8ClampedArray,
	afterRingPixels?: Uint8ClampedArray,
) {
	const result: Record<string, unknown> = {};
	for (const [label, expected, extra] of [
		["beforeRing", beforeRingPixels, 0],
		["afterRing", afterRingPixels, 1],
	] as const) {
		if (!expected) continue;
		const prefix = await captureTitleRiff(source, resources, index, {
			mutate: (plan) => {
				const front = plan.commands.find(
					(command) =>
						command.kind === "surface" && command.id === "title-front",
				);
				check(front?.kind === "surface", "Missing title front surface");
				const ring = front.commands.findIndex(
					(draw) =>
						draw.kind === "path" &&
						draw.path.some(
							(step) =>
								step.kind === "arc" && step.radius >= 300 && step.radius <= 400,
						) &&
						draw.paints.some(
							(paint) => paint.kind === "stroke" && paint.width === 6,
						),
				);
				check(ring >= 0, "Missing title ring boundary");
				Reflect.set(front, "commands", front.commands.slice(0, ring + extra));
			},
		});
		result[label] = {
			...difference(prefix, expected),
			locations: titleRiffDifferenceLocations(prefix, expected),
		};
	}
	return result;
}
