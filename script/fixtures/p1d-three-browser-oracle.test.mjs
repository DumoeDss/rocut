import assert from "node:assert/strict";
import { test } from "node:test";
import { checkP1dPixels, checkP1dPose, checkP1dSequence, P1D_TIMES } from "./p1d-three-browser-oracle.mjs";

// Independent analytic fixture, not pixels copied from the implementation/run.
function knownImage(time) {
	const pixels = Buffer.alloc(64 * 64 * 4);
	for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
		const worldX = (x + .5) / 64 * 3 - 1.5, worldY = 1.5 - (y + .5) / 64 * 3;
		const model = Math.abs(worldX - time * .5) < .6 && Math.abs(worldY) < .6;
		const svg = worldX > -.8 && worldX < -.16 && worldY > .16 && worldY < .8;
		if (model || svg) pixels.set(model ? [230, 110, 90, 255] : [0, 255, 0, 255], (y * 64 + x) * 4);
	}
	return { width: 64, height: 64, pixels };
}
test("independent analytic geometry/color fixture satisfies every sample gate", () => {
	checkP1dSequence(P1D_TIMES.map(time => checkP1dPixels(knownImage(time), time, { svg: true, lit: true })));
	checkP1dPose({ time: .75, index: 45, name: "P1DAnimatedMesh", position: [.375, 0, 0], animationName: "P1DTranslation", svgMeshCount: 1, svgVertices: 4 }, { time: .75, index: 45 });
});
test("blank, frozen, wrong color, missing SVG and wrong pose cannot satisfy the oracle", () => {
	assert.throws(() => checkP1dPixels({ width: 64, height: 64, pixels: Buffer.alloc(16384) }, .75, { svg: true, lit: true }));
	assert.throws(() => checkP1dPixels(knownImage(0), .75, { svg: true, lit: true }));
	const wrongColor = knownImage(.75); wrongColor.pixels.set([0, 0, 255, 255], (32 * 64 + 32) * 4);
	assert.throws(() => checkP1dPixels(wrongColor, .75, { svg: true, lit: true }));
	const missingSvg = knownImage(.75); missingSvg.pixels.fill(0, (16 * 64 + 16) * 4, (16 * 64 + 16) * 4 + 4);
	assert.throws(() => checkP1dPixels(missingSvg, .75, { svg: true, lit: true }));
	assert.throws(() => checkP1dPose({ time: .75, index: 45, name: "P1DAnimatedMesh", position: [0, 0, 0] }, { time: .75, index: 45 }));
	assert.throws(() => checkP1dSequence([{ rgbaSha256: "frozen" }, { rgbaSha256: "frozen" }, { rgbaSha256: "frozen" }, { rgbaSha256: "frozen" }]));
});
