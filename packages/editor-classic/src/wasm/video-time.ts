import {
	planVideoFreezeFrame as planFrame,
	resolveVideoSourceTime as resolveSource,
} from "opencut-wasm";
import { mediaTime, type MediaTime } from "./media-time";

export function planVideoFreezeFrame(
	options: Parameters<typeof planFrame>[0],
): MediaTime | null {
	const result = planFrame(options);
	return result == null ? null : mediaTime({ ticks: result });
}

export function resolveVideoSourceTime(
	options: Parameters<typeof resolveSource>[0],
): MediaTime | null {
	const result = resolveSource(options);
	return result == null ? null : mediaTime({ ticks: result });
}
