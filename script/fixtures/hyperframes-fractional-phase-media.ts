import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	digest,
	pcmDifference,
	readNativePreparedWav,
} from "./hyperframes-variable-rate-io";
import { loopFfmpeg } from "./hyperframes-variable-rate-loop-media";
import type {
	loadVariableRateNative,
	RateSpec,
} from "./hyperframes-variable-rate-native";

export type FractionalNative = Awaited<
	ReturnType<typeof loadVariableRateNative>
>;

/** Keep the original WAV's actual length; padding it here would hide the
 * native decoder's fractional duration decision from the oracle. */
export async function prepareFractionalNative(
	oracle: FractionalNative,
	directory: string,
	id: string,
	source: string,
	trim: number,
	duration: number,
	rate: RateSpec,
) {
	const path = join(directory, `${id}.wav`);
	const prepared = await oracle.native.prepareAudioTrack(
		source,
		path,
		trim,
		duration,
		rate,
		new AbortController().signal,
		{ ffmpegProcessTimeout: 30000 },
	);
	assert.ok(prepared.success, prepared.error);
	const result = await readNativePreparedWav(path);
	assert.ok(result.frames <= Math.ceil(duration * 48000) + 1);
	return { ...result, path };
}

/** Compare PCM including support/length, not just the shared prefix. */
export function fractionalDifference(a: Buffer, b: Buffer) {
	const bytes = Math.max(a.length, b.length);
	assert.ok(bytes > 0 && bytes % 8 === 0);
	const left = Buffer.alloc(bytes),
		right = Buffer.alloc(bytes);
	a.copy(left);
	b.copy(right);
	return {
		...pcmDifference(left, right),
		leftFrames: a.length / 8,
		rightFrames: b.length / 8,
	};
}

export async function graphRatePcm(
	ffmpeg: string,
	source: string,
	rate: number,
) {
	const { stdout } = await loopFfmpeg(ffmpeg, [
		"-i",
		source,
		"-map",
		"0:a:0",
		"-af",
		`aresample=${rate}`,
		"-ar",
		String(rate),
		"-ac",
		"2",
		"-c:a",
		"pcm_f32le",
		"-f",
		"f32le",
		"pipe:1",
	]);
	assert.equal(stdout.length % 8, 0);
	return stdout;
}

function declaration(source: string, from: string, until: string) {
	assert.equal(source.split(from).length, 2);
	const start = source.indexOf(from),
		end = source.indexOf(until, start + from.length);
	assert.ok(end > start);
	return source.slice(start, end).replace(/^export /, "");
}

/** Native exporter placement is intentionally NOT reused as the graph's
 * placement policy: the exporter quantizes start to integer milliseconds. */
export async function nativeFractionalPlacement(
	toolchain: string,
	engine: string,
) {
	const mixer = await readFile(
		join(engine, "dist/services/audioMixer.js"),
		"utf8",
	);
	assert.equal(
		digest(mixer),
		"bbe78eb851b4e5d6d2e94b0f6ec84b5de26b2fe5218cbe348d9e9cd89320ae78",
	);
	const core = join(toolchain, "node_modules/@hyperframes/core");
	const fade = await import(
		pathToFileURL(join(core, "dist/audioFade.js")).href
	);
	const source = [
		declaration(
			mixer,
			"function formatFilterNumber(value)",
			"/** Build an FFmpeg-compatible",
		),
		declaration(
			mixer,
			"export function buildFadeFilters(track)",
			"/** One track:",
		),
		declaration(
			mixer,
			"export function buildTrackInputFilter(track, index, volumeFilter, totalDuration)",
			"// Absolute paths are omitted",
		),
	].join("\n");
	const build: (start: number, duration: number, total: number) => string =
		new Function(
			"clampFadesToDuration",
			`${source}\nreturn (start,duration,total)=>buildTrackInputFilter({start,end:start+duration},0,'volume=1',total);`,
		)(fade.clampFadesToDuration);
	return { build, sourceSha256: digest(source), mixerSha256: digest(mixer) };
}
