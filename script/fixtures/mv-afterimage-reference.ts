import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
	AFTERIMAGE_REFERENCE_FILES,
	type AfterimageReference,
} from "./mv-afterimage-reference-contract.ts";

/**
 * Read complete, trusted upstream scripts into a test-only serializable payload.
 * The browser never receives the reference checkout path or reads original media.
 * No extraction, rewritten formulas, dependency installation or browser launch.
 */
export async function loadAfterimageReference(
	referenceRoot: string,
): Promise<AfterimageReference> {
	assert.ok(
		isAbsolute(referenceRoot),
		"Use an absolute reference checkout path",
	);
	const engine = join(
		referenceRoot,
		"skills/vocaloid-style-mv/template/engine",
	);
	const scripts = await Promise.all(
		AFTERIMAGE_REFERENCE_FILES.map(async (id) => {
			const path = join(engine, id);
			const info = await lstat(path);
			assert.ok(
				info.isFile(),
				`Reference script must be a regular file: ${id}`,
			);
			assert.ok(info.size > 0 && info.size <= 1_000_000);
			const bytes = await readFile(path);
			const code = new TextDecoder("utf-8", {
				fatal: true,
				ignoreBOM: true,
			}).decode(bytes);
			return {
				id,
				code,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			};
		}),
	);
	assert.ok(
		scripts[3]!.code.includes("Z.scene('afterimage',"),
		"Upstream afterimage registration changed; inspect before using the oracle",
	);
	return { version: 1, scripts };
}
