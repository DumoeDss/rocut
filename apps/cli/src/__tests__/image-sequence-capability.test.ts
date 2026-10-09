import { expect, test } from "bun:test";
import { mkdir, readFile, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { IMAGE_SEQUENCE_RESOURCE_CAPABILITY } from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { imageSequenceFixture } from "./image-sequence-fixture";

test("Agent discovers experimental imageSequence in both catalogs and follows its dedicated import/restore endpoints", async () => {
	const fixture = await imageSequenceFixture();
	const options = {
		projectRoot: join(fixture.directory, "project"),
		registry: new TargetRegistry(join(fixture.directory, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
		engineToolchainDirectory: "",
	};
	let host: Awaited<ReturnType<typeof startHost>> | undefined;
	try {
		host = await startHost(options);
		const api = (route: string) => new URL(`api/${route}`, host!.editorUrl);
		const beforeResponse = await fetch(api("context"));
		expect(beforeResponse.status).toBe(200);
		const before = await beforeResponse.json();
		const capability = before.programmaticResources.imageSequence;
		expect(before.programmaticResources.kinds).toContain("imageSequence");
		expect(capability).toEqual(IMAGE_SEQUENCE_RESOURCE_CAPABILITY);
		expect(capability).toMatchObject({
			status: "experimental",
			acceptance: {
				complete: false,
				encodedPixelQuality: "not-accepted",
				installedElectron: "not-verified",
			},
			genericImport: false,
			consumer: { engine: "mv-recipe", sceneKind: "imageSequence" },
		});
		expect(capability.unsupported).toEqual([
			"canvas-assets.image",
			"html-resource-image",
			"automatic-blender-render",
			"rendered-frame-restore",
		]);
		const catalogResponse = await fetch(api(before.editing.catalog));
		expect(catalogResponse.status).toBe(200);
		const catalog = await catalogResponse.json();
		expect(catalog.programmatic.resources.imageSequence).toEqual(capability);
		expect(catalog.programmatic.resources.kinds).toContain("imageSequence");
		expect(catalog.programmatic.resources.kinds).not.toContain("source");
		expect(catalog.programmatic.mvRecipe.scenes).toContain("imageSequence");

		// A single manifest is not a complete dependency closure. Generic import
		// must still reject this kind even though the discovery list includes it.
		const genericResponse = await fetch(
			api(before.programmaticResources.import),
			{
				method: "POST",
				body: JSON.stringify({
					id: fixture.input.id,
					filePath: fixture.manifestPath,
					kind: "imageSequence",
					mimeType: "application/vnd.rocut.image-sequence+json",
				}),
			},
		);
		expect(genericResponse.status).toBe(422);
		expect((await genericResponse.json()).error).toContain(capability.import);
		expect((await (await fetch(api("context"))).json()).revision).toBe(
			before.revision,
		);

		const importedResponse = await fetch(api(capability.import), {
			method: "POST",
			body: JSON.stringify(fixture.input),
		});
		const imported = await importedResponse.json();
		if (importedResponse.status !== 200) throw Error(JSON.stringify(imported));
		expect(imported.resource.kind).toBe("imageSequence");
		expect(imported.manifest).toEqual(fixture.manifest);
		expect(imported.dependencies).toBe(fixture.files.size);
		expect((await (await fetch(api("context"))).json()).revision).toBe(
			before.revision,
		);

		await host.close();
		host = undefined;
		const relocated = join(fixture.directory, "author-moved");
		expect(dirname(fixture.rootDirectory)).toBe(fixture.directory);
		expect(dirname(relocated)).toBe(fixture.directory);
		await rename(fixture.rootDirectory, relocated);
		host = await startHost(options);
		const reopened = await (await fetch(api("context"))).json();
		expect(reopened.programmaticResources.imageSequence).toEqual(capability);
		const outputParent = join(fixture.directory, "restores");
		await mkdir(outputParent);
		const restoreBody = JSON.stringify({
			resource: imported.resource,
			outputParent,
		});
		const denied = await fetch(
			new URL(`/wrong/api/${capability.restoreSource}`, host.editorUrl),
			{ method: "POST", body: restoreBody },
		);
		expect(denied.status).toBe(401);
		await denied.arrayBuffer();
		expect(await readdir(outputParent)).toEqual([]);
		const restoredResponse = await fetch(
			api(reopened.programmaticResources.imageSequence.restoreSource),
			{ method: "POST", body: restoreBody },
		);
		const restored = await restoredResponse.json();
		if (restoredResponse.status !== 200) throw Error(JSON.stringify(restored));
		expect(restored).toMatchObject({
			entryFile: "project.blend",
			framesRestored: false,
			incomplete: false,
			sourceFileCount: 1,
			sourceByteLength: 5,
		});
		expect(
			await readFile(join(restored.sourceDirectory, restored.entryFile)),
		).toEqual(Buffer.from([1, 2, 3, 4, 5]));
		expect(await readFile(restored.originalManifestPath, "utf8")).toBe(
			'{"render":"original-author-manifest"}',
		);
		expect((await readdir(restored.directory)).sort()).toEqual([
			"metadata",
			"source",
		]);
		expect((await (await fetch(api("context"))).json()).revision).toBe(
			before.revision,
		);
	} finally {
		await host?.close();
		await fixture.cleanup();
	}
});
