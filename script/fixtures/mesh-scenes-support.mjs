export function assert(value, message = "Mesh scene assertion failed") {
	if (!value) throw Error(message);
}

const encodedImages = new WeakMap();

export async function freshMeshImage(image) {
	const encoded = encodedImages.get(image);
	assert(encoded, "Mesh oracle input has no declared PNG bytes");
	return createImageBitmap(encoded);
}

export function imagePixels(image, width, height) {
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(image, 0, 0, width, height);
	return ctx.getImageData(0, 0, width, height).data;
}

// Inputs and outputs are straight RGBA in 0..255; filtering/composition uses coverage.
export function sampleRgba(pixels, width, height, u, v) {
	const x = Math.max(0, Math.min(width - 1, u * width - 0.5));
	const y = Math.max(0, Math.min(height - 1, v * height - 0.5));
	const x0 = Math.floor(x),
		y0 = Math.floor(y),
		fx = x - x0,
		fy = y - y0;
	const result = [0, 0, 0, 0];
	for (const [px, py, weight] of [
		[x0, y0, (1 - fx) * (1 - fy)],
		[Math.min(x0 + 1, width - 1), y0, fx * (1 - fy)],
		[x0, Math.min(y0 + 1, height - 1), (1 - fx) * fy],
		[Math.min(x0 + 1, width - 1), Math.min(y0 + 1, height - 1), fx * fy],
	]) {
		const i = (py * width + px) * 4,
			alpha = pixels[i + 3] / 255;
		for (let c = 0; c < 3; c++) result[c] += pixels[i + c] * alpha * weight;
		result[3] += alpha * weight;
	}
	if (result[3] > 0) for (let c = 0; c < 3; c++) result[c] /= result[3];
	result[3] *= 255;
	return result;
}

export function over(top, bottom) {
	const a = top[3] / 255,
		b = bottom[3] / 255,
		alpha = a + b * (1 - a);
	if (!alpha) return [0, 0, 0, 0];
	return [0, 1, 2]
		.map((c) => (top[c] * a + bottom[c] * b * (1 - a)) / alpha)
		.concat(alpha * 255);
}

export function comparePixels(
	actual,
	expected,
	{
		label = "mesh pixels",
		mask,
		maxPremul = 5,
		maxAlpha = 3,
		meanPremul = 1.5,
		minPixels = 1000,
	} = {},
) {
	assert(
		actual.length === expected.length && actual.length % 4 === 0,
		`${label}: dimensions`,
	);
	assert(
		!mask || mask.length === actual.length / 4,
		`${label}: mask dimensions`,
	);
	let checked = 0,
		maximum = 0,
		alphaMaximum = 0,
		sum = 0,
		alphaSum = 0;
	for (let i = 0; i < actual.length; i += 4) {
		if (mask && !mask[i / 4]) continue;
		checked++;
		const alphaError = Math.abs(actual[i + 3] - expected[i + 3]);
		alphaMaximum = Math.max(alphaMaximum, alphaError);
		alphaSum += alphaError;
		for (let c = 0; c < 3; c++) {
			const error = Math.abs(
				(actual[i + c] * actual[i + 3]) / 255 -
					(expected[i + c] * expected[i + 3]) / 255,
			);
			maximum = Math.max(maximum, error);
			sum += error;
		}
	}
	const result = {
		label,
		pixels: checked,
		coverage: checked / (actual.length / 4),
		maxPremul: maximum,
		maxAlpha: alphaMaximum,
		meanPremul: sum / (checked * 3),
		meanAlpha: alphaSum / checked,
	};
	if (
		maximum > maxPremul ||
		alphaMaximum > maxAlpha ||
		result.meanPremul > meanPremul
	) {
		const samples = [];
		for (let i = 0; i < actual.length; i += 4) {
			if (mask && !mask[i / 4]) continue;
			const error = Math.abs(actual[i + 3] - expected[i + 3]);
			if (error >= Math.max(2, alphaMaximum - 1) && samples.length < 32)
				samples.push({
					pixel: i / 4,
					actual: Array.from(actual.subarray(i, i + 4)),
					expected: Array.from(expected.subarray(i, i + 4)),
					alphaError: error,
				});
		}
		Reflect.set(globalThis, "__meshScenesFailure", {
			label,
			actual: base64(actual),
			expected: base64(expected),
			mask: mask ? base64(mask) : null,
			result,
			samples,
		});
	}
	assert(
		checked >= minPixels &&
			maximum <= maxPremul &&
			alphaMaximum <= maxAlpha &&
			result.meanPremul <= meanPremul,
		`${label}: ${JSON.stringify(result)}`,
	);
	return result;
}

export async function makeMeshAssets() {
	const resources = [],
		images = {},
		sourceChecks = [];
	for (const [name, id] of [
		["a", "mesh-a.png"],
		["b", "mesh-b.png"],
	]) {
		const image = new OffscreenCanvas(192, 108),
			ctx = image.getContext("2d");
		const pixels = ctx.createImageData(192, 108);
		for (let y = 0; y < 108; y++)
			for (let x = 0; x < 192; x++) {
				const i = (y * 192 + x) * 4,
					checker = (Math.floor(x / 16) + Math.floor(y / 12)) % 2;
				const colors =
					name === "a"
						? [32 + (200 * x) / 191, 30 + (180 * y) / 107, checker ? 220 : 60]
						: [
								220 - (160 * y) / 107,
								200 - (140 * x) / 191,
								checker ? 20 : 180,
							];
				for (let c = 0; c < 3; c++) pixels.data[i + c] = colors[c];
				const hole =
					name === "a"
						? x >= 82 && x < 106 && y >= 40 && y < 68
						: x >= 32 && x < 56 && y >= 22 && y < 50;
				pixels.data[i + 3] =
					x < 6 || x >= 186 || y < 6 || y >= 102 || hole
						? 0
						: name === "a"
							? x < 96
								? 255
								: 128
							: y < 54
								? 192
								: 255;
			}
		ctx.putImageData(pixels, 0, 0);
		const body = await (
			await image.convertToBlob({ type: "image/png" })
		).arrayBuffer();
		const sha256 = [
			...new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
		]
			.map((v) => v.toString(16).padStart(2, "0"))
			.join("");
		resources.push({
			body,
			resource: {
				id,
				kind: "image",
				mimeType: "image/png",
				byteLength: body.byteLength,
				sha256,
				attachmentKey: `programmatic-sha256-${sha256}`,
			},
		});
		// Fit the declared PNG input: Canvas-backed and decoded-bitmap sources can
		// use different browser downsampling filters at fractional coordinates.
		const encoded = new Blob([body], { type: "image/png" });
		const decoded = await createImageBitmap(encoded);
		encodedImages.set(decoded, encoded);
		sourceChecks.push(
			comparePixels(
				imagePixels(decoded, 192, 108),
				imagePixels(image, 192, 108),
				{
					label: `PNG ${name} lossless coverage`,
					maxPremul: 1,
					maxAlpha: 0,
					meanPremul: 0.35,
					minPixels: 192 * 108,
				},
			),
		);
		images[name] = decoded;
	}
	return { resources, images, sourceChecks };
}

export function sceneSource(resources, scene, settings = {}) {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 192,
		height: 108,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 19,
		...settings,
		resources: resources.map((r) => r.resource),
		recipe: {
			version: 1,
			root: "scene",
			songStartSeconds: 0,
			outputRoles: ["foreground"],
			nodes: [{ id: "scene", scene }],
		},
	};
}

export function transitionSource(
	resources,
	style,
	settings = {},
	span = { startFrame: 0, durationFrames: 24 },
) {
	const source = sceneSource(resources, {}, settings);
	const pose = { x: 0.5, y: 0.5, height: 1, rotation: 0, opacity: 1 };
	source.recipe.root = "mix";
	source.recipe.nodes = [
		...["a", "b"].map((name) => ({
			id: name,
			scene: {
				kind: "illust",
				motion: { startFrame: 0, durationFrames: source.durationFrames - 1 },
				easing: "linear",
				sprites: [
					{
						image: `mesh-${name}.png`,
						role: "foreground",
						from: { ...pose },
						to: { ...pose },
						anchor: [0.5, 0.5],
					},
				],
			},
		})),
		{
			id: "mix",
			scene: {
				kind: "transition",
				from: "a",
				to: "b",
				span,
				easing: "linear",
				style,
			},
		},
	];
	return source;
}

export function base64(bytes) {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 8192)
		binary += String.fromCharCode(
			...bytes.subarray(i, Math.min(i + 8192, bytes.length)),
		);
	return btoa(binary);
}

export function opaqueOracle(pixels, background = [16, 32, 48, 255]) {
	const output = new Uint8ClampedArray(pixels.length);
	for (let i = 0; i < pixels.length; i += 4)
		output.set(over(pixels.subarray(i, i + 4), background), i);
	return output;
}
