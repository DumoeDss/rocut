import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import type { createEmberReference } from "./mv-ember-reference-browser";
import { emberAudioFacts } from "./mv-ember-audio";
import { emberCase, emberSource, emberOriginalFrame } from "./mv-ember-source";
import {
	captureEmber,
	check,
	difference,
	originalEmberPixels,
} from "./mv-ember-capture";

export async function verifyEmberComposition(
	resources: readonly ResolvedProgrammaticResource[],
	oracle: Awaited<ReturnType<typeof createEmberReference>>,
) {
	const observations: Record<string, unknown> = {};
	const audio = emberAudioFacts();
	for (const mode of ["breathe", "ignite", "collapse"] as const) {
		const test = emberCase(mode, audio),
			source = emberSource(
				test,
				resources.map((r) => r.resource),
			);
		const index = mode === "breathe" ? 57 : mode === "ignite" ? 90 : 75;
		const native = await captureEmber(source, resources, index);
		const reseeded = { ...source, seed: 4294967295 };
		check(
			difference(native, await captureEmber(reseeded, resources, index)).max ===
				0,
			`${mode} incorrectly depends on source.seed`,
		);
		if (test.settings.mode === "ignite" && test.original.mode === "ignite") {
			const zero = {
				...test,
				settings: { ...test.settings, seed: 0 },
				original: { ...test.original, seed: 0 },
			};
			const zeroSource = emberSource(
				zero,
				resources.map((r) => r.resource),
			);
			const zeroPixels = await captureEmber(zeroSource, resources, index);
			check(
				difference(native, zeroPixels).max === 0,
				"ignite seed0 differs from seed5",
			);
			const expected = await originalEmberPixels(
				oracle,
				emberOriginalFrame(zero, zeroSource, index),
			);
			const error = difference(zeroPixels, expected.pixels);
			check(
				error.max <= 2 && error.mae < 0.025,
				`Original seed0 fallback mismatch: ${JSON.stringify(error)}`,
			);
			observations.igniteSeedZero = error;
			const other = emberSource(
				{ ...test, settings: { ...test.settings, seed: 7 } },
				resources.map((r) => r.resource),
			);
			check(
				difference(native, await captureEmber(other, resources, index))
					.changed > 100,
				"Nondefault ignite seed lost crack geometry",
			);
		}
		// Separate small-surface author/compositing checks. Native pixel and export
		// acceptance remain full 1920x1080 and are not replaced by this check.
		const transparent = emberSource(
			{
				...test,
				settings: {
					...test.settings,
					grain: 0,
					palette: { ...test.settings.palette, background: [0, 0, 0, 0] },
				},
			},
			resources.map((r) => r.resource),
		);
		const small = { ...transparent, width: 384, height: 216 };
		const original = await captureEmber(small, resources, index);
		check(
			original.some(
				(value, offset) => offset % 4 === 3 && value > 0 && value < 255,
			),
			`${mode} lost partial alpha`,
		);
		const graded = structuredClone(small);
		Reflect.set(graded.recipe!, "post", [
			{ roles: ["foreground"], effects: [{ kind: "fade", amount: 0.5 }] },
		]);
		const actual = await captureEmber(graded, resources, index);
		let alphaError = 0,
			colorError = 0,
			covered = 0;
		for (let offset = 0; offset < actual.length; offset += 4) {
			alphaError = Math.max(
				alphaError,
				Math.abs(actual[offset + 3] - original[offset + 3]),
			);
			if (original[offset + 3] > 128)
				for (let channel = 0; channel < 3; channel++) {
					colorError = Math.max(
						colorError,
						Math.abs(
							actual[offset + channel] - original[offset + channel] * 0.5,
						),
					);
					covered++;
				}
		}
		check(
			alphaError === 0 && colorError <= 2 && covered > 100,
			`${mode} role fade failed: ${alphaError}/${colorError}/${covered}`,
		);
		Reflect.set(graded.recipe!, "post", [
			{ roles: ["graphics"], effects: [{ kind: "fade", amount: 0.5 }] },
		]);
		check(
			difference(original, await captureEmber(graded, resources, index)).max ===
				0,
			`${mode} unrelated role was graded`,
		);
		Reflect.set(graded.recipe!, "post", [
			{ stage: "composite", effects: [{ kind: "fade", amount: 0.5 }] },
		]);
		check(
			difference(actual, await captureEmber(graded, resources, index)).max ===
				0,
			`${mode} role/composite fade diverged`,
		);
		observations[mode] = {
			sourceSeedIndependent: true,
			alphaError,
			colorError,
			covered,
		};
	}
	return observations;
}
