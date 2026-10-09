import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ProgrammaticResource } from "@opencut/editor-contracts";
import {
	loadImageSequenceClosure,
	loadImageSequenceResource,
} from "./image-sequence-closure";
import { openImageSequenceRoot } from "./image-sequence-files";
import {
	createImageSequenceRestoreDirectory,
	ImageSequenceRestoreIncompleteError,
	writeImageSequenceRestoredFile,
} from "./image-sequence-restore-files";
import { validateResources, type ProgrammaticResourceStore } from "./resources";

export { ImageSequenceRestoreIncompleteError } from "./image-sequence-restore-files";

/** Restore authoring inputs only; no image sequence export, compilation or Blender launch. */
export async function restoreImageSequenceSource({
	input,
	signal,
	...context
}: ProgrammaticResourceStore & {
	input: unknown;
	signal?: AbortSignal;
}) {
	signal?.throwIfAborted();
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw Error("Expected image sequence source restore spec");
	const spec = input as Record<string, unknown>;
	if (
		Object.keys(spec).some(
			(key) => !["resource", "outputParent"].includes(key),
		) ||
		typeof spec.outputParent !== "string"
	)
		throw Error(
			"Image sequence source restore requires only resource and outputParent",
		);
	const resources = [spec.resource];
	validateResources(resources);
	const resource = resources[0];
	const parent = await openImageSequenceRoot(spec.outputParent);
	const { manifest } = await loadImageSequenceClosure({
		...context,
		resource,
		signal,
	});
	const target = await createImageSequenceRestoreDirectory({ parent, signal });
	try {
		const writeBytes = async (path: string, bytes: Uint8Array) =>
			writeImageSequenceRestoredFile({
				target,
				path,
				signal,
				expected: {
					byteLength: bytes.byteLength,
					sha256: createHash("sha256").update(bytes).digest("hex"),
				},
				chunks: (async function* () {
					yield bytes;
				})(),
			});
		const provenance = manifest.provenance;
		const receipt = {
			version: 1,
			operation: "image-sequence-source-restore",
			resource,
			shotId: manifest.shotId,
			renderId: manifest.renderId,
			engine: provenance.engine,
			engineVersion: provenance.version,
			parameters: provenance.parameters,
			entryFile: provenance.entryFile,
			sourceFiles: provenance.sourceFiles,
			originalManifest: provenance.originalManifest,
			framesRestored: false,
			pathSafety: "checked-identities-not-native-handle-relative",
			receiptRole: "provenance-only",
			completion:
				"Receipt presence does not prove success; require the successful API result or verify restored file hashes.",
		};
		const receiptPath = await writeBytes(
			"metadata/restore-receipt.json",
			new TextEncoder().encode(JSON.stringify(receipt)),
		);
		const load = (resource: ProgrammaticResource) =>
			loadImageSequenceResource({ ...context, resource, signal });
		for (const file of provenance.sourceFiles) {
			await writeImageSequenceRestoredFile({
				target,
				path: `source/${file.path}`,
				signal,
				expected: file,
				chunks: (async function* () {
					for (const part of file.parts)
						yield new Uint8Array((await load(part)).body);
				})(),
			});
		}
		const original = await load(provenance.originalManifest);
		const originalManifestPath = await writeImageSequenceRestoredFile({
			target,
			path: "metadata/original-render-manifest",
			signal,
			expected: provenance.originalManifest,
			chunks: (async function* () {
				yield new Uint8Array(original.body);
			})(),
		});
		return {
			directory: target.directory,
			sourceDirectory: join(target.directory, "source"),
			entryFile: provenance.entryFile,
			originalManifestPath,
			receiptPath,
			engine: provenance.engine,
			engineVersion: provenance.version,
			parameters: provenance.parameters,
			shotId: manifest.shotId,
			renderId: manifest.renderId,
			sourceFileCount: provenance.sourceFiles.length,
			sourceByteLength: provenance.sourceFiles.reduce(
				(total, file) => total + file.byteLength,
				0,
			),
			framesRestored: false,
			incomplete: false,
		};
	} catch (cause) {
		throw new ImageSequenceRestoreIncompleteError({
			directory: target.directory,
			cause,
		});
	}
}
