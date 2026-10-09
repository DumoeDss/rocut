import type {
	MvEase,
	MvSpan,
} from "../../packages/editor-contracts/src/mv-recipe";
import type { MvShatter } from "../../packages/editor-contracts/src/mv-shatter";
import { assert, freshMeshImage, sampleRgba } from "./mesh-scenes-support.mjs";
import {
	affineShatterSource,
	shatterGeometry,
	shatterSourceAt,
	type Point,
	type ShatterCell,
	type ShatterGeometry,
} from "./shatter-oracle-geometry";

export type ShatterCounterexample =
	| "rectangles"
	| "affineUv"
	| "reverseDepth"
	| "noRefraction"
	| "shiftAlpha"
	| "shadowsAfterColor";
export interface ShatterOracleOptions {
	seed?: number;
	span?: MvSpan;
	easing?: MvEase;
	control?: ShatterCounterexample;
	edgeMargin?: number;
}
export interface ShatterOracleStats {
	fragmentCount: number;
	vertices: number;
	triangles: number;
	nonAxisEdges: number;
	colorSamples: number;
	shadowSamples: number;
	refractionSamples: number;
	transparentFallback: number;
	outsideFallback: number;
	maskedPixels: number;
}
export interface ShatterOracleFrame {
	pixels: Uint8ClampedArray;
	mask: Uint8Array;
	stats: ShatterOracleStats;
}

function easedProgress(
	frame: number,
	{
		span = { startFrame: 0, durationFrames: 24 },
		easing = "linear",
	}: ShatterOracleOptions,
) {
	assert(
		span.durationFrames > 0,
		"Shatter oracle requires a positive source-frame span",
	);
	const p = Math.max(
		0,
		Math.min(1, (frame - span.startFrame) / span.durationFrames),
	);
	if (p === 0 || p === 1) return p;
	switch (easing) {
		case "linear":
			return p;
		case "inOutSine":
			return (1 - Math.cos(Math.PI * p)) / 2;
		case "inOutCubic":
			return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
		case "inExpo":
			return 2 ** (10 * p - 10);
		case "outExpo":
			return 1 - 2 ** (-10 * p);
		case "inOutExpo":
			return p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2;
		case "inQuad":
			return p * p;
		case "outQuad":
			return 1 - (1 - p) ** 2;
	}
}

async function fittedTexture(
	image: ImageBitmap,
	settings: MvShatter,
	width: number,
	height: number,
) {
	const bitmap = await freshMeshImage(image),
		canvas = new OffscreenCanvas(width, height);
	try {
		const context = canvas.getContext("2d")!;
		const [x, y, w, h] = [
			settings.rect[0] * width,
			settings.rect[1] * height,
			settings.rect[2] * width,
			settings.rect[3] * height,
		];
		context.beginPath();
		context.rect(x, y, w, h);
		context.clip();
		if (settings.fit === "stretch") context.drawImage(bitmap, x, y, w, h);
		else {
			const ratio = (settings.fit === "contain" ? Math.min : Math.max)(
				w / bitmap.width,
				h / bitmap.height,
			);
			context.drawImage(
				bitmap,
				x + (w - bitmap.width * ratio) / 2,
				y + (h - bitmap.height * ratio) / 2,
				bitmap.width * ratio,
				bitmap.height * ratio,
			);
		}
		return context.getImageData(0, 0, width, height).data;
	} finally {
		bitmap.close();
		canvas.width = 1;
		canvas.height = 1;
	}
}

function boundaryDistance(point: Point, a: Point, b: Point) {
	const dx = b[0] - a[0],
		dy = b[1] - a[1],
		length = dx * dx + dy * dy;
	const t =
		length === 0
			? 0
			: Math.max(
					0,
					Math.min(
						1,
						((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length,
					),
				);
	return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

function bounds(
	outline: Point[],
	width: number,
	height: number,
	margin: number,
) {
	return [
		Math.max(0, Math.floor(Math.min(...outline.map((p) => p[0])) - margin)),
		Math.min(
			width - 1,
			Math.ceil(Math.max(...outline.map((p) => p[0])) + margin),
		),
		Math.max(0, Math.floor(Math.min(...outline.map((p) => p[1])) - margin)),
		Math.min(
			height - 1,
			Math.ceil(Math.max(...outline.map((p) => p[1])) + margin),
		),
	];
}

function rasterLayer({
	geometry,
	cell,
	shadow,
	settings,
	p,
	texture,
	width,
	height,
	options,
	result,
	stats,
}: {
	geometry: ShatterGeometry;
	cell: ShatterCell;
	shadow: boolean;
	settings: MvShatter;
	p: number;
	texture: Uint8ClampedArray;
	width: number;
	height: number;
	options: ShatterOracleOptions;
	result: ShatterOracleFrame;
	stats: ShatterOracleStats;
}) {
	const outline = shadow ? cell.shadowOutline : cell.outline,
		margin = options.edgeMargin ?? 1.25;
	const [left, right, top, bottom] = bounds(outline, width, height, margin);
	for (let y = top; y <= bottom; y++)
		for (let x = left; x <= right; x++) {
			const point: Point = [x + 0.5, y + 0.5],
				pixel = y * width + x,
				offset = pixel * 4;
			// Only polygon boundaries are excluded. No texture hole or fan diagonal is masked.
			if (
				margin > 0 &&
				outline.some(
					(a, i) =>
						boundaryDistance(point, a, outline[(i + 1) % outline.length]) <=
						margin,
				)
			)
				result.mask[pixel] = 0;
			let source = shatterSourceAt(geometry, cell, point, shadow);
			if (!source) continue;
			if (!shadow && options.control === "affineUv")
				source = affineShatterSource(cell, point);
			if (!source) continue;
			const u = source[0] / width,
				v = source[1] / height;
			if (u < 0 || u > 1 || v < 0 || v > 1) continue;
			const base = sampleRgba(texture, width, height, u, v);
			let color = base,
				alpha = base[3];
			if (shadow) stats.shadowSamples++;
			else {
				stats.colorSamples++;
				const [dx, dy] =
					options.control === "noRefraction" ? [0, 0] : cell.colorOffset;
				if (dx !== 0 || dy !== 0) {
					if (u + dx < 0 || u + dx > 1 || v + dy < 0 || v + dy > 1) {
						if (alpha > 0) stats.outsideFallback++;
					} else {
						const shifted = sampleRgba(texture, width, height, u + dx, v + dy);
						if (shifted[3] > 0) {
							color = shifted;
							if (alpha > 0) stats.refractionSamples++;
						} else if (alpha > 0) stats.transparentFallback++;
						if (options.control === "shiftAlpha") alpha = shifted[3];
					}
				}
			}
			const coverage =
				(alpha / 255) * settings.opacity * (shadow ? settings.shadow * p : 1);
			const shade = shadow ? 0 : cell.brightness;
			// Keep an 8-bit premultiplied framebuffer between painter operations, as the
			// raster target does. Convert to straight RGBA only after all layers finish.
			for (let channel = 0; channel < 3; channel++)
				result.pixels[offset + channel] =
					color[channel] * shade * coverage +
					result.pixels[offset + channel] * (1 - coverage);
			result.pixels[offset + 3] =
				coverage * 255 + result.pixels[offset + 3] * (1 - coverage);
		}
}

export async function sampleShatter(
	image: ImageBitmap,
	settings: MvShatter,
	frame: number,
	width: number,
	height: number,
	options: ShatterOracleOptions = {},
): Promise<ShatterOracleFrame> {
	assert(
		width > 0 &&
			height > 0 &&
			Number.isInteger(width) &&
			Number.isInteger(height),
		"Invalid Shatter oracle dimensions",
	);
	assert(
		(options.edgeMargin ?? 1.25) >= 0 && (options.edgeMargin ?? 1.25) <= 2,
		"Invalid Shatter oracle edge margin",
	);
	const p = easedProgress(frame, options),
		texture = await fittedTexture(image, settings, width, height);
	const stats: ShatterOracleStats = {
		fragmentCount: settings.fragments,
		vertices: 0,
		triangles: 0,
		nonAxisEdges: 0,
		colorSamples: 0,
		shadowSamples: 0,
		refractionSamples: 0,
		transparentFallback: 0,
		outsideFallback: 0,
		maskedPixels: 0,
	};
	const result: ShatterOracleFrame = {
		pixels: new Uint8ClampedArray(texture.length),
		mask: new Uint8Array(width * height).fill(1),
		stats,
	};
	if (settings.opacity === 0) return result;
	const neutral =
		settings.spread === 0 &&
		settings.spin === 0 &&
		settings.gravity === 0 &&
		settings.depth === 0 &&
		settings.shadow === 0;
	if (p === 0 || neutral) {
		const [left, top, rw, rh] = [
			settings.rect[0] * width,
			settings.rect[1] * height,
			settings.rect[2] * width,
			settings.rect[3] * height,
		];
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const offset = (y * width + x) * 4;
				if (
					p > 0 &&
					(x + 0.5 < left ||
						x + 0.5 >= left + rw ||
						y + 0.5 < top ||
						y + 0.5 >= top + rh)
				)
					continue;
				result.pixels.set(texture.subarray(offset, offset + 4), offset);
				result.pixels[offset + 3] *= settings.opacity;
			}
		return result;
	}
	const geometry = shatterGeometry({
		settings,
		progress: p,
		width,
		height,
		seed: options.seed ?? 19,
		rectangles: options.control === "rectangles",
	});
	for (const cell of geometry.cells) {
		stats.vertices += cell.source.length;
		stats.triangles += (cell.source.length - 2) * (settings.shadow > 0 ? 2 : 1);
		stats.nonAxisEdges += cell.source.filter((a, i) => {
			const b = cell.source[(i + 1) % cell.source.length];
			return Math.abs(a[0] - b[0]) > 1e-8 && Math.abs(a[1] - b[1]) > 1e-8;
		}).length;
	}
	const colors = [...geometry.cells].sort(
		(a, b) => a.worldCenter[2] - b.worldCenter[2] || a.index - b.index,
	);
	if (options.control === "reverseDepth") colors.reverse();
	const layers = colors.map((cell) => ({ cell, shadow: false }));
	const shadows =
		settings.shadow > 0
			? geometry.cells.map((cell) => ({ cell, shadow: true }))
			: [];
	for (const layer of options.control === "shadowsAfterColor"
		? [...layers, ...shadows]
		: [...shadows, ...layers])
		rasterLayer({
			geometry,
			...layer,
			settings,
			p,
			texture,
			width,
			height,
			options,
			result,
			stats,
		});
	for (let offset = 0; offset < result.pixels.length; offset += 4) {
		const alpha = result.pixels[offset + 3];
		if (alpha > 0)
			for (let channel = 0; channel < 3; channel++)
				result.pixels[offset + channel] =
					(result.pixels[offset + channel] * 255) / alpha;
	}
	stats.maskedPixels = result.mask.reduce(
		(sum, value) => sum + (value === 0 ? 1 : 0),
		0,
	);
	return result;
}

export function shatterControlDifference(
	reference: ShatterOracleFrame,
	counterexample: ShatterOracleFrame,
	threshold = 3,
): number {
	assert(
		reference.pixels.length === counterexample.pixels.length,
		"Shatter counterexample dimensions differ",
	);
	let changed = 0;
	for (let pixel = 0; pixel < reference.mask.length; pixel++) {
		if (!reference.mask[pixel] || !counterexample.mask[pixel]) continue;
		const offset = pixel * 4,
			a = reference.pixels[offset + 3],
			b = counterexample.pixels[offset + 3];
		if (
			Math.abs(a - b) > threshold ||
			[0, 1, 2].some(
				(channel) =>
					Math.abs(
						(reference.pixels[offset + channel] * a) / 255 -
							(counterexample.pixels[offset + channel] * b) / 255,
					) > threshold,
			)
		)
			changed++;
	}
	return changed;
}
