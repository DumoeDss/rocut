import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { digest, variableRateIo } from "./hyperframes-variable-rate-io";
import { nativePreparationSource } from "./hyperframes-variable-rate-source";

export interface RateLane {
	target: "rate";
	points: {
		t: number;
		v: number;
		curve?: number;
		viaX?: number;
		viaY?: number;
	}[];
}
export type RateSpec = number | RateLane;
interface NativePreparation {
	extractAudioFromVideo(
		source: string,
		output: string,
		options: { startTime: number; duration: number; playbackRate: RateSpec },
		signal: AbortSignal,
		config: { ffmpegProcessTimeout: number },
	): Promise<{ success: boolean; error?: string }>;
	prepareAudioTrack(
		source: string,
		output: string,
		mediaStart: number,
		duration: number,
		rate: RateSpec,
		signal: AbortSignal,
		config: { ffmpegProcessTimeout: number },
	): Promise<{ success: boolean; error?: string }>;
	buildRampFilterComplex(
		rate: RateLane,
		duration: number,
		tail: string | null,
	): string;
}
interface NativeSpeed {
	sourceTimeAt(rate: RateSpec, seconds: number): number;
	shiftRateLane(rate: RateSpec, seconds: number): RateSpec;
}
interface NativeAutomation {
	normalizeAutomation(input: { version: 1; lanes: RateLane[] }): {
		lanes: RateLane[];
	};
}

export async function loadVariableRateNative({
	toolchain,
	archive,
	ffmpeg,
	ffprobe,
}: {
	toolchain: string;
	archive: string;
	ffmpeg: string;
	ffprobe: string;
}) {
	const source = await nativePreparationSource(toolchain, archive);
	const coreRoot = join(toolchain, "node_modules/@hyperframes/core");
	const core = JSON.parse(
		await readFile(join(coreRoot, "package.json"), "utf8"),
	);
	assert.equal(core.version, "0.8.139");
	const speed: NativeSpeed = await import(
		pathToFileURL(join(coreRoot, "dist/speedRamp.js")).href
	);
	const playback = await import(
		pathToFileURL(join(coreRoot, "dist/runtime/playbackRate.js")).href
	);
	const automation: NativeAutomation = await import(
		pathToFileURL(join(coreRoot, "dist/audioAutomation.js")).href
	);
	const io = variableRateIo(ffmpeg, ffprobe);
	const dependencies = {
		existsSync,
		mkdirSync,
		dirname,
		normalizePlaybackRate: playback.normalizePlaybackRate,
		normalizeRateSpec: playback.normalizeRateSpec,
		sourceTimeAt: speed.sourceTimeAt,
		getFfmpegBinary: () => ffmpeg,
		runFfmpeg: io.runFfmpeg,
		extractAudioMetadata: io.extractAudioMetadata,
	};
	// Only pinned upstream source is evaluated; fixture data is never code.
	const native: NativePreparation = new Function(
		...Object.keys(dependencies),
		source.code,
	)(...Object.values(dependencies));
	const coreFiles = [
		"dist/speedRamp.js",
		"dist/audioAutomation.js",
		"dist/runtime/playbackRate.js",
		"dist/runtime/audioAutomationVolume.js",
		"dist/playbackRateBounds.js",
	];
	const coreHashes = Object.fromEntries(
		await Promise.all(
			coreFiles.map(async (path) => [
				path,
				digest(await readFile(join(coreRoot, path))),
			]),
		),
	);
	return {
		io,
		native,
		speed,
		automation,
		provenance: {
			...source.provenance,
			coreVersion: core.version,
			coreHashes,
			ioBoundary:
				"Only FFmpeg/FFprobe process selection and transport are adapted; every native rate/filter/rounding/stereo/PCM-format decision is unchanged.",
			uncovered: [
				"Full public processCompositionAudio dependency closure (notably Puppeteer) is not loaded by this stage oracle.",
				"No MediaElement continuous-preview PCM equivalence; no production Rocut support is established by this oracle.",
			],
		},
	};
}
