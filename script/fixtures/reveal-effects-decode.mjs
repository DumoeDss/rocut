import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

export function decodeRevealEffects(artifacts, ffmpegDirectory) {
	assert(isAbsolute(artifacts) && isAbsolute(ffmpegDirectory));
	const decoder = join(
		dirname(fileURLToPath(import.meta.url)),
		"decode-spatial.mjs",
	);
	return ["laser", "decrypt-reveal"].map((name) => {
		const directory = join(artifacts, name);
		execFileSync(process.execPath, [decoder, directory, ffmpegDirectory], {
			windowsHide: true,
			timeout: 60000,
			maxBuffer: 4 * 1024 * 1024,
		});
		const evidence = JSON.parse(
			readFileSync(join(directory, "independent-region-decode.json"), "utf8"),
		);
		assert(evidence.ok, `${name} independent decode failed`);
		return { name, ...evidence };
	});
}
