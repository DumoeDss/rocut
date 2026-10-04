import type { FrameRate } from "opencut-wasm";
import type { VideoCache } from "../video-cache/service";
import type { CanvasRenderer } from "./canvas-renderer";

export interface TransitionBranchSample {
	localTime: number;
	sourceTime: number | null | undefined;
}
export interface ResolveContext {
	renderer: Pick<CanvasRenderer, "width" | "height">;
	time: number;
	frameRate?: FrameRate;
	videoCache: Pick<VideoCache, "getFrameAt">;
	/** Present only for a picture branch sampled by the Rust transition plan. */
	sample?: TransitionBranchSample;
}
