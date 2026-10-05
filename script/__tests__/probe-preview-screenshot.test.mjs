import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createScreenshotCapture } from "../probe-preview-screenshot.mjs";
const requireWeb = createRequire(
	new URL("../../apps/web/package.json", import.meta.url),
);
const sharp = requireWeb("sharp");

test("screenshot observations capture fresh pixels without claiming frame-swap timing", async () => {
	const white = await sharp({
		create: {
			width: 16,
			height: 9,
			channels: 4,
			background: { r: 255, g: 255, b: 255, alpha: 1 },
		},
	})
		.png()
		.toBuffer();
	const blue = await sharp({
		create: {
			width: 16,
			height: 9,
			channels: 4,
			background: { r: 0, g: 0, b: 255, alpha: 1 },
		},
	})
		.png()
		.toBuffer();
	let calls = 0;
	const observer = createScreenshotCapture({
		cdp: {
			async send(command, options) {
				assert.equal(command, "Page.captureScreenshot");
				assert.equal(options.fromSurface, true);
				return { data: (calls++ === 0 ? white : blue).toString("base64") };
			},
		},
		displayed: { x: 0, y: 0, width: 16, height: 9 },
	});
	const first = await observer.capture(),
		second = await observer.capture(),
		third = await observer.capture();
	assert.equal(first.light, 160 * 90);
	assert.equal(first.blue, 0);
	assert.equal(second.blue, 160 * 90);
	assert.equal(second.light, 0);
	assert.notEqual(first.hash, second.hash);
	assert.equal(second.hash, third.hash);
	assert.equal(third.sequence, 3);
	assert.equal(calls, 3);
	assert(!("frameEpochMs" in first) && !("milliseconds" in first));
	await observer.close();
	await assert.rejects(observer.capture(), /closed/);
});

test("capture errors are surfaced rather than returning a stale previous frame", async () => {
	const observer = createScreenshotCapture({
		cdp: {
			async send() {
				throw Error("capture failed");
			},
		},
		displayed: { x: 0, y: 0, width: 16, height: 9 },
	});
	await assert.rejects(observer.capture(), /capture failed/);
	await observer.close();
});
