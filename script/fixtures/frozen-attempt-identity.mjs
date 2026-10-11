import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const sha256 = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export const parseUtf8Json = (bytes) =>
	JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const samePath = (a, b) =>
	process.platform === "win32"
		? resolve(a).toLowerCase() === resolve(b).toLowerCase()
		: resolve(a) === resolve(b);

export function resolveFrozenPath(root, path) {
	assert(typeof path === "string" && path.length > 0 && !isAbsolute(path));
	const target = resolve(root, path);
	const delta = relative(root, target);
	assert(
		delta !== ".." && !delta.startsWith(`..${sep}`) && !isAbsolute(delta),
		"Frozen source path escaped workspace",
	);
	return target;
}

export async function pinFile(path, name = path) {
	const info = await lstat(path);
	assert(
		info.isFile() && !info.isSymbolicLink(),
		`Not an ordinary file: ${path}`,
	);
	const bytes = await readFile(path);
	return {
		path: name.replaceAll("\\", "/"),
		bytes: bytes.length,
		sha256: sha256(bytes),
	};
}

export async function pinFiles(paths, root) {
	const files = [];
	for (let offset = 0; offset < paths.length; offset += 16) {
		files.push(
			...(await Promise.all(
				paths
					.slice(offset, offset + 16)
					.map((path) =>
						pinFile(root ? resolveFrozenPath(root, path) : path, path),
					),
			)),
		);
	}
	return {
		fileCount: files.length,
		manifestSha256: sha256(JSON.stringify(files)),
		files,
	};
}

/** Read only; no index rebuild, source normalization or package replacement. */
export async function pinClosure(directory) {
	assert(
		samePath(await realpath(directory), directory),
		"Closure parent redirected",
	);
	const paths = [];
	async function walk(current) {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			assert(
				!entry.isSymbolicLink(),
				`Closure link not admitted: ${entry.name}`,
			);
			const path = join(current, entry.name);
			if (entry.isDirectory()) await walk(path);
			else {
				assert(entry.isFile(), "Nonordinary closure entry");
				paths.push(relative(directory, path).replaceAll("\\", "/"));
			}
		}
	}
	await walk(directory);
	assert(paths.length > 0, "Empty closure cannot establish identity");
	return { directory, ...(await pinFiles(paths.sort(), directory)) };
}

export async function pinFrozenManifest({ root, manifestPath, head }) {
	const manifestPin = await pinFile(manifestPath);
	const manifest = parseUtf8Json(await readFile(manifestPath));
	assert.equal(manifest.schema, "fixture-source/v2");
	assert(Array.isArray(manifest.files) && manifest.files.length > 0);
	const paths = manifest.files.map(({ path }) => path);
	assert.equal(
		new Set(paths).size,
		paths.length,
		"Duplicate frozen source path",
	);
	const actual = await pinFiles(paths, root);
	const drift = manifest.files
		.filter((file, index) => file.sha256 !== actual.files[index].sha256)
		.map(({ path }) => path);
	return {
		...manifestPin,
		sourceCommit: manifest.sourceCommit,
		fileCount: paths.length,
		actualFilesManifestSha256: actual.manifestSha256,
		drift,
		valid: manifest.sourceCommit === head && drift.length === 0,
	};
}

export async function snapshotFrozenAttempt({
	root,
	manifestPath,
	extraSources,
	closures,
	executables,
}) {
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		windowsHide: true,
		encoding: "utf8",
	}).trim();
	const closurePins = {};
	for (const [name, directory] of Object.entries(closures))
		closurePins[name] = await pinClosure(directory);
	return {
		capturedAt: new Date().toISOString(),
		head,
		fixture: await pinFrozenManifest({ root, manifestPath, head }),
		extraSources: await pinFiles(extraSources, root),
		closures: closurePins,
		executables: await pinFiles(executables),
	};
}

export function frozenAttemptDigest(snapshot) {
	return {
		head: snapshot.head,
		manifestSha256: snapshot.fixture.sha256,
		actualFilesManifestSha256: snapshot.fixture.actualFilesManifestSha256,
		extraSourcesSha256: snapshot.extraSources.manifestSha256,
		executablesSha256: snapshot.executables.manifestSha256,
		toolchainSha256: snapshot.toolchain?.manifestSha256 ?? null,
		closures: Object.fromEntries(
			Object.entries(snapshot.closures).map(([name, value]) => [
				name,
				value.manifestSha256,
			]),
		),
	};
}

export function assertFrozenAttemptUnchanged(before, after) {
	assert.equal(before.fixture.valid, true, "Initial source manifest invalid");
	assert.equal(after.fixture.valid, true, "Final source manifest invalid");
	assert.deepEqual(
		frozenAttemptDigest(after),
		frozenAttemptDigest(before),
		"Frozen source, browser, package or executable changed",
	);
}
