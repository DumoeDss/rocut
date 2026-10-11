import { isAbsolute, join } from "node:path";
import { validateBuildSource } from "./engines/build-source";
import {
	BuildSourceRestoreIncompleteError,
	buildSourceRestoreIo,
	createBuildSourceRestoreDirectory,
	validateBuildSourceRestorePaths,
} from "./build-source-restore-files";
import {
	loadProgrammaticResources,
	resourceDigest,
	type ProgrammaticResourceStore,
} from "./resources";

export { BuildSourceRestoreIncompleteError } from "./build-source-restore-files";

/** Restore the declared author archive, never original disk paths, author code,
 * package installation or compilation. No project mutation or revision change. */
export async function restoreBuildSource({
	input,
	signal,
	...context
}: ProgrammaticResourceStore & { input: unknown; signal?: AbortSignal }) {
	signal?.throwIfAborted();
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw Error("Expected build source restore specification");
	const spec = input as Record<string, unknown>;
	if (
		Object.keys(spec).some(
			(key) => !["source", "outputDirectory"].includes(key),
		) ||
		typeof spec.outputDirectory !== "string" ||
		!isAbsolute(spec.outputDirectory)
	)
		throw Error(
			"Build source restore requires complete source and absolute outputDirectory",
		);
	const source = structuredClone(spec.source);
	validateBuildSource(source);
	if (!source.build)
		throw Error("Build source restore requires an archived source.build");
	const build = source.build;
	const authorPaths = build.inputs.map((resource) => `source/${resource.id}`);
	// Resource logical IDs need not be safe physical filenames. Content-addressed
	// names avoid device/casing aliases and preserve logical IDs in the file map.
	const resourcePaths = (source.resources ?? []).map(
		(resource) => `resources/${resource.sha256}`,
	);
	validateBuildSourceRestorePaths([
		...authorPaths,
		...new Set(resourcePaths),
		"metadata/build-source.json",
		"metadata/toolchain-lock.json",
		"metadata/restore-receipt.json",
	]);
	const lifetime = signal ?? new AbortController().signal;
	// Rust admits each declared namespace as in compile/rebuild; do not flatten
	// different logical namespaces into a new validator or budget policy.
	const archive = await loadProgrammaticResources(
		context,
		[...build.inputs, build.toolchainLock],
		lifetime,
	);
	const resources = await loadProgrammaticResources(
		context,
		source.resources ?? [],
		lifetime,
	);
	// All declared attachments must pass metadata, length and SHA readback before
	// owning an output directory. Author source files remain byte-exact, even binary.
	const target = await createBuildSourceRestoreDirectory({
		outputDirectory: spec.outputDirectory,
		signal,
	});
	try {
		const write = (
			path: string,
			body: ArrayBuffer,
			expected: { byteLength: number; sha256: string },
		) =>
			buildSourceRestoreIo.writeFile({
				target,
				path,
				expected,
				signal,
				chunks: (async function* () {
					yield new Uint8Array(body);
				})(),
			});
		const writeJson = (path: string, value: unknown) => {
			const body = new TextEncoder().encode(JSON.stringify(value)).buffer;
			return write(path, body, {
				byteLength: body.byteLength,
				sha256: resourceDigest(body),
			});
		};
		for (const [index, path] of authorPaths.entries())
			await write(path, archive[index].body, archive[index].resource);
		const writtenResources = new Set<string>();
		for (const [index, path] of resourcePaths.entries()) {
			if (writtenResources.has(path)) continue;
			await write(path, resources[index].body, resources[index].resource);
			writtenResources.add(path);
		}
		const lock = archive[build.inputs.length];
		const toolchainLockPath = await write(
			"metadata/toolchain-lock.json",
			lock.body,
			lock.resource,
		);
		const fileMap = [
			...build.inputs.map((resource, index) => ({
				role: "build-input",
				path: authorPaths[index],
				resource,
			})),
			...resources.map((loaded, index) => ({
				role: "resource",
				path: resourcePaths[index],
				resource: loaded.resource,
			})),
			{
				role: "toolchain-lock",
				path: "metadata/toolchain-lock.json",
				resource: lock.resource,
			},
		];
		const effects = {
			compiled: false,
			authorCodeExecuted: false,
			projectMutated: false,
			attachmentsImported: false,
			toolchainInstalled: false,
			automaticallyCompilable: false,
		};
		const sourceMetadataPath = await writeJson("metadata/build-source.json", {
			version: 1,
			format: "rocut-build-source-restore-v1",
			source,
			fileMap,
			...effects,
		});
		const receipt = {
			version: 1,
			operation: "build-source-restore",
			status: "complete",
			incomplete: false,
			entryFile: build.entryFile,
			sourceFiles: build.inputs.map((resource, index) => ({
				path: authorPaths[index],
				resource,
			})),
			resources: resources.map((loaded, index) => ({
				path: resourcePaths[index],
				resource: loaded.resource,
			})),
			sourceMetadataPath: "metadata/build-source.json",
			toolchainLockPath: "metadata/toolchain-lock.json",
			fileMap,
			...effects,
			pathSafety: "checked-identities-not-native-handle-relative",
			completion:
				"Require the successful API result or verify restored file hashes; receipt presence alone is not proof of success.",
		};
		const receiptPath = await writeJson(
			"metadata/restore-receipt.json",
			receipt,
		);
		return {
			status: "complete" as const,
			incomplete: false,
			directory: target.directory,
			sourceDirectory: join(target.directory, "source"),
			entryFile: build.entryFile,
			sourceMetadataPath,
			toolchainLockPath,
			receiptPath,
			sourceFileCount: build.inputs.length,
			sourceByteLength: archive
				.slice(0, build.inputs.length)
				.reduce((total, loaded) => total + loaded.body.byteLength, 0),
			resourceFileCount: writtenResources.size,
			fileMap,
			...effects,
		};
	} catch (cause) {
		throw new BuildSourceRestoreIncompleteError({
			directory: target.directory,
			cause,
		});
	}
}
