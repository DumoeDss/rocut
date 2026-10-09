import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type {
	MvEmberCommand,
	MvEmberPlan,
} from "../../packages/editor-contracts/src/mv-ember-plan";
import { captureEmber, check, difference } from "./mv-ember-capture";

export async function emberNegativeControls(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	index: number,
) {
	const scene = source.recipe!.nodes.find(
		(node) => node.scene.kind === "ember",
	)!.scene;
	check(scene.kind === "ember", "Missing Ember test scene");
	const mode = scene.settings.mode;
	const base = await captureEmber(source, resources, index);
	const sameBackend = difference(
		base,
		await captureEmber(source, resources, index, { controlled: true }),
	);
	check(
		sameBackend.max === 0 && sameBackend.mae === 0 && sameBackend.changed === 0,
		`${mode} controlled native replay differs from public route: ${JSON.stringify(sameBackend)}`,
	);
	const tests: [string, (command: MvEmberCommand) => boolean][] = [
		["grain", (c) => c.kind === "grain"],
	];
	if (mode === "breathe")
		tests.push(
			["shimmer-blits", (c) => c.kind === "blit"],
			["HUD", (c) => c.kind === "text"],
		);
	if (mode === "ignite")
		tests.push(
			[
				"crack-polylines",
				(c) =>
					c.kind === "path" &&
					c.path.length > 2 &&
					c.path.every((p) => p.kind === "moveTo" || p.kind === "lineTo"),
			],
			["HUD", (c) => c.kind === "text"],
		);
	if (mode === "collapse")
		tests.push(
			["covered-image", (c) => c.kind === "image"],
			["energy-paths", (c) => c.kind === "path"],
		);
	const observations: Record<string, unknown> = {
		controlledBackend: "production-htmlcanvas-native-document",
		unmodifiedControlledVsPublic: sameBackend,
	};
	for (const [label, omit] of tests) {
		const mutate = (plan: MvEmberPlan) => {
			check(
				plan.commands.some(omit),
				`Missing ${mode}/${label} negative-control target`,
			);
			Reflect.set(
				plan,
				"commands",
				plan.commands.filter((command) => !omit(command)),
			);
		};
		const error = difference(
			base,
			await captureEmber(source, resources, index, { mutate }),
		);
		observations[label] = error;
		check(
			error.changed > 100 && error.mae > 0.002,
			`Invisible ${mode}/${label} negative control: ${JSON.stringify(error)}`,
		);
	}
	const wrongClock = difference(
		base,
		await captureEmber(source, resources, index + 3),
	);
	check(
		wrongClock.changed > 100 && wrongClock.mae > 0.002,
		`Invisible ${mode} wrong-clock negative control`,
	);
	observations.wrongClock = wrongClock;
	return observations;
}
