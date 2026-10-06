import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

export const normalizePluginPath = (path) =>
	path.replaceAll("\\", "/").toLowerCase();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// No redirected roots or nested entries: this is also used to verify backups.
export async function inventoryPlugin(root) {
	assert.equal(
		normalizePluginPath(await realpath(root)),
		normalizePluginPath(root),
	);
	const files = [];
	async function visit(path, relative) {
		const stat = await lstat(path);
		assert(!stat.isSymbolicLink(), "No redirected plugin files");
		if (stat.isDirectory()) {
			for (const name of (await readdir(path)).sort())
				await visit(join(path, name), relative ? relative + "/" + name : name);
		} else {
			assert(stat.isFile());
			files.push({
				path: relative,
				bytes: stat.size,
				sha256: hash(await readFile(path)),
			});
		}
	}
	await visit(root, "");
	return { files, sha256: hash(JSON.stringify(files)) };
}
