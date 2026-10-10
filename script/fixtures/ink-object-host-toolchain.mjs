import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/** Conservative closure: pin every existing toolchain file without copying it.
 * Includes esbuild's native binary and dynamic Three imports, not just manifests.
 */
export async function pinInkHostToolchain(root) {
	assert(isAbsolute(root));
	const files = [];
	let bytes = 0;
	async function walk(directory) {
		for (const name of (await readdir(directory)).sort()) {
			const path = join(directory, name),
				stat = await lstat(path);
			assert(
				!stat.isSymbolicLink(),
				"Toolchain closure rejects redirected inputs",
			);
			if (stat.isDirectory()) await walk(path);
			else {
				assert(stat.isFile());
				assert(files.length < 10000 && bytes + stat.size <= 256 * 1024 * 1024);
				const body = await readFile(path);
				bytes += body.length;
				files.push({
					path,
					bytes: body.length,
					sha256: createHash("sha256").update(body).digest("hex"),
				});
			}
		}
	}
	await walk(root);
	return {
		root,
		bytes,
		files,
		scope:
			"All files in explicitly supplied existing toolchain; read-only full inventory, no dependency install or copy",
	};
}
