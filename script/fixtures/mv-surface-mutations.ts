import { MV_EMBER_RENDERER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-ember-renderer";

export type SurfaceMutation =
	| "omitBlur"
	| "wrongSmoothing"
	| "transparentGray"
	| "prematureRelease";
const mutations: Record<SurfaceMutation, readonly [string, string]> = {
	omitBlur: [
		"target.filter = mvOrderedBlitFilter(r);",
		"target.filter = mvOrderedBlitFilter({ ...r, blurPx: 0 });",
	],
	wrongSmoothing: [
		"target.imageSmoothingEnabled = r.smoothing;",
		"target.imageSmoothingEnabled = !r.smoothing;",
	],
	transparentGray: [
		"ctx.putImageData(pixels,...position);",
		"for (let n = 3; n < pixels.data.length; n += 4) pixels.data[n] = 0; ctx.putImageData(pixels,...position);",
	],
	prematureRelease: [
		"surface.width = 1; surface.height = 1; scratch.delete(command.surface);",
		// A faulty dependency release clears retained consumers before their final blit.
		"surface.width = 1; surface.height = 1; scratch.delete(command.surface); for (const retained of scratch.values()) retained.width = retained.height = 1;",
	],
};
/** Test-only fixed mutations; never selected by author code or a production API. */
export function surfaceReplaySource(mutation?: SurfaceMutation) {
	if (!mutation) return MV_EMBER_RENDERER_SOURCE;
	const [anchor, replacement] = mutations[mutation];
	if (MV_EMBER_RENDERER_SOURCE.split(anchor).length !== 2)
		throw Error(`Surface mutation anchor drift: ${mutation}`);
	return MV_EMBER_RENDERER_SOURCE.replace(anchor, replacement);
}
