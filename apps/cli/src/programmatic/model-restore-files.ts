import { mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { gltfFilePath } from "./gltf-archive";
import {
	openImageSequenceRoot,
	type ImageSequenceRoot,
} from "./image-sequence-files";
import { writeImageSequenceRestoredFile } from "./image-sequence-restore-files";

export class ModelRestoreIncompleteError extends Error {
	readonly code = "MODEL_RESTORE_INCOMPLETE";
	readonly incomplete = true;
	readonly status = "incomplete";
	readonly directory: string;
	constructor({ directory, cause }: { directory: string; cause: unknown }) {
		super(
			`Model source restore incomplete: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
		this.name = "ModelRestoreIncompleteError";
		this.directory = directory;
	}
}

/** Physical IO seam; checked identity writes remain shared with sequence restore. */
export const modelRestoreIo = {
	createDirectory: (path: string) => mkdir(path),
	writeFile: writeImageSequenceRestoredFile,
};

async function confirmParent(parent: ImageSequenceRoot): Promise<void> {
	const current = await openImageSequenceRoot(parent.directory);
	if (
		parent.identity.length !== current.identity.length ||
		parent.identity.some((entry, index) => {
			const other = current.identity[index];
			return (
				entry.path !== other.path ||
				entry.stat.dev !== other.stat.dev ||
				entry.stat.ino !== other.stat.ino ||
				entry.stat.birthtimeMs !== other.stat.birthtimeMs
			);
		})
	)
		throw Error("Model restore parent directory identity changed");
}

/** Exact output path, existing controlled parent, exclusive mkdir, no cleanup. */
export async function createModelRestoreDirectory({
	outputDirectory,
	signal,
}: {
	outputDirectory: string;
	signal?: AbortSignal;
}) {
	if (!isAbsolute(outputDirectory))
		throw Error("Model outputDirectory must be absolute");
	const directory = resolve(outputDirectory);
	gltfFilePath(basename(directory));
	const parent = await openImageSequenceRoot(dirname(directory));
	signal?.throwIfAborted();
	await confirmParent(parent);
	// EEXIST is a pre-publication rejection, so it must not claim ownership.
	await modelRestoreIo.createDirectory(directory);
	try {
		await confirmParent(parent);
		signal?.throwIfAborted();
		const root = await openImageSequenceRoot(directory);
		return { directory, root, directories: new Map([[directory, root]]) };
	} catch (cause) {
		throw new ModelRestoreIncompleteError({ directory, cause });
	}
}
