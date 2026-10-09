import type {
	MvEmberCommand,
	MvFlamePlan,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { captureFlame } from "./mv-flame-capture";
import { check, difference } from "./mv-afterimage-capture";
import { omitFlameFingers } from "./mv-flame-native-mutations";

export function preparedFlame(data: MvFlamePlan) {
	const base = data.commands.find(
		(c) => c.kind === "surface" && c.id === "fl-base",
	);
	check(
		base?.kind === "surface",
		"Missing canonical full prepared Flame surface",
	);
	const [width, height] = base.size;
	const commands: MvEmberCommand[] = [
		base,
		{
			kind: "blit",
			surface: base.id,
			sourceRect: [0, 0, width, height],
			destinationRect: [0, 0, width, height],
			transform: [1, 0, 0, 1, 0, 0],
			composite: "source-over",
			opacity: 1,
		},
		{ kind: "releaseSurface", surface: base.id },
	];
	Reflect.set(data, "commands", commands);
}

function mapCommands({
	data,
	map,
}: {
	data: MvFlamePlan;
	map: (command: MvEmberCommand) => MvEmberCommand | undefined;
}) {
	Reflect.set(
		data,
		"commands",
		data.commands.flatMap((c) => {
			const mapped = map(c);
			return mapped ? [mapped] : [];
		}),
	);
}

/** Independent command omissions only, never alternate expected pixels. */
export async function flameNegatives({
	source,
	resources,
	index,
}: {
	source: ProgrammaticSource;
	resources: readonly ResolvedProgrammaticResource[];
	index: number;
}) {
	const baseline = await captureFlame({
		source: source,
		resources: resources,
		index: index,
	});
	const positive = await captureFlame({
		source: source,
		resources: resources,
		index: index,
		imagePreprocessOwner: undefined,
		control: {},
	});
	check(
		difference(baseline, positive).max === 0,
		"Flame controlled transport must exactly match public route",
	);
	const mutations: Record<string, (data: MvFlamePlan) => void> = {
		"unlit-fingers": (data) => {
			mapCommands({
				data: data,
				map: (c) => {
					if (c.kind === "releaseSurface" && c.surface === "fl-lit-mask")
						return undefined;
					if (c.kind === "surface" && c.id === "fl-fingers")
						return {
							...c,
							commands: c.commands.map((child) =>
								child.kind === "blit" && child.surface === "fl-lit"
									? { ...child, surface: "fl-lit-mask" }
									: child,
							),
						};
					return c;
				},
			});
			Reflect.set(data, "commands", [
				...data.commands,
				{ kind: "releaseSurface", surface: "fl-lit-mask" },
			]);
		},
		"no-repair": (data) =>
			mapCommands({
				data: data,
				map: (c) =>
					c.kind === "surface" && c.id === "fl-base"
						? {
								...c,
								commands: c.commands.filter(
									(child) => child.kind !== "preparedPatch",
								),
							}
						: c,
			}),
		"no-feather": (data) =>
			mapCommands({
				data: data,
				map: (c) =>
					c.kind === "surface" && c.id === "fl-base"
						? {
								...c,
								commands: c.commands.filter(
									(child) =>
										!(
											child.kind === "rect" &&
											child.paint.composite === "destination-out"
										),
								),
							}
						: c,
			}),
		"no-fingers": omitFlameFingers,
		"no-lit-shading": (data) =>
			mapCommands({
				data: data,
				map: (c) =>
					c.kind === "surface" && c.id === "fl-lit"
						? {
								...c,
								commands: c.commands.filter(
									(child) =>
										!(
											child.kind === "rect" &&
											child.paint.composite === "source-atop"
										),
								),
							}
						: c,
			}),
	};
	const results: Record<string, unknown> = {
		positive: difference(baseline, positive),
	};
	for (const [name, mutate] of Object.entries(mutations)) {
		const actual = await captureFlame({
			source: source,
			resources: resources,
			index: index,
			imagePreprocessOwner: undefined,
			control: {
				mutate,
			},
		});
		const diff = difference(baseline, actual);
		check(
			diff.max > 2 || diff.mae >= 0.025,
			`Flame omission is not detectable: ${name}`,
		);
		results[name] = diff;
	}
	return results;
}
