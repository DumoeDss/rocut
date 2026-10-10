import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	blazeEditorDigest as digest,
	blazeEditorWrite as save,
} from "./blaze-editor-control.mjs";
import { decodeBlazeEditorSourcePng } from "./blaze-editor-export-source.mjs";

export async function canonicalBlazeEditorSource({ page, root, editorUrl }) {
	const prepared = JSON.parse(
		await readFile(join(root, "prepared.json"), "utf8"),
	);
	const response = await fetch(
		new URL("api/programmatic/resources/load", editorUrl),
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(prepared.resource),
			signal: AbortSignal.timeout(15000),
		},
	);
	assert.equal(response.status, 200);
	const png = Buffer.from(await response.arrayBuffer());
	assert.equal(digest(png), prepared.resource.sha256);
	assert.equal(png.length, prepared.resource.byteLength);
	const native = decodeBlazeEditorSourcePng(png);
	const decoded = await page.evaluate(async (encoded) => {
		const bytes = Uint8Array.from(atob(encoded), (value) =>
			value.charCodeAt(0),
		);
		const image = await createImageBitmap(
			new Blob([bytes], { type: "image/png" }),
		);
		try {
			const canvas = new OffscreenCanvas(image.width, image.height);
			const context = canvas.getContext("2d", {
				willReadFrequently: true,
				colorSpace: "srgb",
			});
			if (!context) throw Error("Independent 2D image decoder unavailable");
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(0, 0, image.width, image.height);
			let binary = "";
			for (let start = 0; start < pixels.data.length; start += 16384)
				binary += String.fromCharCode(
					...pixels.data.subarray(start, start + 16384),
				);
			return {
				width: image.width,
				height: image.height,
				colorSpace: pixels.colorSpace,
				rgba: btoa(binary),
			};
		} finally {
			image.close();
		}
	}, png.toString("base64"));
	assert.equal(decoded.width, native.width);
	assert.equal(decoded.height, native.height);
	assert.equal(decoded.colorSpace, "srgb");
	const canonical = Buffer.from(decoded.rgba, "base64");
	assert.equal(canonical.toString("base64"), decoded.rgba);
	assert.equal(canonical.length, 192 * 128 * 4);
	let changedRgb = 0,
		transparentPixels = 0,
		partialAlphaPixels = 0;
	for (let offset = 0; offset < canonical.length; offset += 4) {
		const alpha = canonical[offset + 3];
		assert.equal(
			alpha,
			native.pixels[offset + 3],
			"Independent image decode changed alpha",
		);
		if (alpha === 0) transparentPixels++;
		else if (alpha < 255) partialAlphaPixels++;
		for (let channel = 0; channel < 3; channel++) {
			if (alpha === 0) assert.equal(canonical[offset + channel], 0);
			if (alpha === 255)
				assert.equal(
					canonical[offset + channel],
					native.pixels[offset + channel],
				);
			if (canonical[offset + channel] !== native.pixels[offset + channel])
				changedRgb++;
		}
	}
	assert(transparentPixels > 0 && partialAlphaPixels > 0);
	await save(root, "export-source.png", png);
	await save(root, "export-source-native.rgba", Buffer.from(native.pixels));
	await save(root, "export-source-canonical.rgba", canonical);
	const metadata = {
		kind: "independent-png-imagebitmap-offscreen-2d-decode",
		width: 192,
		height: 128,
		resource: prepared.resource,
		pngSha256: digest(png),
		canonicalSha256: digest(canonical),
		nativeSha256: digest(native.pixels),
		changedRgb,
		transparentPixels,
		partialAlphaPixels,
		productionPreviewUsed: false,
		effectApplied: false,
		uiPlayheadChanged: false,
	};
	await save(root, "export-source.json", metadata);
	return metadata;
}
