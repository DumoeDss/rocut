import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
	CONVERGE_REFERENCE_FILES,
	type ConvergeReference,
} from "./mv-converge-reference-contract.ts";

/** Exact original files. No function extraction/replacement or production imports. */
export async function loadConvergeReference(
	root: string,
): Promise<ConvergeReference> {
	assert(isAbsolute(root), "Use an absolute converge reference checkout");
	const scripts = await Promise.all(
		CONVERGE_REFERENCE_FILES.map(async (id) => {
			const path = join(root, "skills/vocaloid-style-mv/template/engine", id),
				stat = await lstat(path);
			assert(
				stat.isFile() && stat.size > 0 && stat.size <= 1_000_000,
				`Invalid original file ${id}`,
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
	assert(
		scripts[0]!.code.includes("Z.makeClock ="),
		"Inspect changed original beat clock",
	);
	assert(
		scripts[3]!.code.includes("Z.scene('converge',"),
		"Inspect changed original converge registration",
	);
	return { version: 1, scripts };
}
