import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
	mainPreviewCanvas,
	samplePreviewPng,
} from "./probe-multilingual-media.mjs";

export async function captureDisplayRaster({ cdp, displayed }) {
	assert(displayed && Object.values(displayed).every(Number.isFinite));
	assert(
		displayed.width >= 320 && displayed.height >= 180,
		"export reference requires a sufficiently large visible preview",
	);
	const { data } = await cdp.send("Page.captureScreenshot", {
		format: "png",
		fromSurface: true,
		clip: { ...displayed, scale: 2 },
	});
	const png = Buffer.from(data, "base64");
	assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
	assert(png.readUInt32BE(16) >= Math.floor(displayed.width) * 2 - 2);
	assert(png.readUInt32BE(20) >= Math.floor(displayed.height) * 2 - 2);
	return png;
}

// Still a screenshot of the actual displayed compositor, not a second render
// or canvas.toDataURL() (WebGPU's discarded drawing buffer can be blank).
// Preserve ordinary CSS screenshots for exact UI/history checks; this denser
// reference avoids repeated low-resolution filtering in the export oracle.
export async function captureExportReference({
	page,
	hostPage,
	path,
	sample = samplePreviewPng,
}) {
	const canvas = await mainPreviewCanvas(page);
	const displayed = await canvas.boundingBox();
	const cdp = await hostPage.context().newCDPSession(hostPage);
	try {
		const png = await captureDisplayRaster({ cdp, displayed });
		writeFileSync(path, png);
		return sample(page, png);
	} finally {
		await cdp.detach();
	}
}
