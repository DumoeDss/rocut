import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { captureDisplayRaster } from "../probe-export-reference.mjs";
const requireWeb = createRequire(
	new URL("../../apps/web/package.json", import.meta.url),
);
const sharp = requireWeb("sharp");
const displayed = { x: 12.25, y: 24.5, width: 500.5, height: 281.5 };

test("export reference captures the current displayed rectangle at double density", async () => {
	const png = await sharp({
		create: { width: 1001, height: 563, channels: 4, background: "cyan" },
	})
		.png()
		.toBuffer();
	const actual = await captureDisplayRaster({
		displayed,
		cdp: {
			async send(command, params) {
				assert.equal(command, "Page.captureScreenshot");
				assert.deepEqual(params, {
					format: "png",
					fromSurface: true,
					clip: { ...displayed, scale: 2 },
				});
				return { data: png.toString("base64") };
			},
		},
	});
	assert.deepEqual(actual, png);
});

test("missing, undersized and nonfinite preview bounds fail before capture", async () => {
	for (const bounds of [
		null,
		{ ...displayed, width: 200 },
		{ ...displayed, height: 90 },
		{ ...displayed, x: NaN },
	])
		await assert.rejects(
			captureDisplayRaster({
				displayed: bounds,
				cdp: {
					send() {
						throw Error("must not capture");
					},
				},
			}),
			(error) => !error.message.includes("must not capture"),
		);
});

test("stale low-density images and capture errors cannot become passing references", async () => {
	const png = await sharp({
		create: { width: 500, height: 281, channels: 4, background: "cyan" },
	})
		.png()
		.toBuffer();
	await assert.rejects(
		captureDisplayRaster({
			displayed,
			cdp: {
				async send() {
					return { data: png.toString("base64") };
				},
			},
		}),
	);
	await assert.rejects(
		captureDisplayRaster({
			displayed,
			cdp: {
				async send() {
					throw Error("capture failed");
				},
			},
		}),
		/capture failed/,
	);
});
