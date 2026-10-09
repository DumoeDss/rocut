import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { describeResource, type ResourceDescription } from "./resource-bytes";
import { resourceDigest, validateResources } from "./resources";

interface PathIdentity {
	readonly path: string;
	readonly stat: Stats;
}
export interface ImageSequenceRoot {
	readonly directory: string;
	readonly identity: readonly PathIdentity[];
}

function sameFile({ left, right }: { left: Stats; right: Stats }): boolean {
	return (
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.birthtimeMs === right.birthtimeMs
	);
}

async function inspectPath(path: string): Promise<PathIdentity[]> {
	const root = parse(path).root;
	const parts = path.slice(root.length).split(sep).filter(Boolean);
	const result: PathIdentity[] = [];
	let current = root;
	for (let index = -1; index < parts.length; index++) {
		if (index >= 0) current = join(current, parts[index]);
		const stat = await lstat(current);
		if (stat.isSymbolicLink())
			throw Error(
				"Image sequence paths must not contain symlinks or junctions",
			);
		if (index < parts.length - 1 && !stat.isDirectory())
			throw Error("Image sequence parent is not a directory");
		result.push({ path: current, stat });
	}
	return result;
}

async function confirmIdentities(
	identities: readonly PathIdentity[],
): Promise<void> {
	for (const entry of identities) {
		const current = await lstat(entry.path);
		if (
			current.isSymbolicLink() ||
			!sameFile({ left: current, right: entry.stat })
		)
			throw Error("Image sequence path changed while importing");
	}
}

export async function openImageSequenceRoot(
	directory: string,
): Promise<ImageSequenceRoot> {
	if (!isAbsolute(directory))
		throw Error("Image sequence rootDirectory must be absolute");
	const normalized = resolve(directory);
	const identity = await inspectPath(normalized);
	if (!identity.at(-1)?.stat.isDirectory())
		throw Error("Image sequence rootDirectory must be a directory");
	if (relative(normalized, await realpath(normalized)) !== "")
		throw Error("Image sequence root redirects to another directory");
	return { directory: normalized, identity };
}

export function imageSequenceRelativePath({
	root,
	absolutePath,
}: {
	root: ImageSequenceRoot;
	absolutePath: string;
}): string {
	if (!isAbsolute(absolutePath))
		throw Error("Image sequence manifestPath must be absolute");
	const path = relative(root.directory, resolve(absolutePath));
	if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`))
		throw Error("Image sequence manifestPath must be inside rootDirectory");
	return path.split(sep).join("/");
}

/** Host path safety only. Resource/manifest size admission remains in Rust. */
export async function readImageSequenceFile({
	root,
	path,
	description,
	signal,
}: {
	root: ImageSequenceRoot;
	path: string;
	description: ResourceDescription;
	signal?: AbortSignal;
}): Promise<ResolvedProgrammaticResource> {
	signal?.throwIfAborted();
	const parts = path.split("/");
	if (
		!path ||
		/[\\:\u0000-\u001f]/.test(path) ||
		parts.some(
			(part) =>
				!part ||
				part === "." ||
				part === ".." ||
				/[. ]$/.test(part) ||
				/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
		)
	)
		throw Error(
			"Image sequence dependency id must be a portable relative file path",
		);
	await confirmIdentities(root.identity);
	const target = resolve(root.directory, ...parts);
	const identities = await inspectPath(target);
	const beforePath = identities.at(-1)!.stat;
	if (!beforePath.isFile())
		throw Error("Image sequence input must be a regular file");
	const actual = await realpath(target);
	if (
		relative(target, actual) !== "" ||
		imageSequenceRelativePath({ root, absolutePath: actual }) !== path
	)
		throw Error("Image sequence dependency escaped its root");
	const provisional = describeResource(description, beforePath.size);
	validateResources([provisional]);
	signal?.throwIfAborted();
	const handle = await open(
		target,
		constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
	);
	try {
		const before = await handle.stat();
		if (
			!sameFile({ left: before, right: beforePath }) ||
			!before.isFile() ||
			before.size !== beforePath.size
		)
			throw Error("Image sequence file changed before opening");
		await confirmIdentities(identities);
		await confirmIdentities(root.identity);
		const bytes = Buffer.alloc(before.size);
		let offset = 0;
		while (offset < bytes.length) {
			signal?.throwIfAborted();
			const { bytesRead } = await handle.read(
				bytes,
				offset,
				bytes.length - offset,
				offset,
			);
			if (bytesRead === 0)
				throw Error("Image sequence file changed while reading");
			offset += bytesRead;
		}
		const after = await handle.stat();
		if (
			!sameFile({ left: before, right: after }) ||
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			before.ctimeMs !== after.ctimeMs
		)
			throw Error("Image sequence file changed while reading");
		await confirmIdentities(identities);
		await confirmIdentities(root.identity);
		signal?.throwIfAborted();
		const body = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
		return {
			resource: describeResource(
				description,
				body.byteLength,
				resourceDigest(body),
			),
			body,
		};
	} finally {
		await handle.close();
	}
}
