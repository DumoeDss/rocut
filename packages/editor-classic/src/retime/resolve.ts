import type { RetimeConfig } from "../timeline";
import { clampRetimeRate } from "./rate";
import { resolveVideoSourceTime } from "../wasm/video-time";
import { TICKS_PER_SECOND } from "../wasm";

function getSafeRate({ rate }: { rate: number }): number {
	return clampRetimeRate({ rate });
}

export function getSourceTimeAtClipTime({
	clipTime,
	retime,
	clipDuration,
}: {
	clipTime: number;
	retime?: RetimeConfig;
	clipDuration?: number;
}): number {
	if (retime?.reverse) {
		if (clipDuration === undefined)
			throw new Error("倒放源时间映射缺少片段时长。");
		const source = resolveVideoSourceTime({
			clipTime: Math.round(clipTime * TICKS_PER_SECOND),
			clipDuration: Math.round(clipDuration * TICKS_PER_SECOND),
			trimStart: 0,
			playbackRate: retime.rate,
			reverse: true,
		});
		if (source === null) throw new Error("倒放片段源时间无效。");
		return source / TICKS_PER_SECOND;
	}
	return clipTime * getSafeRate({ rate: retime?.rate ?? 1 });
}

export function getClipTimeAtSourceTime({
	sourceTime,
	retime,
}: {
	sourceTime: number;
	retime?: RetimeConfig;
}): number {
	return sourceTime / getSafeRate({ rate: retime?.rate ?? 1 });
}

export function getEffectiveRateAt({
	retime,
}: {
	clipTime?: number;
	retime?: RetimeConfig;
}): number {
	return getSafeRate({ rate: retime?.rate ?? 1 });
}

export function getTimelineDurationForSourceSpan({
	sourceSpan,
	retime,
}: {
	sourceSpan: number;
	retime?: RetimeConfig;
}): number {
	if (sourceSpan <= 0) {
		return 0;
	}
	return sourceSpan / getSafeRate({ rate: retime?.rate ?? 1 });
}
