import { mediaTimeFromFrame } from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";

export type PresetRangeMode = "smoke" | "full";

export function presetRangeMode(value?: string): PresetRangeMode {
	if (value === undefined || value === "smoke") return "smoke";
	if (value === "full") return "full";
	throw new Error("ROCUT_TEST_PRESET_RANGE must be smoke or full");
}

/** Test geometry delegates frame/tick conversion to the production Rust core. */
export function presetFrameTicks(source: ProgrammaticSource, frame: number) {
	if (!Number.isSafeInteger(frame) || frame < 0)
		throw new Error("Preset frame must be a nonnegative integer");
	const ticks = mediaTimeFromFrame({ frame, rate: source.frameRate });
	if (ticks === undefined) throw new Error("Invalid preset frame rate");
	return ticks;
}

export function presetExportWindow(
	source: ProgrammaticSource,
	mode: PresetRangeMode,
) {
	if (!Number.isSafeInteger(source.durationFrames) || source.durationFrames < 1)
		throw new Error("Preset duration must be a positive integer frame count");
	const frameCount =
		mode === "full"
			? source.durationFrames
			: Math.min(3, source.durationFrames);
	const firstFrame =
		mode === "full"
			? 0
			: Math.min(
					Math.floor(source.durationFrames / 2),
					source.durationFrames - frameCount,
				);
	return {
		firstFrame,
		frameCount,
		trimStart: presetFrameTicks(source, firstFrame),
		trimEnd: presetFrameTicks(
			source,
			source.durationFrames - firstFrame - frameCount,
		),
		duration: presetFrameTicks(source, frameCount),
	};
}
