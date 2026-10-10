import type { HyperframesRatePreparation } from "./hyperframes-rate-prepare";

/** Pinned preparedAudioOutputArgs ordering. Scalar mono pan precedes tempo;
 * scalar rate 1 omits the output -t, while every ramp includes it. */
export function hyperframesNativePreparationOutputArgs(
	recipe: HyperframesRatePreparation,
	channels: number,
	graphPath: string,
): string[] {
	if (recipe.preparationKind !== undefined &&
		recipe.preparationKind !== "scalar" && recipe.preparationKind !== "ramp")
		throw Error("Unsupported HyperFrames native preparation kind");
	const filter = channels === 1 ? recipe.monoFilter : recipe.stereoFilter;
	if (recipe.preparationKind === "scalar") {
		if (!recipe.observedPcm || typeof recipe.outputDurationRequired !== "boolean")
			throw Error("Invalid HyperFrames scalar preparation receipt");
		return [
			...(channels === 1 ? [] : ["-ac", "2"]),
			...(filter ? ["-af", filter] : []),
			...(recipe.outputDurationRequired ? ["-t", recipe.durationSeconds] : []),
		];
	}
	if (recipe.outputDurationRequired === false)
		throw Error("HyperFrames ramp requires its original output duration");
	return ["-filter_complex_script", graphPath, "-map", "[out]",
		...(channels === 1 ? [] : ["-ac", "2"]), "-t", recipe.durationSeconds];
}
