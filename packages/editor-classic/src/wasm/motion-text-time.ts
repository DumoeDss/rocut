import * as wasm from "opencut-wasm";

export interface MotionTextClipTimeOptions {
	readonly clipStartTime: number;
	readonly clipDuration: number;
	readonly trimStart: number;
	readonly timelineTime: number;
	readonly sequenceDuration: number;
}

export interface MotionTextSequenceTimeOptions {
	readonly clipStartTime: number;
	readonly clipDuration: number;
	readonly trimStart: number;
	readonly sequenceTime: number;
	readonly sequenceDuration: number;
}

export interface MotionTextClipTimeResult {
	readonly active: boolean;
	readonly sequenceTime: number | null;
}

export interface MotionTextSequenceTimeResult {
	readonly active: boolean;
	readonly timelineTime: number | null;
}

export type MotionTextClipTimeCore = (
	options: MotionTextClipTimeOptions,
) => unknown;

export type MotionTextSequenceTimeCore = (
	options: MotionTextSequenceTimeOptions,
) => unknown;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeOptionalTime({
	value,
	field,
}: {
	value: unknown;
	field: string;
}): number | null {
	if (value === undefined || value === null) return null;
	if (typeof value === "number" && Number.isSafeInteger(value)) return value;
	throw new TypeError(`Motion-text time mapping returned an invalid ${field}.`);
}

export function mapMotionTextClipTimeValue({
	options,
	core,
}: {
	readonly options: MotionTextClipTimeOptions;
	readonly core?: MotionTextClipTimeCore;
}): MotionTextClipTimeResult {
	const candidate: unknown = core ?? Reflect.get(wasm, "mapMotionTextClipTime");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose mapMotionTextClipTime.",
		);
	}
	const mapped: unknown = candidate(options);
	if (!isRecord(mapped) || typeof mapped.active !== "boolean") {
		throw new TypeError("Motion-text clip time mapping returned invalid data.");
	}
	return {
		active: mapped.active,
		sequenceTime: decodeOptionalTime({
			value: mapped.sequenceTime,
			field: "sequence time",
		}),
	};
}

export function mapMotionTextSequenceTimeToTimelineValue({
	options,
	core,
}: {
	readonly options: MotionTextSequenceTimeOptions;
	readonly core?: MotionTextSequenceTimeCore;
}): MotionTextSequenceTimeResult {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "mapMotionTextSequenceTimeToTimeline");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose mapMotionTextSequenceTimeToTimeline.",
		);
	}
	const mapped: unknown = candidate(options);
	if (!isRecord(mapped) || typeof mapped.active !== "boolean") {
		throw new TypeError(
			"Motion-text sequence time mapping returned invalid data.",
		);
	}
	return {
		active: mapped.active,
		timelineTime: decodeOptionalTime({
			value: mapped.timelineTime,
			field: "timeline time",
		}),
	};
}
