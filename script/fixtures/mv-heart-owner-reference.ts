import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
export interface HeartOwnerReference {
	readonly scripts: readonly { id: string; code: string; sha256: string }[];
}
export const HEART_OWNER_REFERENCE_FILES = [
	"core/util.js",
	"core/assets.js",
	"core/draw.js",
	"scenes/glass.js",
] as const;
export async function loadHeartOwnerReference(
	root: string,
): Promise<HeartOwnerReference> {
	assert.ok(isAbsolute(root));
	const scripts = [];
	for (const id of HEART_OWNER_REFERENCE_FILES) {
		const path = join(root, "skills/vocaloid-style-mv/template/engine", id),
			stat = await lstat(path);
		assert.ok(
			stat.isFile() &&
				!stat.isSymbolicLink() &&
				stat.size > 0 &&
				stat.size <= 1_000_000,
		);
		const bytes = await readFile(path);
		assert.ok(!(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191));
		scripts.push({
			id,
			code: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
	}
	assert.ok(scripts[3]!.code.includes("function drawBreak(ctx, S, burn)"));
	return { scripts };
}
