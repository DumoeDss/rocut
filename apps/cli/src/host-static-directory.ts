import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { fileURLToPath } from "node:url";

async function unredirected(path: string) {
	const info = await lstat(path);
	if (info.isSymbolicLink() || relative(path, await realpath(path)) !== "")
		throw Error("Embedded Surface path is redirected");
	return info;
}

async function regularFile(path: string) {
	if (!(await unredirected(path)).isFile())
		throw Error("Embedded Surface requires regular files");
	return readFile(path);
}

async function inspectTree(directory: string) {
	if (!(await unredirected(directory)).isDirectory())
		throw Error("Embedded Surface must be a directory");
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		const info = await unredirected(path);
		if (info.isDirectory()) await inspectTree(path);
		else if (!info.isFile())
			throw Error("Embedded Surface contains a non-regular file");
	}
}

/** Only the packed entry's own controlled Surface is implicit; source/API hosts stay unchanged. */
export async function resolveHostStaticDirectory({
	explicit,
	entryUrl,
}: {
	explicit?: string;
	entryUrl: string;
}): Promise<string | undefined> {
	if (explicit !== undefined) return explicit;
	const entry = fileURLToPath(entryUrl);
	if (basename(entry) !== "rocut.mjs") return undefined;
	const runtime = dirname(entry),
		surface = join(runtime, "surface");
	try {
		await lstat(surface);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	try {
		await unredirected(entry);
		await inspectTree(surface);
		await regularFile(join(surface, "index.html"));
		const receipt = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				await regularFile(join(surface, "surface-wasm-package.json")),
			),
		);
		const core = receipt?.coreWasm;
		if (
			!core ||
			typeof core.path !== "string" ||
			typeof core.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(core.sha256) ||
			/[\\:\u0000-\u001f]/.test(core.path) ||
			core.path
				.split("/")
				.some((part: string) => !part || part === "." || part === "..")
		)
			throw Error("Invalid embedded Surface WASM receipt");
		const corePath = resolve(surface, core.path),
			contained = relative(surface, corePath);
		if (
			!contained ||
			isAbsolute(contained) ||
			contained === ".." ||
			contained.startsWith(`..${sep}`)
		)
			throw Error("Embedded Surface WASM escapes its directory");
		const hash = (bytes: Uint8Array) =>
			createHash("sha256").update(bytes).digest("hex");
		if (
			hash(await regularFile(corePath)) !== core.sha256 ||
			hash(await regularFile(join(runtime, "opencut_wasm_bg.wasm"))) !==
				core.sha256
		)
			throw Error("Embedded Surface does not match its runtime WASM");
		return surface;
	} catch (cause) {
		throw new Error(
			"Invalid embedded Surface; rebuild the runtime or pass an explicit --static directory",
			{ cause },
		);
	}
}
