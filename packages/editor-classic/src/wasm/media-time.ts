import * as wasm from "opencut-wasm";
import {
	lastFrameTime as _lastFrameTime,
	parseTimecode as _parseTimecode,
	roundToFrame as _roundToFrame,
	snappedSeekTime as _snappedSeekTime,
	TICKS_PER_SECOND as _TICKS_PER_SECOND,
	mediaTimeFromSeconds as _mediaTimeFromSeconds,
	mediaTimeToSeconds as _mediaTimeToSeconds,
	type FrameRate,
	type TimeCodeFormat,
} from "opencut-wasm";

/**
 * Integer-tick time. Mirrors `MediaTime(i64)` in `rust/crates/time/src/media_time.rs`.
 *
 * `opencut-wasm` exposes `MediaTime` as a bare `number` alias because tsify
 * collapses tuple structs. The brand here is the TS-side discipline that
 * recovers the invariant: a `MediaTime` is an integer count of ticks, and the
 * only legal way to construct one from a fractional `number` is `roundMediaTime`
 * (or `mediaTimeFromSeconds`, which rounds inside the wasm boundary).
 *
 * Reading is free — `MediaTime` is assignable to `number`. Writing is gated —
 * a bare `number` is not assignable to `MediaTime`.
 */
export type MediaTime = number & { readonly __mediaTime: unique symbol };

/** A strict half-open interval on the project timeline: `[startTime, endTime)`. */
export interface MediaTimeRange {
	readonly startTime: MediaTime;
	readonly endTime: MediaTime;
}

export interface ResolvedMediaTimeRange extends MediaTimeRange {
	readonly duration: MediaTime;
}

export type ValidateMediaTimeRangeCore = (options: {
	readonly startTime: number;
	readonly endTime: number;
	readonly timelineDuration: number;
}) => unknown;

type MediaTimeRangeError =
	| "invalid-timeline-duration"
	| "start-before-zero"
	| "end-not-after-start"
	| "end-after-timeline-duration";

export const TICKS_PER_SECOND = _TICKS_PER_SECOND();

function isMediaTime(value: number): value is MediaTime {
	return Number.isInteger(value);
}

function requireMediaTime({
	value,
	context,
}: {
	value: number;
	context: string;
}): MediaTime {
	if (!isMediaTime(value)) {
		throw new Error(`${context}: expected an integer tick count, got ${value}`);
	}
	return value;
}

export const ZERO_MEDIA_TIME = requireMediaTime({
	value: 0,
	context: "ZERO_MEDIA_TIME",
});

/**
 * Construct a `MediaTime` from a known-integer tick count. Use `roundMediaTime`
 * when the input may be fractional.
 */
export function mediaTime({ ticks }: { ticks: number }): MediaTime {
	return requireMediaTime({
		value: ticks,
		context: "mediaTime()",
	});
}

/**
 * Project a fractional value onto the integer-tick lattice.
 *
 * Rounds half away from zero (`-1.5 → -2`, `1.5 → 2`) and normalises `-0` to
 * `0`. The away-from-zero rule matches Rust's `.round()` and avoids the
 * `Math.round(-0.5) === -0` quirk that propagates `-0` into stored data.
 */
export function roundMediaTime({ time }: { time: number }): MediaTime {
	const roundedMagnitude = Math.round(Math.abs(time));
	if (roundedMagnitude === 0) {
		return ZERO_MEDIA_TIME;
	}
	return requireMediaTime({
		value: time < 0 ? -roundedMagnitude : roundedMagnitude,
		context: "roundMediaTime()",
	});
}

export function mediaTimeFromSeconds({
	seconds,
}: {
	seconds: number;
}): MediaTime {
	const result = _mediaTimeFromSeconds({ seconds });
	if (result === undefined) {
		throw new Error(
			`mediaTimeFromSeconds: rust returned undefined for seconds=${seconds}`,
		);
	}
	return requireMediaTime({
		value: result,
		context: "mediaTimeFromSeconds()",
	});
}

export function mediaTimeToSeconds({ time }: { time: MediaTime }): number {
	return _mediaTimeToSeconds({ time });
}

const RANGE_ERROR_MESSAGES: Readonly<Record<MediaTimeRangeError, string>> = {
	"invalid-timeline-duration": "the timeline duration must be positive",
	"start-before-zero": "the range start must not be negative",
	"end-not-after-start": "the range end must be after its start",
	"end-after-timeline-duration": "the range end exceeds the timeline duration",
};

function isMediaTimeRangeError(value: unknown): value is MediaTimeRangeError {
	return value !== null && Object.hasOwn(RANGE_ERROR_MESSAGES, String(value));
}

/**
 * Resolve and validate a timeline range through the Rust time core. An omitted
 * range means the complete timeline; callers never have to duplicate that
 * default or the boundary rules.
 */
export function resolveMediaTimeRange({
	range,
	timelineDuration,
	core,
}: {
	readonly range?: MediaTimeRange;
	readonly timelineDuration: MediaTime;
	readonly core?: ValidateMediaTimeRangeCore;
}): ResolvedMediaTimeRange {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "validateMediaTimeRange");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose validateMediaTimeRange.",
		);
	}
	const startTime = range?.startTime ?? ZERO_MEDIA_TIME;
	const endTime = range?.endTime ?? timelineDuration;
	const result: unknown = candidate({
		startTime,
		endTime,
		timelineDuration,
	});
	if (result === null || typeof result !== "object" || Array.isArray(result)) {
		throw new TypeError("The Rust time core returned an invalid range result.");
	}
	const duration: unknown = Reflect.get(result, "duration");
	const error: unknown = Reflect.get(result, "error");
	if (error !== null) {
		if (!isMediaTimeRangeError(error) || duration !== null) {
			throw new TypeError(
				"The Rust time core returned an invalid range error.",
			);
		}
		throw new RangeError(
			`Invalid timeline range: ${RANGE_ERROR_MESSAGES[error]}.`,
		);
	}
	if (typeof duration !== "number") {
		throw new TypeError(
			"The Rust time core returned an invalid range duration.",
		);
	}
	return {
		startTime,
		endTime,
		duration: requireMediaTime({
			value: duration,
			context: "resolveMediaTimeRange()",
		}),
	};
}

/**
 * Sum `MediaTime` values. Inputs are integer ticks, so the sum is integer too.
 */
export function addMediaTime({
	a,
	b,
}: {
	a: MediaTime;
	b: MediaTime;
}): MediaTime {
	return requireMediaTime({
		value: a + b,
		context: "addMediaTime()",
	});
}

export function subMediaTime({
	a,
	b,
}: {
	a: MediaTime;
	b: MediaTime;
}): MediaTime {
	return requireMediaTime({
		value: a - b,
		context: "subMediaTime()",
	});
}

export function maxMediaTime({
	a,
	b,
}: {
	a: MediaTime;
	b: MediaTime;
}): MediaTime {
	return a > b ? a : b;
}

export function minMediaTime({
	a,
	b,
}: {
	a: MediaTime;
	b: MediaTime;
}): MediaTime {
	return a < b ? a : b;
}

export function clampMediaTime({
	time,
	min,
	max,
}: {
	time: MediaTime;
	min: MediaTime;
	max: MediaTime;
}): MediaTime {
	if (time < min) return min;
	if (time > max) return max;
	return time;
}

export function roundFrameTime({
	time,
	fps,
}: {
	time: MediaTime;
	fps: FrameRate;
}): MediaTime {
	return requireMediaTime({
		value: _roundToFrame({ time, rate: fps }) ?? time,
		context: "roundFrameTime()",
	});
}

export function roundFrameTicks({
	ticks,
	fps,
}: {
	ticks: number;
	fps: FrameRate;
}): number {
	return _roundToFrame({ time: ticks, rate: fps }) ?? ticks;
}

export function snapSeekMediaTime({
	time,
	duration,
	fps,
}: {
	time: MediaTime;
	duration: MediaTime;
	fps: FrameRate;
}): MediaTime {
	return requireMediaTime({
		value: _snappedSeekTime({ time, duration, rate: fps }) ?? time,
		context: "snapSeekMediaTime()",
	});
}

export function lastFrameMediaTime({
	duration,
	fps,
}: {
	duration: MediaTime;
	fps: FrameRate;
}): MediaTime {
	return requireMediaTime({
		value: _lastFrameTime({ duration, rate: fps }) ?? duration,
		context: "lastFrameMediaTime()",
	});
}

export function parseMediaTimecode({
	timeCode,
	format,
	fps,
}: {
	timeCode: string;
	format: TimeCodeFormat;
	fps: FrameRate;
}): MediaTime | null {
	const parsedTime = _parseTimecode({ timeCode, format, rate: fps });
	if (parsedTime == null) {
		return null;
	}
	return requireMediaTime({
		value: parsedTime,
		context: "parseMediaTimecode()",
	});
}
