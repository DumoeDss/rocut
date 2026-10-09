import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Independent oracle: evaluate only hash-checked original declarations, not
 * Rocut's placement plan, Rust timing, delay arithmetic or PCM assembler. */
export async function nativeExportTiming(toolchain: string, engine: string) {
	const bytes = await readFile(join(engine, "dist/services/audioMixer.js"));
	const mixerSha256 = createHash("sha256").update(bytes).digest("hex");
	assert.equal(
		mixerSha256,
		"bbe78eb851b4e5d6d2e94b0f6ec84b5de26b2fe5218cbe348d9e9cd89320ae78",
	);
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	const declarations = [
		["function formatFilterNumber(value)", "/** Build an FFmpeg-compatible"],
		["export function buildFadeFilters(track)", "/** One track:"],
		[
			"export function buildTrackInputFilter(track, index, volumeFilter, totalDuration)",
			"// Absolute paths are omitted",
		],
	]
		.map(([from, until]) => {
			assert.equal(text.split(from).length, 2);
			const start = text.indexOf(from),
				end = text.indexOf(until, start + from.length);
			assert.ok(end > start);
			return text.slice(start, end).replace(/^export /, "");
		})
		.join("\n");
	const fade = await import(
		pathToFileURL(
			join(toolchain, "node_modules/@hyperframes/core/dist/audioFade.js"),
		).href
	);
	const build: (
		track: { start: number; end: number; tailSeconds?: number },
		total: number,
		volume?: string,
	) => string = new Function(
		"clampFadesToDuration",
		`${declarations}\nreturn (track,total,volume='volume=1')=>buildTrackInputFilter(track,0,volume,total);`,
	)(fade.clampFadesToDuration);
	return {
		build,
		mixerSha256,
		declarationsSha256: createHash("sha256").update(declarations).digest("hex"),
	};
}
