import type { MvCloth, MvClothScene } from "@opencut/editor-contracts";
import { clothGeometry } from "./cloth-oracle-mesh";
import type { ClothControl } from "./cloth-oracle-physics";
import { rasterMesh } from "./mesh-scenes-mesh-oracle.mjs";
import {
	assert,
	comparePixels,
	freshMeshImage,
} from "./mesh-scenes-support.mjs";

export interface ClothSampleOptions {
	seed?: number;
	span?: MvClothScene["span"];
	frameRate?: { numerator: number; denominator: number };
	control?: ClothControl;
}

export interface ClothOracleFrame {
	pixels: Uint8ClampedArray;
	mask: Uint8Array;
	stats: {
		steps: number;
		events: number;
		faces: number;
		pinned: number;
		maskedPixels: number;
	};
}

async function fittedTexture(
	image: ImageBitmap,
	settings: MvCloth,
	width: number,
	height: number,
) {
	const bitmap = await freshMeshImage(image),
		canvas = new OffscreenCanvas(width, height);
	try {
		const context = canvas.getContext("2d")!;
		const [x, y, w, h] = settings.rect.map(
			(value, axis) => value * (axis % 2 === 0 ? width : height),
		);
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

/** Source-clock mapping and a separate CPU solver; no Worker/WASM plans are inputs. */
export async function sampleCloth(
	image: ImageBitmap,
	settings: MvCloth,
	frame: number,
	width: number,
	height: number,
	options: ClothSampleOptions = {},
): Promise<ClothOracleFrame> {
	const span = options.span ?? { startFrame: 0, durationFrames: 24 },
		rate = options.frameRate ?? { numerator: 30, denominator: 1 },
		ticksPerFrame = (120000 * rate.denominator) / rate.numerator;
	assert(
		Number.isSafeInteger(frame) &&
			frame >= 0 &&
			Number.isSafeInteger(ticksPerFrame) &&
			ticksPerFrame > 0,
		"Cloth oracle requires an exact integer source clock",
	);
	const elapsedTicks =
		Math.max(0, Math.min(span.durationFrames, frame - span.startFrame)) *
		ticksPerFrame;
	const geometry = clothGeometry({
		settings,
		elapsedTicks,
		width,
		height,
		seed: options.seed ?? 19,
		control: options.control,
	});
	const texture = await fittedTexture(image, settings, width, height);
	const stats: ClothOracleFrame["stats"] = {
		steps: geometry.physics.steps,
		events: geometry.physics.eventCount,
		faces: geometry.faces.length,
		pinned: geometry.physics.particles.filter((particle) => particle.pinned)
			.length,
		maskedPixels: 0,
	};
	const neutral =
		settings.gravity === 0 &&
		settings.gust === 0 &&
		settings.wind.every((value) => value === 0) &&
		settings.events.length === 0;
	if (geometry.fullImage || neutral || settings.opacity === 0) {
		const [left, top, rw, rh] = geometry.rect;
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const offset = (y * width + x) * 4;
				if (
					settings.opacity === 0 ||
					(!geometry.fullImage &&
						(x + 0.5 < left ||
							x + 0.5 >= left + rw ||
							y + 0.5 < top ||
							y + 0.5 >= top + rh))
				)
					texture.fill(0, offset, offset + 4);
				else texture[offset + 3] *= settings.opacity;
			}
		return {
			pixels: texture,
			mask: new Uint8Array(width * height).fill(1),
			stats,
		};
	}
	// Active comparisons exclude 1.25 px around every triangle edge, including
	// shared diagonals. They do not establish full dynamic-edge coverage.
	// Initial and zero-force comparisons above deliberately have no edge mask.
	const raster = rasterMesh({
		faces: geometry.faces,
		texture,
		width,
		height,
		edgeMargin: 1.25,
	});
	stats.maskedPixels = raster.mask.reduce(
		(sum: number, value: number) => sum + (value === 0 ? 1 : 0),
		0,
	);
	return { pixels: raster.pixels, mask: raster.mask, stats };
}

export function clothDifference(a: ClothOracleFrame, b: ClothOracleFrame) {
	assert(a.pixels.length === b.pixels.length, "Cloth difference dimensions");
	let changed = 0;
	for (let pixel = 0; pixel < a.mask.length; pixel++) {
		if (!a.mask[pixel] || !b.mask[pixel]) continue;
		const offset = pixel * 4,
			alphaA = a.pixels[offset + 3],
			alphaB = b.pixels[offset + 3];
		if (
			Math.abs(alphaA - alphaB) > 3 ||
			[0, 1, 2].some(
				(channel) =>
					Math.abs(
						(a.pixels[offset + channel] * alphaA) / 255 -
							(b.pixels[offset + channel] * alphaB) / 255,
					) > 3,
			)
		)
			changed++;
	}
	return changed;
}

export function rejectClothCounterexample(
	reference: ClothOracleFrame,
	wrong: ClothOracleFrame,
	name: string,
) {
	const mask = reference.mask.map((value, i) =>
		value && wrong.mask[i] ? 1 : 0,
	);
	assert(
		mask.filter(Boolean).length > mask.length * 0.25,
		`Cloth ${name} counterexample coverage`,
	);
	const diagnostic = Reflect.get(globalThis, "__meshScenesFailure");
	let rejected = false;
	try {
		comparePixels(wrong.pixels, reference.pixels, {
			label: `Cloth negative ${name}`,
			mask,
			maxPremul: 5,
			maxAlpha: 3,
			meanPremul: 1.5,
			minPixels: mask.length * 0.25,
		});
	} catch {
		rejected = true;
	} finally {
		if (diagnostic === undefined)
			Reflect.deleteProperty(globalThis, "__meshScenesFailure");
		else Reflect.set(globalThis, "__meshScenesFailure", diagnostic);
	}
	assert(rejected, `Cloth ${name} would pass the actual pixel gate`);
	return clothDifference(reference, wrong);
}
