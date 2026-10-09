import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { ProgrammaticSource, ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { readResourceFile } from "../resource-bytes";
import { sourceDescription, withBuildResources } from "./build-source";

/** Only explicitly declared, plain files. Never traverse the user's project tree. */
export async function snapshotSourceFiles(sourceDirectory: string, source: ProgrammaticSource, signal: AbortSignal) {
	if (!isAbsolute(sourceDirectory)) throw Error("sourceDirectory must be absolute");
	const root = await realpath(sourceDirectory);
	if (!(await lstat(root)).isDirectory()) throw Error("sourceDirectory must be a directory");
	if (!source.build) throw Error("Missing build archive declaration");
	const manifest = [...source.build.inputs];
	const inputs: ResolvedProgrammaticResource[] = [];
	for (let i = 0; i < manifest.length; i++) {
		signal.throwIfAborted();
		const id = manifest[i].id;
		let target = root;
		for (const part of id.split("/")) {
			target = join(target, part);
			if ((await lstat(target)).isSymbolicLink()) throw Error(`Build input symlinks are not supported: ${id}`);
		}
		const actual = await realpath(target), path = relative(root, actual);
		if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) throw Error("Build input escaped source directory");
		const input = await readResourceFile(actual, sourceDescription(id), signal, candidate => {
			manifest[i] = candidate;
			withBuildResources(source, manifest, source.build!.toolchainLock);
		});
		manifest[i] = input.resource;
		inputs.push(input);
	}
	return inputs;
}
