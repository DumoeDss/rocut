import { programmaticAudioPolicyJson } from "opencut-wasm";
import type { SceneTracks } from "../timeline/types";
import type { CollectedAudioElement, AudioClipSource } from "./audio";
import type { ProgrammaticAudioRuntime } from "./programmatic-audio-runtime";
import { TICKS_PER_SECOND } from "../wasm";

/** Browser audio materialization only; source admission/timing is Rust-owned.
 * Graphics have no timeline retime yet. Visual hidden is not an audio mute.
 */
export async function collectProgrammaticAudio({
	tracks,
	runtime,
	audioContext,
	sampleRate = audioContext.sampleRate,
	signal,
}: {
	tracks: SceneTracks;
	runtime?: ProgrammaticAudioRuntime;
	audioContext: AudioContext;
	sampleRate?: number;
	signal: AbortSignal;
}): Promise<CollectedAudioElement[]> {
	const results: CollectedAudioElement[] = [];
	for (const track of [tracks.main, ...tracks.overlay])
		for (const element of track.elements) {
			if (
				element.type !== "graphic" ||
				element.definitionId !== "programmatic" ||
				element.programmatic?.audio === undefined
			)
				continue;
			if (!runtime) throw Error("Programmatic audio provider is unavailable");
			const policy: { sampleRates: number[] } = JSON.parse(
				programmaticAudioPolicyJson(),
			);
			const loaded = await runtime.load({
				source: element.programmatic,
				// Unsupported device/output rates retain native-default PCM for resampling.
				sampleRate: policy.sampleRates.includes(sampleRate)
					? sampleRate
					: undefined,
				signal,
			});
			if (!loaded) continue;
			signal.throwIfAborted();
			const { data, gain } = loaded;
			const buffer = runtime.toAudioBuffer({ data, context: audioContext });
			results.push({
				timelineElement: element,
				buffer,
				volume: gain,
				muted: false,
				startTime: element.startTime / TICKS_PER_SECOND,
				duration: element.duration / TICKS_PER_SECOND,
				trimStart: element.trimStart / TICKS_PER_SECOND,
				trimEnd: element.trimEnd / TICKS_PER_SECOND,
			});
		}
	return results;
}

export function programmaticAudioClips(
	elements: CollectedAudioElement[],
): AudioClipSource[] {
	return elements.map((element) => ({
		...element,
		id: element.timelineElement.id,
		sourceKey: `programmatic:${element.timelineElement.id}`,
		buffer: element.buffer,
	}));
}
