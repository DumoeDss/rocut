import { join, isAbsolute } from "node:path";
import type { ProgrammaticResource } from "@opencut/editor-contracts";
import { gltfFilePath } from "./gltf-archive";
import {
	createModelRestoreDirectory,
	modelRestoreIo,
	ModelRestoreIncompleteError,
} from "./model-restore-files";
import {
	loadProgrammaticResource,
	loadProgrammaticResources,
	resourceDigest,
	validateResources,
	type ProgrammaticResourceStore,
} from "./resources";

export { ModelRestoreIncompleteError } from "./model-restore-files";

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw Error("Invalid model source archive");
	return value as Record<string, unknown>;
}

/** Restore only verified archive attachments; original disk locations are never read. */
export async function restoreModelSource({
	input,
	signal,
	...context
}: ProgrammaticResourceStore & { input: unknown; signal?: AbortSignal }) {
	signal?.throwIfAborted();
	const spec = record(input);
	if (
		Object.keys(spec).some(
			(key) => !["resource", "outputDirectory"].includes(key),
		) ||
		typeof spec.outputDirectory !== "string" ||
		!isAbsolute(spec.outputDirectory)
	)
		throw Error(
			"Model source restore requires resource and absolute outputDirectory",
		);
	const descriptors = [spec.resource];
	validateResources(descriptors);
	const resource = descriptors[0];
	if (
		resource.kind !== "source" ||
		resource.mimeType !== "application/octet-stream"
	)
		throw Error("Model archive must be a source resource");
	const archive = await loadProgrammaticResource({
		...context,
		resource,
		signal,
	});
	const manifest = record(
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(archive.body)),
	);
	if (
		Object.keys(manifest).some(
			(key) =>
				!["version", "format", "entryFile", "files", "output"].includes(key),
		) ||
		manifest.version !== 1 ||
		manifest.format !== "gltf-2.0-author-archive" ||
		!Array.isArray(manifest.files)
	)
		throw Error("Unsupported model source archive manifest");
	const entryFile = gltfFilePath(manifest.entryFile);
	if (!entryFile.endsWith(".gltf"))
		throw Error("Model archive entry must be .gltf");
	const files = manifest.files.map((value) => {
		const file = record(value);
		if (Object.keys(file).some((key) => !["path", "resource"].includes(key)))
			throw Error("Unknown model archive file field");
		return { path: gltfFilePath(file.path), resource: file.resource };
	});
	const sourceResources = files.map((file) => file.resource);
	validateResources(sourceResources);
	const paths = new Set<string>();
	const directories = new Map<string, string>();
	for (const file of files) {
		const path = file.path.toLowerCase();
		if (paths.has(path)) throw Error("Duplicate model archive path");
		paths.add(path);
		const parts = file.path.split("/");
		for (let index = 1; index < parts.length; index++) {
			const directory = parts.slice(0, index).join("/");
			const folded = directory.toLowerCase();
			if (directories.has(folded) && directories.get(folded) !== directory)
				throw Error("Model archive directory casing conflicts");
			directories.set(folded, directory);
		}
		const descriptor = file.resource as ProgrammaticResource;
		if (
			descriptor.kind !== "source" ||
			descriptor.mimeType !== "application/octet-stream" ||
			descriptor.id !== `model-source/${file.path}`
		)
			throw Error("Invalid model archive source descriptor");
	}
	if (!files.some((file) => file.path === entryFile))
		throw Error("Model archive is missing its entry file");
	for (const path of paths) {
		const parts = path.split("/");
		for (let index = 1; index < parts.length; index++)
			if (paths.has(parts.slice(0, index).join("/")))
				throw Error("Conflicting model archive file/directory paths");
	}
	const outputs = [manifest.output];
	validateResources(outputs);
	if (
		outputs[0].kind !== "model" ||
		outputs[0].mimeType !== "model/gltf-binary"
	)
		throw Error("Invalid model archive output descriptor");
	validateResources([...sourceResources, resource, outputs[0]]);
	// Complete attachment readback must succeed before any output is published.
	const loaded = await loadProgrammaticResources(
		context,
		sourceResources,
		signal ?? new AbortController().signal,
	);
	const target = await createModelRestoreDirectory({
		outputDirectory: spec.outputDirectory,
		signal,
	});
	try {
		const write = async (
			path: string,
			body: ArrayBuffer,
			expected: { byteLength: number; sha256: string },
		) =>
			modelRestoreIo.writeFile({
				target,
				path,
				expected,
				signal,
				chunks: (async function* () {
					yield new Uint8Array(body);
				})(),
			});
		for (const [index, file] of files.entries())
			await write(
				`source/${file.path}`,
				loaded[index].body,
				loaded[index].resource,
			);
		const archivePath = await write(
			"metadata/model-archive.json",
			archive.body,
			archive.resource,
		);
		const receipt = {
			version: 1,
			operation: "model-source-restore",
			status: "complete",
			incomplete: false,
			resource,
			entryFile,
			sourceFiles: files,
			originalArchivePath: "metadata/model-archive.json",
			glbRebuilt: false,
			pathSafety: "checked-identities-not-native-handle-relative",
			completion:
				"Require the successful API result or verify restored file hashes; receipt presence alone is not proof of success.",
		};
		const receiptBody = new TextEncoder().encode(
			JSON.stringify(receipt),
		).buffer;
		const receiptPath = await write(
			"metadata/restore-receipt.json",
			receiptBody,
			{
				byteLength: receiptBody.byteLength,
				sha256: resourceDigest(receiptBody),
			},
		);
		return {
			status: "complete" as const,
			incomplete: false,
			directory: target.directory,
			sourceDirectory: join(target.directory, "source"),
			entryFile,
			archivePath,
			receiptPath,
			sourceFileCount: files.length,
			sourceByteLength: loaded.reduce(
				(total, file) => total + file.body.byteLength,
				0,
			),
			glbRebuilt: false,
		};
	} catch (cause) {
		throw new ModelRestoreIncompleteError({
			directory: target.directory,
			cause,
		});
	}
}
