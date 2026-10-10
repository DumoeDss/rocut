import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { captureInk } from "./mv-ink-capture";
import { check, difference } from "./mv-afterimage-capture";
import {
	inkMutations,
	inkPixelEquivalentMutations,
} from "./mv-ink-native-mutations";
export async function inkNegatives({
	source,
	resources,
	index,
}: {
	source: ProgrammaticSource;
	resources: readonly ResolvedProgrammaticResource[];
	index: number;
}) {
	const baseline = await captureInk({ source, resources, index });
	const control = await captureInk({ source, resources, index, control: {} });
	const positive = difference(baseline, control);
	check(
		positive.max === 0,
		"Ink controlled replay differs from public native document",
	);
	const observations: Record<string, unknown> = { positive };
	for (const [name, mutate] of Object.entries(inkPixelEquivalentMutations)) {
		const result = difference(
			baseline,
			await captureInk({ source, resources, index, control: { mutate } }),
		);
		check(
			result.max === 0,
			`Ink native pixel-equivalent creation CTM control changed pixels: ${name}`,
		);
		observations[name] = {
			...result,
			pixelEquivalent: true,
			scope:
				"gradient creation CTM native call order; separate structural control, not a pixel-sensitive negative",
		};
	}
	for (const [name, mutate] of Object.entries(inkMutations)) {
		const result = difference(
			baseline,
			await captureInk({ source, resources, index, control: { mutate } }),
		);
		check(
			result.max > 2 || result.mae >= 0.025,
			`Ink negative not observable: ${name}`,
		);
		observations[name] = result;
	}
	const wrongClock = difference(
		baseline,
		await captureInk({ source, resources, index: index - 10 }),
	);
	check(
		wrongClock.max > 2 || wrongClock.mae >= 0.025,
		"Wrong Ink source clock not observable",
	);
	observations["wrong-clock"] = wrongClock;
	return observations;
}
