import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
	MvEmberPlan,
	MvEmberCommand,
} from "@opencut/editor-contracts";
import { captureFall } from "./mv-fall-capture";
import { check, difference } from "./mv-afterimage-capture";
export const fallParity = (diff: ReturnType<typeof difference>) =>
	diff.max <= 2 && diff.mae < 0.025;
export async function fallNegatives(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	advance: (s: string) => void,
) {
	const index = 170,
		actual = await captureFall(source, resources, index);
	const control = difference(
		actual,
		await captureFall(source, resources, index, {}),
	);
	check(control.max === 0, "Controlled Fall must equal public replay exactly");
	const observations: Record<string, unknown> = { controlled: control };
	const filter = (
		data: MvEmberPlan,
		id: string,
		keep: (c: MvEmberCommand) => boolean,
	) => {
		const surface = data.commands.find(
			(c) => c.kind === "surface" && c.id === id,
		);
		check(surface?.kind === "surface", `Missing Fall surface ${id}`);
		const kept = surface.commands.filter(keep);
		check(kept.length < surface.commands.length, `Vacuous Fall omission ${id}`);
		Reflect.set(surface, "commands", kept);
	};
	const omissions: readonly [string, (data: MvEmberPlan) => void][] = [
		[
			"soft-cone",
			(data) =>
				filter(
					data,
					"fa-scene",
					(c) => c.kind !== "blit" || c.surface !== "fa-cone",
				),
		],
		[
			"character-lighting",
			(data) => filter(data, "fa-lit", (c) => c.kind !== "rect"),
		],
		[
			"warm-rim",
			(data) =>
				filter(
					data,
					"fa-scene",
					(c) => c.kind !== "blit" || c.surface !== "fa-warm",
				),
		],
		[
			"cold-rim",
			(data) =>
				filter(
					data,
					"fa-scene",
					(c) => c.kind !== "blit" || c.surface !== "fa-cold",
				),
		],
		[
			"per-strip-rim-blur",
			(data) =>
				filter(
					data,
					"fa-scene",
					(c) => c.kind !== "blit" || c.raster?.blurPx !== 5,
				),
		],
		[
			"ribbon-glows",
			(data) =>
				filter(
					data,
					"fa-scene",
					(c) =>
						c.kind !== "blit" || !["fa-wide", "fa-near"].includes(c.surface),
				),
		],
		[
			"frayed-fibres",
			(data) =>
				filter(
					data,
					"fa-scene",
					(c) =>
						c.kind !== "path" ||
						!c.paints.some((p) => p.kind === "stroke" && p.width === 1),
				),
		],
		[
			"near-streak-sprite",
			(data) =>
				filter(
					data,
					"fa-scene",
					(c) => c.kind !== "blit" || c.surface !== "fa-streak",
				),
		],
	];
	for (const [name, mutate] of omissions) {
		advance(`negative/${name}`);
		const diff = difference(
			actual,
			await captureFall(source, resources, index, { mutate }),
		);
		check(!fallParity(diff), `Fall omission escaped gate: ${name}`);
		observations[name] = diff;
	}
	return observations;
}
