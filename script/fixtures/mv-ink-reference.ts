import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { INK_REFERENCE_FILES, type InkReference } from "./mv-ink-contract.ts";

export async function loadInkReference({
	root,
}: {
	root: string;
}): Promise<InkReference> {
	assert.ok(isAbsolute(root), "Ink reference root must be absolute");
	const scripts = await Promise.all(
		INK_REFERENCE_FILES.map(async (id) => {
			const path = join(root, "skills/vocaloid-style-mv/template/engine", id);
			const info = await lstat(path);
			assert.ok(
				info.isFile() && info.size > 0 && info.size <= 1_000_000,
				`Invalid original ${id}`,
			);
			const bytes = await readFile(path);
			assert.ok(
				!(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191),
				"Unexpected original BOM",
			);
			return {
				id,
				code: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
				sha256: createHash("sha256").update(bytes).digest("hex"),
			};
		}),
	);
	const dark = scripts.find((script) => script.id === "scenes/dark.js");
	for (const name of ["thread", "fall", "flame", "ink"])
		assert.ok(
			dark?.code.includes(`Z.scene('${name}',`),
			`Incomplete dark.js: ${name}`,
		);
	return { version: 1, scripts };
}
