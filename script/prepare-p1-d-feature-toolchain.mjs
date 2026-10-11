import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { pinInkHostToolchain } from "./fixtures/ink-object-host-toolchain.mjs";

const hash = (body, kind = "sha256", encoding = "hex") => createHash(kind).update(body).digest(encoding);
const utf8 = (body) => new TextDecoder("utf-8", { fatal: true }).decode(body);
const normalized = (path) => resolve(path).toLowerCase();

// Only regular npm tar entries are accepted. No PAX, links or special files.
export function featureTarEntries(compressed) {
	const tar = gunzipSync(compressed, { maxOutputLength: 256 * 1024 * 1024 });
	const entries = [], names = new Set();
	let cursor = 0, ended = false;
	while (cursor + 512 <= tar.length) {
		const header = tar.subarray(cursor, cursor + 512);
		if (header.every((byte) => byte === 0)) { ended = true; break; }
		const field = (start, length) => utf8(header.subarray(start, start + length)).split("\0")[0];
		const octal = (start, length) => {
			const text = field(start, length).trim();
			assert(/^[0-7]+$/.test(text), "Invalid tar octal field");
			return Number.parseInt(text, 8);
		};
		const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
		assert.equal(checksum, octal(148, 8), "Tar checksum mismatch");
		assert(header[156] === 48 || header[156] === 0, "Tar requires regular files");
		assert.equal(field(345, 155), "", "Tar prefixes are not accepted");
		const name = field(0, 100);
		assert(name.startsWith("package/"), "Tar requires package prefix");
		const path = name.slice(8), parts = path.split("/");
		assert(path && parts.every((part) => part && part !== "." && part !== ".." && !/[\\:\x00-\x1f]/.test(part)), "Unsafe tar path");
		assert(!names.has(path.toLowerCase()), "Duplicate tar path"); names.add(path.toLowerCase());
		const size = octal(124, 12);
		assert(size <= 256 * 1024 * 1024 && entries.length < 10000, "Tar bounds exceeded");
		assert(cursor + 512 + size <= tar.length, "Truncated tar entry");
		entries.push({ path, body: tar.subarray(cursor + 512, cursor + 512 + size) });
		cursor += 512 + Math.ceil(size / 512) * 512;
	}
	assert(ended && tar.subarray(cursor).every((byte) => byte === 0), "Tar must have a zero trailer");
	assert(entries.some((entry) => entry.path === "package.json"));
	return entries;
}

async function identity(path) {
	const stat = await lstat(path);
	assert(stat.isDirectory() && !stat.isSymbolicLink(), "Directory redirection refused");
	const physical = await realpath(path);
	assert.equal(normalized(physical), normalized(path), "Physical parent redirection refused");
	return { path: resolve(path), physical, dev: stat.dev, ino: stat.ino };
}
async function captureParents(path) {
	const result = [];
	for (let current = resolve(path); ; current = dirname(current)) {
		result.push(await identity(current));
		if (dirname(current) === current) return result;
	}
}
async function validateParents(parents) {
	for (const captured of parents) assert.deepEqual(await identity(captured.path), captured, "Parent identity changed");
}

export async function prepareFeatureToolchain(ordinary, archive, ownedBase) {
	assert([ordinary, archive, ownedBase].every(isAbsolute));
	const ordinaryParents = await captureParents(ordinary), archiveParents = await captureParents(dirname(archive));
	const archiveStat = await lstat(archive);
	assert(archiveStat.isFile() && !archiveStat.isSymbolicLink());
	const before = await pinInkHostToolchain(ordinary), compressed = await readFile(archive);
	const entries = featureTarEntries(compressed);
	const manifest = JSON.parse(utf8(entries.find((entry) => entry.path === "package.json").body));
	assert.equal(manifest.name, "@elftia/three-assets"); assert.equal(manifest.version, "0.1.1");
	assert.equal(manifest.elftiaAssetFeatures, "svg-animation-v1");
	assert.equal(manifest.elftiaAssetCodecs, "offline-codecs-v1");
	const baseParent = await captureParents(dirname(ownedBase));
	await validateParents(baseParent); await mkdir(ownedBase, { recursive: true });
	const baseParents = await captureParents(ownedBase);
	await validateParents(baseParents); const root = await mkdtemp(join(ownedBase, "run-"));
	const parents = await captureParents(root);
	const receipt = { version: 1, ok: false, root, ordinary, archive, offline: true, installExecuted: false,
		cleanup: "No deletes or swaps; incomplete run is retained on failure", before,
		tar: { sha256: hash(compressed), integrity: `sha512-${hash(compressed, "sha512", "base64")}`, files: entries.length } };
	const expectedFiles = new Map();
	const write = async (path, body) => {
		assert(relative(root, path) && !relative(root, path).startsWith("..") && !isAbsolute(relative(root, path)));
		await validateParents(parents); await mkdir(dirname(path), { recursive: true });
		const destinationParents = await captureParents(dirname(path));
		await validateParents(parents); await validateParents(destinationParents);
		await writeFile(path, body, { flag: "wx" });
		await validateParents(parents); await validateParents(destinationParents);
		assert.deepEqual(await readFile(path), Buffer.from(body));
		expectedFiles.set(relative(root, path).replaceAll("\\", "/"), { bytes: Buffer.byteLength(body), sha256: hash(body) });
	};
	try {
		const excluded = (path) => path === "package.json" || path === "package-lock.json" || path === "node_modules/.package-lock.json" || path.startsWith("node_modules/@elftia/three-assets/");
		let copied = 0;
		for (const file of before.files) {
			const path = relative(ordinary, file.path).replaceAll("\\", "/");
			if (excluded(path)) continue;
			await validateParents(ordinaryParents);
			const sourceParents = await captureParents(dirname(file.path));
			const stat = await lstat(file.path); assert(stat.isFile() && !stat.isSymbolicLink());
			const body = await readFile(file.path); assert.equal(hash(body), file.sha256);
			await validateParents(sourceParents);
			await write(join(root, path), body); copied++;
		}
		for (const entry of entries) await write(join(root, "node_modules/@elftia/three-assets", entry.path), entry.body);
		await write(join(root, "elftia-three-assets-0.1.1.tgz"), compressed);
		const source = "file:./elftia-three-assets-0.1.1.tgz";
		const packageJson = JSON.parse(utf8(await readFile(join(ordinary, "package.json"))));
		packageJson.name = "rocut-p1d-feature-toolchain-fixture"; packageJson.dependencies[manifest.name] = source;
		const lock = JSON.parse(utf8(await readFile(join(ordinary, "package-lock.json"))));
		lock.name = packageJson.name; lock.packages[""].name = packageJson.name; lock.packages[""].dependencies[manifest.name] = source;
		lock.packages["node_modules/@elftia/three-assets"] = { version: manifest.version, resolved: source,
			integrity: receipt.tar.integrity, license: manifest.license, peerDependencies: manifest.peerDependencies };
		await write(join(root, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
		await write(join(root, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
		const hiddenLockFile = before.files.find((file) => relative(ordinary, file.path).replaceAll("\\", "/") === "node_modules/.package-lock.json");
		if (hiddenLockFile) {
			const hidden = JSON.parse(utf8(await readFile(hiddenLockFile.path)));
			hidden.name = packageJson.name; hidden.packages["node_modules/@elftia/three-assets"] = lock.packages["node_modules/@elftia/three-assets"];
			await write(join(root, "node_modules/.package-lock.json"), JSON.stringify(hidden, null, 2) + "\n");
		}
		await validateParents(ordinaryParents); await validateParents(archiveParents);
		receipt.after = await pinInkHostToolchain(ordinary); assert.deepEqual(receipt.after, before);
		assert.deepEqual(await readFile(archive), compressed);
		receipt.installed = await pinInkHostToolchain(root);
		assert.equal(receipt.installed.files.length, expectedFiles.size);
		for (const file of receipt.installed.files) assert.deepEqual({ bytes: file.bytes, sha256: file.sha256 }, expectedFiles.get(relative(root, file.path).replaceAll("\\", "/")), "Installed closure differs from expected bytes");
		receipt.sourcePin = { archive, sha256: hash(compressed), installedPackageExactlyMatchesTar: true,
			dependencyCopies: copied, dependencyBytesExactlyMatchOrdinary: true, rootManifestAndLockSource: source };
		for (const name of ["three", "@noble/hashes", "esbuild"]) {
			const actual = JSON.parse(utf8(await readFile(join(root, "node_modules", name, "package.json"))));
			assert.equal(actual.version, packageJson.dependencies[name]);
		}
		receipt.ok = true;
	} catch (error) { receipt.error = String(error.stack ?? error); throw error; }
	finally { await write(join(root, "p1d-feature-toolchain-evidence.json"), JSON.stringify(receipt, null, 2) + "\n"); }
	return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [ordinary, archive] = process.argv.slice(2);
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const receipt = await prepareFeatureToolchain(resolve(ordinary), resolve(archive), join(root, ".artifacts/p1d-feature-toolchain"));
	console.log(JSON.stringify({ root: receipt.root, ok: receipt.ok, tar: receipt.tar, copied: receipt.sourcePin.dependencyCopies }));
}
