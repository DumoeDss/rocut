import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { MvEmberPlan } from "../../packages/editor-contracts/src/mv-ember-plan";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { resolveMvResourceFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-resource-frame";
import { controlledNativeReplay } from "./mv-native-controlled-replay";
export { check, difference, pixels } from "./mv-afterimage-capture";
import { check, pixels } from "./mv-afterimage-capture";

export function emberResources(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
) {
	return (source.resources ?? []).map((declared) => {
		const found = resources.find((r) => r.resource.id === declared.id);
		check(found, `Missing Ember fixture attachment: ${declared.id}`);
		return found;
	});
}
export async function captureEmber(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
	index: number,
	options: {
		trim?: number;
		fractionalTrim?: number;
		mutate?: (plan: MvEmberPlan) => void;
		observe?: (plan: MvEmberPlan) => void;
		/** Fixture-only no-mutation baseline for the controlled native transport. */
		controlled?: boolean;
	} = {},
) {
	const step =
		(120000 * source.frameRate.denominator) / source.frameRate.numerator;
	const trim = (options.trim ?? 0) * step + (options.fractionalTrim ?? 0);
	let frame = resolveProgrammaticFrame({
		source,
		clipStart: 120000,
		trimStart: trim,
		clipDuration: source.durationFrames * step - trim,
		timelineTime: 120000 + index * step - trim,
	});
	check(frame, "Missing Ember frame");
	const assets = emberResources(source, resources);
	const controlled = options.controlled || !!options.mutate;
	if (!controlled && options.observe) {
		frame = await resolveMvResourceFrame({ source, resources: assets, frame });
		check(
			frame.recipePlan?.root.kind === "ember",
			"Unexpected Ember mutation root",
		);
		options.observe?.(frame.recipePlan.root.data);
	}
	// Negatives deliberately mutate fresh admitted data inside a test-only
	// transport, but use the EXACT production HTMLCanvas document. Using the old
	// Worker here would confound omitted-command sensitivity with clip-AA changes.
	const request = { source, frame, resources: assets };
	const bitmap = controlled
		? await controlledNativeReplay({
				...request,
				mutate: (plan) => {
					check(plan.root.kind === "ember", "Unexpected controlled Ember root");
					options.mutate?.(plan.root.data);
					options.observe?.(plan.root.data);
				},
			})
		: await renderProgrammaticCanvas(request);
	try {
		return pixels(bitmap, source.width, source.height);
	} finally {
		bitmap.close();
	}
}

export async function originalEmberPixels(
	oracle: Awaited<
		ReturnType<
			typeof import("./mv-ember-reference-browser").createEmberReference
		>
	>,
	frame: import("./mv-ember-reference-contract").EmberReferenceFrame,
) {
	const result = await oracle.render(frame);
	try {
		return {
			pixels: pixels(result.bitmap, 1920, 1080),
			provenance: result.provenance,
		};
	} finally {
		result.bitmap.close();
		result.canvas.width = result.canvas.height = 1;
	}
}
