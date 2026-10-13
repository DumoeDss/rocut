import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, link, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";

export const POSTER_SOURCE_LIMIT = 1024 * 1024 * 1024;
export const POSTER_PNG_LIMIT = 1024 * 1024;
export const posterDigest = (body: Uint8Array) =>
	createHash("sha256").update(body).digest("hex");
const samePath = (a: string, b: string) =>
	process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
const contained = (root: string, file: string) => {
	const rel = relative(root, file);
	return (
		!!rel &&
		!isAbsolute(rel) &&
		rel !== ".." &&
		!rel.startsWith(".." + (process.platform === "win32" ? "\\" : "/"))
	);
};

/** Check every real component, including already-existing project ancestors. */
export async function posterDirectory(
	directory: string,
	create = false,
): Promise<string> {
	if (!isAbsolute(directory)) throw Error("Poster root must be absolute");
	const absolute = resolve(directory),
		volume = parse(absolute).root;
	let current = volume;
	for (const part of relative(volume, absolute)
		.split(/[\\/]/)
		.filter(Boolean)) {
		current = join(current, part);
		if (create) {
			try {
				await mkdir(current);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		}
		const stat = await lstat(current);
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			!samePath(await realpath(current), current)
		)
			throw Error("Poster directory is redirected or invalid");
	}
	return absolute;
}
export function posterRelative(value: unknown): string {
	if (
		typeof value !== "string" ||
		!value ||
		value.length > 2000 ||
		/[\\:\x00-\x1f]/.test(value) ||
		isAbsolute(value) ||
		value.split("/").some((part) => !part || part === "." || part === "..")
	)
		throw Error("Invalid contained poster path");
	return value;
}
export async function posterPaths(input: {
	projectRoot: string;
	sourceRelativePath: string;
	sourceSha256: string;
	destinationRelativePath: string;
}) {
	if (!/^[a-f0-9]{64}$/.test(input.sourceSha256))
		throw Error("Invalid poster source pin");
	const root = await posterDirectory(input.projectRoot);
	const source = resolve(root, posterRelative(input.sourceRelativePath));
	const destinationRelativePath = `.elftia/creator/posters/${input.sourceSha256}/frame-0.png`;
	if (input.destinationRelativePath !== destinationRelativePath)
		throw Error("Poster destination differs from fixed source pin");
	const destination = resolve(root, posterRelative(destinationRelativePath));
	if (!contained(root, source) || !contained(root, destination))
		throw Error("Poster path escaped project");
	await posterDirectory(dirname(source));
	return { root, source, destination, destinationRelativePath };
}
export async function readPosterFile(
	file: string,
	limit: number,
	signal: AbortSignal,
	optional = false,
): Promise<Buffer | undefined> {
	signal.throwIfAborted();
	let stat;
	try {
		stat = await lstat(file);
	} catch (error) {
		if (optional && (error as NodeJS.ErrnoException).code === "ENOENT")
			return undefined;
		throw error;
	}
	if (
		!stat.isFile() ||
		stat.isSymbolicLink() ||
		stat.size < 1 ||
		stat.size > limit ||
		!samePath(await realpath(file), resolve(file))
	)
		throw Error("Poster file is redirected or exceeds bounds");
	const handle = await open(file, "r");
	try {
		const opened = await handle.stat();
		if (
			opened.dev !== stat.dev ||
			opened.ino !== stat.ino ||
			opened.size !== stat.size
		)
			throw Error("Poster file changed before read");
		// A bounded handle read cannot allocate beyond the stat-derived cap even if
		// another process grows the file while it is being read.
		const body = Buffer.alloc(opened.size);
		let offset = 0;
		while (offset < body.length) {
			signal.throwIfAborted();
			const result = await handle.read(
				body,
				offset,
				body.length - offset,
				offset,
			);
			if (!result.bytesRead) throw Error("Poster file truncated during read");
			offset += result.bytesRead;
		}
		const after = await handle.stat(),
			current = await lstat(file);
		if (
			after.size !== opened.size ||
			after.mtimeMs !== opened.mtimeMs ||
			current.dev !== opened.dev ||
			current.ino !== opened.ino ||
			current.isSymbolicLink()
		)
			throw Error("Poster file changed during read");
		return body;
	} finally {
		await handle.close();
	}
}
export function posterPng(body: Buffer) {
	if (
		body.length < 33 ||
		body.length > POSTER_PNG_LIMIT ||
		!body
			.subarray(0, 8)
			.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
		body.toString("ascii", 12, 16) !== "IHDR"
	)
		throw Error("Invalid poster PNG");
	const width = body.readUInt32BE(16),
		height = body.readUInt32BE(20);
	if (!width || !height || width > 512 || height > 512)
		throw Error("Poster PNG dimensions exceed bounds");
	return { width, height, sha256: posterDigest(body), sizeBytes: body.length };
}
export async function writePosterFile(
	file: string,
	body: Buffer,
	signal: AbortSignal,
): Promise<void> {
	const parent = await posterDirectory(dirname(file)),
		temporary = join(parent, `.poster-${randomUUID()}.tmp`);
	let created = false;
	try {
		signal.throwIfAborted();
		const handle = await open(temporary, "wx", 0o600);
		created = true;
		try {
			await handle.writeFile(body);
			await handle.sync();
		} finally {
			await handle.close();
		}
		signal.throwIfAborted();
		await posterDirectory(parent);
		try {
			await link(temporary, file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const existing = await readPosterFile(file, body.length, signal);
			if (!existing?.equals(body))
				throw Error("Existing poster differs from fixed output");
		}
	} finally {
		// No recursive cleanup. Revalidate the exact parent before unlinking only
		// the exclusive random temporary name owned by this operation.
		if (created) {
			await posterDirectory(parent);
			await unlink(temporary);
		}
	}
}
