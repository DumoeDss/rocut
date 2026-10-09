import type { ProgrammaticResource } from "@opencut/editor-contracts";
import { describeResource } from "./resource-bytes";
import {
	resourceDigest,
	validateResources,
	type ProgrammaticResourceStore,
} from "./resources";
import {
	IMAGE_SEQUENCE_MIME,
	loadImageSequenceResource,
	parseImageSequenceManifest,
	saveImageSequenceResource,
	verifyImageSequenceSourceFiles,
} from "./image-sequence-closure";
import {
	imageSequenceRelativePath,
	openImageSequenceRoot,
	readImageSequenceFile,
} from "./image-sequence-files";
import { validateImageSequenceFrame } from "./image-sequence-image";

/** An import prepares a complete archive; attaching it is still an editing transaction. */
export async function importImageSequence({
	input,
	signal,
	...context
}: ProgrammaticResourceStore & {
	input: unknown;
	signal?: AbortSignal;
}) {
	signal?.throwIfAborted();
	if (typeof context.store.listAttachmentHeaders !== "function")
		throw Error(
			"Image sequence import requires metadata-only attachment enumeration",
		);
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw Error("Expected image sequence import spec");
	const spec = input as Record<string, unknown>;
	if (
		Object.keys(spec).some(
			(key) => !["id", "manifestPath", "rootDirectory"].includes(key),
		) ||
		typeof spec.id !== "string" ||
		typeof spec.manifestPath !== "string" ||
		typeof spec.rootDirectory !== "string"
	)
		throw Error(
			"Image sequence import requires only id, manifestPath and rootDirectory",
		);
	const description = {
		id: spec.id,
		kind: "imageSequence" as const,
		mimeType: IMAGE_SEQUENCE_MIME,
	};
	validateResources([describeResource(description, 1)]);
	const root = await openImageSequenceRoot(spec.rootDirectory);
	const path = imageSequenceRelativePath({
		root,
		absolutePath: spec.manifestPath,
	});
	const original = await readImageSequenceFile({
		root,
		path,
		description,
		signal,
	});
	const validation = parseImageSequenceManifest(original.body);
	if (validation.manifest.provenance.originalManifest.id === path)
		throw Error(
			"Original render manifest must not refer to the canonical import manifest",
		);
	let reusedDependencies = 0;
	for (const dependency of validation.dependencies) {
		signal?.throwIfAborted();
		const loaded = await readImageSequenceFile({
			root,
			path: dependency.id,
			description: dependency,
			signal,
		});
		if (
			loaded.resource.byteLength !== dependency.byteLength ||
			loaded.resource.sha256 !== dependency.sha256
		)
			throw Error(
				`Image sequence input does not match descriptor: ${dependency.id}`,
			);
		if (dependency.kind === "image")
			validateImageSequenceFrame({ loaded, manifest: validation.manifest });
		const saved = await saveImageSequenceResource({
			...context,
			resource: dependency,
			body: loaded.body,
			signal,
		});
		if (saved.reused) reusedDependencies++;
	}
	await verifyImageSequenceSourceFiles({
		manifest: validation.manifest,
		signal,
		read: (resource: ProgrammaticResource) =>
			loadImageSequenceResource({ ...context, resource, signal }),
	});
	// Publish the canonical manifest only after every dependency and whole source
	// file passed durable readback. Failed imports leave unreferenced bytes, no GC.
	const body = new TextEncoder().encode(
		JSON.stringify(validation.manifest),
	).buffer;
	const resource = describeResource(
		description,
		body.byteLength,
		resourceDigest(body),
	);
	const saved = await saveImageSequenceResource({
		...context,
		resource,
		body,
		signal,
	});
	return {
		...saved,
		manifest: validation.manifest,
		dependencies: validation.dependencies.length,
		reusedDependencies,
	};
}
