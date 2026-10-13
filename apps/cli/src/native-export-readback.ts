import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join, parse, relative, resolve, sep } from "node:path";

export const NATIVE_EXPORT_ARTIFACT_LIMIT = 1024 * 1024 * 1024;
export const NATIVE_EXPORT_LEDGER_LIMIT = 16 * 1024 * 1024;

export class NativeExportReadbackError extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}
const same = (a: Stats, b: Stats) =>
	a.dev === b.dev &&
	a.ino === b.ino &&
	a.size === b.size &&
	a.mtimeMs === b.mtimeMs &&
	a.ctimeMs === b.ctimeMs;

/** Read one bounded regular file from a pinned handle. Never follows a redirected parent. */
export async function readNativeExportFile(
	path: string,
	limit: number,
	onOpened?: () => Promise<void>,
) {
	const absolute = resolve(path);
	const root = parse(absolute).root;
	const names = relative(root, absolute).split(sep);
	const parents: { path: string; stat: Stats }[] = [];
	let cursor = root;
	for (const name of names.slice(0, -1)) {
		cursor = join(cursor, name);
		const stat = await lstat(cursor);
		if (!stat.isDirectory() || stat.isSymbolicLink())
			throw new NativeExportReadbackError("native-export-directory-redirected");
		parents.push({ path: cursor, stat });
	}
	const before = await lstat(absolute);
	if (!before.isFile() || before.isSymbolicLink())
		throw new NativeExportReadbackError("native-export-file-redirected");
	if (before.size > limit)
		throw new NativeExportReadbackError("native-export-read-limit");
	const file = await open(
		absolute,
		constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
	);
	try {
		const opened = await file.stat();
		if (!same(before, opened))
			throw new NativeExportReadbackError("native-export-read-changed");
		await onOpened?.();
		const bytes = Buffer.alloc(opened.size);
		let offset = 0;
		while (offset < bytes.length) {
			const next = await file.read(
				bytes,
				offset,
				bytes.length - offset,
				offset,
			);
			if (!next.bytesRead)
				throw new NativeExportReadbackError("native-export-read-changed");
			offset += next.bytesRead;
		}
		const after = await file.stat();
		const pathAfter = await lstat(absolute);
		if (
			!same(opened, after) ||
			!same(opened, pathAfter) ||
			pathAfter.isSymbolicLink()
		)
			throw new NativeExportReadbackError("native-export-read-changed");
		for (const parent of parents) {
			const current = await lstat(parent.path);
			// Directory contents may change independently; identity must not.
			if (
				current.isSymbolicLink() ||
				!current.isDirectory() ||
				current.dev !== parent.stat.dev ||
				current.ino !== parent.stat.ino
			)
				throw new NativeExportReadbackError(
					"native-export-directory-redirected",
				);
		}
		return bytes;
	} finally {
		await file.close();
	}
}

/** Stable wire bytes, not a replacement for Rust request/source fingerprinting. */
export function nativeExportManifestBytes(record: unknown): Buffer {
	const stable = (value: any): any =>
		Array.isArray(value)
			? value.map(stable)
			: value && typeof value === "object"
				? Object.fromEntries(
						Object.keys(value)
							.sort()
							.map((key) => [key, stable(value[key])]),
					)
				: value;
	return Buffer.from(JSON.stringify(stable(record)), "utf8");
}
export function nativeExportBytesSha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}
