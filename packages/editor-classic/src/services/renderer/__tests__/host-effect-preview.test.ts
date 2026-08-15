import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { BrowserAssetResolver } from "../../../editor/host/browser-runtime";
import { getEffectPreviewSource } from "../effect-preview-source";

describe("Host-scoped effect preview", () => {
	test("keys image/canvas state by resolver identity across two bases", () => {
		const firstResolver = new BrowserAssetResolver("/host-one/");
		const secondResolver = new BrowserAssetResolver("/host-two/");
		const first = getEffectPreviewSource({ resolver: firstResolver });
		const firstAgain = getEffectPreviewSource({ resolver: firstResolver });
		const second = getEffectPreviewSource({ resolver: secondResolver });

		expect(first).toBe(firstAgain);
		expect(second).not.toBe(first);
		expect(first.previewImageUrl).toBe("/host-one/effects/preview.jpg");
		expect(second.previewImageUrl).toBe("/host-two/effects/preview.jpg");
	});

	test("decodes the shipped image and produces a nonblank preview source", async () => {
		const bytes = await readFile(
			resolve(process.cwd(), "apps/web/public/effects/preview.jpg"),
		);
		const image = await loadImage(bytes);
		expect(image.width).toBeGreaterThan(0);
		expect(image.height).toBeGreaterThan(0);

		const canvas = createCanvas(160, 160);
		const context = canvas.getContext("2d");
		context.drawImage(image, 0, 0, 160, 160);
		const pixels = context.getImageData(0, 0, 160, 160).data;
		let opaque = 0;
		let nonBlack = 0;
		for (let index = 0; index < pixels.length; index += 4) {
			if ((pixels[index + 3] ?? 0) > 0) opaque += 1;
			if (
				(pixels[index] ?? 0) > 0 ||
				(pixels[index + 1] ?? 0) > 0 ||
				(pixels[index + 2] ?? 0) > 0
			) {
				nonBlack += 1;
			}
		}
		expect(opaque).toBeGreaterThan(0);
		expect(nonBlack).toBeGreaterThan(0);
	});
});
