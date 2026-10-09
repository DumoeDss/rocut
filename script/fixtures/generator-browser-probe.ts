import {
	assertGenerator as assert,
	generatorAssets,
} from "./generator-browser-assets";
import { generatorCapture } from "./generator-capture";
import { checkGlyphRain, checkParticleReveal } from "./generator-visual-checks";
import {
	generatorSource,
	glyphScene,
	particleScene,
} from "./generator-fixture";
import { exportGenerators } from "./generator-export-probe";

export async function runGeneratorProbe() {
	const { resources, image } = await generatorAssets();
	const { capture, count } = generatorCapture(resources);
	const descriptors = resources.map((r) => r.resource);
	const rain = generatorSource(glyphScene(), descriptors),
		reveal = generatorSource(particleScene(), descriptors);
	const sheet = document.createElement("canvas");
	sheet.width = 768;
	sheet.height = 432;
	const ctx = sheet.getContext("2d")!;
	ctx.fillStyle = "#102030";
	ctx.fillRect(0, 0, sheet.width, sheet.height);
	const stamp = (pixels: Uint8ClampedArray, col: number, row: number) => {
		const cell = new OffscreenCanvas(192, 108);
		cell
			.getContext("2d")!
			.putImageData(
				new ImageData(new Uint8ClampedArray(pixels), 192, 108),
				0,
				0,
			);
		ctx.drawImage(cell, col * 192, row * 108);
	};
	document.body.append(sheet);
	const glyphs = await checkGlyphRain(rain, capture, stamp),
		particles = await checkParticleReveal(reveal, capture, stamp, image);
	for (const [row, source] of [rain, reveal].entries()) {
		for (const [col, frame] of [0, 8, 16, 24].entries())
			stamp((await capture(source, frame)).pixels, col, row + 2);
		for (const [width, height] of [
			[96, 192],
			[256, 96],
		]) {
			const resized = { ...source, width, height },
				first = await capture(resized, 8);
			await capture(resized, 24);
			assert(
				first.hash === (await capture(resized, 8)).hash,
				"Aspect ratio reverse seek failed",
			);
		}
	}
	let missing = false;
	try {
		await capture(rain, 0, {
			resources: resources.filter((r) => r.resource.kind !== "font"),
		});
	} catch (error) {
		missing = /font|resource/i.test(String(error));
	}
	assert(missing, "Missing declared font was silently accepted");
	const controller = new AbortController(),
		pending = capture(rain, 0, { signal: controller.signal });
	controller.abort(new DOMException("Probe cancelled", "AbortError"));
	let cancelled = false;
	try {
		await pending;
	} catch (error) {
		cancelled = error instanceof DOMException && error.name === "AbortError";
	}
	assert(
		cancelled && (await capture(rain, 0)).hash === glyphs.frame0,
		"Cancellation or recovery failed",
	);
	const video = await exportGenerators([rain, reveal], resources);
	assert(
		document.querySelectorAll("iframe").length === 0,
		"Generator sandbox leaked",
	);
	Reflect.set(globalThis, "__stylizedSheet", sheet.toDataURL("image/png"));
	return {
		ok: true,
		glyphs,
		particles,
		video,
		descriptors,
		captures: count(),
		checks: [
			"integer/fractional drawing clock",
			"repeat/reverse/ref/trim seek",
			"seed and geometry parameters",
			"transparent and partial alpha",
			"particle full-image endpoint and spatial motion",
			"in/out direction",
			"contain/cover/stretch",
			"output roles and zero opacity",
			"landscape/portrait",
			"missing font rejects",
			"cancellation and recovery",
			"preview/export equality on dark/light backgrounds",
			"real WebM encode/decode",
			"no remaining iframe",
		],
	};
}
