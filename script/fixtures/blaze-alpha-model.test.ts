import { expect, test } from "bun:test";
import {
	alphaAdjustment,
	alphaAnalytic,
	alphaContrasts,
	alphaIdentityPass,
	alphaRows,
	alphaSource,
	alphaStagePlan,
} from "./blaze-alpha-cases";
import {
	alphaMetrics,
	alphaObservation,
	alphaPredictions,
} from "./blaze-alpha-model";
import { alphaEmptyStackRejection } from "./blaze-alpha-admission";

test("B uses a legal explicit identity pass and never substitutes an empty stack", () => {
	expect(alphaIdentityPass()).toEqual({
		shader: "vhs",
		uniforms: [
			{ name: "amount", value: [0] },
			{ name: "noise", value: [0] },
			{ name: "scanlines", value: [0] },
			{ name: "bleed", value: [0] },
			{ name: "seed", value: [1] },
			{ name: "frame", value: [0] },
		],
	});
	expect(
		alphaStagePlan.some((stage) => stage.id === "B0-identity-returned"),
	).toBe(true);
	expect(alphaStagePlan.some((stage) => stage.id.includes("empty"))).toBe(
		false,
	);
});

test("empty-stack check accepts only the precise production rejection, not success or unrelated errors", async () => {
	for (const thrown of [
		"At least one effect pass is required",
		new Error("At least one effect pass is required"),
	])
		expect(
			await alphaEmptyStackRejection(() => {
				throw thrown;
			}),
		).toEqual({
			attempted: true,
			rejected: true,
			matched: true,
			error: "At least one effect pass is required",
		});
	expect((await alphaEmptyStackRejection(() => undefined)).matched).toBe(false);
	expect(
		(
			await alphaEmptyStackRejection(() => {
				throw Error("GPU lost");
			})
		).matched,
	).toBe(false);
	expect(
		(
			await alphaEmptyStackRejection(() =>
				Promise.reject("At least one effect pass is required"),
			)
		).matched,
	).toBe(true);
});

test("independent source covers all RGB bytes at every alpha with asymmetric channels", () => {
	const image = alphaSource();
	expect([image.width, image.height]).toEqual([256, 16]);
	for (let y = 0; y < image.height; y++) {
		for (let channel = 0; channel < 3; channel++) {
			const values = new Set<number>();
			for (let x = 0; x < image.width; x++)
				values.add(image.pixels[(y * image.width + x) * 4 + channel]);
			expect(values.size).toBe(256);
		}
		expect(image.pixels[y * image.width * 4 + 3]).toBe(alphaRows[y]);
	}
	expect(new Set(alphaStagePlan.map((stage) => stage.id)).size).toBe(17);
});

test("black contrast analytic result uses explicit 41/46/51 bytes and preserves alpha", () => {
	for (const [index, contrast] of alphaContrasts.entries()) {
		const image = alphaAnalytic(contrast);
		for (let y = 0; y < image.height; y++) {
			expect([
				...image.pixels.subarray(y * image.width * 4, y * image.width * 4 + 4),
			]).toEqual(
				alphaRows[y]
					? [
							[41, 46, 51][index],
							[41, 46, 51][index],
							[41, 46, 51][index],
							alphaRows[y],
						]
					: [0, 0, 0, 0],
			);
		}
		expect(alphaAdjustment(contrast).uniforms.map((item) => item.name)).toEqual(
			["exposure", "contrast", "saturation", "temperature", "tint"],
		);
	}
	expect(() => alphaAnalytic(-33)).toThrow();
});

test("fixed model exposes alpha16 amplification without changing premultiplied integer bytes", () => {
	const native = new Uint8ClampedArray([41, 46, 51, 16]);
	const observed = alphaObservation(native);
	expect([...observed]).toEqual([48, 48, 48, 16]);
	const metric = alphaMetrics(observed, native);
	expect(metric.alphaDifferences).toBe(0);
	expect(metric.integerPremultipliedDifferences).toBe(0);
	expect(metric.straightMean).toBe(4);
	expect(metric.straightMaximum).toBe(7);
});

test("metric mean keeps fractional premultiplied values and all three channels", () => {
	const actual = new Uint8ClampedArray([1, 0, 0, 1]),
		expected = new Uint8ClampedArray([0, 0, 0, 1]);
	expect(alphaMetrics(actual, expected).premultipliedMean).toBe(1 / 255 / 3);
	expect(alphaMetrics(actual, expected).visibleChannels).toBe(0);
	expect(
		alphaMetrics(
			new Uint8ClampedArray([9, 0, 0, 16]),
			new Uint8ClampedArray([0, 0, 0, 16]),
		).visibleChannels,
	).toBe(3);
	expect(() => alphaMetrics(actual, new Uint8ClampedArray(8))).toThrow();
});

test("opaque rows are identity and hidden RGB clears; all six wrong predictions are distinguishable", () => {
	const source = alphaSource(),
		predictions = alphaPredictions(source),
		modeled = predictions["single-premultiplication"];
	expect([...modeled.subarray(0, source.width * 4)]).toEqual(
		Array(source.width * 4).fill(0),
	);
	expect([...modeled.subarray(15 * source.width * 4)]).toEqual([
		...source.pixels.subarray(15 * source.width * 4),
	]);
	for (const [name, pixels] of Object.entries(predictions))
		if (name !== "single-premultiplication")
			expect(alphaMetrics(pixels, modeled).differentBytes).toBeGreaterThan(0);
	expect(
		alphaMetrics(predictions["forced-opaque"], modeled).alphaDifferences,
	).toBeGreaterThan(0);
});
