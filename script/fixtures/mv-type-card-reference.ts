import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
	TYPE_CARD_REFERENCE_FILES,
	type TypeCardReference,
} from "./mv-type-card-reference-contract.ts";

/** Complete original scripts; no source extraction, production math, or artwork IO. */
export async function loadTypeCardReference(
	referenceRoot: string,
): Promise<TypeCardReference> {
	assert.ok(
		isAbsolute(referenceRoot),
		"Use an absolute typeCard reference checkout",
	);
	const engine = join(
		referenceRoot,
		"skills/vocaloid-style-mv/template/engine",
	);
	const scripts = await Promise.all(
		TYPE_CARD_REFERENCE_FILES.map(async (id) => {
			const path = join(engine, id),
				info = await lstat(path);
			assert.ok(
				info.isFile() && info.size > 0 && info.size <= 1_000_000,
				`Invalid original script: ${id}`,
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
	assert.ok(
		scripts[3]!.code.includes("Z.scene('typeCard',"),
		"Original typeCard registration changed; inspect the new source",
	);
	return { version: 1, scripts };
}
