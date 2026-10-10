import * as wasm from "/wasm-glue.mjs";

const width = 96,
	height = 64;
const frameRate = { numerator: 30, denominator: 1 };
const neutral = {
	version: 1,
	columns: 16,
	rows: 16,
	durationTicks: 120000,
	seed: 17,
	drying: 2,
	diffusion: 2,
	weaveFrequency: 9,
	weaveHeight: 0,
	lightX: 0,
	lightY: 0,
	lightZ: 1,
	relief: 0,
	strokeCount: 0,
};
const painted = {
	...neutral,
	weaveHeight: 0.015,
	relief: 3,
	lightX: 0.4,
	lightY: 0.2,
	strokeCount: 1,
	stroke0StartTicks: 0,
	stroke0EndTicks: 80000,
	stroke0FromX: 0.12,
	stroke0FromY: 0.25,
	stroke0ToX: 0.88,
	stroke0ToY: 0.75,
	stroke0Radius: 0.13,
	stroke0Bristles: 6,
	stroke0Opacity: 0.85,
	stroke0Wetness: 0.7,
	stroke0Thickness: 0.06,
};
const grayPass = {
	shader: "color-adjustment",
	uniforms: {
		exposure: 0,
		contrast: 0,
		saturation: -100,
		temperature: 0,
		tint: 0,
	},
};
const encode = (bytes) => btoa(String.fromCharCode(...bytes));
function read(canvas) {
	const copy = new OffscreenCanvas(width, height);
	const context = copy.getContext("2d", { willReadFrequently: true });
	context.drawImage(canvas, 0, 0);
	return new Uint8Array(context.getImageData(0, 0, width, height).data);
}
function metrics(actual, expected) {
	let max = 0,
		sum = 0;
	for (let index = 0; index < actual.length; index++) {
		const delta = Math.abs(actual[index] - expected[index]);
		max = Math.max(max, delta);
		sum += delta;
	}
	return { max, mean: sum / actual.length };
}
function source(grayscale) {
	const canvas = new OffscreenCanvas(width, height),
		data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4;
			let r = 20 + ((x * 67 + y * 17) % 210),
				g = 15 + ((x * 23 + y * 47) % 200),
				b = 30 + ((x * 11 + y * 83) % 195);
			if (grayscale)
				r = g = b = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
			data.set([r, g, b, 255], offset);
		}
	canvas
		.getContext("2d")
		.putImageData(new ImageData(data, width, height), 0, 0);
	return canvas;
}
function passes(params, ticks = 60000) {
	const resolved = JSON.parse(
		wasm.resolveStylizedEffectJson(
			JSON.stringify({
				effectType: "canvas",
				params,
				localTime: ticks,
				frameRate,
			}),
		),
	);
	if (resolved.error || !resolved.passes?.length)
		throw Error(resolved.error ?? "Missing Canvas pass");
	return resolved.passes;
}
function layer(textureId = "source", effectPassGroups = []) {
	return {
		type: "layer",
		textureId,
		transform: {
			centerX: width / 2,
			centerY: height / 2,
			width,
			height,
			rotationDegrees: 0,
			flipX: false,
			flipY: false,
		},
		opacity: 1,
		blendMode: "normal",
		effectPassGroups,
		mask: null,
	};
}
const group = (items, effectPassGroups = []) => ({
	items,
	effectPassGroups,
	opacity: 1,
	blendMode: "normal",
});
const frame = (items) => ({
	width,
	height,
	clear: { color: [0, 0, 0, 0] },
	items,
});
async function complete(handle, request) {
	let ready = false,
		calls = 0;
	while (!ready && calls < 2000) {
		const pending = wasm.advanceRenderFrameForHandle(handle, request, 64);
		if (!(pending instanceof Promise))
			throw Error("Generated advance binding is not Promise");
		ready = await pending;
		calls++;
	}
	if (!ready) throw Error("Bounded request did not finish");
	wasm.commitRenderFrameForHandle(handle, request);
	return { bytes: read(wasm.getCompositorCanvasForHandle(handle)), calls };
}

export {
	width,
	height,
	neutral,
	painted,
	grayPass,
	encode,
	read,
	metrics,
	source,
	passes,
	layer,
	group,
	frame,
	complete,
};
const report = {
	ok: false,
	scope:
		"Real frozen WASM request/compositor capture and presentation Canvas. Not editor/Host, encoded export, native output bytes or an independent full material oracle.",
	backend: "",
	checks: [],
	frames: [],
	failure: null,
	disposed: false,
};
const handles = new Set();
Reflect.set(globalThis, "__canvasCaptureProgress", report);
function check(id, passed, detail) {
	report.checks.push({ id, passed, detail });
}
function near(id, actual, expected, tolerance = 2) {
	const comparison = metrics(actual, expected);
	check(id, comparison.max <= tolerance, { ...comparison, tolerance });
}
function distinct(id, actual, expected, minimum = 3) {
	const comparison = metrics(actual, expected);
	check(id, comparison.mean > minimum, { ...comparison, minimumMean: minimum });
}

export { report, handles, check, near, distinct };
