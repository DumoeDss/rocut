import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { capture, check, difference } from "./mv-afterimage-capture";

export async function verifyAfterimageComposition(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
) {
	const transparent = structuredClone(source);
	Reflect.set(transparent, "width", 384);
	Reflect.set(transparent, "height", 216);
	const scene = transparent.recipe!.nodes[0]!.scene;
	check(scene.kind === "afterimage", "Expected afterimage scene");
	Reflect.set(scene.settings, "grain", 0);
	Reflect.set(scene.settings, "background", [0, 0, 0, 0]);
	const original = await capture(transparent, resources, 30);
	check(original[3] === 0, "Transparent afterimage gained opaque background");
	check(
		original.some((v, i) => i % 4 === 3 && v > 0 && v < 255),
		"Afterimage lost partial alpha",
	);
	const graded = structuredClone(transparent);
	Reflect.set(graded.recipe!, "post", [
		{ roles: ["graphics"], effects: [{ kind: "fade", amount: 0.5 }] },
	]);
	const actual = await capture(graded, resources, 30);
	let alphaError = 0,
		colorError = 0,
		count = 0;
	for (let i = 0; i < actual.length; i += 4) {
		alphaError = Math.max(
			alphaError,
			Math.abs(actual[i + 3]! - original[i + 3]!),
		);
		// Fully covered samples avoid unpremultiply quantization near transparent edges.
		if (original[i + 3] === 255)
			for (let c = 0; c < 3; c++) {
				colorError = Math.max(
					colorError,
					Math.abs(actual[i + c]! - original[i + c]! * 0.5),
				);
				count++;
			}
	}
	check(
		alphaError === 0 && colorError <= 1 && count > 100,
		"Role post failed alpha-preserving fade",
	);
	Reflect.set(graded.recipe!, "post", [
		{ roles: ["foreground"], effects: [{ kind: "fade", amount: 0.5 }] },
	]);
	check(
		difference(original, await capture(graded, resources, 30)).max === 0,
		"Post targeting another role changed afterimage",
	);
	Reflect.set(graded.recipe!, "post", [
		{ stage: "composite", effects: [{ kind: "fade", amount: 0.5 }] },
	]);
	check(
		difference(actual, await capture(graded, resources, 30)).max === 0,
		"Single-role composite and role fade differ",
	);
	const colored = structuredClone(transparent);
	const variant = colored.recipe!.nodes[0]!.scene;
	check(variant.kind === "afterimage", "Expected editable afterimage settings");
	Reflect.set(variant.settings, "color", [1, 0.2, 0.1, 1]);
	Reflect.set(variant.settings, "fringeColor", [0.8, 0.1, 0.3, 1]);
	check(
		difference(original, await capture(colored, resources, 30)).mae > 1,
		"Author colors ignored",
	);
	Reflect.set(variant.settings, "timeScale", 2);
	Reflect.set(variant.settings, "motionScale", 0);
	check(
		difference(
			await capture(colored, resources, 30),
			await capture(colored, resources, 31),
		).mae > 0.01,
		"Zero motionScale incorrectly froze decay",
	);
	return {
		checks: [
			"Transparent afterimage partial coverage; role/composite alpha-preserving post; authored palette and nonfreezing zero-motion scale",
		],
		observations: { alphaError, colorError, opaqueChannelSamples: count },
	};
}
