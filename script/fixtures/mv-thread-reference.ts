import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
	THREAD_REFERENCE_FILES,
	type ThreadReference,
} from "./mv-thread-contract.ts";

/** Load all four original files; never extract or replace scene helper bodies. */
export async function loadThreadReference(
	root: string,
): Promise<ThreadReference> {
	assert.ok(
		isAbsolute(root),
		"Thread oracle requires an absolute reference root",
	);
	const scripts = await Promise.all(
		THREAD_REFERENCE_FILES.map(async (id) => {
			const path = join(root, "skills/vocaloid-style-mv/template/engine", id);
			const info = await lstat(path);
			assert.ok(
				info.isFile() && info.size > 0 && info.size <= 1_000_000,
				`Invalid complete reference ${id}`,
			);
			const bytes = await readFile(path);
			return {
				id,
				code: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
					bytes,
				),
				sha256: createHash("sha256").update(bytes).digest("hex"),
			};
		}),
	);
	for (const name of ["thread", "fall", "flame", "ink"])
		assert.ok(
			scripts[3]!.code.includes(`Z.scene('${name}',`),
			`Incomplete dark.js: ${name}`,
		);
	return { version: 1, scripts };
}
