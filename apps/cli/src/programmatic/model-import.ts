import { lstat } from "node:fs/promises";
import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { join } from "node:path";
import { archiveGltf, gltfFilePath } from "./gltf-archive";
import {
	openImageSequenceRoot,
	readImageSequenceFile,
} from "./image-sequence-files";
import { describeResource, saveResourceBytes } from "./resource-bytes";
import {
	resourceDigest,
	validateResources,
	type ProgrammaticResourceStore,
} from "./resources";

/** Explicit author closure, archived verbatim; runtime receives only the GLB. */
export async function importGltfModel({
	input,
	signal,
	...context
}: ProgrammaticResourceStore & { input: unknown; signal?: AbortSignal }) {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw Error("Expected glTF model import spec");
	const spec = input as Record<string, unknown>;
	if (
		Object.keys(spec).some(
			(key) =>
				![
					"id",
					"kind",
					"mimeType",
					"sourceDirectory",
					"entryFile",
					"files",
				].includes(key),
		) ||
		typeof spec.id !== "string" ||
		spec.kind !== "model" ||
		spec.mimeType !== "model/gltf-binary" ||
		typeof spec.sourceDirectory !== "string" ||
		!Array.isArray(spec.files)
	)
		throw Error(
			"glTF model import requires id, kind:model, mimeType:model/gltf-binary, sourceDirectory, entryFile and files",
		);
	const entryFile = gltfFilePath(spec.entryFile);
	if (!entryFile.endsWith(".gltf"))
		throw Error("glTF entryFile must end in .gltf");
	const paths = spec.files.map(gltfFilePath);
	if (!paths.includes(entryFile) || new Set(paths).size !== paths.length)
		throw Error(
			"glTF files must uniquely declare the entry and complete dependency closure",
		);
	const description = {
		id: spec.id,
		kind: "model" as const,
		mimeType: "model/gltf-binary",
	};
	const sourceDescription = (path: string) => ({
		id: `model-source/${path}`,
		kind: "source" as const,
		mimeType: "application/octet-stream",
	});
	// Rust's resource-count limit is checked before touching the source directory.
	validateResources([
		...paths.map((path) => describeResource(sourceDescription(path), 0)),
		describeResource(
			{
				id: "model-archive.json",
				kind: "source",
				mimeType: "application/octet-stream",
			},
			0,
		),
		describeResource(description, 1),
	]);
	const root = await openImageSequenceRoot(spec.sourceDirectory);
	const provisional = [];
	for (const path of paths) {
		signal?.throwIfAborted();
		let current = root.directory;
		const parts = path.split("/");
		for (const [index, part] of parts.entries()) {
			current = join(current, part);
			const component = await lstat(current);
			if (
				component.isSymbolicLink() ||
				(index < parts.length - 1 && !component.isDirectory())
			)
				throw Error(`glTF input path redirects: ${path}`);
		}
		const stat = await lstat(current);
		if (!stat.isFile() || stat.isSymbolicLink())
			throw Error(`glTF input must be a regular file: ${path}`);
		provisional.push(describeResource(sourceDescription(path), stat.size));
	}
	validateResources(provisional);
	const loaded: ResolvedProgrammaticResource[] = [];
	for (const path of paths) {
		const file = await readImageSequenceFile({
			root,
			path,
			description: sourceDescription(path),
			signal,
		});
		loaded.push(file);
		validateResources(loaded.map((value) => value.resource));
	}
	const body = archiveGltf({
		entryFile,
		files: new Map(paths.map((path, index) => [path, loaded[index].body])),
		admitBytes: (byteLength) =>
			validateResources([describeResource(description, byteLength)]),
	});
	const resource = describeResource(
		description,
		body.byteLength,
		resourceDigest(body),
	);
	const manifest = {
		version: 1,
		format: "gltf-2.0-author-archive",
		entryFile,
		files: paths.map((path, index) => ({
			path,
			resource: loaded[index].resource,
		})),
		output: resource,
	};
	const archiveBody = new TextEncoder().encode(JSON.stringify(manifest)).buffer;
	const archiveResource = describeResource(
		{
			id: "model-archive.json",
			kind: "source",
			mimeType: "application/octet-stream",
		},
		archiveBody.byteLength,
		resourceDigest(archiveBody),
	);
	validateResources([
		...loaded.map((value) => value.resource),
		archiveResource,
		resource,
	]);
	// Publication follows full validation; formal attachment readback verifies every byte.
	for (const file of loaded) await saveResourceBytes(context, file, signal);
	await saveResourceBytes(
		context,
		{ resource: archiveResource, body: archiveBody },
		signal,
	);
	const saved = await saveResourceBytes(context, { resource, body }, signal);
	return { ...saved, archive: { resource: archiveResource, manifest } };
}
