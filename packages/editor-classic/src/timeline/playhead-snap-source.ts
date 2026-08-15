import type { SnapPoint } from "./snapping";
import type { MediaTime } from "../wasm";

export function getPlayheadSnapPoints({
	playheadTime,
}: {
	playheadTime: MediaTime;
}): SnapPoint[] {
	return [{ time: playheadTime, type: "playhead" }];
}
