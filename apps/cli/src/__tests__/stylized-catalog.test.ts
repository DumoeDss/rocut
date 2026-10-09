import { expect, test } from "bun:test";
import { mvRecipeCatalogJson, stylizedEffectCatalogJson } from "opencut-wasm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

test("editing discovery exposes Rust stylized parameters without claiming runtime health", async () => {
	const parent = path.resolve(tmpdir());
	const root = await mkdtemp(path.join(parent, "rocut-stylized-catalog-"));
	const host = await startHost({
		projectRoot: path.join(root, "project"),
		registry: new TargetRegistry(path.join(root, "registry")),
		htmlBrowserExecutable: "",
	});
	try {
		const response = await fetch(
			new URL("api/editing/catalog", host.editorUrl),
		);
		expect(response.status).toBe(200);
		const catalog = await response.json(),
			extensions = JSON.parse(mvRecipeCatalogJson());
		expect(catalog.programmatic.mvRecipe.extensions).toEqual(extensions);
		expect(extensions.availability).toBe("implemented-not-runtime-probed");
		expect(catalog.programmatic.mvRecipe.scenes).toContain("glyphRain");
		expect(catalog.programmatic.mvRecipe.scenes).toContain("particleReveal");
		expect(catalog.programmatic.mvRecipe.scenes).toContain("asciiSweep");
		expect(catalog.programmatic.mvRecipe.scenes).toContain("particleScroll");
		expect(catalog.programmatic.mvRecipe.scenes).toContain("grid");
		expect(catalog.programmatic.mvRecipe.scenes).toContain("hexFloat");
		expect(catalog.programmatic.mvRecipe.scenes).toContain("shatter");
		expect(catalog.programmatic.mvRecipe.transitions).toContain("bend");
		expect(catalog.programmatic.mvRecipe.transitions).toContain("peel");
		expect(extensions.transitionParameters.peel.requires).toEqual([
			"worker-webgl2",
		]);
		expect(catalog.programmatic.runtimes).toEqual(["canvas-worker"]);
		expect(catalog.programmatic.htmlDocument.configured).toBe(false);
		expect(catalog.programmatic.resources.kinds).toContain("model");
		expect(catalog.programmatic.resources.kinds).toContain("environment");
		for (const effect of JSON.parse(stylizedEffectCatalogJson())) {
			const fields = catalog.effects[effect.id];
			expect(fields.map((field: { key: string }) => field.key)).toEqual(
				effect.fields.map((field: { key: string }) => field.key),
			);
			for (const field of effect.fields)
				expect(
					fields.find((p: { key: string }) => p.key === field.key),
				).toMatchObject(field);
		}
	} finally {
		await host.close();
		if (
			path.dirname(root) !== parent ||
			!path.basename(root).startsWith("rocut-stylized-catalog-")
		)
			throw Error("Invalid catalog fixture cleanup root");
		await rm(root, { recursive: true, force: true });
	}
});
