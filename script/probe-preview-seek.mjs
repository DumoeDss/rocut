import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";

function timecode(frame) {
	const seconds = Math.floor(frame / 30);
	return [
		Math.floor(seconds / 3600),
		Math.floor(seconds / 60) % 60,
		seconds % 60,
		frame % 30,
	]
		.map((value) => String(value).padStart(2, "0"))
		.join(":");
}

// WebGPU discards its drawing buffer after presentation. Capture the displayed
// canvas through Chromium, not canvas.drawImage(), which reads transparent pixels.
// Times include screenshot/decode overhead: they are conservative upper bounds.
export async function probePreviewSeek({
	page,
	hostPage,
	work,
	evidence,
	onPhase,
}) {
	const cdp = await hostPage.context().newCDPSession(hostPage);
	try {
		return await measurePreviewSeek({ page, work, evidence, onPhase, cdp });
	} finally {
		await cdp.detach();
	}
}

async function measurePreviewSeek({ page, work, evidence, onPhase, cdp }) {
	onPhase("F04 visible-frame reference sweep");
	const dimensions = await page.evaluate(
		async () =>
			(await (await fetch(new URL("api/record", location.href))).json()).record
				.data.settings.canvasSize,
	);
	assert(dimensions.width >= 1280 && dimensions.height >= 720);
	await page.getByLabel("Media", { exact: true }).click();
	const canvas = page.locator(
		'canvas[width="' +
			dimensions.width +
			'"][height="' +
			dimensions.height +
			'"]',
	);
	await expect(canvas).toHaveCount(1);
	await expect(canvas).toBeVisible();
	const displayed = await canvas.boundingBox();
	assert(displayed && displayed.width > 100 && displayed.height > 50);
	await page.evaluate(() => {
		window.__rocutVisibleSeekProbe = {
			target: null,
			start: null,
			trusted: false,
		};
		document.addEventListener(
			"keydown",
			(event) => {
				const state = window.__rocutVisibleSeekProbe;
				if (
					event.key === "Enter" &&
					event.target?.getAttribute("aria-label") === "Playhead time" &&
					event.target.value === state.target
				) {
					state.start = performance.now();
					state.trusted = event.isTrusted;
				}
			},
			true,
		);
	});
	const capture = async () => {
		const captureStarted = performance.now();
		const screenshot = await cdp.send("Page.captureScreenshot", {
			format: "png",
			fromSurface: true,
			captureBeyondViewport: false,
			optimizeForSpeed: true,
			clip: {
				x: displayed.x,
				y: displayed.y,
				width: displayed.width,
				height: displayed.height,
				scale: 1,
			},
		});
		const captureMs = performance.now() - captureStarted;
		const decodeStarted = performance.now();
		const png = Buffer.from(screenshot.data, "base64");
		const result = await page.evaluate(async (bytes) => {
			const image = await createImageBitmap(
				new Blob([new Uint8Array(bytes)], { type: "image/png" }),
			);
			const sample = new OffscreenCanvas(160, 90);
			const context = sample.getContext("2d");
			context.drawImage(image, 0, 0, 160, 90);
			image.close();
			const pixels = context.getImageData(0, 0, 160, 90).data;
			let hash = 2166136261,
				light = 0,
				blue = 0;
			for (let i = 0; i < pixels.length; i++)
				hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0;
			for (let i = 0; i < pixels.length; i += 4) {
				if (pixels[i] > 160 && pixels[i + 1] > 160 && pixels[i + 2] > 160)
					light++;
				if (pixels[i + 2] > 160 && pixels[i] < 100 && pixels[i + 1] < 100)
					blue++;
			}
			const state = window.__rocutVisibleSeekProbe;
			return {
				hash: hash.toString(16).padStart(8, "0"),
				light,
				blue,
				milliseconds:
					state.start === null ? null : performance.now() - state.start,
				trusted: state.trusted,
			};
		}, Array.from(png));
		return { ...result, captureMs, decodeMs: performance.now() - decodeStarted };
	};
	const seek = async (target, expected) => {
		const before = (await capture()).hash;
		await page.getByLabel("Edit playhead time", { exact: true }).click();
		const input = page.getByLabel("Playhead time", { exact: true });
		await input.fill(target);
		await page.evaluate((target) => {
			window.__rocutVisibleSeekProbe = { target, start: null, trusted: false };
		}, target);
		await input.press("Enter");
		const pressReturnMs = await page.evaluate(() =>
			performance.now() - window.__rocutVisibleSeekProbe.start,
		);
		const observations = [];
		let previous = null,
			stable = 0;
		for (let attempt = 0; attempt < 30; attempt++) {
			const current = await capture();
			observations.push(current);
			assert(
				current.trusted && current.milliseconds !== null,
				"Must time a real Enter gesture",
			);
			assert(
				current.milliseconds < 5000,
				"Requested visible frame did not arrive: " + target,
			);
			const hasScene = current.light > 20 && current.blue > 1000;
			if (expected && hasScene && current.hash === expected) {
				await expect(
					page.getByLabel("Edit playhead time", { exact: true }),
				).toHaveText(target);
				return { timecode: target, ...current, pressReturnMs, observations };
			}
			if (!expected) {
				stable =
					hasScene && current.hash !== before && current.hash === previous
						? stable + 1
						: 0;
				if (stable >= 2)
					return { timecode: target, ...current, pressReturnMs, observations };
				previous = current.hash;
			}
		}
		throw new Error("Requested visible frame was not stable: " + target);
	};
	const references = [];
	for (let index = 0; index < 30; index++)
		references.push(await seek(timecode(((index * 37) % 120) * 45 + 12)));
	assert.equal(
		new Set(references.map((sample) => sample.hash)).size,
		30,
		"Every target must have a distinguishable visible frame",
	);
	await page.screenshot({ path: join(work, "f04-reference.png") });
	onPhase("F04 thirty measured random visible-frame seeks");
	const samples = [];
	for (let index = 0; index < 30; index++) {
		const reference = references[(index * 13 + 7) % 30];
		samples.push(await seek(reference.timecode, reference.hash));
	}
	const ordered = samples
		.map((sample) => sample.milliseconds)
		.sort((a, b) => a - b);
	const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1];
	const result = {
		name: "F04 random seeks reach the actual target picture within budget",
		resolution: dimensions,
		displaySize: { width: displayed.width, height: displayed.height },
		cueCount: 120,
		referenceFrames: references,
		samples,
		p95,
		maximum: ordered.at(-1),
		budgetMs: 250,
		measurement:
			"trusted Enter to matching visible Chromium screenshot; includes capture, transfer and decode overhead",
		pass: p95 <= 250,
	};
	evidence.checks.push(result);
	await page.screenshot({ path: join(work, "f04-measured-seek.png") });
	assert(
		p95 <= 250,
		"F04 visible-frame seek upper-bound p95 exceeds 250 ms: " + p95,
	);
}
