import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { capture, check, difference } from "./mv-type-card-capture";
import { typeCardCase, typeCardSource, color } from "./mv-type-card-source";

export async function verifyTypeCardComposition(
	resources: readonly ResolvedProgrammaticResource[],
) {
	const observations: unknown[] = [];
	for (const mode of ["quiet", "flicker"] as const) {
		const { settings } = typeCardCase(mode);
		Reflect.set(settings, "grain", 0);
		Reflect.set(settings, "background", [0, 0, 0, 0]);
		const source = typeCardSource(
			resources.map((r) => r.resource),
			settings,
		);
		Reflect.set(source, "width", 384);
		Reflect.set(source, "height", 216);
		const index = mode === "quiet" ? 90 : 1,
			original = await capture(source, resources, index);
		check(
			original[3] === 0 &&
				original.some((v, i) => i % 4 === 3 && v > 0 && v < 255),
			`${mode} lost transparent/partial alpha`,
		);
		const graded = structuredClone(source);
		Reflect.set(graded.recipe!, "post", [
			{ roles: ["graphics"], effects: [{ kind: "fade", amount: 0.5 }] },
		]);
		const actual = await capture(graded, resources, index);
		let alphaError = 0,
			colorError = 0,
			covered = 0;
		for (let i = 0; i < actual.length; i += 4) {
			alphaError = Math.max(
				alphaError,
				Math.abs(actual[i + 3]! - original[i + 3]!),
			);
			if (original[i + 3]! > 128)
				for (let c = 0; c < 3; c++) {
					colorError = Math.max(
						colorError,
						Math.abs(actual[i + c]! - original[i + c]! * 0.5),
					);
					covered++;
				}
		}
		check(
			alphaError === 0 && colorError <= 2 && covered > 100,
			`${mode} role post failed alpha-preserving fade: ${alphaError}/${colorError}/${covered}`,
		);
		Reflect.set(graded.recipe!, "post", [
			{ roles: ["foreground"], effects: [{ kind: "fade", amount: 0.5 }] },
		]);
		check(
			difference(original, await capture(graded, resources, index)).max === 0,
			`${mode} post affected another role`,
		);
		Reflect.set(graded.recipe!, "post", [
			{ stage: "composite", effects: [{ kind: "fade", amount: 0.5 }] },
		]);
		check(
			difference(actual, await capture(graded, resources, index)).max === 0,
			`${mode} role/composite post differ`,
		);
		if (settings.mode === "quiet")
			Reflect.set(settings, "color", color(255, 30, 70));
		else
			Reflect.set(settings, "rgbColors", [
				color(255, 150, 0),
				color(200, 255, 0),
				color(0, 255, 200),
			]);
		check(
			difference(original, await capture(source, resources, index)).mae > 0.01,
			`${mode} authored palette ignored`,
		);
		Reflect.set(source, "frameRate", { numerator: 30000, denominator: 1001 });
		check(
			difference(
				await capture(source, resources, 60),
				await capture(source, resources, 60, 10),
			).max === 0,
			`${mode} fractional fps/trim disagreed`,
		);
		observations.push({ mode, alphaError, colorError, covered });
	}
	return {
		observations,
		checks: [
			"Both modes: transparent coverage, role/composite post, role isolation, authored colors, small canvas and 30000/1001 trim consistency",
		],
	};
}
