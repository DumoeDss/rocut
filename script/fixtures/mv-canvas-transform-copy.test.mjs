import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "../browser-probe-toolchain.mjs";
import { MV_EMBER_RASTER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-ember-raster.ts";
import { MV_CONVERGE_RENDERER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-converge-renderer.ts";

test("native raster preserves an explicit Canvas CTM copy boundary", async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const results = await page.evaluate(
			({ ember, converge }) => {
				const apply = new Function(`${ember}; return mvEmberTransform;`)();
				const draw = new Function(`${converge}; return drawMvConverge;`)();
				const results = [];
				for (const offscreen of [false, true]) {
					const make = () => {
						const canvas = offscreen
							? new OffscreenCanvas(1920, 1080)
							: document.createElement("canvas");
						canvas.width = 1920;
						canvas.height = 1080;
						return canvas.getContext("2d");
					};
					for (const zoom of [1.0461002765958676, 1.200101293]) {
						const source = make(),
							reference = make(),
							actual = make(),
							wrong = make(),
							scene = make();
						const operations = [
							{ kind: "translate", offset: [960.00000782, 539.9991589897] },
							{ kind: "scale", factors: [zoom, zoom] },
							{ kind: "translate", offset: [-960, -540] },
							{ kind: "copyTransform" },
							{ kind: "translate", offset: [250, 540] },
							{ kind: "scale", factors: [0.94, 0.94] },
						];
						const transform = [1, 0, 0, 1, 0, 0],
							rect = [0, 0, 381, 297];
						// Independent reference: copy to a different Canvas as intro.js does.
						source.translate(960.00000782, 539.9991589897);
						source.scale(zoom, zoom);
						source.translate(-960, -540);
						reference.setTransform(source.getTransform());
						reference.translate(250, 540);
						reference.scale(0.94, 0.94);
						apply(actual, { transform, operations });
						apply(wrong, {
							transform,
							operations: operations.filter(
								(op) => op.kind !== "copyTransform",
							),
						});
						const matrix = (ctx) => {
							const m = ctx.getTransform();
							return [m.a, m.b, m.c, m.d, m.e, m.f];
						};
						let sceneMatrix;
						const fillRect = scene.fillRect.bind(scene);
						scene.fillRect = (...args) => {
							sceneMatrix = matrix(scene);
							fillRect(...args);
						};
						draw(scene, {
							commands: [
								{
									kind: "rect",
									transform,
									operations,
									rect,
									paint: {
										kind: "fill",
										composite: "source-over",
										opacity: 1,
										style: { kind: "solid", color: [0.2, 0.4, 0.8, 1] },
									},
								},
							],
						});
						for (const ctx of [reference, actual]) {
							ctx.fillStyle = "rgb(51,102,204)";
							ctx.fillRect(...rect);
						}
						const expected = reference.getImageData(0, 0, 1920, 1080).data;
						const equalPixels = (ctx) =>
							ctx
								.getImageData(0, 0, 1920, 1080)
								.data.every((v, i) => v === expected[i]);
						results.push({
							offscreen,
							zoom,
							expected: matrix(reference),
							actual: matrix(actual),
							wrong: matrix(wrong),
							scene: sceneMatrix,
							emberPixelsExact: equalPixels(actual),
							convergePixelsExact: equalPixels(scene),
						});
					}
				}
				return results;
			},
			{ ember: MV_EMBER_RASTER_SOURCE, converge: MV_CONVERGE_RENDERER_SOURCE },
		);
		assert.equal(results.length, 4);
		for (const result of results) {
			assert.deepEqual(result.actual, result.expected, JSON.stringify(result));
			assert.deepEqual(result.scene, result.expected, JSON.stringify(result));
			assert.notDeepEqual(
				result.wrong,
				result.expected,
				"omitting the copy must be detected",
			);
			assert.ok(result.emberPixelsExact);
			assert.ok(result.convergePixelsExact);
		}
	} finally {
		await browser.close();
	}
});
