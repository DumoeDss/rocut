import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import * as fs from "node:fs/promises";
import { join, relative } from "node:path";
import {
	openImageSequenceRoot,
	type ImageSequenceRoot,
} from "./image-sequence-files";

export class ImageSequenceRestoreIncompleteError extends Error {
	readonly code = "IMAGE_SEQUENCE_RESTORE_INCOMPLETE";
	readonly incomplete = true;
	readonly directory: string;
	constructor({ directory, cause }: { directory: string; cause: unknown }) {
		super(
			`Image sequence source restore incomplete: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
		this.name = "ImageSequenceRestoreIncompleteError";
		this.directory = directory;
	}
}

const sameIdentity = (left: Stats, right: Stats) =>
	left.dev === right.dev &&
	left.ino === right.ino &&
	left.birthtimeMs === right.birthtimeMs;

/** Small physical IO seam for deterministic directory-redirection tests. */
export const imageSequenceRestoreIo = {
	createDirectory: async (path: string): Promise<void> => {
		await fs.mkdir(path);
	},
	createTemporaryDirectory: (prefix: string): Promise<string> =>
		fs.mkdtemp(prefix),
	openFile: (path: string): Promise<fs.FileHandle> =>
		fs.open(
			path,
			constants.O_RDWR |
				constants.O_CREAT |
				constants.O_EXCL |
				(constants.O_NOFOLLOW || 0),
			0o600,
		),
};

async function confirmDirectory(root: ImageSequenceRoot): Promise<void> {
	const current = await openImageSequenceRoot(root.directory);
	if (
		current.identity.length !== root.identity.length ||
		root.identity.some(
			(entry, index) =>
				entry.path !== current.identity[index].path ||
				!sameIdentity(entry.stat, current.identity[index].stat),
		)
	)
		throw Error("Image sequence restore directory identity changed");
}

/**
 * Checked-path IO, not a native directory-handle sandbox. Node lacks portable
 * openat/mkdirat: a hostile ancestor race can create an empty entry elsewhere.
 * Recheck before payload writes, use only the verified handle, and never clean
 * up by a path whose identity may have changed.
 */
export async function createImageSequenceRestoreDirectory({
	parent,
	signal,
}: {
	parent: ImageSequenceRoot;
	signal?: AbortSignal;
}) {
	signal?.throwIfAborted();
	await confirmDirectory(parent);
	const directory = await imageSequenceRestoreIo.createTemporaryDirectory(
		join(parent.directory, "rocut-image-sequence-restore-"),
	);
	try {
		await confirmDirectory(parent);
		signal?.throwIfAborted();
		const root = await openImageSequenceRoot(directory);
		return { directory, root, directories: new Map([[directory, root]]) };
	} catch (cause) {
		throw new ImageSequenceRestoreIncompleteError({ directory, cause });
	}
}

type RestoreDirectory = Awaited<
	ReturnType<typeof createImageSequenceRestoreDirectory>
>;

async function prepareParent({
	target,
	path,
	signal,
}: {
	target: RestoreDirectory;
	path: string;
	signal?: AbortSignal;
}): Promise<{ directory: ImageSequenceRoot; filePath: string }> {
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
			"Image sequence restore requires a portable relative file path",
		);
	let directory = target.root;
	for (const part of parts.slice(0, -1)) {
		signal?.throwIfAborted();
		await confirmDirectory(directory);
		const child = join(directory.directory, part);
		const existing = target.directories.get(child);
		if (existing) {
			await confirmDirectory(existing);
			directory = existing;
			continue;
		}
		await imageSequenceRestoreIo.createDirectory(child);
		await confirmDirectory(directory);
		directory = await openImageSequenceRoot(child);
		target.directories.set(child, directory);
	}
	await confirmDirectory(directory);
	return { directory, filePath: join(directory.directory, parts.at(-1)!) };
}

async function confirmFile({
	handle,
	directory,
	filePath,
	identity,
}: {
	handle: fs.FileHandle;
	directory: ImageSequenceRoot;
	filePath: string;
	identity: Stats;
}): Promise<Stats> {
	await confirmDirectory(directory);
	const actual = await fs.lstat(filePath),
		held = await handle.stat();
	if (
		!actual.isFile() ||
		actual.isSymbolicLink() ||
		actual.nlink !== 1 ||
		!sameIdentity(actual, identity) ||
		!sameIdentity(held, identity) ||
		relative(filePath, await fs.realpath(filePath)) !== ""
	)
		throw Error("Image sequence restore file identity changed");
	return held;
}

/** Stream one admitted file, verify actual persisted bytes, and never replace it. */
export async function writeImageSequenceRestoredFile({
	target,
	path,
	chunks,
	expected,
	signal,
}: {
	target: RestoreDirectory;
	path: string;
	chunks: AsyncIterable<Uint8Array>;
	expected: { byteLength: number; sha256: string };
	signal?: AbortSignal;
}): Promise<string> {
	signal?.throwIfAborted();
	const { directory, filePath } = await prepareParent({ target, path, signal });
	signal?.throwIfAborted();
	await confirmDirectory(directory);
	const handle = await imageSequenceRestoreIo.openFile(filePath);
	try {
		const identity = await handle.stat();
		await confirmFile({ handle, directory, filePath, identity });
		if (!identity.isFile() || identity.size !== 0 || identity.nlink !== 1)
			throw Error("Image sequence restore output is not a new exclusive file");
		let offset = 0;
		for await (const chunk of chunks) {
			signal?.throwIfAborted();
			await confirmFile({ handle, directory, filePath, identity });
			if (offset + chunk.byteLength > expected.byteLength)
				throw Error("Image sequence restored file exceeds declared size");
			let consumed = 0;
			while (consumed < chunk.byteLength) {
				signal?.throwIfAborted();
				await confirmFile({ handle, directory, filePath, identity });
				const { bytesWritten } = await handle.write(
					chunk,
					consumed,
					chunk.byteLength - consumed,
					offset,
				);
				if (bytesWritten === 0)
					throw Error("Image sequence restore write made no progress");
				consumed += bytesWritten;
				offset += bytesWritten;
				await confirmFile({ handle, directory, filePath, identity });
			}
		}
		if (offset !== expected.byteLength)
			throw Error("Image sequence restored file length mismatch");
		await handle.sync();
		const before = await confirmFile({ handle, directory, filePath, identity });
		if (before.size !== expected.byteLength)
			throw Error("Image sequence restored file length mismatch");
		const hash = createHash("sha256"),
			buffer = Buffer.alloc(65536);
		for (let position = 0; position < offset; ) {
			signal?.throwIfAborted();
			await confirmFile({ handle, directory, filePath, identity });
			const { bytesRead } = await handle.read(
				buffer,
				0,
				Math.min(buffer.length, offset - position),
				position,
			);
			if (bytesRead === 0)
				throw Error("Image sequence restored file was truncated");
			hash.update(buffer.subarray(0, bytesRead));
			position += bytesRead;
		}
		const after = await confirmFile({ handle, directory, filePath, identity });
		if (
			hash.digest("hex") !== expected.sha256 ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs ||
			after.ctimeMs !== before.ctimeMs
		)
			throw Error("Image sequence restored file integrity mismatch");
		signal?.throwIfAborted();
		return filePath;
	} finally {
		await handle.close();
	}
}
