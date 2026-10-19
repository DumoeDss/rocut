import {
	audioClipSampleTimes,
	planAudioMixWindow,
	planAudioSampleWindow,
} from "opencut-wasm";
import { mediaTimeFromSeconds } from "../wasm";
import { getSourceTimeAtClipTime } from "../retime";
import {
	hasAnimatedVolume,
	resolveEffectiveAudioGain,
} from "../timeline/audio-state";
import type { RetimeConfig } from "../timeline";
import type { CollectedAudioElement } from "./audio";

export function mixAudioChannels({
	element,
	buffer,
	trimStart,
	retime,
	outputBuffer,
	outputLength,
	sampleRate,
	outputStartTime,
}: {
	element: CollectedAudioElement;
	buffer: AudioBuffer;
	trimStart: number;
	retime?: RetimeConfig;
	outputBuffer: AudioBuffer;
	outputLength: number;
	sampleRate: number;
	/** Requested absolute timeline start, snapped to the global PCM floor grid. */
	outputStartTime: number;
}): void {
	const output = planAudioSampleWindow({
		startTime: mediaTimeFromSeconds({ seconds: outputStartTime }),
		duration: 0,
		sampleRate,
	});
	if (!output) throw new Error("Invalid timeline audio sample origin");
	const clipStart = mediaTimeFromSeconds({ seconds: element.startTime });
	const window = planAudioMixWindow({
		clipStart,
		clipDuration: mediaTimeFromSeconds({ seconds: element.duration }),
		sampleOrigin: output.sampleOrigin,
		outputLength,
		sampleRate,
	});
	if (!window) throw new Error("Invalid timeline audio mix window");
	const animated =
		element.timelineElement.type !== "graphic" &&
		hasAnimatedVolume({ element: element.timelineElement });
	const outputs = [
		outputBuffer.getChannelData(0),
		outputBuffer.getChannelData(1),
	];
	const sources = [
		buffer.getChannelData(0),
		buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1)),
	];
	for (let begin = window.start; begin < window.end; begin += 4096) {
		const count = Math.min(4096, window.end - begin);
		const times = audioClipSampleTimes({
			clipStart,
			sampleOrigin: output.sampleOrigin + begin,
			sampleCount: count,
			sampleRate,
		});
		if (times.length !== count)
			throw new Error("Invalid timeline audio sample clock");
		for (let offset = 0; offset < count; offset++) {
			const clipTime = times[offset];
			const sourceTime =
				trimStart +
				getSourceTimeAtClipTime({
					clipTime,
					retime,
					clipDuration: element.duration,
				});
			const sourceIndex = sourceTime * buffer.sampleRate;
			if (sourceIndex < 0) continue;
			if (sourceIndex >= buffer.length) return;
			const lowerIndex = Math.floor(sourceIndex);
			const upperIndex = Math.min(buffer.length - 1, lowerIndex + 1);
			const fraction = sourceIndex - lowerIndex;
			const gain =
				animated && element.timelineElement.type !== "graphic"
					? resolveEffectiveAudioGain({
							element: element.timelineElement,
							localTime: clipTime,
						})
					: element.volume;
			for (let channel = 0; channel < 2; channel++) {
				const source = sources[channel];
				outputs[channel][begin + offset] +=
					(source[lowerIndex] * (1 - fraction) +
						source[upperIndex] * fraction) *
					gain;
			}
		}
	}
}
