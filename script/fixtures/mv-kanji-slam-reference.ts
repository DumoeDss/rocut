import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
	KANJI_SLAM_REFERENCE_FILES,
	type KanjiSlamReference,
} from "./mv-kanji-slam-reference-contract.ts";

/** All of typo.js, including sibling registrations, preload and private caches. */
export async function loadKanjiSlamReference(
	referenceRoot: string,
): Promise<KanjiSlamReference> {
	assert.ok(
		isAbsolute(referenceRoot),
		"Use an absolute kanjiSlam reference checkout",
	);
	const engine = join(
		referenceRoot,
		"skills/vocaloid-style-mv/template/engine",
	);
	const scripts = await Promise.all(
		KANJI_SLAM_REFERENCE_FILES.map(async (id) => {
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
	for (const scene of ["kanjiSlam", "typeCard", "tunnel"])
		assert.ok(
			scripts[3]!.code.includes(`Z.scene('${scene}',`),
			`Complete original typo registration changed: ${scene}`,
		);
	return { version: 1, scripts };
}
