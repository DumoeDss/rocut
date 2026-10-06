import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import {
	mainPreviewCanvas,
	samplePreviewPng,
} from "./probe-multilingual-media.mjs";

export function inspectF03(pixels) {
	assert.equal(pixels.length, 320 * 180 * 4);
	const regions = [[], [], []];
	for (let y = 2; y < 178; y++)
		for (let x = 2; x < 318; x++) {
			const index = y * 320 + x;
			const [r, g, b] = pixels.slice(index * 4, index * 4 + 3);
			if (r < 70 && g > 180 && b > 180) regions[0].push(index);
			if (r > 180 && g < 70 && b > 180) regions[1].push(index);
			if (r < 70 && g > 180 && b < 70) regions[2].push(index);
		}
	return {
		hash: createHash("sha256").update(Buffer.from(pixels)).digest("hex"),
		regions,
	};
}

export const captureF03 = async (page) =>
	samplePreviewPng(
		page,
		await (await mainPreviewCanvas(page)).screenshot(),
		inspectF03,
	);

export function assertF03(sample) {
	for (const [index, region] of sample.regions.entries()) {
		assert(
			region.length > 25,
			`language layer ${index} must contain visible glyphs`,
		);
		assert(
			region.every(
				(pixel) =>
					pixel % 320 >= (index * 320) / 3 &&
					pixel % 320 < ((index + 1) * 320) / 3,
			),
			`language layer ${index} must stay in its own third`,
		);
	}
}

export async function stableF03(page) {
	let previous,
		streak = 0,
		sample;
	await expect
		.poll(
			async () => {
				sample = await captureF03(page);
				try {
					assertF03(sample);
				} catch {
					return false;
				}
				streak = sample.hash === previous ? streak + 1 : 1;
				previous = sample.hash;
				return streak >= 3;
			},
			{ timeout: 30000 },
		)
		.toBe(true);
	return sample;
}
