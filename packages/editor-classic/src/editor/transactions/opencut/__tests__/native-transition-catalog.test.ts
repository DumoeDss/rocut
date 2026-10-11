import { expect, test } from "bun:test";
import { mvRecipeCatalogJson } from "opencut-wasm";
import { nativeTransitionCatalog } from "../native-transition-catalog";
import { editingCatalog } from "../editing-catalog";
import { PEEL_UNAVAILABLE } from "../../../../transitions/transition-style";

test("old native core does not advertise Peel just because MV recipes support it", () => {
	const catalog = nativeTransitionCatalog({ mvRecipeCatalogJson });
	expect(catalog.target).toBe("clip.transitionIn");
	expect(catalog.styles["cross-dissolve"].availability).toBe(
		"implemented-not-runtime-probed",
	);
	expect(catalog.styles.peel).toMatchObject({
		availability: "unavailable",
		error: PEEL_UNAVAILABLE,
		fallback: "none; missing or rejected native support is an error",
	});
	expect(catalog.styles.peel.defaults).toBeUndefined();
	expect(catalog.styles.peel.parameters).toBeUndefined();
	expect(catalog.styles.bend.availability).toBe("unavailable");
	expect(catalog.styles.bend.defaults).toBeUndefined();
});

test("native admission gates discovery and parameter metadata comes from Rust", () => {
	const inputs: unknown[] = [];
	const catalog = nativeTransitionCatalog({
		mvRecipeCatalogJson,
		nativeTransitionStyleValidateJson: (input) => {
			inputs.push(JSON.parse(input));
			return input;
		},
	});
	const parameters = JSON.parse(mvRecipeCatalogJson()).transitionParameters.peel
		.parameters;
	expect(catalog.styles.peel.availability).toBe(
		"implemented-not-runtime-probed",
	);
	expect(catalog.styles.peel.parameters).toEqual(parameters);
	const expected = {
		kind: "peel" as const,
		direction: parameters.direction.suggested,
		curl: parameters.curl.suggested,
		segments: parameters.segments.suggested,
		shading: parameters.shading.suggested,
		perspective: parameters.perspective.suggested,
	};
	expect(catalog.styles.peel.defaults).toEqual(expected);
	const bendParameters = JSON.parse(mvRecipeCatalogJson()).transitionParameters
		.bend.parameters;
	const expectedBend = {
		kind: "bend" as const,
		direction: bendParameters.direction.suggested,
		hinge: bendParameters.hinge.suggested,
		angle: bendParameters.angle.suggested,
		perspective: bendParameters.perspective.suggested,
		shading: bendParameters.shading.suggested,
	};
	expect(catalog.styles.bend.availability).toBe(
		"implemented-not-runtime-probed",
	);
	expect(catalog.styles.bend.parameters).toEqual(bendParameters);
	expect(catalog.styles.bend.defaults).toEqual(expectedBend);
	expect(inputs).toEqual([expected, expectedBend]);
});

test("a core with Peel but without Bend never advertises recipe-only Bend as native", () => {
	const catalog = nativeTransitionCatalog({
		mvRecipeCatalogJson,
		nativeTransitionStyleValidateJson: (input) => {
			if (JSON.parse(input).kind === "bend")
				throw Error("Bend missing in selected runtime");
			return input;
		},
	});
	expect(catalog.styles.peel.availability).toBe(
		"implemented-not-runtime-probed",
	);
	expect(catalog.styles.bend.availability).toBe("unavailable");
	expect(catalog.styles.bend.error).toBe("Bend missing in selected runtime");
	expect(catalog.styles.bend.defaults).toBeUndefined();
});

test("catalog admission errors stay visible without a usable Peel default", () => {
	const catalog = nativeTransitionCatalog({
		mvRecipeCatalogJson,
		nativeTransitionStyleValidateJson: () => {
			throw Error("native Peel support was rejected");
		},
	});
	expect(catalog.styles.peel.availability).toBe("unavailable");
	expect(catalog.styles.peel.error).toBe("native Peel support was rejected");
	expect(catalog.styles.peel.defaults).toBeUndefined();
});

test("public editing catalog exposes distinct native and recipe transition targets", () => {
	const catalog = editingCatalog();
	expect(catalog.transitions.target).toBe("clip.transitionIn");
	expect(catalog.transitions.operation).toContain(
		"update-clip.patch.transitionIn",
	);
	expect(catalog.programmatic.mvRecipe.transitions).toContain("peel");
	expect(catalog.transitions.styles.bend.fields).toEqual([
		"direction",
		"hinge",
		"angle",
		"perspective",
		"shading",
	]);
	expect(catalog.programmatic.mvRecipe.transitions).toContain("bend");
	expect(catalog.programmatic.mvRecipe.contract).toContain("source.recipe");
});
