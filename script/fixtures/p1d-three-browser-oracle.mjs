import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { P1D_SVG_COLOR_RGBA } from "./p1d-three-browser-color-reference.mjs";

export const P1D_TIMES = [0.75, 0, 0.25, 0.75];
export const P1D_SUPPORTED_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#00ff00"/></svg>';
export const P1D_SVG_CONTRACT = {
	profile: "svg-animation-v1", modeling: { kind: "flat" }, curveSegments: 8,
	scope: "One bounded static filled rectangle in the trusted SVG subset, not arbitrary SVG",
	root: "svg with namespace and bounded positive viewBox; root width/height are not admitted",
	fill: "none, #RGB, #RRGGBB, black, white, red, green, blue; lime is not admitted",
	exclusions: "DTD/entities/comments, scripts, text, external references, url fills, nested svg and other unsupported tags/attributes",
};
export function checkP1dPose(observation, frame) {
	assert.equal(observation.time, frame.time);
	assert.equal(observation.index, frame.index);
	assert.equal(observation.name, "P1DAnimatedMesh");
	assert.deepEqual(observation.position, [frame.time * 0.5, 0, 0]);
	assert.equal(observation.animationName, "P1DTranslation");
	assert.equal(observation.svgMeshCount, 1);
	assert.equal(observation.svgVertices, 4);
}
export function checkP1dPixels(image, time, { svg = false, lit = false } = {}) {
	assert.equal(image.width, 64); assert.equal(image.height, 64);
	const pixel = (x, y) => [...image.pixels.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
	assert.deepEqual(pixel(2, 2), [0, 0, 0, 0], "Independent transparent corner");
	assert.equal(pixel(32, 32)[3], 255, "Real model interior must be opaque");
	// Existing local geometry spans [-.6,.6], camera spans [-1.5,1.5].
	// Key times place the left/right edge strictly away from these pixel centers.
	assert.equal(pixel(20, 32)[3], time === 0 ? 255 : 0, "Independent left-edge motion");
	assert.equal(pixel(50, 32)[3], time > 0.5 ? 255 : 0, "Independent right-edge motion");
	if (lit) {
		const [red, green, blue] = pixel(32, 32);
		assert(red > 70 && red > green * 1.2 && green > blue, "Known warm glTF material under white ambient light");
	}
	if (svg) {
		const [red, green, blue, alpha] = pixel(16, 16);
		// MeshBasic is unlit, not tone-map exempt. The old pure-green expectation was incorrect.
		assert(alpha === 255 && [red, green, blue].every((channel, i) => Math.abs(channel - P1D_SVG_COLOR_RGBA[i]) < 5),
			"Known independent green SVG interior under fixed ACES/exposure1+sRGB8");
	} else assert.equal(pixel(16, 16)[3], 0, "No SVG in ordinary model case");
	return { rgbaSha256: createHash("sha256").update(image.pixels).digest("hex"),
		pixels: { corner: pixel(2, 2), model: pixel(32, 32), left: pixel(20, 32), right: pixel(50, 32), svg: pixel(16, 16) } };
}
export function checkP1dSequence(frames) {
	assert.equal(frames.length, 4);
	assert.equal(frames[0].rgbaSha256, frames[3].rgbaSha256, "Repeated absolute frame is exact");
	assert.notEqual(frames[0].rgbaSha256, frames[1].rgbaSha256, "Independent pixel gates also require visible motion");
	assert.notEqual(frames[1].rgbaSha256, frames[2].rgbaSha256);
}
