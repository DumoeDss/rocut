import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
	MvEmberPlan,
	MvEmberCommand,
} from "@opencut/editor-contracts";
import { captureThread } from "./mv-thread-capture";
import { check, difference } from "./mv-afterimage-capture";
export const threadParity = (diff: ReturnType<typeof difference>) =>
	diff.max <= 2 && diff.mae < 0.025;

export async function threadNegatives(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	advance: (s: string) => void,
) {
	const index = 170,
		actual = await captureThread(source, resources, index);
	const control = difference(
		actual,
		await captureThread(source, resources, index, {}),
	);
	check(
		control.max === 0,
		"Controlled Thread must equal public replay exactly",
	);
	const observations: Record<string, unknown> = { controlled: control };
	const mutateSurface = (
		data: MvEmberPlan,
		id: string,
		keep: (c: MvEmberCommand) => boolean,
	) => {
		const surface = data.commands.find(
			(c) => c.kind === "surface" && c.id === id,
		);
		check(surface?.kind === "surface", `Missing Thread fixture surface ${id}`);
		const remaining = surface.commands.filter(keep);
		check(
			remaining.length < surface.commands.length,
			`Vacuous Thread negative ${id}`,
		);
		Reflect.set(surface, "commands", remaining);
	};
	const omissions: readonly [string, (data: MvEmberPlan) => void][] = [
		[
			"nebula",
			(data) =>
				mutateSurface(
					data,
					"th-scene",
					(c) =>
						c.kind !== "blit" || !["th-neb-v", "th-neb-r"].includes(c.surface),
				),
		],
		[
			"hand-lighting",
			(data) => mutateSurface(data, "th-lit", (c) => c.kind !== "rect"),
		],
		[
			"hand-rim",
			(data) =>
				mutateSurface(
					data,
					"th-scene",
					(c) => c.kind !== "blit" || c.surface !== "th-rim",
				),
		],
		[
			"ribbon-glows",
			(data) =>
				mutateSurface(
					data,
					"th-scene",
					(c) =>
						c.kind !== "blit" || !["th-wide", "th-near"].includes(c.surface),
				),
		],
		[
			"frayed-fibres",
			(data) =>
				mutateSurface(
					data,
					"th-scene",
					(c) =>
						c.kind !== "path" ||
						!c.paints.some((p) => p.kind === "stroke" && p.width === 1.1),
				),
		],
	];
	for (const [name, mutate] of omissions) {
		advance(`negative/${name}`);
		const diff = difference(
			actual,
			await captureThread(source, resources, index, { mutate }),
		);
		check(!threadParity(diff), `Thread omission escaped gate: ${name}`);
		observations[name] = diff;
	}
	return observations;
}
