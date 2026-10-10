import type { MvRoadNativePost } from "../../../../../editor-contracts/src/mv-road";
import type { applyRoadReferencePost } from "./mv-road-reference-post";
import type { ReferencePostInputs } from "./mv-reference-post";

/** The same original Road post executor serves the native document and Worker.
 * The host supplies its own allocator/cancellation owner; no resource URLs,
 * authored code or inferred palette/beat policy enter this backend.
 */
export function createRoadPostBackend({
	createSurface,
	releaseSurface,
	check,
	renderReferencePost,
	executeRoadPost,
}: {
	createSurface: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas;
	releaseSurface: (surface: HTMLCanvasElement | OffscreenCanvas) => void;
	check: () => void;
	renderReferencePost: (inputs: ReferencePostInputs) => void;
	executeRoadPost: typeof applyRoadReferencePost;
}) {
	return Object.freeze({
		applyRoad(
			ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
			request: MvRoadNativePost,
		) {
			executeRoadPost({
				ctx, request, createSurface, releaseSurface, check, renderReferencePost,
			});
		},
	});
}

/** Embed after MV_ROAD_REFERENCE_POST_SOURCE in either trusted raster realm. */
export const MV_ROAD_POST_BACKEND_SOURCE =
	"\nconst createRoadPostBackend = " + createRoadPostBackend.toString() + ";\n";
