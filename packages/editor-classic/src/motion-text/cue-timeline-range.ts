import type {
	MotionTextCue,
	MotionTextSequence,
} from "@opencut/editor-contracts";
import type { MotionTextElement } from "../timeline";
import {
	mapMotionTextSequenceTimeToTimelineValue,
	mediaTime,
	type MediaTimeRange,
} from "../wasm";

/** Resolve the visible intersection of one cue and one clip to timeline time. */
export function resolveMotionTextCueTimelineRange({
	element,
	sequence,
	cue,
}: {
	readonly element: MotionTextElement;
	readonly sequence: MotionTextSequence;
	readonly cue: MotionTextCue;
}): MediaTimeRange | null {
	const visibleSequenceEnd = Math.min(
		element.trimStart + element.duration,
		sequence.duration,
	);
	const startSequenceTime = Math.max(cue.startTime, element.trimStart);
	const endSequenceTime = Math.min(
		cue.startTime + cue.duration,
		visibleSequenceEnd,
	);
	if (endSequenceTime <= startSequenceTime) return null;

	const base = {
		clipStartTime: element.startTime,
		clipDuration: element.duration,
		trimStart: element.trimStart,
		sequenceDuration: sequence.duration,
	};
	const start = mapMotionTextSequenceTimeToTimelineValue({
		options: { ...base, sequenceTime: startSequenceTime },
	});
	// The core maps active instants in a half-open clip. Map the final included
	// tick, then restore the exclusive boundary so the result remains exact.
	const finalTick = mapMotionTextSequenceTimeToTimelineValue({
		options: { ...base, sequenceTime: endSequenceTime - 1 },
	});
	if (
		!start.active ||
		start.timelineTime === null ||
		!finalTick.active ||
		finalTick.timelineTime === null
	) {
		return null;
	}
	return {
		startTime: mediaTime({ ticks: start.timelineTime }),
		endTime: mediaTime({ ticks: finalTick.timelineTime + 1 }),
	};
}
