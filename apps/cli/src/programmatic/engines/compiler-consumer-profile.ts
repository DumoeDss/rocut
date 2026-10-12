import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resourceDigest } from "../resources";

interface PackagePin {
	path: string;
	version: string;
	integrity: string;
}
const ID = "rocut-three-engine-compiler-v1";
const OMITTED: Readonly<Record<string, string>> = {
	"node_modules/@chenglou/pretext": "0.0.5",
	"node_modules/@hyperframes/studio-server": "0.8.139",
	"node_modules/@img/colour": "1.1.0",
	"node_modules/@img/sharp-win32-x64": "0.35.5",
	"node_modules/argparse": "2.0.1",
	"node_modules/bpm-detective": "2.0.5",
	"node_modules/detect-libc": "2.1.2",
	"node_modules/hono": "4.13.13",
	"node_modules/semver": "7.8.5",
	"node_modules/sharp": "0.35.5",
	"node_modules/wawoff2": "2.0.1",
};
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const fail = (): never => {
	throw Error("Invalid rocut-three-engine-compiler-v1 consumer profile");
};
const digest = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
async function jsonFile(file: string, signal: AbortSignal) {
	signal.throwIfAborted();
	const state = await lstat(file);
	if (!state.isFile() || state.isSymbolicLink() || state.size > 8_000_000)
		return fail();
	if ((await realpath(file)).toLowerCase() !== resolve(file).toLowerCase())
		return fail();
	const handle = await open(file, "r");
	let bytes: Buffer;
	try {
		const before = await handle.stat();
		if (
			!before.isFile() ||
			before.size > 8_000_000 ||
			before.dev !== state.dev ||
			before.ino !== state.ino
		)
			return fail();
		bytes = Buffer.alloc(before.size);
		let offset = 0;
		while (offset < bytes.length) {
			signal.throwIfAborted();
			const { bytesRead } = await handle.read(
				bytes,
				offset,
				bytes.length - offset,
				offset,
			);
			if (!bytesRead) return fail();
			offset += bytesRead;
		}
		const after = await handle.stat();
		if (
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			before.ctimeMs !== after.ctimeMs
		)
			return fail();
	} finally {
		await handle.close();
	}
	signal.throwIfAborted();
	const value: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(bytes),
	);
	if (!record(value)) return fail();
	return { value, bytes };
}
function pinList(value: unknown): PackagePin[] {
	if (!Array.isArray(value)) return fail();
	return value.map((p: unknown) => {
		if (
			!record(p) ||
			typeof p.path !== "string" ||
			typeof p.version !== "string" ||
			typeof p.integrity !== "string"
		)
			return fail();
		return { path: p.path, version: p.version, integrity: p.integrity };
	});
}
const equalPins = (a: PackagePin[], b: PackagePin[]) =>
	JSON.stringify(a) === JSON.stringify(b);

/** A source lock is ancestry, not a claim that its omitted CLI services ship. */
export async function readCompilerConsumerProfile({
	root,
	lockBytes,
	packages,
	signal,
}: {
	root: string;
	lockBytes: ArrayBuffer;
	packages: PackagePin[];
	signal: AbortSignal;
}) {
	let closure: Awaited<ReturnType<typeof jsonFile>>;
	try {
		closure = await jsonFile(join(root, "closure-manifest.json"), signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	const profile = closure.value.consumerProfile;
	if (profile === undefined) return undefined; // Existing full explicit directories.
	if (
		!record(profile) ||
		profile.id !== ID ||
		profile.packageClosureComplete !== false
	)
		return fail();
	const projection = closure.value.projection;
	if (
		!record(projection) ||
		projection.platformTarget !== "win32-x64" ||
		projection.sourceClosurePath !== "source-closure-manifest.json" ||
		closure.value.packageLockSha256 !== resourceDigest(lockBytes)
	)
		return fail();
	const original = await jsonFile(
		join(root, "source-closure-manifest.json"),
		signal,
	);
	if (
		digest(original.bytes) !== projection.sourceClosureSha256 ||
		original.value.packageLockSha256 !== closure.value.packageLockSha256 ||
		!equalPins(pinList(original.value.packages), packages)
	)
		return fail();
	const omittedPackages = packages.filter((p) => OMITTED[p.path] === p.version);
	if (omittedPackages.length !== 11) return fail();
	const retainedPackages = packages.filter(
		(p) => !Object.hasOwn(OMITTED, p.path),
	);
	if (
		!equalPins(pinList(profile.omittedPackages), omittedPackages) ||
		!equalPins(pinList(closure.value.packages), retainedPackages)
	)
		return fail();
	for (const pin of omittedPackages) {
		try {
			await lstat(join(root, ...pin.path.split("/")));
			return fail();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	for (const pin of retainedPackages) {
		const directory = join(root, ...pin.path.split("/"));
		const state = await lstat(directory);
		if (!state.isDirectory() || state.isSymbolicLink()) return fail();
		const { value } = await jsonFile(join(directory, "package.json"), signal);
		if (
			value.name !== pin.path.split("node_modules/").at(-1) ||
			value.version !== pin.version
		)
			return fail();
	}
	return {
		id: ID,
		packageClosureComplete: false,
		sourceLockSha256: resourceDigest(lockBytes),
		retainedPackages,
		omittedPackages: omittedPackages.map((p) => ({
			...p,
			reason: "not-reachable-from-reviewed-rocut-compiler-entrypoints",
		})),
	};
}
