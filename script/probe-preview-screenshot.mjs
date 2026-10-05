import assert from "node:assert/strict";
import { createRequire } from "node:module";
const requireWeb = createRequire(
	new URL("../apps/web/package.json", import.meta.url),
);

// For heap/functional diagnostics only. Unlike screencast, each observation
// reads a current compositor snapshot; it has no frame-swap timing evidence.
export function createScreenshotCapture({ cdp, displayed }) {
	const sharp = requireWeb("sharp");
	let sequence = 0,
		closed = false;
	return {
		async capture() {
			assert(!closed, "Screenshot observer is closed");
			const { data } = await cdp.send("Page.captureScreenshot", {
				format: "png",
				fromSurface: true,
			});
			const pixels = await sharp(Buffer.from(data, "base64"))
				.extract({
					left: Math.round(displayed.x),
					top: Math.round(displayed.y),
					width: Math.floor(displayed.width),
					height: Math.floor(displayed.height),
				})
				.resize(160, 90)
				.ensureAlpha()
				.raw()
				.toBuffer();
			let hash = 2166136261,
				light = 0,
				blue = 0;
			for (const value of pixels)
				hash = Math.imul(hash ^ value, 16777619) >>> 0;
			for (let i = 0; i < pixels.length; i += 4) {
				if (pixels[i] > 160 && pixels[i + 1] > 160 && pixels[i + 2] > 160)
					light++;
				if (pixels[i + 2] > 160 && pixels[i] < 100 && pixels[i + 1] < 100)
					blue++;
			}
			return {
				hash: hash.toString(16).padStart(8, "0"),
				light,
				blue,
				sequence: ++sequence,
			};
		},
		async close() {
			closed = true;
		},
	};
}
