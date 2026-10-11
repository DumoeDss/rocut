import { mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { gltfFilePath } from "./gltf-archive";
import {
	openImageSequenceRoot,
	type ImageSequenceRoot,
} from "./image-sequence-files";
import { writeImageSequenceRestoredFile } from "./image-sequence-restore-files";

export class BuildSourceRestoreIncompleteError extends Error {
	readonly code = "BUILD_SOURCE_RESTORE_INCOMPLETE";
	readonly status = "incomplete";
	readonly incomplete = true;
	readonly directory: string;
	constructor({ directory, cause }: { directory: string; cause: unknown }) {
		super(
			`Build source restore incomplete: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
		this.name = "BuildSourceRestoreIncompleteError";
		this.directory = directory;
	}
}

/** Physical IO only. Rust owns source/resource admission and archive budgets. */
export const buildSourceRestoreIo = {
	createDirectory: (path: string) => mkdir(path),
	writeFile: writeImageSequenceRestoredFile,
};

/** Before publication, reject physical filename aliases even where a logical
 * Rust resource namespace is case-sensitive. Reuse portable-path IO checks. */
export function validateBuildSourceRestorePaths(
	paths: readonly string[],
): void {
	const files = new Set<string>(),
		directories = new Map<string, string>();
	for (const path of paths) {
		gltfFilePath(path);
		const folded = path.toLowerCase();
		if (files.has(folded))
			throw Error("Build source restore file paths collide");
		files.add(folded);
		const parts = path.split("/");
		for (let index = 1; index < parts.length; index++) {
			const directory = parts.slice(0, index).join("/"),
				lower = directory.toLowerCase();
			if (directories.has(lower) && directories.get(lower) !== directory)
				throw Error("Build source restore directory casing conflicts");
			directories.set(lower, directory);
		}
	}
	for (const directory of directories.keys())
		if (files.has(directory))
			throw Error("Build source restore file/directory paths collide");
}

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
		throw Error("Build source restore parent directory identity changed");
}

/** Existing nonredirected parent, exclusive output mkdir, no overwrite/cleanup.
 * Like existing restore IO, checked identities are not native openat handles. */
export async function createBuildSourceRestoreDirectory({
	outputDirectory,
	signal,
}: {
	outputDirectory: string;
	signal?: AbortSignal;
}) {
	if (!isAbsolute(outputDirectory))
		throw Error("Build source outputDirectory must be absolute");
	const directory = resolve(outputDirectory);
	gltfFilePath(basename(directory));
	const parent = await openImageSequenceRoot(dirname(directory));
	signal?.throwIfAborted();
	await confirmParent(parent);
	// EEXIST is pre-publication rejection, not ownership of the existing tree.
	await buildSourceRestoreIo.createDirectory(directory);
	try {
		await confirmParent(parent);
		signal?.throwIfAborted();
		const root = await openImageSequenceRoot(directory);
		return { directory, root, directories: new Map([[directory, root]]) };
	} catch (cause) {
		throw new BuildSourceRestoreIncompleteError({ directory, cause });
	}
}
