import {
	planVideoFreezeFrame as planFrame,
	resolveVideoSourceTime as resolveSource,
} from "opencut-wasm";
import { mediaTime, type MediaTime } from "./media-time";
import * as wasm from "opencut-wasm";

export function isVideoReverseSupported(): boolean {
	return [
		"resolveDirectionalVideoSourceTime",
		"reverseAudioSamples",
		"directionalSourceTrims",
	].every((name) => typeof Reflect.get(wasm, name) === "function");
}

export function planVideoFreezeFrame(
	options: Parameters<typeof planFrame>[0] & { reverse?: boolean },
): MediaTime | null {
	const result = planFrame(options);
	if (result != null && options.reverse)
		return resolveVideoSourceTime({
			clipTime: options.playhead - options.clipStart,
			clipDuration: options.clipDuration,
			trimStart: options.trimStart,
			playbackRate: options.playbackRate,
			sourceDuration: options.sourceDuration,
			reverse: true,
		});
	return result == null ? null : mediaTime({ ticks: result });
}

export function resolveVideoSourceTime(
	options: Parameters<typeof resolveSource>[0] & {
		clipDuration?: number;
		reverse?: boolean;
	},
): MediaTime | null {
	let result: unknown;
	if (options.reverse) {
		const directional: unknown = Reflect.get(
			wasm,
			"resolveDirectionalVideoSourceTime",
		);
		if (typeof directional !== "function")
			throw new Error("当前媒体运行时不支持倒放，请更新编辑器运行时。");
		if (options.clipDuration === undefined)
			throw new Error("倒放片段缺少时长。");
		result = directional(options);
	} else result = resolveSource(options);
	if (result != null && typeof result !== "number")
		throw new Error("媒体运行时返回了无效的源时间。");
	return result == null ? null : mediaTime({ ticks: result });
}

export function reverseAudioSamples({
	samples,
}: {
	samples: Float32Array;
}): Float32Array {
	const reverse: unknown = Reflect.get(wasm, "reverseAudioSamples");
	if (typeof reverse !== "function")
		throw new Error("当前媒体运行时不支持倒放音频，请更新编辑器运行时。");
	const result: unknown = reverse(samples);
	if (!(result instanceof Float32Array) || result.length !== samples.length)
		throw new Error("媒体运行时返回了无效的倒放音频。");
	return result;
}

export function directionalSourceTrims(options: {
	trimStart: MediaTime;
	trimEnd: MediaTime;
	reverse?: boolean;
}): { trimStart: MediaTime; trimEnd: MediaTime } {
	if (!options.reverse)
		return { trimStart: options.trimStart, trimEnd: options.trimEnd };
	const map: unknown = Reflect.get(wasm, "directionalSourceTrims");
	if (typeof map !== "function")
		throw new Error("当前媒体运行时不支持倒放剪辑，请更新编辑器运行时。");
	const result: unknown = map(options);
	if (
		!result ||
		typeof result !== "object" ||
		!("trimStart" in result) ||
		!("trimEnd" in result) ||
		typeof result.trimStart !== "number" ||
		typeof result.trimEnd !== "number"
	)
		throw new Error("倒放源裁剪范围无效。");
	return {
		trimStart: mediaTime({ ticks: result.trimStart }),
		trimEnd: mediaTime({ ticks: result.trimEnd }),
	};
}
