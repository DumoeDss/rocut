import { expect, test } from "bun:test";
import {
	blazeModes,
	blazeParameters,
	blazeRate,
	blazeSeekTicks,
	blazeSource,
} from "./blaze-cases";
import {
	blazeContext,
	blazeDifference,
	blazeExpected,
	blazeOver,
	blazePixelField,
	blazeSample,
} from "./blaze-oracle";
import { blazeStraightBytes } from "./blaze-oracle-sampling";

const width = 192,
	height = 128;
const source = blazeSource({ width, height });
const request = {
	source,
	width,
	height,
	params: blazeParameters,
	ticks: 48000,
	rate: blazeRate,
};

test("four independent modes and their combination are distinguishable from disabled output", () => {
	for (const name of ["flame", "sparks", "smoke", "heat", "combined"]) {
		const result = blazeExpected({
			...request,
			params: { ...blazeParameters, ...blazeModes[name] },
		});
		expect(result.activePixels).toBeGreaterThan(0);
		expect(
			blazeDifference({ actual: source, expected: result.pixels, minimum: 2 })
				.changedPixels,
		).toBeGreaterThan(0);
		if (name !== "combined") {
			for (const [mode, mask] of Object.entries(result.modes))
				expect(mask.some(Boolean)).toBe(mode === name);
		}
	}
});

test("disabled, amount zero and all contribution zeros preserve every source byte including hidden RGB", () => {
	for (const override of [
		{ enabled: false },
		{ params: { ...blazeParameters, amount: 0 } },
		{ params: { ...blazeParameters, ...blazeModes.zeroContributions } },
	]) {
		const result = blazeExpected({ ...request, ...override });
		expect(result.pixels).toEqual(source);
		expect(result.activePixels).toBe(0);
		expect(result.identity.every(Boolean)).toBe(true);
	}
});

test("transparent coverage is additive for overlays, but pure heat cannot create alpha", () => {
	const transparent = blazeSource({ kind: "transparent" });
	for (const name of ["flame", "sparks", "smoke", "heat"]) {
		const result = blazeExpected({
			...request,
			source: transparent,
			params: { ...blazeParameters, ...blazeModes[name] },
		});
		const alpha = Array.from(
			{ length: width * height },
			(_, pixel) => result.pixels[pixel * 4 + 3],
		);
		expect(alpha.some((value) => value > 0)).toBe(name !== "heat");
		if (name === "heat")
			expect(result.premultiplied.every((value) => value === 0)).toBe(true);
	}
	expect(Array.from(blazeStraightBytes([1e-6, 0, 0, 1e-6]))).toEqual([
		255, 0, 0, 0,
	]);
});

test("premultiplied source-over order is smoke then flame then spark", () => {
	let pixel = blazeOver({
		base: [0, 0, 0.5, 0.5],
		color: [0.16, 0.18, 0.2],
		alpha: 0.25,
	});
	pixel = blazeOver({ base: pixel, color: [1, 0.12, 0.015], alpha: 0.5 });
	pixel = blazeOver({ base: pixel, color: [1, 0.75, 0.25], alpha: 0.25 });
	for (const [index, expected] of [0.64, 0.249375, 0.2275, 0.859375].entries())
		expect(pixel[index]).toBeCloseTo(expected, 12);
});

test("combined output matches the closed-form composition of independent contributions and rejects swapped layers", () => {
	const transparent = blazeSource({ kind: "transparent" });
	const isolate = (key: "flameOpacity" | "smokeOpacity" | "sparkOpacity") =>
		blazeExpected({
			...request,
			source: transparent,
			params: {
				...blazeParameters,
				...blazeModes.zeroContributions,
				[key]: blazeParameters[key],
			},
		}).premultiplied;
	const smoke = isolate("smokeOpacity"),
		flame = isolate("flameOpacity"),
		spark = isolate("sparkOpacity");
	const heat = blazeExpected({
		...request,
		params: {
			...blazeParameters,
			flameOpacity: 0,
			smokeOpacity: 0,
			sparkOpacity: 0,
		},
	}).premultiplied;
	const combined = blazeExpected(request).premultiplied;
	let swappedLayerPixels = 0;
	for (let offset = 0; offset < combined.length; offset += 4) {
		const sa = smoke[offset + 3],
			fa = flame[offset + 3],
			pa = spark[offset + 3];
		let swappedDifference = 0;
		for (let channel = 0; channel < 4; channel++) {
			const expected =
				heat[offset + channel] * (1 - sa) * (1 - fa) * (1 - pa) +
				smoke[offset + channel] * (1 - fa) * (1 - pa) +
				flame[offset + channel] * (1 - pa) +
				spark[offset + channel];
			expect(combined[offset + channel]).toBeCloseTo(expected, 12);
			const swapped =
				heat[offset + channel] * (1 - sa) * (1 - fa) * (1 - pa) +
				flame[offset + channel] * (1 - sa) * (1 - pa) +
				smoke[offset + channel] * (1 - pa) +
				spark[offset + channel];
			swappedDifference = Math.max(
				swappedDifference,
				Math.abs(swapped - combined[offset + channel]),
			);
		}
		swappedLayerPixels += Number(swappedDifference > 2 / 255);
	}
	expect(swappedLayerPixels).toBeGreaterThan(64);
});

test("reverse seek is stateless, exact binary speed repeats and wrong seed/first-frame output is rejected", () => {
	const frames = new Map<number, ReturnType<typeof blazeExpected>["pixels"]>();
	for (const ticks of blazeSeekTicks) {
		const frame = blazeExpected({ ...request, ticks }).pixels;
		const previous = frames.get(ticks);
		if (previous) expect(frame).toEqual(previous);
		frames.set(ticks, frame);
	}
	const current = blazeExpected(request).pixels;
	const period = blazeExpected({
		...request,
		ticks: request.ticks + 240000,
	}).pixels;
	expect(current).toEqual(period);
	const otherSeed = blazeExpected({
		...request,
		params: { ...blazeParameters, seed: 27182 },
	}).pixels;
	expect(
		blazeDifference({ actual: current, expected: otherSeed, minimum: 2 })
			.changedPixels,
	).toBeGreaterThan(64);
	expect(
		blazeDifference({ actual: frames.get(0)!, expected: current, minimum: 2 })
			.changedPixels,
	).toBeGreaterThan(64);
});

test("heat uses actual displaced bilinear input and its vertical sign matters on a stress source", () => {
	const stress = blazeSource({ pattern: "stress" });
	const params = { ...blazeParameters, ...blazeModes.heat, amount: 1 };
	const result = blazeExpected({ ...request, source: stress, params });
	const context = blazeContext({ ...request, params });
	let rejectedNearest = 0,
		rejectedVerticalFlip = 0;
	for (let y = 20; y < height - 20; y += 7) {
		for (let x = 20; x < width - 20; x += 9) {
			const field = blazePixelField({ context, x, y });
			const offset = (y * width + x) * 4;
			const expected = result.pixels.slice(offset, offset + 4);
			const nearest = blazeStraightBytes(
				blazeSample({
					pixels: stress,
					width,
					height,
					x: Math.round(x + field.dx),
					y: Math.round(y + field.dy),
				}),
			);
			const flipped = blazeStraightBytes(
				blazeSample({
					pixels: stress,
					width,
					height,
					x: x + field.dx,
					y: y - field.dy,
				}),
			);
			rejectedNearest += blazeDifference({
				actual: nearest,
				expected,
				minimum: 2,
			}).changedPixels;
			rejectedVerticalFlip += blazeDifference({
				actual: flipped,
				expected,
				minimum: 2,
			}).changedPixels;
		}
	}
	expect(rejectedNearest).toBeGreaterThan(16);
	expect(rejectedVerticalFlip).toBeGreaterThan(16);
	expect(result.exteriorPixels).toBeGreaterThan(0);
});
